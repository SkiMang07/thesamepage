"""Team meetings — inline agenda capture, id-preserving agenda edits, the
confirmed wrap-up write (receipt, retry guard, carry-forward lineage) and
series rollover.

Uses a small in-memory stand-in for the Supabase client, the same shape as
tests/test_beyond.py's. It applies the filters each route passes, so the
manager_id / summary-is-null conditions are exercised rather than assumed.
RLS itself is verified separately against local Postgres (docs/ENGINEERING.md).
"""
import re
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from routes.team import (
    AgendaItemIn,
    LogTeamMeetingIn,
    TeamMeetingPatch,
    TeamWrapUpCommitment,
    AgendaOutcomeIn,
    _next_occurrence_at,
    add_team_meeting_agenda_item,
    list_team_commitments,
    list_team_meetings,
    log_team_meeting,
    update_team_meeting,
)

MANAGER = "manager-1"
OTHER = "manager-2"

_EMBED_FK = {"direct_reports": "direct_report_id", "team_meeting_series": "series_id"}


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, db, name):
        self.db, self.name = db, name
        self.filters, self.op, self.payload, self._limit = [], "select", None, None
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

    def eq(self, col, val):
        self.filters.append(lambda r: r.get(col) == val)
        return self

    def neq(self, col, val):
        self.filters.append(lambda r: r.get(col) != val)
        return self

    def in_(self, col, vals):
        vals = list(vals)
        self.filters.append(lambda r: r.get(col) in vals)
        return self

    def is_(self, col, val):
        assert val == "null"
        self.filters.append(lambda r: r.get(col) is None)
        return self

    def order(self, col, desc=False, **_k):
        self._order = (col, desc)
        return self

    def limit(self, n):
        self._limit = n
        return self

    def execute(self):
        if self.db.fail_on == (self.name, self.op):
            raise RuntimeError(f"simulated failure on {self.name} {self.op}")
        table = self.db.tables.setdefault(self.name, [])
        match = [r for r in table if all(f(r) for f in self.filters)]
        if self.op == "insert":
            created = []
            for row in self.payload:
                row = {"id": str(uuid.uuid4()), "created_at": _now(), **row}
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
        rows = [dict(r) for r in match]
        order = getattr(self, "_order", None)
        if order:
            col, desc = order
            rows.sort(key=lambda r: (r.get(col) is None, r.get(col) if r.get(col) is not None else 0), reverse=desc)
        for row in rows:
            for name, _cols in self.embeds:
                fk = _EMBED_FK.get(name)
                target = next(
                    (t for t in self.db.tables.get(name, []) if fk and t.get("id") == row.get(fk)), None
                )
                row[name] = dict(target) if target else None
        return _Result(rows[: self._limit] if self._limit else rows)


class _DB:
    def __init__(self):
        self.tables: dict[str, list[dict]] = {}
        self.fail_on = None

    def table(self, name):
        return _Query(self, name)


def _now():
    return datetime.now(timezone.utc).isoformat()


def _days(n):
    return (datetime.now(timezone.utc) + timedelta(days=n)).replace(
        hour=12, minute=0, second=0, microsecond=0
    ).isoformat()


def _seed():
    db = _DB()
    db.tables = {
        "direct_reports": [
            {"id": "dr-maya", "manager_id": MANAGER, "name": "Maya Patel", "org_unit_id": "ou-us", "archived_at": None},
            {"id": "dr-sam", "manager_id": MANAGER, "name": "Sam Rivera", "org_unit_id": "ou-us", "archived_at": None},
            {"id": "dr-theirs", "manager_id": OTHER, "name": "Not yours", "org_unit_id": None, "archived_at": None},
        ],
        "team_meeting_series": [],
        "team_meetings": [
            # Held last week, not yet logged.
            {"id": "m-held", "manager_id": MANAGER, "org_unit_id": "ou-us", "scheduled_at": _days(-3),
             "summary": None, "raw_notes": None, "logged_at": None, "series_id": None, "created_at": _days(-10)},
            {"id": "m-logged", "manager_id": MANAGER, "org_unit_id": "ou-us", "scheduled_at": _days(-10),
             "summary": "Agreed the handoff owner.", "raw_notes": None, "logged_at": _days(-10),
             "series_id": None, "created_at": _days(-20)},
            {"id": "m-theirs", "manager_id": OTHER, "org_unit_id": None, "scheduled_at": _days(2),
             "summary": None, "raw_notes": None, "logged_at": None, "series_id": None, "created_at": _days(-1)},
        ],
        "team_meeting_agenda_items": [
            {"id": "i-1", "meeting_id": "m-held", "manager_id": MANAGER, "position": 0, "item": "Handoff owner",
             "covered": False, "notes": None, "carried_from_item_id": None},
            {"id": "i-2", "meeting_id": "m-held", "manager_id": MANAGER, "position": 1, "item": "Launch checklist",
             "covered": False, "notes": None, "carried_from_item_id": None},
            {"id": "i-old", "meeting_id": "m-logged", "manager_id": MANAGER, "position": 0, "item": "Old topic",
             "covered": True, "notes": "done", "carried_from_item_id": None},
        ],
        "commitments": [],
    }
    return db


def _auth(db, user=MANAGER):
    return (user, db)


def _items(db, meeting_id):
    return sorted(
        (r for r in db.tables["team_meeting_agenda_items"] if r["meeting_id"] == meeting_id),
        key=lambda r: r["position"],
    )


def _log_body(**overrides):
    body = dict(
        summary="We agreed Maya owns the handoff.",
        raw_notes="Handoff owner:\nMaya",
        agenda_outcomes=[
            AgendaOutcomeIn(id="i-1", covered=True, notes="Maya"),
            AgendaOutcomeIn(id="i-2", covered=False, notes=None),
        ],
        commitments=[
            TeamWrapUpCommitment(description="Draft the handoff doc", direct_report_id="dr-maya", due_date="2026-10-02"),
            TeamWrapUpCommitment(description="Open the CSM req", direct_report_id=None, due_date=None),
            TeamWrapUpCommitment(description="   ", direct_report_id=None, due_date=None),
        ],
        carry_forward_items=["Launch checklist", "Pricing FAQ"],
    )
    body.update(overrides)
    return LogTeamMeetingIn(**body)


# ---------------------------------------------------------------------------
# Inline capture — one item, appended, nothing else touched
# ---------------------------------------------------------------------------

def test_capture_appends_one_item_and_keeps_existing_ids():
    db = _seed()
    before = [(r["id"], r["item"]) for r in _items(db, "m-held")]
    result = add_team_meeting_agenda_item("m-held", AgendaItemIn(item="  Hiring plan  "), auth=_auth(db))
    assert result["created"] is True
    assert result["item"]["item"] == "Hiring plan"
    assert result["item"]["position"] == 2
    after = _items(db, "m-held")
    assert [(r["id"], r["item"]) for r in after[:2]] == before
    assert len(after) == 3


def test_capture_does_not_add_a_duplicate():
    db = _seed()
    result = add_team_meeting_agenda_item("m-held", AgendaItemIn(item="handoff OWNER"), auth=_auth(db))
    assert result["created"] is False
    assert result["item"]["id"] == "i-1"
    assert len(_items(db, "m-held")) == 2


def test_capture_refuses_a_logged_meeting():
    db = _seed()
    with pytest.raises(HTTPException) as exc:
        add_team_meeting_agenda_item("m-logged", AgendaItemIn(item="Late thought"), auth=_auth(db))
    assert exc.value.status_code == 409
    assert len(_items(db, "m-logged")) == 1


def test_capture_rejects_blank_and_other_managers_meetings():
    db = _seed()
    with pytest.raises(HTTPException) as blank:
        add_team_meeting_agenda_item("m-held", AgendaItemIn(item="   "), auth=_auth(db))
    assert blank.value.status_code == 422
    with pytest.raises(HTTPException) as theirs:
        add_team_meeting_agenda_item("m-theirs", AgendaItemIn(item="Peek"), auth=_auth(db))
    assert theirs.value.status_code == 404
    assert _items(db, "m-theirs") == []


def test_capture_stops_at_the_agenda_limit():
    db = _seed()
    for n in range(18):
        add_team_meeting_agenda_item("m-held", AgendaItemIn(item=f"Topic {n}"), auth=_auth(db))
    assert len(_items(db, "m-held")) == 20
    with pytest.raises(HTTPException) as exc:
        add_team_meeting_agenda_item("m-held", AgendaItemIn(item="One too many"), auth=_auth(db))
    assert exc.value.status_code == 422


# ---------------------------------------------------------------------------
# Editing the plan reconciles by text instead of replacing every row
# ---------------------------------------------------------------------------

def test_editing_the_agenda_keeps_unchanged_items():
    db = _seed()
    db.tables["team_meeting_agenda_items"][1]["carried_from_item_id"] = "i-old"
    update_team_meeting(
        "m-held",
        TeamMeetingPatch(agenda_items=["Launch checklist", "New topic"]),
        auth=_auth(db),
    )
    rows = _items(db, "m-held")
    assert [r["item"] for r in rows] == ["Launch checklist", "New topic"]
    kept = rows[0]
    assert kept["id"] == "i-2"                       # same row, not a re-insert
    assert kept["carried_from_item_id"] == "i-old"   # lineage survives the edit
    assert all(r["id"] != "i-1" for r in rows)        # removed line is gone


def test_a_logged_meetings_agenda_stays_frozen():
    db = _seed()
    with pytest.raises(HTTPException) as exc:
        update_team_meeting("m-logged", TeamMeetingPatch(agenda_items=["x"]), auth=_auth(db))
    assert exc.value.status_code == 409
    assert [r["item"] for r in _items(db, "m-logged")] == ["Old topic"]


# ---------------------------------------------------------------------------
# The confirmed write: what it returns, and what a retry does
# ---------------------------------------------------------------------------

def test_log_returns_the_saved_records():
    db = _seed()
    result = log_team_meeting("m-held", _log_body(), auth=_auth(db))

    assert result["meeting"]["status"] == "logged"
    saved = [c["description"] for c in result["commitments"]]
    assert saved == ["Draft the handoff doc", "Open the CSM req"]   # blank row not written
    names = [c["direct_report_name"] for c in result["commitments"]]
    assert names == ["Maya Patel", None]                           # None = the manager's own
    for c in result["commitments"]:
        assert c["source_type"] == "team_meeting"
        assert c["source_id"] == "m-held"
        assert c["org_unit_id"] == "ou-us"
    assert result["carried_forward"] == ["Launch checklist", "Pricing FAQ"]

    outcomes = {r["id"]: r for r in _items(db, "m-held")}
    assert outcomes["i-1"]["covered"] is True and outcomes["i-1"]["notes"] == "Maya"
    assert outcomes["i-2"]["covered"] is False


def test_retrying_a_log_does_not_duplicate_anything():
    db = _seed()
    first = log_team_meeting("m-held", _log_body(), auth=_auth(db))
    meetings_after_first = len(db.tables["team_meetings"])
    with pytest.raises(HTTPException) as exc:
        log_team_meeting("m-held", _log_body(summary="Second try"), auth=_auth(db))
    assert exc.value.status_code == 409
    assert len(db.tables["commitments"]) == 2
    assert len(db.tables["team_meetings"]) == meetings_after_first
    next_id = first["next_meeting"]["id"]
    assert [r["item"] for r in _items(db, next_id)] == ["Launch checklist", "Pricing FAQ"]
    held = next(m for m in db.tables["team_meetings"] if m["id"] == "m-held")
    assert held["summary"] == "We agreed Maya owns the handoff."


def test_the_claim_is_conditional_on_summary_still_being_empty():
    # Simulates a second tab that logged between this request's read and its
    # write: the pre-check passes, the conditional update matches nothing.
    db = _seed()
    real_table = db.table

    def racing_table(name):
        query = real_table(name)
        if name == "team_meetings":
            original = query.update

            def update(values):
                if "summary" in values:
                    for row in db.tables["team_meetings"]:
                        if row["id"] == "m-held":
                            row["summary"] = "Logged elsewhere"
                return original(values)

            query.update = update
        return query

    db.table = racing_table
    with pytest.raises(HTTPException) as exc:
        log_team_meeting("m-held", _log_body(), auth=_auth(db))
    assert exc.value.status_code == 409
    assert db.tables["commitments"] == []


def test_a_bad_owner_is_refused_before_anything_is_written():
    db = _seed()
    body = _log_body(commitments=[TeamWrapUpCommitment(description="x", direct_report_id="dr-theirs")])
    with pytest.raises(HTTPException) as exc:
        log_team_meeting("m-held", body, auth=_auth(db))
    assert exc.value.status_code == 404
    held = next(m for m in db.tables["team_meetings"] if m["id"] == "m-held")
    assert held["summary"] is None            # not half-logged
    assert db.tables["commitments"] == []


# ---------------------------------------------------------------------------
# Carry-forward: lineage, no duplicates, rollover
# ---------------------------------------------------------------------------

def test_carried_agenda_items_keep_their_source_and_fresh_lines_do_not_get_one():
    db = _seed()
    result = log_team_meeting("m-held", _log_body(), auth=_auth(db))
    nxt = {r["item"]: r for r in _items(db, result["next_meeting"]["id"])}
    assert nxt["Launch checklist"]["carried_from_item_id"] == "i-2"
    assert nxt["Pricing FAQ"]["carried_from_item_id"] is None


def test_carrying_into_an_existing_open_meeting_does_not_repeat_an_item():
    db = _seed()
    db.tables["team_meetings"].append(
        {"id": "m-next", "manager_id": MANAGER, "org_unit_id": "ou-us", "scheduled_at": _days(4),
         "summary": None, "raw_notes": None, "logged_at": None, "series_id": None, "created_at": _now()}
    )
    add_team_meeting_agenda_item("m-next", AgendaItemIn(item="Launch checklist"), auth=_auth(db))
    result = log_team_meeting("m-held", _log_body(), auth=_auth(db))
    assert result["next_meeting"]["id"] == "m-next"
    items = [r["item"] for r in _items(db, "m-next")]
    assert items == ["Launch checklist", "Pricing FAQ"]


def test_series_rolls_from_the_scheduled_date_and_skips_the_past():
    anchor = "2026-01-05T12:00:00+00:00"   # a Monday, long past
    now = datetime(2026, 9, 25, 15, 0, tzinfo=timezone.utc)
    nxt = datetime.fromisoformat(_next_occurrence_at(anchor, 1, now=now))
    assert nxt > now
    assert nxt.weekday() == 0              # still a Monday
    assert nxt - now <= timedelta(weeks=1)


def test_no_series_and_nothing_carried_creates_no_next_meeting():
    db = _seed()
    before = len(db.tables["team_meetings"])
    result = log_team_meeting("m-held", _log_body(carry_forward_items=[]), auth=_auth(db))
    assert result["next_meeting"] is None
    assert len(db.tables["team_meetings"]) == before


def test_no_series_with_carried_items_creates_an_undated_meeting():
    db = _seed()
    result = log_team_meeting("m-held", _log_body(), auth=_auth(db))
    assert result["next_meeting"]["scheduled_at"] is None
    assert result["next_meeting"]["status"] == "open"


# ---------------------------------------------------------------------------
# Reads the page builds sources and receipts from
# ---------------------------------------------------------------------------

def test_team_commitments_carry_their_source():
    db = _seed()
    log_team_meeting("m-held", _log_body(), auth=_auth(db))
    for row in db.tables["commitments"]:
        row["is_team_commitment"] = True
    rows = list_team_commitments(auth=_auth(db))
    assert {r["source_type"] for r in rows} == {"team_meeting"}
    assert {r["source_id"] for r in rows} == {"m-held"}
    assert sorted(r["direct_report_name"] or "You" for r in rows) == ["Maya Patel", "You"]


def test_meetings_list_is_manager_scoped():
    db = _seed()
    rows = list_team_meetings(auth=_auth(db))
    assert "m-theirs" not in {r["id"] for r in rows}
