"""Goals — optional numeric measures, readings, the goal check-in write and
the Updates feed. Uses a small in-memory stand-in for the Supabase client.
The transactional SQL function, the measure-lock trigger and RLS are verified
against local Postgres (see docs/systems/goals.md)."""
import re
import uuid

import pytest
from fastapi import HTTPException
from postgrest.exceptions import APIError

import routes.goals as goals
from routes.check_ins import enrich_with_check_ins

ME = "manager-1"
OTHER = "manager-2"

_EMBED_FK = {"direct_reports": "direct_report_id", "org_units": "org_unit_id"}


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, db, name):
        self.db, self.name = db, name
        self.filters, self.op, self.payload, self._limit, self._negate = [], "select", None, None, False
        self._order = None
        self.embeds = []

    def select(self, cols="*", **_k):
        self.op = "select"
        self.embeds = re.findall(r"(\w+)\(([^)]*)\)", cols or "")
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

    def order(self, col, desc=False):
        self._order = (col, desc)
        return self

    def limit(self, n):
        self._limit = n
        return self

    def execute(self):
        self.db.queries.append((self.name, self.op))
        table = self.db.tables.setdefault(self.name, [])
        match = [r for r in table if all(f(r) for f in self.filters)]
        if self.op == "insert":
            created = []
            for row in self.payload:
                row = {"id": str(uuid.uuid4()), "created_at": "2026-09-25T12:00:00+00:00", **row}
                table.append(row)
                created.append(dict(row))
            return _Result(created)
        if self.op == "update":
            for row in match:
                row.update(self.payload)
            return _Result([dict(r) for r in match])
        if self.op == "delete":
            for row in match:
                table.remove(row)
            return _Result([])
        if self._order:
            col, desc = self._order
            match.sort(key=lambda r: str(r.get(col) or ""), reverse=desc)
        rows = [dict(r) for r in match]
        for row in rows:
            for name, _cols in self.embeds:
                fk = _EMBED_FK.get(name)
                target = next((t for t in self.db.tables.get(name, []) if t.get("id") == row.get(fk)), None)
                row[name] = dict(target) if target else None
        return _Result(rows[: self._limit] if self._limit else rows)


class _Rpc:
    def __init__(self, db, name, params):
        self.db, self.name, self.params = db, name, params

    def execute(self):
        self.db.rpc_calls.append((self.name, self.params))
        if self.db.rpc_error:
            raise APIError(self.db.rpc_error)
        row = {
            "id": "ci-new",
            "goal_id": self.params["p_goal_id"],
            "project_id": None,
            "status": self.params["p_status"],
            "progress": self.params["p_progress"],
            "measured_value": self.params["p_measured_value"],
            "note": self.params["p_note"],
            "source_type": None,
            "source_id": None,
            "created_at": "2026-09-25T12:00:00+00:00",
        }
        return _Result([row])


class _DB:
    def __init__(self, tables):
        self.tables = tables
        self.queries: list = []
        self.rpc_calls: list = []
        self.rpc_error = None

    def table(self, name):
        return _Query(self, name)

    def rpc(self, name, params):
        return _Rpc(self, name, params)


MEASURE = {
    "measure_label": "handoffs with an owner, next step and date",
    "measure_format": "count",
    "measure_unit": "handoffs",
    "measure_target": 20,
    "measure_direction": "at_least",
}
NO_MEASURE = {k: None for k in MEASURE}


def _ci(id_, goal, at, status="on_track", progress=None, value=None, note=None, owner=ME, **extra):
    return {"id": id_, "owner_id": owner, "goal_id": goal, "project_id": None, "status": status,
            "progress": progress, "measured_value": value, "note": note, "created_at": at,
            "source_type": None, "source_id": None, **extra}


def _seed():
    return _DB({
        "direct_reports": [
            {"id": "dr-maya", "manager_id": ME, "name": "Maya"},
            {"id": "dr-theirs", "manager_id": OTHER, "name": "Theirs"},
        ],
        "org_units": [
            {"id": "ou-cs", "name": "Customer Success", "unit_type": "team"},
            {"id": "ou-dept", "name": "Customer Experience", "unit_type": "department"},
        ],
        "goals": [
            {"id": "g-measured", "owner_id": ME, "title": "Handoffs", "level": "team", "status": "at_risk",
             "org_unit_id": "ou-cs", "direct_report_id": None, "parent_goal_id": None, "description": None,
             "success_metrics": "20 handoffs include an owner", "due_date": None, "created_at": "2026-09-01", **MEASURE},
            {"id": "g-legacy", "owner_id": ME, "title": "Legacy", "level": "team", "status": "on_track",
             "org_unit_id": None, "direct_report_id": None, "parent_goal_id": None, "description": None,
             "success_metrics": "Grow NPS", "due_date": None, "created_at": "2026-08-01", **NO_MEASURE},
            {"id": "g-closed", "owner_id": ME, "title": "Done", "level": "team", "status": "completed",
             "org_unit_id": "ou-cs", "direct_report_id": None, "parent_goal_id": None, "description": None,
             "success_metrics": None, "due_date": None, "created_at": "2026-07-01", **NO_MEASURE},
            {"id": "g-theirs", "owner_id": OTHER, "title": "Not yours", "level": "team", "status": "active",
             "org_unit_id": "ou-cs", "direct_report_id": None, "parent_goal_id": None, "description": None,
             "success_metrics": None, "due_date": None, "created_at": "2026-07-01", **NO_MEASURE},
        ],
        "check_ins": [
            _ci("c1", "g-measured", "2026-09-09T10:00:00+00:00", value=0, note="pilot"),
            _ci("c2", "g-measured", "2026-09-16T10:00:00+00:00", value=6),
            _ci("c3", "g-measured", "2026-09-23T10:00:00+00:00", status="at_risk", note="note only"),
            _ci("c4", "g-legacy", "2026-09-10T10:00:00+00:00", progress=40, note="forty"),
            _ci("c5", "g-legacy", "2026-09-20T10:00:00+00:00", note="note only"),
            _ci("c6", "g-closed", "2026-09-05T10:00:00+00:00", status="completed", note="shipped",
                source_type="outside_meeting", source_id="m-1"),
            _ci("c7", "g-theirs", "2026-09-24T10:00:00+00:00", note="private", owner=OTHER),
        ],
    })


def _auth(db):
    return (ME, db)


def _goal(db, goal_id):
    return next(g for g in goals.list_goals(auth=_auth(db)) if g["id"] == goal_id)


# --- readings and enrichment -------------------------------------------------

def test_readings_keep_zero_and_their_own_date_through_a_note_only_update():
    g = _goal(_seed(), "g-measured")
    assert g["measure"] == {"label": MEASURE["measure_label"], "format": "count", "unit": "handoffs",
                            "target": 20, "direction": "at_least"}
    assert g["latest_reading"]["value"] == 6
    assert g["latest_reading"]["at"].startswith("2026-09-16")
    assert g["last_check_in_at"].startswith("2026-09-23")  # newer than the reading
    assert [r["value"] for r in g["recent_readings"]] == [6, 0]  # zero is a real reading
    assert g["reading_count"] == 2
    assert g["progress"] is None  # a reading is never turned into completion %


def test_legacy_goal_keeps_completion_percent_and_has_no_readings():
    g = _goal(_seed(), "g-legacy")
    assert g["measure"] is None
    assert g["progress"] == 40 and g["progress_at"].startswith("2026-09-10")
    assert g["latest_reading"] is None and g["recent_readings"] == [] and g["reading_count"] == 0
    assert g["last_check_in_note"] == "note only"


def test_list_never_includes_another_owners_goals():
    ids = {g["id"] for g in goals.list_goals(auth=_auth(_seed()))}
    assert "g-theirs" not in ids


def test_project_enrichment_gets_no_reading_fields():
    db = _DB({"check_ins": [{"id": "p1", "owner_id": ME, "goal_id": None, "project_id": "pr-1", "status": "active",
                             "progress": 30, "note": None, "created_at": "2026-09-01"}]})
    rows = enrich_with_check_ins(db, ME, [{"id": "pr-1"}], "project_id")
    assert rows[0]["progress"] == 30 and "latest_reading" not in rows[0]


def test_recent_readings_are_bounded():
    db = _seed()
    db.tables["check_ins"] += [
        _ci(f"x{i}", "g-measured", f"2026-10-{i:02d}T10:00:00+00:00", value=i) for i in range(1, 20)
    ]
    g = _goal(db, "g-measured")
    assert len(g["recent_readings"]) == 12 and g["reading_count"] == 21
    assert g["latest_reading"]["value"] == 19


# --- measure configuration ---------------------------------------------------

def _body(**overrides):
    base = {"title": "Handoffs", "level": "team", "status": "at_risk", "org_unit_id": "ou-cs",
            "success_metrics": "20 handoffs include an owner"}
    base.update(overrides)
    return goals.GoalIn(**base)


def test_put_without_a_measure_key_leaves_the_measure_alone():
    db = _seed()
    goals.update_goal("g-measured", _body(title="Handoffs, clarified"), auth=_auth(db))
    stored = next(g for g in db.tables["goals"] if g["id"] == "g-measured")
    assert stored["title"] == "Handoffs, clarified"
    assert stored["measure_format"] == "count" and stored["measure_target"] == 20


def test_label_and_target_edit_is_allowed_after_readings():
    db = _seed()
    out = goals.update_goal("g-measured", _body(measure={"label": "handoffs with all three details", "format": "count",
                                                        "unit": "handoffs", "target": 25, "direction": "at_least"}),
                            auth=_auth(db))
    assert out["measure"]["target"] == 25 and out["measure"]["label"] == "handoffs with all three details"
    assert out["latest_reading"]["value"] == 6  # response carries enrichment, not just base columns


@pytest.mark.parametrize("measure", [
    {"label": "x", "format": "count", "unit": "calls", "target": 20, "direction": "at_least"},
    {"label": "x", "format": "number", "unit": "handoffs", "target": 20, "direction": "at_least"},
    None,
])
def test_unit_format_or_removal_is_refused_once_readings_exist(measure):
    db = _seed()
    with pytest.raises(HTTPException) as exc:
        goals.update_goal("g-measured", _body(measure=measure), auth=_auth(db))
    assert exc.value.status_code == 409
    assert next(g for g in db.tables["goals"] if g["id"] == "g-measured")["measure_unit"] == "handoffs"


def test_measure_can_be_added_to_a_legacy_goal_without_touching_history():
    db = _seed()
    out = goals.update_goal("g-legacy", _body(title="Legacy", org_unit_id=None, measure={
        "label": "net dollar retention", "format": "percent", "unit": "ignored", "target": 105, "direction": "at_least"}),
        auth=_auth(db))
    assert out["measure"] == {"label": "net dollar retention", "format": "percent", "unit": "%",
                              "target": 105, "direction": "at_least"}
    assert out["progress"] == 40 and out["latest_reading"] is None


@pytest.mark.parametrize("target", [2.5, -1, float("inf")])
def test_count_target_must_be_a_whole_non_negative_finite_number(target):
    with pytest.raises(HTTPException) as exc:
        goals.create_goal(_body(measure={"label": "calls", "format": "count", "unit": "calls",
                                         "target": target, "direction": "at_least"}), auth=_auth(_seed()))
    assert exc.value.status_code == 422


def test_blank_measure_label_is_refused():
    with pytest.raises(HTTPException):
        goals.create_goal(_body(measure={"label": "  ", "format": "number", "target": 3, "direction": "below"}),
                          auth=_auth(_seed()))


def test_create_with_measure_and_zero_target():
    db = _seed()
    out = goals.create_goal(_body(title="Zero escalations", measure={
        "label": "open escalations", "format": "count", "unit": "escalations", "target": 0, "direction": "at_most"}),
        auth=_auth(db))
    assert out["measure"]["target"] == 0 and out["measure"]["direction"] == "at_most"


# --- references --------------------------------------------------------------

def test_another_managers_report_is_refused():
    with pytest.raises(HTTPException) as exc:
        goals.create_goal(_body(level="individual", org_unit_id=None, direct_report_id="dr-theirs"), auth=_auth(_seed()))
    assert exc.value.status_code == 422


def test_org_unit_must_match_the_level():
    with pytest.raises(HTTPException):
        goals.create_goal(_body(org_unit_id="ou-dept"), auth=_auth(_seed()))


def test_mismatched_association_is_dropped_like_the_form_does():
    db = _seed()
    out = goals.create_goal(_body(level="company", org_unit_id="ou-cs", direct_report_id="dr-maya"), auth=_auth(db))
    assert out["org_unit_id"] is None and out["direct_report_id"] is None


def test_parent_cycle_is_refused():
    db = _seed()
    db.tables["goals"][1]["parent_goal_id"] = "g-measured"  # legacy is a child of measured
    with pytest.raises(HTTPException) as exc:
        goals.update_goal("g-measured", _body(parent_goal_id="g-legacy"), auth=_auth(db))
    assert exc.value.status_code == 422


def test_another_owners_goal_cannot_be_a_parent():
    with pytest.raises(HTTPException):
        goals.create_goal(_body(parent_goal_id="g-theirs"), auth=_auth(_seed()))


# --- goal check-in write -----------------------------------------------------

def test_check_in_goes_through_the_transactional_function_with_zero_kept():
    db = _seed()
    row = goals.create_goal_check_in("g-measured", goals.GoalCheckInIn(
        status="on_track", measured_value=0, note="reset", client_request_id="key-1"), auth=_auth(db))
    name, params = db.rpc_calls[0]
    assert name == "record_goal_check_in"
    assert params["p_measured_value"] == 0 and params["p_client_request_id"] == "key-1"
    assert params["p_progress"] is None
    assert row["measured_value"] == 0
    # No direct table writes: status write-through happens inside the function.
    assert ("check_ins", "insert") not in db.queries and ("goals", "update") not in db.queries


def test_legacy_caller_body_still_works():
    db = _seed()
    goals.create_goal_check_in("g-legacy", goals.GoalCheckInIn(status="at_risk", progress=55, note="x"), auth=_auth(db))
    params = db.rpc_calls[0][1]
    assert params["p_measured_value"] is None and params["p_client_request_id"] is None and params["p_progress"] == 55


@pytest.mark.parametrize("code,status", [("22023", 422), ("P0002", 404)])
def test_function_errors_become_clear_http_errors(code, status):
    db = _seed()
    db.rpc_error = {"code": code, "message": "A count must be a whole number of zero or more"}
    with pytest.raises(HTTPException) as exc:
        goals.create_goal_check_in("g-measured", goals.GoalCheckInIn(status="on_track", measured_value=2.5),
                                   auth=_auth(db))
    assert exc.value.status_code == status


def test_bad_progress_is_refused_before_any_write():
    db = _seed()
    with pytest.raises(HTTPException):
        goals.create_goal_check_in("g-legacy", goals.GoalCheckInIn(status="on_track", progress=140), auth=_auth(db))
    assert db.rpc_calls == []


def test_status_only_change_writes_no_check_in():
    db = _seed()
    goals.update_goal_status("g-legacy", goals.GoalStatusUpdate(status="at_risk"), auth=_auth(db))
    assert len(db.tables["check_ins"]) == 7
    assert _goal(db, "g-legacy")["last_check_in_at"].startswith("2026-09-20")


# --- Updates feed ------------------------------------------------------------

def _feed(db, **kw):
    params = {"level": "team", "direct_report_id": None, "org_unit_id": None, "unassociated": False,
              "closed": False, "limit": 150}
    params.update(kw)
    return goals.list_goal_updates(auth=_auth(db), **params)


def test_updates_are_newest_first_open_only_and_own_only():
    rows = _feed(_seed())
    assert [r["id"] for r in rows] == ["c3", "c5", "c2", "c4", "c1"]
    note_only = next(r for r in rows if r["id"] == "c3")
    assert note_only["measured_value"] is None  # never re-states an older reading


def test_updates_scope_by_org_unit_id_and_unassociated_is_distinct_from_all():
    assert {r["goal_id"] for r in _feed(_seed(), org_unit_id="ou-cs")} == {"g-measured"}
    assert {r["goal_id"] for r in _feed(_seed(), unassociated=True)} == {"g-legacy"}


def test_closed_updates_keep_their_source():
    rows = _feed(_seed(), closed=True)
    assert [r["id"] for r in rows] == ["c6"]
    assert rows[0]["source_type"] == "outside_meeting" and rows[0]["source_id"] == "m-1"


def test_updates_limit_is_bounded():
    assert len(_feed(_seed(), limit=2)) == 2
    assert len(_feed(_seed(), limit=100000)) == 5
