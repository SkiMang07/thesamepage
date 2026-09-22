"""Beyond the team — the draft sanitiser, the confirmed write, and the prep
block. Uses a small in-memory stand-in for the Supabase client; RLS itself is
verified separately against local Postgres (see docs/ENGINEERING.md)."""
import asyncio
import re
import uuid
from datetime import date, datetime, timedelta, timezone

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

_EMBED_FK = {
    "goals": "goal_id",
    "projects": "project_id",
    "direct_reports": "direct_report_id",
    "outside_meetings": "meeting_id",
    "outside_people": "person_id",
}


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, db, name):
        self.db, self.name = db, name
        self.filters, self.op, self.payload, self._limit, self._negate = [], "select", None, None, False

    # --- builders ---
    def select(self, cols="*", **_k):
        # Resolves PostgREST-style embeds like "goals(title)" by foreign key,
        # so code that reads joined names is exercised, not skipped.
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

    def lt(self, col, val):
        return self._add(lambda r: r.get(col) is not None and r.get(col) < val)

    def lte(self, col, val):
        return self._add(lambda r: r.get(col) is not None and r.get(col) <= val)

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
        for row in rows:
            for name, _cols in getattr(self, "embeds", []):
                fk = _EMBED_FK.get(name)
                target = next((t for t in self.db.tables.get(name, []) if fk and t.get("id") == row.get(fk)), None)
                row[name] = dict(target) if target else None
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


# ---------------------------------------------------------------------------
# Phase 2 — repeating 1:1s, carry-forward, prep, Away
# ---------------------------------------------------------------------------

from routes.away import _compute_sweep  # noqa: E402
from routes.beyond import (  # noqa: E402
    MeetingPatch,
    PrepIn,
    _build_outside_prep_prompt,
    _gather_prep_sources,
    _meeting_status,
    _next_occurrence_at,
    get_prep_sources,
    prepare_meeting,
    update_meeting,
)


def _noon(d: date) -> str:
    return datetime(d.year, d.month, d.day, 12, tzinfo=timezone.utc).isoformat()


def _add_series(db, weeks=2, person="p-priya"):
    db.tables.setdefault("outside_meeting_series", []).append(
        {"id": "s-1", "owner_id": MANAGER, "person_id": person, "interval_weeks": weeks,
         "anchor_at": "2026-09-01T12:00:00+00:00", "active": True}
    )
    db.tables["outside_meetings"][0]["series_id"] = "s-1"


def _next_one_on_ones(db, exclude="m-1on1"):
    return [m for m in db.tables["outside_meetings"] if m["id"] != exclude and m.get("summary") is None]


def test_status_is_derived_from_summary_and_date():
    today = date.today()
    assert _meeting_status({"summary": "x", "scheduled_at": _noon(today + timedelta(days=9))}) == "logged"
    assert _meeting_status({"summary": None, "scheduled_at": None}) == "upcoming"
    assert _meeting_status({"summary": None, "scheduled_at": _noon(today + timedelta(days=1))}) == "upcoming"
    # A meeting today is one you just had: finish writing it up.
    assert _meeting_status({"summary": None, "scheduled_at": _noon(today)}) == "draft"
    assert _meeting_status({"summary": None, "scheduled_at": _noon(today - timedelta(days=3))}) == "draft"


def test_next_occurrence_steps_from_the_scheduled_date_and_skips_the_past():
    assert _next_occurrence_at("2026-09-01T12:00:00+00:00", 2, today=date(2026, 9, 2)) == "2026-09-15T12:00:00+00:00"
    # Logged five weeks late: skip the stale dates, keep the weekday rhythm.
    assert _next_occurrence_at("2026-09-01T12:00:00+00:00", 2, today=date(2026, 10, 7)) == "2026-10-13T12:00:00+00:00"


def test_logging_a_repeating_one_on_one_creates_the_next_with_carried_topics():
    db = _seed()
    _add_series(db)
    body = LogMeetingIn(summary="Covered budget.", carry_forward_items=["Revisit the Q4 req", " revisit the q4 req "])
    result = _run(log_meeting("m-1on1", body, auth=(MANAGER, db)))

    nxt = _next_one_on_ones(db)
    assert len(nxt) == 1 and result["next_meeting_id"] == nxt[0]["id"]
    assert nxt[0]["series_id"] == "s-1" and nxt[0]["kind"] == "one_on_one"
    assert nxt[0]["scheduled_at"] == _next_occurrence_at("2026-09-18T12:00:00+00:00", 2)
    assert nxt[0]["carry_forward_items"] == ["Revisit the Q4 req"]
    people = [j for j in db.tables["outside_meeting_people"] if j["meeting_id"] == nxt[0]["id"]]
    assert [j["person_id"] for j in people] == ["p-priya"]


def test_carried_topics_without_a_repeat_make_an_undated_next_one_then_top_it_up():
    db = _seed()
    _run(log_meeting("m-1on1", LogMeetingIn(summary="One.", carry_forward_items=["Budget"]), auth=(MANAGER, db)))
    nxt = _next_one_on_ones(db)
    assert len(nxt) == 1 and nxt[0]["scheduled_at"] is None and nxt[0]["series_id"] is None

    # Another 1:1 with the same person gets logged: top up, never a second one.
    db.tables["outside_meetings"].append(
        {"id": "m-2", "owner_id": MANAGER, "title": None, "kind": "one_on_one", "scheduled_at": _noon(date.today()),
         "notes": None, "summary": None, "logged_at": None, "created_at": "x", "series_id": None,
         "prep_guide": None, "carry_forward_items": []}
    )
    db.tables["outside_meeting_people"].append({"meeting_id": "m-2", "person_id": "p-priya", "owner_id": MANAGER})
    _run(log_meeting("m-2", LogMeetingIn(summary="Two.", carry_forward_items=["Hiring plan"]), auth=(MANAGER, db)))
    nxt = [m for m in _next_one_on_ones(db, exclude="m-2")]
    assert len(nxt) == 1 and nxt[0]["carry_forward_items"] == ["Budget", "Hiring plan"]


def test_logging_with_nothing_to_carry_and_no_repeat_creates_nothing():
    db = _seed()
    result = _run(log_meeting("m-1on1", LogMeetingIn(summary="Done."), auth=(MANAGER, db)))
    assert result["next_meeting_id"] is None and _next_one_on_ones(db) == []


def test_an_undated_next_one_on_one_is_logged_as_today_unless_told_otherwise():
    db = _seed()
    db.tables["outside_meetings"][0]["scheduled_at"] = None
    _run(log_meeting("m-1on1", LogMeetingIn(summary="Done."), auth=(MANAGER, db)))
    assert db.tables["outside_meetings"][0]["scheduled_at"] == _noon(date.today())


def test_repeat_rule_set_changed_and_cleared_through_patch():
    db = _seed()
    _run(update_meeting("m-1on1", MeetingPatch(recurrence_weeks=2), auth=(MANAGER, db)))
    series = db.tables["outside_meeting_series"]
    assert len(series) == 1 and series[0]["active"] and series[0]["person_id"] == "p-priya"
    assert db.tables["outside_meetings"][0]["series_id"] == series[0]["id"]

    _run(update_meeting("m-1on1", MeetingPatch(recurrence_weeks=3), auth=(MANAGER, db)))
    assert [s_["interval_weeks"] for s_ in series if s_["active"]] == [3]

    out = _run(update_meeting("m-1on1", MeetingPatch(clear_recurrence=True), auth=(MANAGER, db)))
    assert not any(s_["active"] for s_ in series)
    assert db.tables["outside_meetings"][0]["series_id"] is None and out["recurrence_weeks"] is None


def test_only_a_one_on_one_can_repeat():
    db = _seed()
    with pytest.raises(HTTPException) as exc:
        _run(update_meeting("m-1on1", MeetingPatch(kind="group", person_ids=["p-priya", "p-omar"], recurrence_weeks=2), auth=(MANAGER, db)))
    assert exc.value.status_code == 422


def _prep_seed():
    db = _seed()
    today = date.today()
    db.tables["outside_meetings"][0].update({"scheduled_at": _noon(today + timedelta(days=3)), "carry_forward_items": ["Q4 req"]})
    db.tables["outside_meetings"].append(
        {"id": "m-old", "owner_id": MANAGER, "title": None, "kind": "one_on_one", "scheduled_at": _noon(today - timedelta(days=10)),
         "notes": None, "summary": "Approved headcount, pending churn.", "logged_at": "x", "created_at": "x",
         "series_id": None, "prep_guide": None, "carry_forward_items": []}
    )
    db.tables["outside_meeting_people"].append({"meeting_id": "m-old", "person_id": "p-priya", "owner_id": MANAGER})
    db.tables["goals"] += [
        {"id": "g-ind", "owner_id": MANAGER, "title": "Sam: certify on admin", "level": "individual", "status": "at_risk"},
    ]
    db.tables["commitments"] += [
        {"id": "c1", "owner_id": MANAGER, "description": "Send renewal-risk summary", "committed_by": "manager",
         "outside_person_id": "p-priya", "status": "open", "due_date": None},
        {"id": "c2", "owner_id": MANAGER, "description": "Get the req approved", "committed_by": "counterpart",
         "outside_person_id": "p-priya", "status": "open", "due_date": None},
    ]
    db.tables["check_ins"] += [
        {"goal_id": "g-1", "project_id": None, "owner_id": MANAGER, "status": "at_risk", "progress": 40,
         "note": "Sign-off slipped", "created_at": datetime.now(timezone.utc).isoformat()},
        {"goal_id": "g-ind", "project_id": None, "owner_id": MANAGER, "status": "at_risk", "progress": 10,
         "note": "Sam behind on certification", "created_at": datetime.now(timezone.utc).isoformat()},
    ]
    db.tables["outside_meeting_links"] += [
        {"id": "l1", "meeting_id": "m-old", "owner_id": MANAGER, "goal_id": "g-1", "project_id": None,
         "direct_report_id": None, "note": "Pricing slips to November", "created_at": datetime.now(timezone.utc).isoformat()},
        {"id": "l2", "meeting_id": "m-old", "owner_id": MANAGER, "goal_id": None, "project_id": None,
         "direct_report_id": "dr-sam", "note": "Priya said Sam's demo landed", "created_at": datetime.now(timezone.utc).isoformat()},
    ]
    return db


def test_boss_prep_is_a_team_update_built_from_work_not_people():
    db = _prep_seed()
    src = _run(get_prep_sources("m-1on1", auth=(MANAGER, db)))
    assert src["shape"] == "team_update"
    assert src["last_meeting"]["summary"].startswith("Approved headcount")
    assert src["carried"] == ["Q4 req"]
    assert [c["description"] for c in src["you_owe"]] == ["Send renewal-risk summary"]
    assert [c["description"] for c in src["they_owe"]] == ["Get the req approved"]
    # Individual-level goals are about a person: never in a managing-up prep.
    assert [g["title"] for g in src["goals"]] == ["Launch pricing"]
    assert [m["item"] for m in src["moved"]] == ["Launch pricing"]
    # Work links only — a secondhand note about a report never flows up.
    assert [h["note"] for h in src["heard"]] == ["Pricing slips to November"]
    text = repr(src)
    assert "Sam" not in text

    prompt = _build_outside_prep_prompt(src, "", date.today().isoformat())
    assert "Never name or assess individual team members" in prompt
    assert "Sam" not in prompt


def test_peer_prep_is_about_what_is_open_between_you():
    db = _prep_seed()
    db.tables["outside_people"][0]["relationship"] = "peer"
    src = _run(get_prep_sources("m-1on1", auth=(MANAGER, db)))
    assert src["shape"] == "between_you" and src["goals"] == [] and src["moved"] == []
    assert "LIVE GOALS" not in _build_outside_prep_prompt(src, "", date.today().isoformat())


def test_prepare_saves_the_sheet_and_a_model_failure_saves_nothing(monkeypatch):
    db = _prep_seed()
    fn = getattr(prepare_meeting, "__wrapped__", prepare_meeting)

    monkeypatch.setattr(beyond, "generate_text", lambda *a, **k: "not json")
    with pytest.raises(HTTPException) as exc:
        _run(fn(request=None, meeting_id="m-1on1", body=PrepIn(), auth=(MANAGER, db)))
    assert exc.value.status_code == 502 and db.tables["outside_meetings"][0].get("prep_guide") is None

    monkeypatch.setattr(
        beyond,
        "generate_text",
        lambda *a, **k: '{"situation_summary": "Budget is the story.", "agenda_items": [{"title": "Q4 req", "rationale": "Carried", "talking_points": ["Where did it land?"]}], "asks": ["Air cover on pricing"]}',
    )
    out = _run(fn(request=None, meeting_id="m-1on1", body=PrepIn(notes="Raise hiring"), auth=(MANAGER, db)))
    guide = db.tables["outside_meetings"][0]["prep_guide"]
    assert guide["shape"] == "team_update" and guide["asks"] == ["Air cover on pricing"]
    assert out["prep_guide"]["agenda_items"][0]["title"] == "Q4 req"


def test_prep_refuses_group_and_logged_meetings():
    db = _prep_seed()
    db.tables["outside_meetings"][0]["kind"] = "group"
    with pytest.raises(HTTPException) as exc:
        _run(get_prep_sources("m-1on1", auth=(MANAGER, db)))
    assert exc.value.status_code == 422
    with pytest.raises(HTTPException) as exc:
        _run(get_prep_sources("m-old", auth=(MANAGER, db)))
    assert exc.value.status_code == 409


def test_away_moves_unlogged_meetings_beyond_the_team():
    db = _seed()
    for t in ("one_on_ones", "team_meetings"):
        db.tables[t] = []
    start = date.today() + timedelta(days=30)
    db.tables["outside_meetings"][0]["scheduled_at"] = _noon(start + timedelta(days=1))
    days, items = _compute_sweep(MANAGER, db, start, start + timedelta(days=4))
    moved = [i for i in items if i["entity_type"] == "outside_meeting"]
    assert moved and moved[0]["label"] == "Boss 1:1"
    db.tables["outside_meetings"][0]["title"] = None
    _, items = _compute_sweep(MANAGER, db, start, start + timedelta(days=4))
    assert [i["label"] for i in items if i["entity_type"] == "outside_meeting"] == ["1:1 with Priya"]
