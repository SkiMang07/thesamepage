"""Beyond the team — the draft sanitiser, the confirmed write, and the prep
block. Uses a small in-memory stand-in for the Supabase client; RLS itself is
verified separately against local Postgres (see docs/ENGINEERING.md)."""
import asyncio
import uuid

import pytest
from fastapi import HTTPException

import routes.beyond as beyond
from routes.beyond import (
    DraftCheckIn,
    DraftCommitment,
    DraftReportNote,
    LogMeetingIn,
    WrapUpRequest,
    _sanitize_draft,
    fetch_secondhand_notes,
    log_meeting,
    wrap_up_meeting,
)
from routes.one_on_ones import _build_prep_prompt

MANAGER = "manager-1"


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, db, name):
        self.db, self.name = db, name
        self.filters, self.op, self.payload, self._limit, self._negate = [], "select", None, None, False

    # --- builders ---
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

    def neq(self, col, val):
        return self._add(lambda r: r.get(col) != val)

    def in_(self, col, vals):
        vals = list(vals)
        return self._add(lambda r: r.get(col) in vals)

    def is_(self, col, val):
        assert val == "null"
        return self._add(lambda r: r.get(col) is None)

    def gte(self, col, val):
        return self._add(lambda r: (r.get(col) or "") >= val)

    def order(self, *_a, **_k):
        return self

    def limit(self, n):
        self._limit = n
        return self

    def execute(self):
        if self.db.fail_on == self.name:
            raise RuntimeError(f"relation {self.name} does not exist")
        table = self.db.tables.setdefault(self.name, [])
        match = [r for r in table if all(f(r) for f in self.filters)]
        if self.op == "insert":
            created = []
            for row in self.payload:
                row = {"id": str(uuid.uuid4()), **row}
                table.append(row)
                created.append(dict(row))
            self.db.writes.append((self.name, "insert", created))
            return _Result(created)
        if self.op == "update":
            for row in match:
                row.update(self.payload)
            self.db.writes.append((self.name, "update", self.payload))
            return _Result([dict(r) for r in match])
        if self.op == "delete":
            for row in match:
                table.remove(row)
            return _Result([])
        rows = [dict(r) for r in match]
        return _Result(rows[: self._limit] if self._limit else rows)


class _DB:
    def __init__(self):
        self.tables: dict[str, list[dict]] = {}
        self.writes: list = []
        self.fail_on = None

    def table(self, name):
        return _Query(self, name)


def _seed():
    db = _DB()
    db.tables = {
        "outside_people": [
            {"id": "p-priya", "owner_id": MANAGER, "name": "Priya", "relationship": "manager", "archived_at": None},
            {"id": "p-omar", "owner_id": MANAGER, "name": "Omar", "relationship": "peer", "archived_at": None},
            {"id": "p-other", "owner_id": "someone-else", "name": "Not yours", "relationship": "peer", "archived_at": None},
        ],
        "outside_meetings": [
            {"id": "m-1on1", "owner_id": MANAGER, "title": "Boss 1:1", "kind": "one_on_one",
             "scheduled_at": "2026-09-18T12:00:00+00:00", "notes": None, "summary": None, "logged_at": None,
             "created_at": "2026-09-18T15:00:00+00:00"},
        ],
        "outside_meeting_people": [{"meeting_id": "m-1on1", "person_id": "p-priya", "owner_id": MANAGER}],
        "direct_reports": [
            {"id": "dr-sam", "manager_id": MANAGER, "name": "Sam", "archived_at": None},
            {"id": "dr-theirs", "manager_id": "someone-else", "name": "Theirs", "archived_at": None},
        ],
        "goals": [{"id": "g-1", "owner_id": MANAGER, "title": "Launch pricing", "level": "team", "status": "on_track"}],
        "projects": [{"id": "pr-1", "owner_id": MANAGER, "title": "CRM migration", "status": "active"}],
        "commitments": [],
        "check_ins": [],
        "outside_meeting_links": [],
    }
    return db


def _run(coro):
    return asyncio.run(coro)


# ---------------------------------------------------------------------------
# Draft sanitiser — the extractor never gets to invent a link
# ---------------------------------------------------------------------------

def _sanitize(parsed, attendees=("p-priya",)):
    return _sanitize_draft(
        parsed,
        attendee_ids=set(attendees),
        report_ids={"dr-sam"},
        goal_ids={"g-1"},
        project_ids={"pr-1"},
    )


def test_sanitize_drops_ids_the_manager_does_not_have():
    draft = _sanitize(
        {
            "summary": "  Budget approved.  ",
            "commitments": [
                {"description": "Sam sends the deck", "owner": "report", "direct_report_id": "dr-theirs"},
            ],
            "check_ins": [
                {"goal_id": "g-invented", "status": "at_risk", "note": "x"},
                {"goal_id": "g-1", "project_id": "pr-1", "status": "at_risk", "note": "two targets"},
                {"project_id": "pr-1", "status": "not-a-status", "note": "x"},
            ],
            "report_notes": [{"direct_report_id": "dr-theirs", "note": "someone else's report"}],
        }
    )
    assert draft.summary == "Budget approved."
    # An unknown report owner falls back to "you", never to a guessed person.
    assert draft.commitments[0].owner == "you"
    assert draft.commitments[0].direct_report_id is None
    assert draft.check_ins == []
    assert draft.report_notes == []


def test_sanitize_resolves_the_counterpart_in_a_one_on_one_only():
    parsed = {"commitments": [{"description": "Get budget approved", "owner": "counterpart", "outside_person_id": None}]}
    assert _sanitize(parsed, attendees=("p-priya",)).commitments[0].outside_person_id == "p-priya"
    # In a group meeting an unknown counterpart is left for the manager to pick.
    group = _sanitize(parsed, attendees=("p-priya", "p-omar")).commitments[0]
    assert group.owner == "counterpart" and group.outside_person_id is None


def test_sanitize_keeps_valid_routing_and_one_check_in_per_target():
    draft = _sanitize(
        {
            "check_ins": [
                {"goal_id": "g-1", "status": "at_risk", "note": "Sign-off slipped"},
                {"goal_id": "g-1", "status": "on_track", "note": "duplicate"},
            ],
            "report_notes": [{"direct_report_id": "dr-sam", "note": "Priya said Sam's demo landed well"}],
        }
    )
    assert [(c.goal_id, c.status) for c in draft.check_ins] == [("g-1", "at_risk")]
    assert draft.report_notes[0].direct_report_id == "dr-sam"


def test_wrapup_returns_an_empty_draft_when_the_model_call_fails(monkeypatch):
    db = _seed()

    def boom(*_a, **_k):
        raise RuntimeError("provider down")

    monkeypatch.setattr(beyond, "generate_text", boom)
    # The limiter decorator wraps the route; call the undecorated function.
    fn = getattr(wrap_up_meeting, "__wrapped__", wrap_up_meeting)
    draft = _run(fn(request=None, meeting_id="m-1on1", body=WrapUpRequest(raw_notes="notes"), auth=(MANAGER, db)))
    assert draft.summary == "" and draft.commitments == [] and draft.check_ins == []
    assert db.writes == []


# ---------------------------------------------------------------------------
# /log — the only write, after the manager confirms
# ---------------------------------------------------------------------------

def test_log_writes_every_confirmed_item_with_its_source():
    db = _seed()
    body = LogMeetingIn(
        summary="Budget approved; pricing sign-off slips to November.",
        raw_notes="raw",
        meeting_date="2026-09-17",
        commitments=[
            DraftCommitment(description="Get budget approved", owner="counterpart", outside_person_id="p-priya"),
            DraftCommitment(description="Send Priya the deck", owner="you"),
            DraftCommitment(description="Sam writes the FAQ", owner="report", direct_report_id="dr-sam"),
        ],
        check_ins=[DraftCheckIn(goal_id="g-1", status="at_risk", note="Sign-off slipped to November")],
        report_notes=[DraftReportNote(direct_report_id="dr-sam", note="Priya said Sam's demo landed well")],
    )
    result = _run(log_meeting("m-1on1", body, auth=(MANAGER, db)))

    meeting = db.tables["outside_meetings"][0]
    assert meeting["summary"].startswith("Budget approved")
    assert meeting["scheduled_at"] == "2026-09-17T12:00:00+00:00"
    assert result["status"] == "logged"

    by_desc = {c["description"]: c for c in db.tables["commitments"]}
    assert by_desc["Get budget approved"]["committed_by"] == "counterpart"
    assert by_desc["Get budget approved"]["direct_report_id"] is None
    # In a 1:1, what you owe, you owe to them.
    assert by_desc["Send Priya the deck"]["committed_by"] == "manager"
    assert by_desc["Send Priya the deck"]["outside_person_id"] == "p-priya"
    assert by_desc["Sam writes the FAQ"]["committed_by"] == "direct_report"
    assert all(c["source_type"] == "outside_meeting" and c["source_id"] == "m-1on1" for c in by_desc.values())

    check_in = db.tables["check_ins"][0]
    assert (check_in["goal_id"], check_in["source_type"], check_in["source_id"]) == ("g-1", "outside_meeting", "m-1on1")
    assert db.tables["goals"][0]["status"] == "at_risk"  # check-in write-through unchanged

    links = db.tables["outside_meeting_links"]
    assert {(l.get("goal_id"), l.get("direct_report_id")) for l in links} == {("g-1", None), (None, "dr-sam")}


def test_log_twice_is_refused_so_nothing_duplicates():
    db = _seed()
    body = LogMeetingIn(summary="Done", commitments=[DraftCommitment(description="x", owner="you")])
    _run(log_meeting("m-1on1", body, auth=(MANAGER, db)))
    with pytest.raises(HTTPException) as exc:
        _run(log_meeting("m-1on1", body, auth=(MANAGER, db)))
    assert exc.value.status_code == 409
    assert len(db.tables["commitments"]) == 1


@pytest.mark.parametrize(
    "body, status",
    [
        (LogMeetingIn(summary="  "), 422),
        (LogMeetingIn(summary="s", commitments=[DraftCommitment(description="x", owner="counterpart")]), 422),
        (LogMeetingIn(summary="s", commitments=[DraftCommitment(description="x", owner="counterpart", outside_person_id="p-other")]), 404),
        (LogMeetingIn(summary="s", commitments=[DraftCommitment(description="x", owner="report", direct_report_id="dr-theirs")]), 404),
        (LogMeetingIn(summary="s", check_ins=[DraftCheckIn(goal_id="g-nope", status="at_risk")]), 404),
        (LogMeetingIn(summary="s", report_notes=[DraftReportNote(direct_report_id="dr-theirs", note="x")]), 404),
    ],
)
def test_log_rejects_bad_input_before_writing_anything(body, status):
    db = _seed()
    with pytest.raises(HTTPException) as exc:
        _run(log_meeting("m-1on1", body, auth=(MANAGER, db)))
    assert exc.value.status_code == status
    assert db.writes == []
    assert db.tables["outside_meetings"][0]["summary"] is None


# ---------------------------------------------------------------------------
# Prep — secondhand, private, and never breaks prep
# ---------------------------------------------------------------------------

def _prep(**kwargs):
    return _build_prep_prompt(
        report_name="Sam",
        raw_notes="",
        open_commitments=[],
        recent_summaries=[],
        days_since_last=7,
        cadence_days=14,
        **kwargs,
    )


def test_prep_frames_outside_notes_as_secondhand():
    prompt = _prep(
        secondhand_notes=[
            {"note": "Priya said Sam's demo landed well", "meeting_title": "Pricing WG", "meeting_date": "2026-09-18", "people": ["Priya"]}
        ]
    )
    assert "SECONDHAND" in prompt
    assert "Sam was not there" in prompt
    assert "2026-09-18, Pricing WG (with Priya): Priya said Sam's demo landed well" in prompt
    assert "not established fact" in prompt


def test_prep_without_outside_notes_is_unchanged():
    assert "SECONDHAND" not in _prep()
    assert _prep() == _prep(secondhand_notes=[])


def test_secondhand_notes_fail_soft_when_the_table_is_missing():
    db = _seed()
    db.fail_on = "outside_meeting_links"
    assert fetch_secondhand_notes(db, MANAGER, "dr-sam") == []


def test_secondhand_notes_only_for_that_report():
    db = _seed()
    db.tables["outside_meeting_links"] = [
        {"meeting_id": "m-1on1", "owner_id": MANAGER, "direct_report_id": "dr-sam", "note": "About Sam",
         "created_at": "2099-01-01T00:00:00+00:00",
         "outside_meetings": {"title": "Boss 1:1", "scheduled_at": "2026-09-18T12:00:00+00:00"}},
        {"meeting_id": "m-1on1", "owner_id": MANAGER, "direct_report_id": "dr-other", "note": "Not Sam",
         "created_at": "2099-01-01T00:00:00+00:00", "outside_meetings": {}},
    ]
    notes = fetch_secondhand_notes(db, MANAGER, "dr-sam")
    assert [n["note"] for n in notes] == ["About Sam"]
    assert notes[0]["people"] == ["Priya"] and notes[0]["meeting_date"] == "2026-09-18"
