"""
Overnight prep (backend/jobs/nightly_prep.py) against an in-memory table
store standing in for the worker's service-role client.

What matters here is what the worker must never do, because with the service
role nothing but its own predicates stops it: prepare an occurrence twice,
overwrite a sheet the manager made, spend on a read-only account or an
archived person, read another tenant's records into a prompt, or consume a
thought the saved sheet did not read.
"""
import os
import re
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

for _k in ("SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"):
    os.environ.setdefault(_k, f"https://dummy.{_k.lower()}.invalid")

import ai_core  # noqa: E402
from jobs import nightly_prep, worker  # noqa: E402

NOW = datetime(2026, 9, 27, 7, 5, tzinfo=timezone.utc)
TODAY = "2026-09-27T12:00:00+00:00"
TOMORROW = "2026-09-28T12:00:00+00:00"
LATER = "2026-09-29T12:00:00+00:00"

AGENDA_JSON = (
    '{"situation_summary": "Renewal work is moving.", "agenda_items": ['
    '{"title": "Renewal forecast", "rationale": "Carried.", "suggested_questions": ["Where did it land?"]},'
    '{"title": "Closing", "rationale": "Always.", "suggested_questions": ["Anything else?"]}]}'
)


# ---------------------------------------------------------------------------
# In-memory client
# ---------------------------------------------------------------------------

def _or_predicate(expr: str):
    """The two or_() shapes fetch_role_expectations sends."""
    parts, depth, cur = [], 0, ""
    for ch in expr:
        if ch == "," and depth == 0:
            parts.append(cur)
            cur = ""
            continue
        depth += ch == "("
        depth -= ch == ")"
        cur += ch

    parts.append(cur)

    def atom(a: str):
        if a.startswith("and("):
            subs = _or_predicate_list(a[4:-1])
            return lambda row: all(s(row) for s in subs)
        field, op, value = a.split(".", 2)
        if op == "is" and value == "null":
            return lambda row: row.get(field) is None
        return lambda row: row.get(field) == value

    def _or_predicate_list(inner: str):
        return [atom(p) for p in re.split(r",(?![^(]*\))", inner)]

    atoms = [atom(p) for p in parts]
    return lambda row: any(a(row) for a in atoms)


class _Query:
    def __init__(self, client, table):
        self.client, self.table = client, table
        self.filters, self.operation, self.values, self.limit_count = [], "select", None, None
        self.order_by = None

    def select(self, *_a, **_k):
        return self

    def eq(self, f, v):
        self.filters.append(lambda r, f=f, v=v: r.get(f) == v)
        return self

    def is_(self, f, v):
        exp = None if v == "null" else v
        self.filters.append(lambda r, f=f, e=exp: r.get(f) is e)
        return self

    def in_(self, f, vs):
        vs = set(vs)
        self.filters.append(lambda r, f=f, vs=vs: r.get(f) in vs)
        return self

    def gte(self, f, v):
        self.filters.append(lambda r, f=f, v=v: r.get(f) is not None and str(r.get(f)) >= v)
        return self

    def lt(self, f, v):
        self.filters.append(lambda r, f=f, v=v: r.get(f) is not None and str(r.get(f)) < v)
        return self

    def or_(self, expr):
        self.filters.append(_or_predicate(expr))
        return self

    def order(self, field, desc=False):
        if self.order_by is None:
            self.order_by = (field, desc)
        return self

    def limit(self, n):
        self.limit_count = n
        return self

    def update(self, values):
        self.operation, self.values = "update", values
        return self

    def insert(self, values):
        self.operation, self.values = "insert", values
        return self

    def delete(self):
        self.operation = "delete"
        return self

    def execute(self):
        self.client.log.append((self.table, self.operation))
        rows = self.client.rows.setdefault(self.table, [])
        if self.operation == "insert":
            batch = self.values if isinstance(self.values, list) else [self.values]
            out = []
            for v in batch:
                row = {"id": f"{self.table}-{len(rows) + 1}", "created_at": NOW.isoformat(), **v}
                if self.table == "ai_jobs":
                    live = [j for j in rows if j["one_on_one_id"] == row["one_on_one_id"]
                            and j["status"] in ("queued", "submitted")]
                    if live:
                        raise RuntimeError("duplicate key value violates ai_jobs_one_in_flight_idx")
                rows.append(row)
                out.append(dict(row))
            return SimpleNamespace(data=out)
        matched = [r for r in rows if all(p(r) for p in self.filters)]
        if self.operation == "delete":
            self.client.rows[self.table] = [r for r in rows if r not in matched]
            return SimpleNamespace(data=matched)
        if self.order_by:
            field, desc = self.order_by
            matched.sort(key=lambda r: str(r.get(field) or ""), reverse=desc)
        if self.limit_count is not None:
            matched = matched[: self.limit_count]
        if self.operation == "update":
            for r in matched:
                r.update(self.values)
        return SimpleNamespace(data=[dict(r) for r in matched])


class _Client:
    def __init__(self, rows):
        self.rows = rows
        self.log = []

    def table(self, name):
        return _Query(self, name)


def _occurrence(id_, manager="m1", report="r1", at=TOMORROW, **kw):
    return {
        "id": id_, "manager_id": manager, "direct_report_id": report, "scheduled_at": at,
        "summary": None, "prep_guide": None, "carry_forward_items": [], "opening_line": None,
        "created_at": "2026-09-20T00:00:00+00:00", **kw,
    }


def _world():
    trial_left = (NOW + timedelta(days=5)).isoformat()
    return {
        "users": [{"id": "m1", "org_id": "org1"}, {"id": "m2", "org_id": "org2"}],
        "organizations": [{"id": "org1", "one_on_one_cadence_days": 14}, {"id": "org2"}],
        "subscriptions": [
            {"user_id": "m1", "status": "trialing", "trial_ends_at": trial_left},
            {"user_id": "m2", "status": "trialing", "trial_ends_at": (NOW - timedelta(days=1)).isoformat()},
        ],
        "direct_reports": [
            {"id": "r1", "manager_id": "m1", "name": "Jordan", "role_level_id": "lvl1",
             "org_unit_id": None, "one_on_one_cadence_days": None, "archived_at": None},
            {"id": "r2", "manager_id": "m1", "name": "Leah", "role_level_id": None,
             "org_unit_id": None, "one_on_one_cadence_days": None, "archived_at": "2026-09-01T00:00:00+00:00"},
            {"id": "r3", "manager_id": "m2", "name": "Other", "role_level_id": None,
             "org_unit_id": None, "one_on_one_cadence_days": None, "archived_at": None},
        ],
        "one_on_ones": [
            _occurrence("today", at=TODAY, carry_forward_items=["Renewal forecast"],
                        opening_line="Last time we said the forecast by the 3rd. Where did it land?"),
            _occurrence("later", at=LATER),
            _occurrence("prepped", at=TOMORROW, prep_guide={"situation_summary": "mine"}),
            _occurrence("logged", at=TOMORROW, summary="done"),
            _occurrence("undated", at=None),
            _occurrence("archived", report="r2"),
            _occurrence("expired-trial", manager="m2", report="r3"),
            {"id": "history", "manager_id": "m1", "direct_report_id": "r1", "summary": "Talked renewals.",
             "scheduled_at": "2026-09-13T12:00:00+00:00", "prep_guide": None, "created_at": "2026-09-13T00:00:00+00:00"},
        ],
        "commitments": [
            {"id": "c1", "owner_id": "m1", "direct_report_id": "r1", "status": "open",
             "description": "Send the forecast", "due_date": "2026-10-03", "committed_by": "direct_report"},
            {"id": "c-foreign", "owner_id": "m2", "direct_report_id": "r1", "status": "open",
             "description": "FOREIGN COMMITMENT", "due_date": None, "committed_by": "manager"},
        ],
        "dr_capture_notes": [
            {"id": "cap1", "manager_id": "m1", "direct_report_id": "r1", "content": "Seemed stretched on scope",
             "created_at": "2026-09-25T00:00:00+00:00"},
        ],
        "goals": [
            {"id": "g1", "owner_id": "m1", "direct_report_id": "r1", "title": "Renewal rate", "status": "at_risk",
             "created_at": "2026-09-01"},
            {"id": "g-foreign", "owner_id": "m2", "direct_report_id": "r1", "title": "FOREIGN GOAL",
             "status": "at_risk", "created_at": "2026-09-01"},
        ],
        "development_plans": [
            {"id": "p1", "manager_id": "m1", "direct_report_id": "r1", "plan_text": "Grow toward team lead",
             "created_at": "2026-08-01"},
        ],
        "role_levels": [{"id": "lvl1", "job_role": "CSM", "job_level": "2", "functional_team": None,
                         "job_responsibilities": None, "created_at": "2026-01-01"}],
        "metric_configs": [],
        "skill_configs": [],
        "value_configs": [
            {"id": "v1", "org_id": "org1", "role_level_id": None, "value_name": "Own the outcome", "retired_at": None},
            {"id": "v-foreign", "org_id": "org2", "role_level_id": None, "value_name": "FOREIGN VALUE", "retired_at": None},
        ],
        "document_scopes": [],
        "outside_meeting_links": [],
        "ai_jobs": [],
    }


@pytest.fixture
def batch(monkeypatch):
    """Fake Batch API: records submissions; results are set per test."""
    state = {"submitted": [], "status": "ended", "results": {}}

    def submit(requests, model=None, max_tokens=None):
        state["submitted"].append({"requests": requests, "model": model, "max_tokens": max_tokens})
        return f"batch-{len(state['submitted'])}"

    monkeypatch.setattr(ai_core, "submit_text_batch", submit)
    monkeypatch.setattr(ai_core, "get_batch", lambda bid: {"id": bid, "processing_status": state["status"],
                                                          "results_url": "x"})
    monkeypatch.setattr(
        ai_core, "batch_text_results",
        lambda b: [(cid, *res) for cid, res in state["results"].items()],
    )
    return state


# ---------------------------------------------------------------------------
# Selection
# ---------------------------------------------------------------------------

def test_due_is_today_and_tomorrow_unprepared_entitled_and_active_only():
    due = nightly_prep.due_occurrences(_Client(_world()), NOW)
    assert [row["id"] for row in due] == ["today"]


def test_a_recent_job_blocks_resubmission_but_one_failure_gets_a_retry():
    world = _world()
    client = _Client(world)
    world["ai_jobs"].append({"id": "j0", "kind": "overnight_prep", "one_on_one_id": "today",
                             "status": "failed", "created_at": (NOW - timedelta(hours=1)).isoformat()})
    assert [r["id"] for r in nightly_prep.due_occurrences(client, NOW)] == ["today"]
    world["ai_jobs"].append({"id": "j1", "kind": "overnight_prep", "one_on_one_id": "today",
                             "status": "failed", "created_at": (NOW - timedelta(minutes=30)).isoformat()})
    assert nightly_prep.due_occurrences(client, NOW) == []          # two failures: left for the manager
    world["ai_jobs"] = [{"id": "j2", "kind": "overnight_prep", "one_on_one_id": "today",
                         "status": "applied", "created_at": (NOW - timedelta(hours=2)).isoformat()}]
    assert nightly_prep.due_occurrences(client, NOW) == []
    world["ai_jobs"][0]["created_at"] = (NOW - timedelta(hours=30)).isoformat()
    assert [r["id"] for r in nightly_prep.due_occurrences(client, NOW)] == ["today"]


def test_active_subscription_counts_and_no_subscription_row_does_not():
    assert nightly_prep._entitled({"status": "active"}, NOW)
    assert not nightly_prep._entitled(None, NOW)
    assert not nightly_prep._entitled({"status": "canceled"}, NOW)


# ---------------------------------------------------------------------------
# Submit
# ---------------------------------------------------------------------------

def test_submit_builds_the_prompt_from_this_managers_records_only(batch):
    world = _world()
    client = _Client(world)
    assert nightly_prep.submit_due(client, NOW) == 1

    (sub,) = batch["submitted"]
    assert sub["model"] == "claude-sonnet-5" and sub["max_tokens"] == 2000
    ((job_id, prompt),) = sub["requests"]
    job = next(j for j in world["ai_jobs"] if j["id"] == job_id)
    assert job["status"] == "submitted" and job["batch_id"] == "batch-1" and job["one_on_one_id"] == "today"

    # Every default source the review step would include.
    for expected in ("Renewal forecast", "Where did it land?", "Seemed stretched on scope",
                     "Send the forecast", "Renewal rate is at risk", "Development: Grow toward team lead",
                     "Talked renewals.", "Own the outcome"):
        assert expected in prompt, expected
    # No other tenant's commitment, goal or company value.
    for foreign in ("FOREIGN COMMITMENT", "FOREIGN GOAL", "FOREIGN VALUE"):
        assert foreign not in prompt
    snap = job["input"]
    assert snap["capture_ids"] == ["cap1"]
    assert [c["id"] for c in snap["open_commitments"]] == ["c1"]
    assert "1 carried topic" in snap["drew_on"] and "1 open commitment" in snap["drew_on"]
    assert "the opening line you kept at the last wrap-up" in snap["drew_on"]


def test_submit_failure_marks_jobs_failed_and_frees_the_occurrence(monkeypatch):
    world = _world()

    def boom(*a, **k):
        raise ai_core.AIBatchError("batch submit failed: 529")

    monkeypatch.setattr(ai_core, "submit_text_batch", boom)
    assert nightly_prep.submit_due(_Client(world), NOW) == 0
    assert [(j["status"], j["outcome"]) for j in world["ai_jobs"]] == [("failed", "submit_failed")]
    assert world["ai_jobs"][0]["input"] == {}


def test_a_second_submit_the_same_night_submits_nothing(batch):
    client = _Client(_world())
    nightly_prep.submit_due(client, NOW)
    assert nightly_prep.submit_due(client, NOW + timedelta(minutes=15)) == 0
    assert len(batch["submitted"]) == 1


# ---------------------------------------------------------------------------
# Collect
# ---------------------------------------------------------------------------

def _submitted_world(batch):
    world = _world()
    client = _Client(world)
    nightly_prep.submit_due(client, NOW)
    job = world["ai_jobs"][0]
    return world, client, job


def _row(world, id_):
    return next(r for r in world["one_on_ones"] if r["id"] == id_)


def test_collect_saves_the_sheet_marked_overnight_and_consumes_only_what_it_read(batch):
    world, client, job = _submitted_world(batch)
    # A thought kept after the prompt was built must survive.
    world["dr_capture_notes"].append({"id": "cap2", "manager_id": "m1", "direct_report_id": "r1",
                                      "content": "Later thought", "created_at": NOW.isoformat()})
    batch["results"] = {job["id"]: (AGENDA_JSON, None)}

    assert nightly_prep.collect(client, NOW + timedelta(hours=1)) == {"applied": 1}
    guide = _row(world, "today")["prep_guide"]
    assert guide["prepared_by"] == "overnight"
    assert guide["situation_summary"] == "Renewal work is moving."
    assert [a["title"] for a in guide["agenda_items"]] == ["Renewal forecast", "Closing"]
    assert guide["source_notes"] == "Seemed stretched on scope"
    assert [c["id"] for c in guide["open_commitments_to_check"]] == ["c1"]
    assert "1 kept thought" in guide["drew_on"]
    assert [c["id"] for c in world["dr_capture_notes"]] == ["cap2"]
    assert job["status"] == "applied" and set(job["input"]) == {"drew_on"}   # record text dropped


def test_a_sheet_the_manager_made_meanwhile_is_never_overwritten(batch):
    world, client, job = _submitted_world(batch)
    _row(world, "today")["prep_guide"] = {"situation_summary": "The manager's own", "prepared_by": "manager"}
    batch["results"] = {job["id"]: (AGENDA_JSON, None)}

    assert nightly_prep.collect(client, NOW + timedelta(hours=1)) == {"skipped": 1}
    assert _row(world, "today")["prep_guide"]["situation_summary"] == "The manager's own"
    assert job["outcome"] == "already_prepared"
    assert [c["id"] for c in world["dr_capture_notes"]] == ["cap1"]          # nothing consumed


def test_a_meeting_logged_meanwhile_is_left_alone(batch):
    world, client, job = _submitted_world(batch)
    _row(world, "today")["summary"] = "We met early."
    batch["results"] = {job["id"]: (AGENDA_JSON, None)}
    nightly_prep.collect(client, NOW + timedelta(hours=1))
    assert _row(world, "today")["prep_guide"] is None and job["outcome"] == "already_logged"


@pytest.mark.parametrize("text,error,outcome", [
    (None, "errored", "errored"),
    ("I could not do that.", None, "unparseable"),
])
def test_a_failed_or_unusable_result_saves_nothing(batch, text, error, outcome):
    world, client, job = _submitted_world(batch)
    batch["results"] = {job["id"]: (text, error)}
    assert nightly_prep.collect(client, NOW + timedelta(hours=1)) == {"failed": 1}
    assert _row(world, "today")["prep_guide"] is None
    assert job["outcome"] == outcome
    assert [c["id"] for c in world["dr_capture_notes"]] == ["cap1"]


def test_an_unfinished_batch_waits_then_is_written_off(batch):
    world, client, job = _submitted_world(batch)
    batch["status"] = "in_progress"
    assert nightly_prep.collect(client, NOW + timedelta(hours=2)) == {}
    assert job["status"] == "submitted"
    assert nightly_prep.collect(client, NOW + timedelta(hours=27)) == {"failed": 1}
    assert job["outcome"] == "batch_timeout"


def test_a_job_orphaned_before_submission_is_released():
    world = _world()
    world["ai_jobs"].append({"id": "j", "kind": "overnight_prep", "one_on_one_id": "today", "manager_id": "m1",
                             "status": "queued", "created_at": (NOW - timedelta(hours=1)).isoformat(), "input": {}})
    assert nightly_prep.collect(_Client(world), NOW) == {"failed": 1}
    assert world["ai_jobs"][0]["outcome"] == "never_submitted"


# ---------------------------------------------------------------------------
# Worker
# ---------------------------------------------------------------------------

def test_nightly_window_is_four_hours_from_the_configured_hour():
    at = lambda h: datetime(2026, 9, 27, h, 0, tzinfo=timezone.utc)  # noqa: E731
    assert [h for h in range(24) if worker.in_nightly_window(at(h))] == [7, 8, 9, 10]


def test_a_tick_outside_the_window_only_collects(batch):
    client = _Client(_world())
    assert worker.tick(client, datetime(2026, 9, 27, 15, 0, tzinfo=timezone.utc))["submitted"] == 0
    assert batch["submitted"] == []
    assert worker.tick(client, NOW)["submitted"] == 1
