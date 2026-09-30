"""Batch expectations intake, Build 3a: the expectations group in the notes
read, role creation and dedupe, apply ordering, the background state machine,
retry from the row alone, and the cross-contamination guarantee — one
person's number never reaches another person's draft."""
import os

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2ln")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.c2ln")
os.environ.setdefault("ANTHROPIC_API_KEY", "test")

import json  # noqa: E402
from datetime import datetime, timedelta, timezone  # noqa: E402
from types import SimpleNamespace  # noqa: E402

import pytest  # noqa: E402
from fastapi import HTTPException  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from postgrest.exceptions import APIError  # noqa: E402

import analytics  # noqa: E402
import expectations_batch as eb  # noqa: E402
import main  # noqa: E402
import routes.notes_dump as nd  # noqa: E402
import routes.role_expectations as rex  # noqa: E402
import utils  # noqa: E402


# ── an in-memory stand-in for the database client ────────────────────────

class _Q:
    def __init__(self, db, name):
        self.db, self.name = db, name
        self.filters, self.mode, self.payload, self._limit = [], "select", None, None

    @property
    def not_(self):
        outer = self

        class _Not:
            def is_(self, col, val):
                outer.filters.append(lambda r: r.get(col) is not None)
                return outer

        return _Not()

    def select(self, *_a, **_k):
        return self

    def eq(self, col, val):
        self.filters.append(lambda r: r.get(col) == val)
        return self

    def neq(self, col, val):
        self.filters.append(lambda r: r.get(col) != val)
        return self

    def in_(self, col, vals):
        self.filters.append(lambda r: r.get(col) in vals)
        return self

    def is_(self, col, val):
        self.filters.append(lambda r: r.get(col) is None if val == "null" else True)
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, n):
        self._limit = n
        return self

    def insert(self, payload):
        self.mode, self.payload = "insert", payload
        return self

    def update(self, payload):
        self.mode, self.payload = "update", payload
        return self

    def execute(self):
        self.db.log.append((self.mode, self.name))
        rows = self.db.rows.setdefault(self.name, [])
        if self.mode == "insert":
            if self.name == "role_expectation_drafts" and any(
                r["role_level_id"] == self.payload["role_level_id"] and r["status"] == "open" for r in rows
            ):
                raise APIError({"code": "23505", "message": "duplicate key"})
            row = {"id": f"{self.name}-{len(rows) + 1}", **self.payload}
            if self.name == "role_expectation_drafts":
                row.setdefault("version", 0)
                row.setdefault("updated_at", "2026-09-30T00:00:00+00:00")
            rows.append(row)
            return SimpleNamespace(data=[json.loads(json.dumps(row))])
        hit = [r for r in rows if all(f(r) for f in self.filters)]
        if self.mode == "update":
            for r in hit:
                r.update(json.loads(json.dumps(self.payload)))
        if self._limit is not None:
            hit = hit[: self._limit]
        return SimpleNamespace(data=[json.loads(json.dumps(r)) for r in hit])


class DB:
    def __init__(self):
        self.log = []
        self.rows = {
            "direct_reports": [
                {"id": "andre", "name": "Andre Okafor", "manager_id": "u1", "role_level_id": None, "role_title": None,
                 "org_unit_id": None, "archived_at": None},
                {"id": "kwame", "name": "Kwame Mensah", "manager_id": "u1", "role_level_id": None, "role_title": None,
                 "org_unit_id": None, "archived_at": None},
                {"id": "sofia", "name": "Sofia Reyes", "manager_id": "u1", "role_level_id": "rl_fe", "role_title": None,
                 "org_unit_id": None, "archived_at": None},
                {"id": "mei", "name": "Mei Tanaka", "manager_id": "u1", "role_level_id": "rl_sr", "role_title": None,
                 "org_unit_id": None, "archived_at": None},
            ],
            "org_units": [],
            "role_levels": [
                {"id": "rl_fe", "job_role": "Frontend Engineer", "job_level": 2, "role_family_id": None},
                {"id": "rl_sr", "job_role": "Senior Engineer", "job_level": 4, "role_family_id": None},
                {"id": "rl_be", "job_role": "Backend Engineer", "job_level": 2, "role_family_id": None},
            ],
            "role_families": [], "goals": [], "one_on_ones": [], "dr_capture_notes": [],
            "role_expectation_drafts": [], "role_expectation_decisions": [],
            "metric_configs": [], "skill_configs": [], "value_configs": [],
        }

    def table(self, name):
        return _Q(self, name)


TEXT = ("Andre first. Backend, mid-level, two years. I'd want a weekly written status from him.\n\n"
        "Kwame. Junior, eight months. By his 90-day mark he should own one service end to end. Ask questions early.\n\n"
        "Sofia. Solid delivery, and I should ask her what she wants next.")


def _ctx(db=None):
    return nd.build_context(db or DB(), "u1")


def _ref(ctx, report_id):
    return next(k for k, p in ctx["people"].items() if p["id"] == report_id)


def _rref(ctx, role_id):
    return next(k for k, r in ctx["roles"].items() if r["id"] == role_id)


# ── the expectations group in the read ───────────────────────────────────

def test_validate_resolves_roles_in_order_and_proposes_new_ones():
    ctx = _ctx()
    parsed = {
        "role_assignments": [{"person": _ref(ctx, "kwame"), "role": _rref(ctx, "rl_be"), "org_unit_name": "Platform"}],
        "expectations": [
            {"person": _ref(ctx, "andre"), "role": None, "job_role": "Backend Platform Engineer", "job_level": 3,
             "statement": "A weekly written status.", "excerpt": "weekly written status", "confidence": "high"},
            {"person": _ref(ctx, "kwame"), "job_role": "Junior Engineer", "job_level": 1, "confidence": "high"},
            {"person": _ref(ctx, "sofia"), "role": _rref(ctx, "rl_sr"), "confidence": "high"},  # keeps her own
            {"person": _ref(ctx, "mei"), "job_role": "Senior Engineer", "job_level": 4},        # existing by name
            {"person": "P99", "job_role": "Ghost"},
            {"person": _ref(ctx, "andre"), "job_role": "Duplicate"},
        ],
    }
    out = nd.validate_parse(parsed, ctx, TEXT)
    rows = {e["report_id"]: e for e in out["expectations"]}
    assert set(rows) == {"andre", "kwame", "sofia", "mei"}
    assert rows["andre"]["new_role"] == {"job_role": "Backend Platform Engineer", "job_level": 3, "level_stated": True}
    assert rows["andre"]["role_level_id"] is None and rows["andre"]["excerpt"] == "weekly written status"
    assert rows["kwame"]["role_level_id"] == "rl_be" and rows["kwame"]["new_role"] is None  # this read's assignment wins
    assert rows["sofia"]["role_level_id"] == "rl_fe"                                      # current role wins over a cite
    assert rows["mei"]["role_level_id"] == "rl_sr"
    # The assignment is carried by the expectation row; only the team half stays.
    (ra,) = out["role_assignments"]
    assert ra["report_id"] == "kwame" and ra["role_level_id"] is None and ra["org_unit_name"] == "Platform"


def test_an_unstated_level_is_a_visible_guess():
    ctx = _ctx()
    out = nd.validate_parse({"expectations": [
        {"person": _ref(ctx, "andre"), "job_role": "Backend Engineer II", "job_level": None},
        {"person": _ref(ctx, "kwame"), "job_role": "SRE", "job_level": 40},
    ]}, ctx, TEXT)
    rows = {e["report_id"]: e for e in out["expectations"]}
    assert rows["andre"]["new_role"] == {"job_role": "Backend Engineer II", "job_level": 1, "level_stated": False}
    assert rows["kwame"]["new_role"]["job_level"] == 10 and rows["kwame"]["new_role"]["level_stated"] is False


def _row(rid, name, role=None, new=None, low=False, statement=None):
    return {"report_id": rid, "person_name": name, "role_level_id": role, "new_role": new,
            "statement": statement, "excerpt": None, "low": low}


def test_finish_blocks_plainly_orders_by_soonest_and_preselects_five_roles():
    rows = [_row(f"p{i}", f"Person {i}", new={"job_role": f"Role {i}", "job_level": 2}) for i in range(7)]
    rows += [
        _row("open", "Olga", role="rl_open"),
        _row("done", "Dmitri", role="rl_done"),
        _row("quiet", "Quinn", new={"job_role": "Role q", "job_level": 1}),
        _row("share", "Sam", new={"job_role": "Role 0", "job_level": 2}),  # same new role as p0
        _row("unsure", "Uma", new={"job_role": "Role u", "job_level": 1}, low=True),
    ]
    slices = {r["report_id"]: f"{r['person_name']} owns things." for r in rows if r["report_id"] != "quiet"}
    rank = {"p6": 0, "p5": 1, "share": 2, "p0": 3, "p1": 4, "p2": 5, "p3": 6, "p4": 7}
    out = nd.finish_expectations(rows, slices=slices, open_draft_roles={"rl_open"}, covered_roles={"rl_done"}, rank=rank)
    by = {r["report_id"]: r for r in out}
    assert [r["report_id"] for r in out][:8] == ["p6", "p5", "share", "p0", "p1", "p2", "p3", "p4"]
    assert by["open"]["blocked"] == "open_draft" and by["done"]["blocked"] == "approved"
    assert by["quiet"]["blocked"] == "no_text" and by["quiet"]["slice"] is None
    drafted = [r["report_id"] for r in out if r["draft"]]
    # Five roles: p6, p5, Role 0 (share + p0 together), p1, p2.
    assert drafted == ["p6", "p5", "share", "p0", "p1", "p2"]
    assert not by["p3"]["draft"] and not by["unsure"]["draft"] and not by["open"]["draft"]


def test_a_statement_keeps_only_numbers_that_person_said():
    rows = [_row("andre", "Andre", new={"job_role": "BE", "job_level": 2},
                 statement="A weekly written status. Review 90 docs a quarter.")]
    nd.finish_expectations(rows, slices={"andre": "Andre, weekly written status, two years."},
                           open_draft_roles=set(), covered_roles=set(), rank={})
    assert rows[0]["statement"] == "A weekly written status."


def test_queue_rank_uses_expectation_queue_order():
    from routes.onboarding import expectation_queue
    reports = [
        {"id": "a", "name": "A", "role_level_id": None},
        {"id": "b", "name": "B", "role_level_id": "r1"},
        {"id": "c", "name": "C", "role_level_id": "r1"},
    ]
    queue = expectation_queue(reports, {"r1": "R1"}, set(), {"c": "2026-10-01", "a": "2026-10-03"}, limit=10)
    assert nd.queue_rank(reports, queue) == {"c": 0, "b": 0, "a": 1}


def test_expectation_rows_have_their_own_budget():
    drafts = {
        "org_units": [], "goals": [],
        "role_assignments": [{"report_id": f"r{i}", "low": False} for i in range(5)],
        "person_notes": [{"report_id": f"n{i}", "text": "x", "low": False} for i in range(5)],
        "expectations": [{"report_id": f"e{i}", "low": False} for i in range(nd.CAP_EXPECTATIONS + 2)],
    }
    shown, overflow = nd.rank_and_cap(drafts, [])
    assert len(shown["role_assignments"]) == 5 and len(shown["person_notes"]) == 5
    assert len(shown["expectations"]) == nd.CAP_EXPECTATIONS
    assert overflow == 2


# ── parse end to end ─────────────────────────────────────────────────────

@pytest.fixture
def client(monkeypatch):
    db = DB()
    main.app.dependency_overrides[utils.get_authenticated_client] = lambda: ("u1", db)
    sent = []
    monkeypatch.setattr(analytics, "capture", lambda uid, ev, props=None: sent.append((ev, props)))
    monkeypatch.setattr(nd, "ensure_org", lambda *a, **k: "org1")
    monkeypatch.setattr(nd, "get_email_from_token", lambda a: "m@example.com")
    yield TestClient(main.app), db, sent
    main.app.dependency_overrides.clear()


def test_parse_returns_each_persons_slice_and_writes_nothing(client, monkeypatch):
    c, db, sent = client
    ctx = _ctx(db)
    reply = json.dumps({
        "expectations": [
            {"person": _ref(ctx, "andre"), "job_role": "Backend Engineer", "job_level": 3,
             "statement": "Weekly written status.", "excerpt": "weekly written status", "confidence": "high"},
            {"person": _ref(ctx, "kwame"), "job_role": "Junior Engineer", "job_level": 1, "confidence": "high"},
        ],
        "unmatched_people": [{"name": "Priya Nair"}],
    })
    monkeypatch.setattr(nd, "generate_text", lambda *a, **k: reply)
    before = json.dumps(db.rows, sort_keys=True)
    body = c.post("/api/onboarding/notes-dump/parse", data={"text": TEXT}).json()
    assert json.dumps(db.rows, sort_keys=True) == before
    rows = {e["report_id"]: e for e in body["expectations"]}
    assert rows["andre"]["slice"].startswith("Andre first.") and "90-day" not in rows["andre"]["slice"]
    assert "90-day" in rows["kwame"]["slice"]
    assert rows["andre"]["key"].startswith("exp") and rows["andre"]["draft"] is True
    assert body["other_names"] == ["Priya Nair"] and body["max_roles"] == 5
    props = [p for e, p in sent if e == "notes_dump_parsed"][0]
    assert props["proposed_expectations"] == 2 and "Andre" not in json.dumps(sent)


# ── apply: create, dedupe, assign, then queue ────────────────────────────

@pytest.fixture
def no_background(monkeypatch):
    queued = []
    monkeypatch.setattr(nd, "draft_in_background", lambda supabase, ids, uid=None: queued.append(list(ids)))
    return queued


def _apply(c, **payload):
    return c.post("/api/onboarding/notes-dump/apply", json=payload)


def test_apply_creates_one_level_per_new_role_assigns_then_queues(client, no_background):
    c, db, sent = client
    r = _apply(c, text=TEXT, expectations=[
        {"report_id": "andre", "job_role": "Backend  Platform Engineer", "job_level": 3, "draft": True,
         "statement": "Weekly written status. 90 reviews a quarter."},
        {"report_id": "kwame", "job_role": "backend platform engineer", "job_level": 3, "draft": True},
        {"report_id": "sofia", "role_level_id": "rl_fe", "draft": False},
    ])
    assert r.status_code == 200, r.text
    body = r.json()
    new = [x for x in db.rows["role_levels"] if x["job_role"].lower() == "backend platform engineer"]
    assert len(new) == 1 and new[0]["job_level"] == 3 and new[0]["role_family_id"] is None
    assert body["roles_created"] == 1 and body["saved"]["roles"] == 2
    assert {d["id"]: d["role_level_id"] for d in db.rows["direct_reports"]}["kwame"] == new[0]["id"]
    # Level, then assignment, then the draft.
    order = [e for e in db.log if e[0] in ("insert", "update")]
    assert order.index(("insert", "role_levels")) < order.index(("update", "direct_reports")) \
        < order.index(("insert", "role_expectation_drafts"))
    (draft,) = db.rows["role_expectation_drafts"]
    a = draft["analysis"]
    assert a["status"] == "drafting" and a["source"] == "batch" and a["started_at"]
    # Both people share the role: both slices, and nothing else from the input.
    assert "weekly written status" in a["context"] and "90-day mark" in a["context"]
    assert "Sofia" not in a["context"]
    assert a["statement"] == "Weekly written status."  # 90 is Kwame's, not Andre's
    assert draft["items"] == [] and draft["status"] == "open" and draft["source_label"] == eb.SOURCE_LABEL
    assert body["drafting"][0]["people"] == ["Andre Okafor", "Kwame Mensah"]
    assert body["waiting"] == [{"report_id": "sofia", "person_name": "Sofia Reyes", "role_level_id": "rl_fe"}]
    assert no_background == [[draft["id"]]]
    props = [p for e, p in sent if e == "notes_dump_applied"][0]
    assert props["roles_created"] == 1 and props["drafts_queued"] == 1

    # Idempotent: the level is found by name and level, and the open draft is not duplicated.
    again = _apply(c, text=TEXT, expectations=[
        {"report_id": "andre", "job_role": "Backend Platform Engineer", "job_level": 3, "draft": True}]).json()
    assert again["roles_created"] == 0 and len(db.rows["role_expectation_drafts"]) == 1
    assert again["not_drafted"] == [{"report_id": "andre", "person_name": "Andre Okafor",
                                     "reason": "Andre already has a working draft — this won’t change it."}]


def test_apply_skips_approved_and_textless_roles_visibly(client, no_background):
    c, db, _ = client
    db.rows["skill_configs"].append({"id": "s1", "role_level_id": "rl_sr", "retired_at": None})
    body = _apply(c, text="Andre ships weekly.", expectations=[
        {"report_id": "mei", "role_level_id": "rl_sr", "draft": True},
        {"report_id": "kwame", "job_role": "Junior Engineer", "job_level": 1, "draft": True},
    ]).json()
    reasons = {x["person_name"]: x["reason"] for x in body["not_drafted"]}
    assert reasons["Mei Tanaka"] == "Mei’s role already has approved expectations — this won’t change them."
    assert reasons["Kwame Mensah"] == "Nothing you typed is about Kwame, so there’s nothing to draft from. Attached files aren’t kept."
    assert db.rows["role_expectation_drafts"] == [] and no_background == []
    # Kwame still got his role: rows are never silently dropped.
    assert next(d for d in db.rows["direct_reports"] if d["id"] == "kwame")["role_level_id"]


def test_apply_refuses_more_than_five_roles_before_writing(client, no_background):
    c, db, _ = client
    before = json.dumps(db.rows, sort_keys=True)
    r = _apply(c, text=TEXT, expectations=[
        {"report_id": "andre", "job_role": f"Role {i}", "job_level": 1, "draft": True} for i in range(6)])
    assert r.status_code == 422 and "5 roles" in r.json()["detail"]
    assert json.dumps(db.rows, sort_keys=True) == before


def test_apply_rejects_unknown_fields_and_other_managers_people(client, no_background):
    c, db, _ = client
    assert _apply(c, expectations=[{"report_id": "andre", "job_role": "X", "slice": "sneaky"}]).status_code == 422
    db.rows["direct_reports"].append({"id": "theirs", "name": "Not Mine", "manager_id": "u2", "archived_at": None})
    body = _apply(c, expectations=[{"report_id": "theirs", "job_role": "X", "job_level": 1}]).json()
    assert body["refused"] == [{"kind": "expectation", "reason": "That person isn't on your team"}]


# ── the background state machine ────────────────────────────────────────

def _queued(db, context="Andre, weekly written status.", role="rl_be", started=None, version=0):
    a = eb.drafting_analysis(context, "Weekly status.")
    if started:
        a["started_at"] = started.isoformat()
    row = {"id": f"d-{len(db.rows['role_expectation_drafts']) + 1}", "org_id": "org1", "role_level_id": role,
           "kind": "new", "status": "open", "items": [], "questions": [], "suggestions": [],
           "analysis": a, "version": version, "updated_at": "2026-09-30T00:00:00+00:00"}
    db.rows["role_expectation_drafts"].append(row)
    return row["id"]


def _reply(target_text=None, quote=None):
    item = {"section": "responsibility", "measure": "numeric", "title": "Written status",
            "responsibility": "Sends a written status.", "meets": "Every week, on time.",
            "exceeds": "", "measurement_period": "week", "order_type": "primary", "basis": "described",
            "source_quote": "weekly written status",
            "target": {"text": target_text, "quote": quote} if target_text else None}
    return {"items": [item, {"section": "skill", "title": "Asks early", "basis": "typical"}], "questions": []}


def _row_of(db, draft_id):
    return next(r for r in db.rows["role_expectation_drafts"] if r["id"] == draft_id)


def test_drafting_to_composed_from_the_row_alone():
    db = DB()
    did = _queued(db)
    prompts = []
    out = eb.run_one(db, did, call=lambda p: prompts.append(p) or _reply("weekly written status", "weekly written status"))
    assert out == "composed"
    row = _row_of(db, did)
    assert row["analysis"]["status"] == "composed" and row["analysis"]["context"] == "Andre, weekly written status."
    assert row["version"] == 2  # claimed, then written
    (item,) = row["items"]
    assert item["target"]["status"] == "set" and item["target"]["source"] == "manager"
    assert row["suggestions"][0]["item"]["origin"] == "typical"   # typical waits as a suggestion
    assert "Andre, weekly written status." in prompts[0] and "Backend Engineer, level 2" in prompts[0]


def test_drafting_to_failed_and_unreadable_is_failed():
    db = DB()
    a, b = _queued(db), _queued(db, role="rl_fe")

    def boom(_):
        raise HTTPException(status_code=502, detail="AI call failed: Server error '500'")

    assert eb.run_one(db, a, call=boom, sleep=lambda s: None) == "failed"
    assert eb.run_one(db, b, call=lambda p: {}) == "failed"
    for d in (a, b):
        row = _row_of(db, d)
        assert row["analysis"]["status"] == "failed" and row["analysis"]["context"] and row["items"] == []
        assert eb.can_retry(row)


def test_rate_limit_backs_off_then_succeeds():
    db = DB()
    did = _queued(db)
    calls, waits = [], []

    def flaky(p):
        calls.append(p)
        if len(calls) < 3:
            raise HTTPException(status_code=502, detail="AI call failed: Client error '429 Too Many Requests'")
        return _reply()

    assert eb.run_one(db, did, call=flaky, sleep=waits.append) == "composed"
    assert waits == list(eb.BACKOFF_SECONDS)


def test_a_late_run_never_lands_on_top_of_a_retry_or_an_edit():
    db = DB()
    did = _queued(db)

    def meanwhile(p):
        _row_of(db, did)["version"] += 5  # a Retry or a discard happened while the model ran
        return _reply()

    assert eb.run_one(db, did, call=meanwhile) == "superseded"
    assert _row_of(db, did)["analysis"]["status"] == "drafting"


def test_staleness_is_per_row():
    now = datetime(2026, 9, 30, 12, 0, tzinfo=timezone.utc)
    early = eb.drafting_analysis("x", None, now=now - timedelta(minutes=6))
    late = eb.drafting_analysis("x", None, now=now - timedelta(minutes=1))
    assert eb.is_stale(early, now) and not eb.is_stale(late, now)
    assert eb.presented_analysis(early, now)["status"] == "failed"
    assert eb.presented_analysis(late, now)["status"] == "drafting"
    assert eb.is_drafting(late, now) and not eb.is_drafting(early, now)
    # A composed row is never stale.
    assert not eb.is_stale({"status": "composed", "started_at": early["started_at"]}, now)


def test_the_run_restarts_the_clock_when_it_actually_starts():
    db = DB()
    did = _queued(db, started=datetime.now(timezone.utc) - timedelta(minutes=4))
    seen = {}

    def look(p):
        seen["started"] = _row_of(db, did)["analysis"]["started_at"]
        return _reply()

    eb.run_one(db, did, call=look)
    started = datetime.fromisoformat(seen["started"])
    assert datetime.now(timezone.utc) - started < timedelta(seconds=30)


def test_background_runs_at_most_five_rows_three_at_a_time():
    import threading
    import time as _t
    db = DB()
    ids = [_queued(db, role=f"r{i}") for i in range(7)]
    for i in range(7):
        db.rows["role_levels"].append({"id": f"r{i}", "job_role": f"Role {i}", "job_level": 1})
    live, peak, lock = [0], [0], threading.Lock()

    def slow(p):
        with lock:
            live[0] += 1
            peak[0] = max(peak[0], live[0])
        _t.sleep(0.05)
        with lock:
            live[0] -= 1
        return _reply()

    results = eb.draft_in_background(db, ids, call=slow)
    assert len(results) == 5 and set(results.values()) == {"composed"}
    assert peak[0] <= 3


# ── retry and presentation through the routes ────────────────────────────

def test_retry_requeues_a_failed_row_from_what_is_stored(client, monkeypatch):
    c, db, _ = client
    did = _queued(db, started=datetime.now(timezone.utc) - timedelta(minutes=9))  # went quiet
    got = c.get("/api/role-expectations/roles/rl_be").json()
    assert got["draft"]["analysis"]["status"] == "failed" and got["draft"]["can_retry"] is True
    prompts = []
    monkeypatch.setattr(rex, "_call_model", lambda p, **k: prompts.append(p) or _reply())
    r = c.post(f"/api/role-expectations/drafts/{did}/redraft", json={"version": 0})
    assert r.status_code == 200, r.text
    assert r.json()["draft"]["analysis"]["status"] == "drafting"
    row = _row_of(db, did)  # the background task ran after the response
    assert row["analysis"]["status"] == "composed" and len(row["items"]) == 1
    assert "Andre, weekly written status." in prompts[0]
    # Nothing to retry now.
    assert c.post(f"/api/role-expectations/drafts/{did}/redraft", json={"version": row["version"]}).status_code == 409


def test_a_row_still_drafting_cant_be_retried_or_edited(client):
    c, db, _ = client
    did = _queued(db)
    assert c.post(f"/api/role-expectations/drafts/{did}/redraft", json={"version": 0}).status_code == 409
    r = c.put(f"/api/role-expectations/drafts/{did}", json={"version": 0, "items": []})
    assert r.status_code == 409 and "still being written" in r.json()["detail"]


def test_drafting_stays_out_of_needs_review_and_a_failed_one_is_in_it(client):
    c, db, _ = client
    _queued(db, role="rl_be")
    _queued(db, role="rl_fe", started=datetime.now(timezone.utc) - timedelta(minutes=10))
    body = c.get("/api/role-expectations/overview").json()
    review = {x["role_level_id"]: x for x in body["needs_review"]}
    assert "rl_be" not in review
    assert review["rl_fe"]["detail"].startswith("The draft couldn't be written")
    levels = {lv["role_level_id"]: lv for lv in body["levels"]}
    assert levels["rl_be"]["draft"]["drafting"] is True
    assert levels["rl_fe"]["draft"]["drafting"] is False and levels["rl_fe"]["draft"]["analysis_failed"] is True


# ── cross-contamination: one person's number never reaches another's draft ─

def test_one_persons_number_never_reaches_another_persons_draft(client, monkeypatch):
    """Andre and Kwame get separate roles. Kwame said "90-day"; Andre didn't.
    The model, drafting Andre, tries to use Kwame's 90 — as a target quoting
    Kwame's words, and as a number in the text. Both are refused, because
    Andre's draft only ever sees Andre's slice."""
    c, db, _ = client
    queued = []
    monkeypatch.setattr(nd, "draft_in_background", lambda supabase, ids, uid=None: queued.extend(ids))
    _apply(c, text=TEXT, expectations=[
        {"report_id": "andre", "job_role": "Backend Engineer", "job_level": 2, "draft": True},
        {"report_id": "kwame", "job_role": "Junior Engineer", "job_level": 1, "draft": True},
    ])
    drafts = {d["role_level_id"]: d for d in db.rows["role_expectation_drafts"]}
    andre = drafts["rl_be"]
    kwame = next(d for rid, d in drafts.items() if rid != "rl_be")
    assert "90" not in andre["analysis"]["context"] and "eight" not in andre["analysis"]["context"]
    assert "90-day" in kwame["analysis"]["context"]

    prompts = {}

    def model(prompt):
        who = "andre" if "Andre first." in prompt else "kwame"
        prompts[who] = prompt
        return {"items": [
            {"section": "responsibility", "measure": "numeric", "title": "Plan delivery",
             "responsibility": "Delivers a plan.", "meets": "A plan within 90 days of starting.",
             "exceeds": "", "measurement_period": "quarter", "order_type": "primary", "basis": "described",
             "source_quote": "By his 90-day mark",
             "target": {"text": "90-day mark", "quote": "By his 90-day mark he should own one service end to end"}},
        ], "questions": [{"item_index": 0, "topic": "scope", "question": "Is 90 days right?", "why": "Eight months in."}]}

    for d in queued:
        assert eb.run_one(db, d, call=model) == "composed"
    assert "90-day" not in prompts["andre"] and "90-day" in prompts["kwame"]

    a = _row_of(db, andre["id"])
    (item,) = a["items"]
    assert item["target"] == {"status": "unresolved"}           # Kwame's quote isn't in Andre's slice
    assert "90" not in item["meets"] and item["source_quote"] is None
    assert not any("90" in q["question"] for q in a["questions"])

    k = _row_of(db, kwame["id"])
    (kitem,) = k["items"]
    assert kitem["target"]["status"] == "set" and kitem["target"]["source"] == "manager"
    assert "90" in kitem["meets"]


# ── the 2026-09-30 Dana rerun ────────────────────────────────────────────
# Fiction: the persona monologue, copied verbatim into test_intake_slices.DANA.

from tests.test_intake_slices import DANA  # noqa: E402


def _dana_db():
    db = DB()
    people = [("andre", "Andre Okafor", "rl_be"), ("kwame", "Kwame Mensah", "rl_jr"), ("lena", "Lena Fischer", "rl_sre"),
              ("mei", "Mei Tanaka", "rl_sr"), ("sofia", "Sofia Reyes", "rl_fe"), ("tomas", "Tomás Silva", "rl_tl")]
    db.rows["direct_reports"] = [
        {"id": i, "name": n, "manager_id": "u1", "role_level_id": r, "role_title": None, "org_unit_id": "u", "archived_at": None}
        for i, n, r in people]
    db.rows["role_levels"] += [
        {"id": "rl_jr", "job_role": "Junior Engineer", "job_level": 1, "role_family_id": None},
        {"id": "rl_sre", "job_role": "Senior Platform Engineer", "job_level": 1, "role_family_id": None},
        {"id": "rl_tl", "job_role": "Senior Backend Engineer", "job_level": 1, "role_family_id": None},
    ]
    # Sofia's role has the morning's working draft; Tomás's role is approved.
    db.rows["role_expectation_drafts"].append({
        "id": "sofia-draft", "org_id": "org1", "role_level_id": "rl_fe", "kind": "new", "status": "open",
        "items": [{"key": "k1", "title": "Ship features"}], "questions": [], "suggestions": [],
        "analysis": {"status": "composed"}, "version": 7, "updated_at": "2026-09-30T09:00:00+00:00"})
    db.rows["metric_configs"].append({"id": "m1", "role_level_id": "rl_tl", "retired_at": None})
    return db


def _dana_rows(draft=True):
    return [{"report_id": r, "role_level_id": rl, "draft": draft and r != "sofia"} for r, rl in
            [("andre", "rl_be"), ("kwame", "rl_jr"), ("lena", "rl_sre"), ("mei", "rl_sr"), ("sofia", "rl_fe")]]


@pytest.fixture
def dana(monkeypatch):
    db = _dana_db()
    main.app.dependency_overrides[utils.get_authenticated_client] = lambda: ("u1", db)
    monkeypatch.setattr(analytics, "capture", lambda *a, **k: None)
    monkeypatch.setattr(nd, "ensure_org", lambda *a, **k: "org1")
    monkeypatch.setattr(nd, "get_email_from_token", lambda a: "m@example.com")
    queued = []
    monkeypatch.setattr(nd, "draft_in_background", lambda supabase, ids, uid=None: queued.extend(ids))
    yield TestClient(main.app), db, queued
    main.app.dependency_overrides.clear()


SOFIA_REASON = "Sofia already has a working draft — this won’t change it."


def test_sofia_is_named_as_skipped_on_the_receipt_and_never_offered_a_draft(dana):
    """The review row said she already has a working draft. The browser sends
    her kept row with draft false, as it does for any blocked row; she used to
    come back in `waiting` ("has a role now and no draft yet", "Draft the next
    1"). Now she comes back skipped, with the review row's own words."""
    c, db, queued = dana
    body = _apply(c, text=DANA, expectations=_dana_rows()).json()
    assert body["waiting"] == []
    assert {"report_id": "sofia", "person_name": "Sofia Reyes", "reason": SOFIA_REASON} in body["not_drafted"]
    assert sorted(p for d in body["drafting"] for p in d["people"]) == \
        ["Andre Okafor", "Kwame Mensah", "Lena Fischer", "Mei Tanaka"]
    sofia = next(d for d in db.rows["role_expectation_drafts"] if d["id"] == "sofia-draft")
    assert sofia["version"] == 7 and sofia["items"] == [{"key": "k1", "title": "Ship features"}]


def test_the_same_holds_with_no_draft_queued_and_for_an_approved_role(dana):
    c, db, _ = dana
    body = _apply(c, expectations=[{"report_id": "sofia", "role_level_id": "rl_fe", "draft": False},
                                   {"report_id": "tomas", "role_level_id": "rl_tl", "draft": False},
                                   {"report_id": "mei", "role_level_id": "rl_sr", "draft": False}]).json()
    assert [w["report_id"] for w in body["waiting"]] == ["mei"]
    reasons = {x["report_id"]: x["reason"] for x in body["not_drafted"]}
    assert reasons == {"sofia": SOFIA_REASON,
                       "tomas": "Tomás’s role already has approved expectations — this won’t change them."}


def test_draft_the_next_for_a_role_with_a_working_draft_is_refused_server_side(dana):
    """What "Draft the next 1" sent for Sofia before the fix: her row with
    draft true. The server refuses it and her draft is untouched: no second
    draft, no overwrite, no version bump."""
    c, db, queued = dana
    body = _apply(c, text=DANA, expectations=[{"report_id": "sofia", "role_level_id": "rl_fe", "draft": True}]).json()
    assert body["drafting"] == [] and queued == []
    assert body["not_drafted"] == [{"report_id": "sofia", "person_name": "Sofia Reyes", "reason": SOFIA_REASON}]
    drafts = [d for d in db.rows["role_expectation_drafts"] if d["role_level_id"] == "rl_fe"]
    assert len(drafts) == 1 and drafts[0]["version"] == 7 and drafts[0]["items"][0]["title"] == "Ship features"


def test_someone_sharing_a_role_drafted_now_is_not_offered_a_second_pass(client, no_background):
    c, db, _ = client
    body = _apply(c, text=TEXT, expectations=[
        {"report_id": "andre", "role_level_id": "rl_be", "draft": True},
        {"report_id": "kwame", "role_level_id": "rl_be", "draft": False}]).json()
    assert body["waiting"] == []
    assert body["not_drafted"] == [{"report_id": "kwame", "person_name": "Kwame Mensah",
                                    "reason": "Kwame shares Andre’s role, which is being drafted now."}]


def _dana_model(prompts):
    """A model that tries the three mistakes from the rerun whenever it can
    see the words for them, plus Andre's correct target."""
    def model(prompt):
        who = next(n for n in ("Andre", "Kwame", "Lena", "Mei") if f"{n}" in prompt.split("THE MANAGER'S DESCRIPTION")[1][:60])
        prompts[who] = prompt
        items = [{"section": "skill", "title": "Asks early", "responsibility": "Raises blockers early.",
                  "basis": "described", "source_quote": ""}]
        if who == "Andre":
            items.append({"section": "responsibility", "measure": "numeric", "title": "Weekly written status",
                          "responsibility": "Sends a written status.", "meets": "Every week.", "measurement_period": "week",
                          "basis": "described", "source_quote": "a weekly written status",
                          "target": {"text": "weekly written status", "quote": "I'd want a weekly written status from him"}})
        # Whatever the prompt says, try to put the manager's side on the report.
        if who == "Kwame":
            items.append({"section": "responsibility", "measure": "numeric", "title": "Weekly 1:1 attendance",
                          "responsibility": "Attends a weekly 1:1.", "meets": "Weekly 1:1, thirty minutes.",
                          "measurement_period": "week", "basis": "described", "source_quote": "Weekly 1:1, thirty minutes",
                          "target": {"text": "Weekly 1:1, thirty minutes", "quote": "Weekly 1:1, thirty minutes"}})
        if who == "Lena":
            items.append({"section": "responsibility", "measure": "judged", "title": "Quarterly priorities delivered",
                          "responsibility": "Provides quarterly priorities.", "basis": "described",
                          "source_quote": "I owe her quarterly priorities"})
        return {"items": items, "questions": [{"item_index": len(items) - 1, "topic": "scope", "question": "Current gap?"}]}
    return model


def test_rerunning_dana_puts_each_expectation_on_the_right_side(dana):
    c, db, queued = dana
    body = _apply(c, text=DANA, expectations=_dana_rows()).json()
    assert len(queued) == 4
    prompts = {}
    for d in queued:
        assert eb.run_one(db, d, call=_dana_model(prompts)) == "composed"
    by_role = {d["role_level_id"]: d for d in db.rows["role_expectation_drafts"]}

    # The drafter never saw the manager's side (checked in the description it
    # reads, not the rules around it, which name the kinds of sentence).
    prompts = {k: v.split("THE MANAGER'S DESCRIPTION OF THE ROLE")[1].split("THERE IS NO JOB DESCRIPTION.")[0]
               for k, v in prompts.items()}
    assert "Weekly 1:1" not in prompts["Kwame"] and "thirty" not in prompts["Kwame"]
    assert "growth plan" not in prompts["Kwame"]
    assert "quarterly priorities" not in prompts["Lena"] and "I owe her" not in prompts["Lena"]
    assert "I'd want a weekly written status from him." in prompts["Andre"]
    # And the stored slice is still the manager's words.
    assert "Weekly 1:1, thirty minutes." in by_role["rl_jr"]["analysis"]["context"]

    kwame = by_role["rl_jr"]
    assert [i["title"] for i in kwame["items"]] == ["Asks early"]           # no 1:1-cadence target on Kwame
    assert not any("30" in json.dumps(i) or "thirty" in json.dumps(i).lower() for i in kwame["items"])
    assert any("Weekly 1:1, thirty minutes." in n for n in kwame["analysis"]["notes"])

    lena = by_role["rl_sre"]
    assert "Quarterly priorities delivered" not in [i["title"] for i in lena["items"]]
    assert not any(q.get("question") == "Current gap?" for q in lena["questions"])  # its question went with it
    assert any("I owe her quarterly priorities." in n for n in lena["analysis"]["notes"])

    andre = by_role["rl_be"]
    status = next(i for i in andre["items"] if i["title"] == "Weekly written status")
    assert status["target"] == {"status": "set", "text": "weekly written status", "source": "manager",
                                "quote": "I'd want a weekly written status from him"}
    assert not andre["analysis"]["notes"] or not any("Left out" in n for n in andre["analysis"]["notes"])


def test_the_review_row_reads_and_states_only_the_persons_side():
    from intake_slices import slice_by_person
    from tests.test_intake_slices import ROSTER
    slices = slice_by_person(DANA, ROSTER)
    rows = [
        _row("kwame", "Kwame Mensah", role="rl_jr", statement=(
            "Ask questions early and don't sit on a blocker. Expects to hold weekly 30-minute 1:1s given he needs a lot of coaching.")),
        _row("lena", "Lena Fischer", role="rl_sre", statement=(
            "Visibility: tell the manager before something breaks. Provides her quarterly priorities when asked.")),
        _row("andre", "Andre Okafor", role="rl_be", statement="A weekly written status and consistent delivery."),
    ]
    nd.finish_expectations(rows, slices=slices, open_draft_roles=set(), covered_roles=set(), rank={})
    by = {r["report_id"]: r for r in rows}
    assert by["kwame"]["statement"] == "Ask questions early and don't sit on a blocker."
    assert "Weekly 1:1" not in by["kwame"]["slice"] and "Weekly 1:1, thirty minutes." in by["kwame"]["held_back"]
    assert by["lena"]["statement"] == "Visibility: tell the manager before something breaks."
    assert by["lena"]["held_back"] == ["I owe her quarterly priorities.", "Asked two weeks ago, waiting on her."]
    assert by["andre"]["statement"] == "A weekly written status and consistent delivery." and by["andre"]["held_back"] == []


def test_what_the_manager_owes_is_proposed_as_a_commitment_not_a_note():
    """Lena's quarterly priorities and Kwame's growth plan are Dana's debts:
    held back from their drafts and proposed as commitments Dana owes, even
    when the model proposed none. The 2026-09-30 rerun lost all three to the
    five-note cap when they were notes. A commitment already covering one
    isn't doubled, a promise said twice is one row, the 1:1 rhythm is not
    owed, and notes are left alone."""
    from intake_slices import slice_by_person
    from tests.test_intake_slices import ROSTER
    slices = slice_by_person(DANA, ROSTER)
    note = {"report_id": "kwame", "person_name": "Kwame Mensah", "low": False, "text": "Needs a lot of coaching.", "excerpt": None}

    def run(commitments):
        drafts = {
            "expectations": [_row("lena", "Lena Fischer", role="rl_sre"), _row("kwame", "Kwame Mensah", role="rl_jr"),
                             _row("andre", "Andre Okafor", role="rl_be")],
            "person_notes": [dict(note)], "commitments": commitments,
        }
        nd.finish_expectations(drafts["expectations"], slices=slices, open_draft_roles=set(), covered_roles=set(), rank={})
        nd.commitments_for_held_back(drafts)
        by = {}
        for c in drafts["commitments"]:
            by.setdefault(c["report_id"], []).append(c)
        assert drafts["person_notes"] == [note]
        return by

    by = run([])
    (lena,) = by["lena"]
    assert lena["description"] == "I owe her quarterly priorities. Asked two weeks ago, waiting on her."
    assert lena["excerpt"] == "I owe her quarterly priorities." and lena["low"] is False and lena["due_date"] is None
    (kwame,) = by["kwame"]                                # "So, growth plan, mine." is the same promise
    assert "growth plan" in kwame["description"] and "1:1" not in kwame["description"]
    assert "andre" not in by                              # nothing held back from Andre

    by = run([{"report_id": "kwame", "person_name": "Kwame Mensah", "low": False, "due_date": None,
               "description": "Write Kwame's growth plan", "excerpt": "I'd write him a growth plan"}])
    assert len(by["kwame"]) == 1 and by["kwame"][0]["description"] == "Write Kwame's growth plan"
    assert len(by["lena"]) == 1


def test_a_promise_the_model_gave_someone_else_is_not_added_again():
    """"I said I'd pair her with Ava" is Carla's, and the model said so; the
    slice rules put the sentence in Ava's slice. It must not come back as a
    promise owed to Ava. A different held-back promise of Ava's still does."""
    row = {"report_id": "ava", "person_name": "Ava Stone",
           "held_back": ["I owe her the escalation runbook review.", "I said I'd pair her with Ava for shadowing."]}
    drafts = {"expectations": [row], "person_notes": [], "commitments": [
        {"report_id": "carla", "person_name": "Carla Diaz", "description": "Pair Carla with Ava for shadowing",
         "excerpt": "I said I'd pair her with Ava for shadowing.", "due_date": None, "low": False}]}
    nd.commitments_for_held_back(drafts)
    added = [c for c in drafts["commitments"] if c["report_id"] == "ava"]
    assert [c["description"] for c in added] == ["I owe her the escalation runbook review."]


def test_loose_manager_side_lines_are_held_back_but_never_proposed_as_commitments():
    """2026-09-30 walkthrough: "He's terse so I have to ask." and "That's on me."
    came back as pre-checked "What you owe people" rows. They stay out of the
    drafter's reading (held back) but are not a promise, so no row is added."""
    from intake_slices import is_promise, manager_side
    for loose in ("He's terse so I have to ask.", "That's on me.", "Weekly written status is mine."):
        assert manager_side(loose) == "commitment" and not is_promise(loose), loose
    for promise in ("I owe her feedback on one design doc.", "I promised him a 90-day growth plan.",
                    "I said I'd write him a growth plan.", "I'd write him a growth plan."):
        assert is_promise(promise), promise

    row = {"report_id": "tomas", "person_name": "Tomás Ibarra",
           "held_back": ["He's terse so I have to ask.", "That's on me."]}
    drafts = {"expectations": [row], "person_notes": [], "commitments": []}
    nd.commitments_for_held_back(drafts)
    assert drafts["commitments"] == []
