"""Period assessments — evidence scoping, drafting against each item's own
scale, manager-owned decisions, visible revisions, resumable drafts and
retry-safe completion. Uses an in-memory stand-in for the Supabase client;
the completion transaction, the one-open-draft index and RLS are verified
against local Postgres (see docs/systems/assessments.md → Verification)."""
import copy
import json
import re
import uuid

import pytest
from fastapi import HTTPException
from postgrest.exceptions import APIError

import routes.assessment_reviews as ar
import routes.assessments as assessments

ME = "manager-1"
OTHER = "manager-2"
REPORT = "dr-maya"
SKILL = "sk-plan"      # 1-4 scale with meanings
SKILL5 = "sk-comm"     # 1-5 scale, no meanings configured
VALUE = "va-own"
METRIC = "me-csat"


# ---------------------------------------------------------------------------
# In-memory Supabase stand-in
# ---------------------------------------------------------------------------

class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, db, name):
        self.db, self.name = db, name
        self.filters, self.op, self.payload = [], "select", None
        self._limit, self._negate, self._order, self._single = None, False, [], False

    def select(self, *_a, **_k):
        self.op = "select"
        return self

    def insert(self, rows):
        self.op, self.payload = "insert", rows if isinstance(rows, list) else [rows]
        return self

    def update(self, values):
        self.op, self.payload = "update", values
        return self

    def delete(self):
        self.op = "delete"
        return self

    @property
    def not_(self):
        self._negate = True
        return self

    def _add(self, fn):
        negate, self._negate = self._negate, False
        self.filters.append((lambda r: not fn(r)) if negate else fn)
        return self

    def eq(self, col, val):
        return self._add(lambda r: r.get(col) == val)

    def in_(self, col, vals):
        vals = list(vals)
        return self._add(lambda r: r.get(col) in vals)

    def is_(self, col, val):
        assert val == "null"
        return self._add(lambda r: r.get(col) is None)

    def gte(self, col, val):
        return self._add(lambda r: str(r.get(col) or "") >= str(val))

    def lt(self, col, val):
        return self._add(lambda r: str(r.get(col) or "") < str(val))

    def or_(self, expr):
        # Only the pattern fetch_role_expectations uses.
        m = re.match(r"role_level_id\.eq\.([^,]+),role_level_id\.is\.null", expr)
        rid = m.group(1)
        return self._add(lambda r: r.get("role_level_id") in (rid, None))

    def order(self, col, desc=False):
        self._order.append((col, desc))
        return self

    def limit(self, n):
        self._limit = n
        return self

    def single(self):
        self._single = True
        return self

    def execute(self):
        table = self.db.tables.setdefault(self.name, [])
        match = [r for r in table if all(f(r) for f in self.filters)]
        if self.op == "insert":
            created = []
            for row in self.payload:
                if self.name == "performance_reviews" and row.get("status") == "draft":
                    clash = [r for r in table if r["manager_id"] == row["manager_id"]
                             and r["direct_report_id"] == row["direct_report_id"] and r["status"] == "draft"]
                    if clash:
                        raise APIError({"code": "23505", "message": "duplicate"})
                full = {"id": str(uuid.uuid4()), "created_at": self.db.clock(), **copy.deepcopy(row)}
                if self.name == "performance_reviews":
                    full = {"version": 0, "conversation": [], "excluded_evidence": [], "include_private": False,
                            "manager_context": None, "picture": None, "completed_snapshot": None, "completed_at": None,
                            "rating_ordinal": None, "summary": None, **full}
                table.append(full)
                created.append(copy.deepcopy(full))
            return _Result(created)
        if self.op == "update":
            for row in match:
                row.update(copy.deepcopy(self.payload))
            return _Result([copy.deepcopy(r) for r in match])
        if self.op == "delete":
            for row in match:
                table.remove(row)
            return _Result([])
        for col, desc in reversed(self._order):
            match.sort(key=lambda r: str(r.get(col) or ""), reverse=desc)
        rows = [copy.deepcopy(r) for r in match]
        rows = rows[: self._limit] if self._limit else rows
        if self._single:
            if len(rows) != 1:
                raise APIError({"code": "PGRST116", "message": "no rows"})
            return _Result(rows[0])
        return _Result(rows)


class _Rpc:
    """complete_performance_review() in Python, mirroring the SQL function."""

    def __init__(self, db, name, params):
        self.db, self.name, self.params = db, name, params

    def execute(self):
        assert self.name == "complete_performance_review"
        self.db.rpc_calls += 1
        p = json.loads(json.dumps(self.params, default=str))
        review = next((r for r in self.db.tables["performance_reviews"]
                       if r["id"] == p["p_review_id"] and r["manager_id"] == self.db.user), None)
        if not review:
            raise APIError({"code": "P0002", "message": "Assessment not found"})
        if review["status"] == "completed":
            return _Result([copy.deepcopy(review)])
        if p["p_expected_version"] != review["version"]:
            raise APIError({"code": "40001", "message": "This assessment changed after it was reviewed"})
        payload = p["p_payload"]
        t = self.db.tables
        now = self.db.clock()
        if payload.get("overall"):
            t["assessments"].append({"id": str(uuid.uuid4()), "manager_id": self.db.user, "direct_report_id": review["direct_report_id"],
                                     "level_ordinal": payload["overall"]["level_ordinal"], "notes": payload["overall"].get("notes"),
                                     "source_type": "performance_review", "source_id": review["id"], "created_at": now})
        for s in payload.get("skills") or []:
            t["skill_assessments"].append({"id": str(uuid.uuid4()), "direct_report_id": review["direct_report_id"],
                                           "skill_config_id": s["config_id"], "evaluation_point": s["evaluation_point"],
                                           "notes": s.get("notes"), "assessed_at": now, "performance_review_id": review["id"]})
        for v in payload.get("values") or []:
            t["value_assessments"].append({"id": str(uuid.uuid4()), "direct_report_id": review["direct_report_id"],
                                           "value_config_id": v["config_id"], "evaluation_point": v["evaluation_point"],
                                           "notes": v.get("notes"), "assessed_at": now, "performance_review_id": review["id"]})
        for m in payload.get("metrics") or []:
            t["metric_entries"].append({"id": str(uuid.uuid4()), "direct_report_id": review["direct_report_id"],
                                        "metric_config_id": m["config_id"], "value": m["value"], "period": m["period"],
                                        "notes": m.get("notes"), "recorded_at": now, "performance_review_id": review["id"]})
        review.update(status="completed", stage="completed", completed_at=now, version=review["version"] + 1,
                      rating_ordinal=(payload.get("overall") or {}).get("level_ordinal"), summary=payload.get("summary"),
                      completed_snapshot=payload.get("snapshot"), completion_request_id=p.get("p_client_request_id"))
        return _Result([copy.deepcopy(review)])


class _DB:
    def __init__(self, tables, user=ME):
        self.tables = tables
        self.user = user
        self.rpc_calls = 0
        self._tick = 0

    def clock(self):
        self._tick += 1
        return f"2026-10-02T12:{self._tick // 60:02d}:{self._tick % 60:02d}+00:00"

    def table(self, name):
        return _Query(self, name)

    def rpc(self, name, params):
        return _Rpc(self, name, params)


def _seed():
    return _DB({
        "users": [],
        "direct_reports": [
            {"id": REPORT, "manager_id": ME, "name": "Maya", "role_title": "CSM", "role_level_id": "rl-1"},
            {"id": "dr-other", "manager_id": OTHER, "name": "Other", "role_title": None, "role_level_id": None},
        ],
        "role_levels": [{"id": "rl-1", "job_role": "Customer Success Manager", "job_level": 2, "functional_team": None,
                         "job_responsibilities": None, "created_at": "2026-01-01"}],
        "assessment_levels": [{"id": f"lv{o}", "org_id": "org-1", "ordinal": o, "label": l} for o, l in
                              [(1, "Needs Improvement"), (2, "Developing"), (3, "Meets Expectations"), (4, "Exceeds Expectations"), (5, "Outstanding")]],
        "skill_configs": [
            {"id": SKILL, "role_level_id": "rl-1", "skill_name": "Account planning", "order_type": "primary",
             "expectation": "Own the renewal plan and handoff independently", "evaluation_scale_min": 1, "evaluation_scale_max": 4},
            {"id": SKILL5, "role_level_id": "rl-1", "skill_name": "Communication", "order_type": "secondary",
             "expectation": "Clear written updates", "evaluation_scale_min": 1, "evaluation_scale_max": 5},
        ],
        "skill_scale_definitions": [
            {"id": f"sd{p}", "skill_config_id": SKILL, "evaluation_point": p, "qualitative_output": q}
            for p, q in [(1, "Learning"), (2, "With guidance"), (3, "Independent"), (4, "Teaches others")]
        ],
        "value_configs": [{"id": VALUE, "role_level_id": None, "value_name": "Ownership", "order_type": None,
                           "evaluation_scale_min": 1, "evaluation_scale_max": 3}],
        "value_scale_definitions": [],
        "metric_configs": [{"id": METRIC, "role_level_id": "rl-1", "metric_name": "CSAT", "order_type": "primary",
                            "measurement_period": "quarter", "expectation": "At least 4.5", "evaluation_scale_min": 1, "evaluation_scale_max": 4}],
        "metric_scale_definitions": [],
        "skill_assessments": [
            {"id": "old-skill", "direct_report_id": REPORT, "skill_config_id": SKILL, "evaluation_point": 2,
             "notes": "Needs support on renewals", "assessed_at": "2026-06-30T12:00:00+00:00", "performance_review_id": None},
        ],
        "value_assessments": [],
        "metric_entries": [
            {"id": "csat-q3", "direct_report_id": REPORT, "metric_config_id": METRIC, "value": 4.6, "period": "Q3 2026",
             "notes": None, "recorded_at": "2026-09-29T12:00:00+00:00"},
            {"id": "csat-q2", "direct_report_id": REPORT, "metric_config_id": METRIC, "value": 4.1, "period": "Q2 2026",
             "notes": None, "recorded_at": "2026-06-28T12:00:00+00:00"},
        ],
        "assessments": [
            {"id": "old-overall", "manager_id": ME, "direct_report_id": REPORT, "level_ordinal": 3, "notes": "Solid",
             "source_type": "manual", "source_id": None, "created_at": "2026-06-30T12:00:00+00:00"},
        ],
        "one_on_ones": [
            {"id": "oo-in", "manager_id": ME, "direct_report_id": REPORT, "scheduled_at": "2026-09-18T12:00:00+00:00",
             "created_at": "2026-09-01", "summary": "Maya walked through the renewal plan she led.", "notes": "Seemed tired"},
            {"id": "oo-in2", "manager_id": ME, "direct_report_id": REPORT, "scheduled_at": "2026-08-04T12:00:00+00:00",
             "created_at": "2026-08-01", "summary": "Checklist for handoffs agreed.", "notes": None},
            {"id": "oo-before", "manager_id": ME, "direct_report_id": REPORT, "scheduled_at": "2026-06-10T12:00:00+00:00",
             "created_at": "2026-06-01", "summary": "Q2 wrap.", "notes": None},
            {"id": "oo-after", "manager_id": ME, "direct_report_id": REPORT, "scheduled_at": "2026-10-05T12:00:00+00:00",
             "created_at": "2026-10-01", "summary": "Next quarter kickoff.", "notes": None},
            {"id": "oo-planned", "manager_id": ME, "direct_report_id": REPORT, "scheduled_at": "2026-09-25T12:00:00+00:00",
             "created_at": "2026-09-20", "summary": None, "notes": "prep only"},
            {"id": "oo-theirs", "manager_id": OTHER, "direct_report_id": REPORT, "scheduled_at": "2026-09-10T12:00:00+00:00",
             "created_at": "2026-09-10", "summary": "Not yours", "notes": None},
        ],
        "commitments": [
            {"id": "c-done", "owner_id": ME, "direct_report_id": REPORT, "description": "Finish handoff checklist",
             "committed_by": "direct_report", "status": "done", "due_date": "2026-09-10", "completed_at": "2026-09-09T10:00:00+00:00",
             "created_at": "2026-08-04T10:00:00+00:00"},
            {"id": "c-overdue", "owner_id": ME, "direct_report_id": REPORT, "description": "Draft QBR deck",
             "committed_by": "direct_report", "status": "open", "due_date": "2026-09-01", "completed_at": None,
             "created_at": "2026-08-10T10:00:00+00:00"},
            {"id": "c-old", "owner_id": ME, "direct_report_id": REPORT, "description": "Old thing",
             "committed_by": "manager", "status": "done", "due_date": "2026-05-01", "completed_at": "2026-05-02T10:00:00+00:00",
             "created_at": "2026-04-10T10:00:00+00:00"},
        ],
        "goals": [
            {"id": "g-1", "owner_id": ME, "direct_report_id": REPORT, "title": "Consistent handoffs", "status": "active",
             "success_metrics": "Every renewal has a named owner", "due_date": None, "created_at": "2026-07-02",
             "measure_label": None, "measure_unit": None, "measure_target": None, "measure_direction": None},
        ],
        "check_ins": [
            {"id": "ci-in", "goal_id": "g-1", "project_id": None, "status": "on_track", "progress": 50, "note": "Half the accounts done",
             "measured_value": None, "created_at": "2026-09-12T10:00:00+00:00"},
            {"id": "ci-out", "goal_id": "g-1", "project_id": None, "status": "on_track", "progress": 80, "note": "After period",
             "measured_value": None, "created_at": "2026-10-03T10:00:00+00:00"},
        ],
        "projects": [],
        "development_plans": [],
        "dr_capture_notes": [
            {"id": "cap-1", "manager_id": ME, "direct_report_id": REPORT, "content": "Handled escalation calmly", "created_at": "2026-09-02T10:00:00+00:00"},
        ],
        "outside_meeting_links": [],
        "performance_reviews": [],
    })


@pytest.fixture
def db(monkeypatch):
    d = _seed()
    monkeypatch.setattr(ar, "get_org", lambda *_a, **_k: None)
    monkeypatch.setattr(assessments, "ensure_org", lambda *_a, **_k: "org-1")
    monkeypatch.setattr(assessments, "get_email_from_token", lambda *_a, **_k: None)
    return d


class _AI:
    def __init__(self):
        self.responses: list = []
        self.prompts: list[str] = []

    def __call__(self, prompt, model=None, max_tokens=None):
        self.prompts.append(prompt)
        nxt = self.responses.pop(0)
        if isinstance(nxt, Exception):
            raise nxt
        return nxt if isinstance(nxt, str) else json.dumps(nxt)


@pytest.fixture
def ai(monkeypatch):
    fake = _AI()
    monkeypatch.setattr(ar, "generate_text", fake)
    return fake


def _auth(db):
    return (db.user, db)


def _create(db, mode="ai", start="2026-07-01", end="2026-09-30", cadence="quarterly"):
    body = ar.CreateReviewIn(direct_report_id=REPORT, cadence=cadence, period_start=start, period_end=end, mode=mode)
    return ar.create_review(body, auth=_auth(db), authorization=None)


def _ref(review, source_id):
    return next(i["ref"] for i in review["evidence"]["items"] if i["id"] == source_id)


def _keys(review):
    return {e["key"]: f"K{n}" for n, e in enumerate(review["catalog"], start=1)}


def _item(review, key):
    return next(e for e in review["catalog"] if e["key"] == key)


# ---------------------------------------------------------------------------
# Period and source scoping
# ---------------------------------------------------------------------------

def test_evidence_is_scoped_to_the_period_the_manager_and_authorized_sources(db):
    r = _create(db)
    assert r["review_period"].startswith("Q3 2026")
    items = {i["id"]: i for i in r["evidence"]["items"]}
    assert items["one_on_one:oo-in"]["timing"] == "in_period"
    assert items["one_on_one:oo-before"]["timing"] == "background"
    assert "one_on_one:oo-after" not in items          # after the period
    assert "one_on_one:oo-planned" not in items        # no reviewed write-up
    assert "one_on_one:oo-theirs" not in items         # another manager's record
    assert items["commitment:c-done"]["title"] == "Commitment completed"
    assert items["commitment:c-overdue"]["title"] == "Commitment overdue"
    assert "commitment:c-old" not in items
    assert "goal_check_in:ci-in" in items and "goal_check_in:ci-out" not in items
    assert items["goal:g-1"]["timing"] == "context"
    assert items["metric_entry:csat-q3"]["value"] == 4.6
    assert "metric_entry:csat-q2" not in items
    # private material is off by default and says so
    assert not any(i["private"] for i in items.values())
    cov = {c["source"]: c["status"] for c in r["evidence"]["coverage"]}
    assert cov["private"] == "private_off" and cov["team_meetings"] == "not_inspected"


def test_private_material_only_with_explicit_opt_in_and_labelled(db):
    r = _create(db)
    r = ar.update_review(r["id"], ar.UpdateReviewIn(version=r["version"], include_private=True), auth=_auth(db), authorization=None)
    private = [i for i in r["evidence"]["items"] if i["private"]]
    assert {i["id"] for i in private} == {"private_note:oo-in", "capture_note:cap-1"}
    assert all("Private" in i["attribution"] for i in private)


def test_period_change_regathers_and_marks_the_picture_out_of_date(db, ai):
    r = _create(db)
    ai.responses.append({"headline": "A renewal led", "summary": "s", "contributions": [{"text": "Led renewal plan", "sources": [_ref(r, "one_on_one:oo-in")]}],
                         "impact": None, "gaps": [], "questions": []})
    r = ar.build_picture.__wrapped__(None, r["id"], auth=_auth(db), authorization=None)
    assert r["flags"]["picture_stale"] is False
    r = ar.update_review(r["id"], ar.UpdateReviewIn(version=r["version"], period_start="2026-08-01"), auth=_auth(db), authorization=None)
    assert r["flags"]["picture_stale"] is True
    assert "one_on_one:oo-in2" in {i["id"] for i in r["evidence"]["items"]}
    assert not any(i["id"] == "one_on_one:oo-in2" and i["timing"] == "in_period" for i in r["evidence"]["items"] if i["date"] < "2026-08-01")


# ---------------------------------------------------------------------------
# The picture
# ---------------------------------------------------------------------------

def _picture(db, r, ai, response):
    ai.responses.append(response)
    return ar.build_picture.__wrapped__(None, r["id"], auth=_auth(db), authorization=None)


def test_picture_drops_uncited_contributions_and_failure_is_recoverable(db, ai):
    r = _create(db)
    r = _picture(db, r, ai, {"headline": "h", "summary": "s", "impact": {"title": "t", "text": "impact unclear"},
                             "contributions": [{"text": "cited", "sources": [_ref(r, "commitment:c-done")]},
                                               {"text": "made up", "sources": []}, {"text": "bad ref", "sources": ["S999"]}],
                             "gaps": ["No satisfaction reading"], "questions": ["q1", "q2", "q3"]})
    assert [c["text"] for c in r["picture"]["contributions"]] == ["cited"]
    assert len(r["picture"]["questions"]) == 2
    r = _picture(db, r, ai, RuntimeError("model down"))
    assert "couldn't be written" in r["picture"]["error"]
    assert r["evidence"]["items"]  # evidence kept


def test_sparse_period_gets_honest_state_without_an_ai_call(db, ai):
    r = _create(db, start="2025-01-01", end="2025-03-31", cadence="quarterly")
    r = ar.build_picture.__wrapped__(None, r["id"], auth=_auth(db), authorization=None)
    assert r["picture"]["sparse"] is True and ai.prompts == []


# ---------------------------------------------------------------------------
# Drafting against each item's own scale
# ---------------------------------------------------------------------------

def _draft(db, r, ai, judgments, unassessed=(), narrative=None):
    ai.responses.append({"narrative": narrative or {"headline": "A growing contribution", "overview": "o"},
                         "judgments": judgments, "unassessed": list(unassessed)})
    return ar.draft_judgments.__wrapped__(None, r["id"], ar.DraftIn(version=r["version"]), auth=_auth(db), authorization=None)


def test_draft_respects_each_scale_and_never_invents_metrics(db, ai):
    r = _create(db)
    k = _keys(r)
    s_oo, s_csat, s_ci = _ref(r, "one_on_one:oo-in"), _ref(r, "metric_entry:csat-q3"), _ref(r, "goal_check_in:ci-in")
    r = _draft(db, r, ai, [
        {"key": k["overall"], "point": 3, "reason": "overall", "sources": [s_oo]},
        {"key": k[f"skill:{SKILL}"], "point": 3, "reason": "led plan", "sources": [s_oo], "needs_attention": "One example only"},
        {"key": k[f"skill:{SKILL5}"], "point": 5, "reason": "ok on its own 1-5 scale", "sources": [s_ci]},
        {"key": k[f"value:{VALUE}"], "point": 4, "reason": "outside 1-3 scale", "sources": [s_oo]},
        {"key": k[f"metric:{METRIC}"], "value": 4.9, "period": "Q3", "reason": "inferred", "sources": [s_oo]},
    ])
    st = {e["key"]: e["state"] for e in r["catalog"]}
    assert st["overall"]["decision"]["point"] == 3
    assert st[f"skill:{SKILL5}"]["decision"]["point"] == 5
    assert st[f"value:{VALUE}"]["decision"]["state"] == "unassessed"       # 4 isn't on a 1-3 scale
    assert st[f"metric:{METRIC}"]["decision"]["state"] == "unassessed"      # no reading of 4.9 exists
    assert "No recorded reading" in st[f"metric:{METRIC}"]["unassessed_reason"]
    att = _item(r, f"skill:{SKILL}")["attention"]
    assert "One example only" in att and any("Differs from the prior" in a for a in att)
    # the draft prompt shows scale meanings, not bare numbers
    assert "3: Independent" in ai.prompts[-1] and "PRIOR judgment" in ai.prompts[-1]

    r = _draft(db, r, ai, [{"key": k[f"metric:{METRIC}"], "value": 4.6, "reason": "recorded", "sources": [s_csat]}])
    assert _item(r, f"metric:{METRIC}")["state"]["decision"] == {**_item(r, f"metric:{METRIC}")["state"]["decision"], "value": 4.6, "period": "Q3 2026"}


def test_a_metric_number_the_manager_stated_can_be_proposed(db, ai):
    r = _create(db)
    r = ar.update_review(r["id"], ar.UpdateReviewIn(version=r["version"], manager_context="CSAT from the vendor report was 4.8 for Q3."),
                         auth=_auth(db), authorization=None)
    k = _keys(r)
    r = _draft(db, r, ai, [{"key": k[f"metric:{METRIC}"], "value": 4.8, "period": "Q3 2026", "reason": "you said", "sources": ["M"]}])
    item = _item(r, f"metric:{METRIC}")
    assert item["state"]["decision"]["value"] == 4.8
    assert any("Rests only on context you added" in a for a in item["attention"])


def test_draft_failure_keeps_everything_and_says_so(db, ai):
    r = _create(db)
    r = ar.item_action(r["id"], f"skill:{SKILL}", ar.ItemActionIn(version=r["version"], action="set", point=2, reason="mine"),
                       auth=_auth(db), authorization=None)
    ai.responses.append(RuntimeError("timeout"))
    r = ar.draft_judgments.__wrapped__(None, r["id"], ar.DraftIn(version=r["version"]), auth=_auth(db), authorization=None)
    assert "couldn't be generated" in r["draft"]["last_error"]
    assert _item(r, f"skill:{SKILL}")["state"]["decision"]["point"] == 2


# ---------------------------------------------------------------------------
# Edits, discussion and revisions
# ---------------------------------------------------------------------------

def test_revisions_never_overwrite_manager_edits(db, ai):
    r = _create(db)
    k = _keys(r)
    s_oo = _ref(r, "one_on_one:oo-in")
    r = _draft(db, r, ai, [{"key": k[f"skill:{SKILL}"], "point": 3, "reason": "AI", "sources": [s_oo]},
                           {"key": k[f"skill:{SKILL5}"], "point": 3, "reason": "AI", "sources": [s_oo]}])
    r = ar.item_action(r["id"], f"skill:{SKILL}", ar.ItemActionIn(version=r["version"], action="set", point=2, reason="With guidance still"),
                       auth=_auth(db), authorization=None)
    # discussion scoped to one item proposes a revision there, and tries another item too
    ai.responses.append({"reply": "The records support progress.", "revisions": [
        {"key": k[f"skill:{SKILL}"], "point": 3, "reason": "Led this renewal", "sources": [s_oo]},
        {"key": k[f"skill:{SKILL5}"], "point": 1, "reason": "unrelated", "sources": [s_oo]}]})
    r = ar.discuss.__wrapped__(None, r["id"], ar.DiscussIn(version=r["version"], message="Is 2 fair?", item_key=f"skill:{SKILL}"),
                               auth=_auth(db), authorization=None)
    plan, comm = _item(r, f"skill:{SKILL}")["state"], _item(r, f"skill:{SKILL5}")["state"]
    assert plan["decision"]["point"] == 2 and plan["revision"]["point"] == 3   # visible, not applied
    assert comm["revision"] is None and comm["decision"]["point"] == 3        # other item untouched
    assert [m["role"] for m in r["conversation"]] == ["manager", "assistant"]
    # redraft: manager decision stays, new proposal becomes a revision; untouched AI items update and are flagged
    r = _draft(db, r, ai, [{"key": k[f"skill:{SKILL}"], "point": 4, "reason": "AI again", "sources": [s_oo]},
                           {"key": k[f"skill:{SKILL5}"], "point": 4, "reason": "AI again", "sources": [s_oo]}])
    plan, comm = _item(r, f"skill:{SKILL}"), _item(r, f"skill:{SKILL5}")
    assert plan["state"]["decision"]["point"] == 2 and plan["state"]["revision"]["point"] == 4
    assert comm["state"]["decision"]["point"] == 4 and "Changed after you updated the context." in comm["attention"]
    # apply the revision: only that item and its reason change
    r = ar.item_action(r["id"], f"skill:{SKILL}", ar.ItemActionIn(version=r["version"], action="apply_revision"), auth=_auth(db), authorization=None)
    plan = _item(r, f"skill:{SKILL}")["state"]
    assert plan["decision"]["point"] == 4 and plan["decision"]["origin"] == "ai_revision" and plan["revision"] is None


def test_discussion_failure_keeps_the_message(db, ai):
    r = _create(db)
    ai.responses.append(RuntimeError("down"))
    r = ar.discuss.__wrapped__(None, r["id"], ar.DiscussIn(version=r["version"], message="What about ownership?"), auth=_auth(db), authorization=None)
    assert r["conversation"][0]["text"] == "What about ownership?" and r["conversation"][1]["error"] is True


def test_stale_writes_are_refused_and_drafts_resume(db):
    r = _create(db)
    again = _create(db)
    assert again["resumed"] is True and again["id"] == r["id"]
    ar.update_review(r["id"], ar.UpdateReviewIn(version=r["version"], manager_context="x"), auth=_auth(db), authorization=None)
    with pytest.raises(HTTPException) as e:
        ar.update_review(r["id"], ar.UpdateReviewIn(version=r["version"], manager_context="y"), auth=_auth(db), authorization=None)
    assert e.value.status_code == 409
    reloaded = ar.get_review(r["id"], auth=_auth(db), authorization=None)
    assert reloaded["manager_context"] == "x"


def test_another_manager_cannot_read_or_start_on_my_report(db):
    r = _create(db)
    other = _DB(db.tables, user=OTHER)
    with pytest.raises(HTTPException) as e:
        ar.get_review(r["id"], auth=_auth(other), authorization=None)
    assert e.value.status_code == 404
    with pytest.raises(HTTPException):
        _create(other)


# ---------------------------------------------------------------------------
# Review and completion
# ---------------------------------------------------------------------------

def _complete(db, r, request_id="req-1"):
    return ar.complete_review(r["id"], ar.CompleteIn(version=r["version"], client_request_id=request_id), auth=_auth(db), authorization=None)


def test_manual_completion_writes_only_what_was_set_and_is_retry_safe(db):
    r = _create(db, mode="manual")
    assert r["stage"] == "draft" and r["mode"] == "manual"
    r = ar.item_action(r["id"], "overall", ar.ItemActionIn(version=r["version"], action="set", point=3, reason="Meets"), auth=_auth(db), authorization=None)
    r = ar.item_action(r["id"], f"skill:{SKILL5}", ar.ItemActionIn(version=r["version"], action="set", point=4), auth=_auth(db), authorization=None)
    before_skill = len(db.tables["skill_assessments"])
    done = _complete(db, r)
    assert done["status"] == "completed" and done["already_completed"] is False
    t = db.tables
    assert len(t["skill_assessments"]) == before_skill + 1                     # untouched prior (SKILL) not re-logged
    assert [a for a in t["assessments"] if a["source_type"] == "performance_review"][0]["source_id"] == r["id"]
    assert not any(m.get("performance_review_id") for m in t["metric_entries"])  # no invented metric
    snap = done["completed_snapshot"]
    assert {i["key"] for i in snap["items"]} == {"overall", f"skill:{SKILL5}"}
    assert {u["key"] for u in snap["unassessed"]} == {f"skill:{SKILL}", f"value:{VALUE}", f"metric:{METRIC}"}
    assert snap["shared_with_report"] is False
    # retry returns the same record and writes nothing
    again = _complete(db, r)
    assert again["already_completed"] is True
    assert len(t["skill_assessments"]) == before_skill + 1 and db.rpc_calls == 1
    with pytest.raises(HTTPException) as e:
        ar.item_action(r["id"], "overall", ar.ItemActionIn(version=done["version"], action="set", point=4), auth=_auth(db), authorization=None)
    assert e.value.status_code == 409


def test_completion_requires_the_reviewed_version_and_blocks_open_questions(db, ai):
    r = _create(db)
    k = _keys(r)
    s_oo = _ref(r, "one_on_one:oo-in")
    r = _draft(db, r, ai, [{"key": k["overall"], "point": 3, "reason": "r", "sources": [s_oo]},
                           {"key": k[f"skill:{SKILL}"], "point": 3, "reason": "r", "sources": [s_oo]}])
    with pytest.raises(HTTPException) as e:
        ar.complete_review(r["id"], ar.CompleteIn(version=r["version"] - 1), auth=_auth(db), authorization=None)
    assert e.value.status_code == 409
    # context changed after drafting → must redraft or keep the draft explicitly
    r = ar.update_review(r["id"], ar.UpdateReviewIn(version=r["version"], manager_context="She also onboarded two colleagues."),
                         auth=_auth(db), authorization=None)
    assert r["flags"]["context_changed"] is True
    with pytest.raises(HTTPException) as e:
        _complete(db, r)
    assert e.value.status_code == 422 and any("context" in p for p in e.value.detail["problems"])
    r = ar.update_review(r["id"], ar.UpdateReviewIn(version=r["version"], acknowledge_context_change=True), auth=_auth(db), authorization=None)
    assert r["flags"]["context_changed"] is False
    # a metric set without its period can't complete
    r = ar.item_action(r["id"], f"metric:{METRIC}", ar.ItemActionIn(version=r["version"], action="set", value=4.6), auth=_auth(db), authorization=None)
    with pytest.raises(HTTPException) as e:
        _complete(db, r)
    assert any("measurement period" in p for p in e.value.detail["problems"])
    r = ar.item_action(r["id"], f"metric:{METRIC}", ar.ItemActionIn(version=r["version"], action="unassessed"), auth=_auth(db), authorization=None)
    # summary goes stale when a judgment changes afterwards
    ai.responses.append({"headline": "Quarter in review", "overview": "Maya led the renewal plan.", "contributions": [],
                         "strengths": [{"text": "Planning", "keys": [k[f"skill:{SKILL}"]]}], "attention": [], "gaps": ["No CSAT reading used"],
                         "discussion": "What helped you resolve it?"})
    r = ar.write_summary.__wrapped__(None, r["id"], ar.DraftIn(version=r["version"]), auth=_auth(db), authorization=None)
    assert r["stage"] == "review" and r["flags"]["summary_stale"] is False
    r = ar.item_action(r["id"], "overall", ar.ItemActionIn(version=r["version"], action="set", point=4), auth=_auth(db), authorization=None)
    assert r["flags"]["summary_stale"] is True
    with pytest.raises(HTTPException) as e:
        _complete(db, r)
    assert any("summary" in p for p in e.value.detail["problems"])
    r = ar.edit_summary(r["id"], ar.SummaryEditIn(version=r["version"], overview="Maya exceeded on renewals this quarter."), auth=_auth(db), authorization=None)
    assert r["flags"]["summary_stale"] is False
    done = _complete(db, r)
    snap = done["completed_snapshot"]
    assert snap["summary"]["overview"] == "Maya exceeded on renewals this quarter." and snap["summary"]["origin"] == "manager"
    assert snap["summary"]["discussion"] == "What helped you resolve it?"
    plan = next(i for i in snap["items"] if i["key"] == f"skill:{SKILL}")
    assert plan["meaning"] == "Independent" and plan["sources"][0]["id"] == "one_on_one:oo-in"
    assert plan["scale"][0] == {"point": 1, "meaning": "Learning"}
    assert done["rating_ordinal"] == 4


def test_pending_revision_blocks_completion(db, ai):
    r = _create(db, mode="manual")
    r = ar.item_action(r["id"], "overall", ar.ItemActionIn(version=r["version"], action="set", point=3), auth=_auth(db), authorization=None)
    ai.responses.append({"reply": "I'd suggest 2.", "revisions": [{"key": "K1", "point": 2, "reason": "limited", "sources": [_ref(r, "one_on_one:oo-in")]}]})
    r = ar.discuss.__wrapped__(None, r["id"], ar.DiscussIn(version=r["version"], message="Too high?", item_key="overall"), auth=_auth(db), authorization=None)
    with pytest.raises(HTTPException) as e:
        _complete(db, r)
    assert any("revised judgment" in p for p in e.value.detail["problems"])
    r = ar.item_action(r["id"], "overall", ar.ItemActionIn(version=r["version"], action="dismiss_revision"), auth=_auth(db), authorization=None)
    assert _complete(db, r)["rating_ordinal"] == 3


def test_reaffirming_a_prior_rating_is_explicit_and_metrics_cannot_be_reaffirmed(db):
    r = _create(db, mode="manual")
    r = ar.item_action(r["id"], f"skill:{SKILL}", ar.ItemActionIn(version=r["version"], action="reaffirm_prior"), auth=_auth(db), authorization=None)
    d = _item(r, f"skill:{SKILL}")["state"]["decision"]
    assert d["point"] == 2 and d["origin"] == "reaffirmed"
    with pytest.raises(HTTPException) as e:
        ar.item_action(r["id"], f"metric:{METRIC}", ar.ItemActionIn(version=r["version"], action="reaffirm_prior"), auth=_auth(db), authorization=None)
    assert e.value.status_code == 409
    done = _complete(db, r)
    rows = [s for s in db.tables["skill_assessments"] if s["skill_config_id"] == SKILL]
    assert len(rows) == 2 and rows[-1]["performance_review_id"] == r["id"] and rows[-1]["evaluation_point"] == 2
    assert done["status"] == "completed"


def test_scale_points_outside_the_item_scale_are_refused(db):
    r = _create(db, mode="manual")
    with pytest.raises(HTTPException) as e:
        ar.item_action(r["id"], f"value:{VALUE}", ar.ItemActionIn(version=r["version"], action="set", point=5), auth=_auth(db), authorization=None)
    assert e.value.status_code == 422


def test_nothing_included_cannot_complete(db):
    r = _create(db, mode="manual")
    with pytest.raises(HTTPException) as e:
        _complete(db, r)
    assert any("at least one judgment" in p for p in e.value.detail["problems"])


def test_latest_rating_consumers_see_only_confirmed_writes(db, ai):
    r = _create(db)
    k = _keys(r)
    r = _draft(db, r, ai, [{"key": k["overall"], "point": 4, "reason": "r", "sources": [_ref(r, "one_on_one:oo-in")]}])
    sc = assessments.get_scorecard(REPORT, auth=_auth(db), authorization=None)
    assert sc["overall"]["id"] == "old-overall"                 # a draft writes nothing
    assert sc["open_review"]["id"] == r["id"] and sc["last_review"] is None
    _complete(db, r)
    sc = assessments.get_scorecard(REPORT, auth=_auth(db), authorization=None)
    assert sc["overall"]["level_ordinal"] == 4 and sc["overall"]["source_type"] == "performance_review"
    skill = next(s for s in sc["skills"] if s["config_id"] == SKILL)
    assert skill["latest"]["id"] == "old-skill"                  # untouched item keeps its history
    team = assessments.list_team_assessments(auth=_auth(db), authorization=None)
    maya = next(t for t in team if t["id"] == REPORT)
    assert maya["latest_level_ordinal"] == 4 and maya["latest_from_review"] is True
    assert maya["last_review"]["id"] == r["id"] and maya["open_review"] is None


def test_discard_only_drafts(db):
    r = _create(db, mode="manual")
    assert ar.discard_review(r["id"], auth=_auth(db)) == {"ok": True}
    assert db.tables["performance_reviews"] == []


def test_confirming_an_existing_reading_does_not_log_it_twice(db, ai):
    r = _create(db)
    k = _keys(r)
    r = _draft(db, r, ai, [{"key": k[f"metric:{METRIC}"], "value": 4.6, "reason": "recorded", "sources": [_ref(r, "metric_entry:csat-q3")]}])
    before = len(db.tables["metric_entries"])
    done = _complete(db, r)
    assert len(db.tables["metric_entries"]) == before
    item = next(i for i in done["completed_snapshot"]["items"] if i["key"] == f"metric:{METRIC}")
    assert item["existing_reading"] == "metric_entry:csat-q3" and item["value"] == 4.6


def test_team_list_carries_history_with_confirmed_headline_only(db, ai):
    r = _create(db)
    k = _keys(r)
    r = _draft(db, r, ai, [{"key": k["overall"], "point": 4, "reason": "r", "sources": [_ref(r, "one_on_one:oo-in")]}])
    team = assessments.list_team_assessments(auth=_auth(db), authorization=None)
    maya = next(t for t in team if t["id"] == REPORT)
    assert [x["id"] for x in maya["reviews"]] == [r["id"]]
    assert maya["reviews"][0]["headline"] is None                # a draft never shows a headline
    assert "completed_snapshot" not in maya["reviews"][0]
    done = _complete(db, r)
    team = assessments.list_team_assessments(auth=_auth(db), authorization=None)
    row = next(t for t in team if t["id"] == REPORT)["reviews"][0]
    assert row["status"] == "completed" and row["rating_ordinal"] == 4 and row["rating_label"]
    snap = done["completed_snapshot"]
    expected = ((snap.get("summary") or {}).get("headline") or (snap.get("narrative") or {}).get("headline") or None)
    assert row["headline"] == (expected.strip() if expected else None)
    assert "completed_snapshot" not in row
