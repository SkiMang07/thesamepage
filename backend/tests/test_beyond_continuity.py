"""Beyond the team — Overview brief, continuity aggregate, private prep items
and reviewed AI suggestions (routes/beyond_continuity.py).

Uses the in-memory Supabase stand-in from test_beyond.py. RLS for the new
tables is verified separately against local Postgres."""
import json
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

import routes.beyond_continuity as bc
from routes.beyond import PrepIn, _build_outside_prep_prompt, _gather_prep_sources, fetch_prep_items
from routes.beyond_continuity import (
    ConnectIn,
    PrepItemIn,
    add_prep_item,
    build_brief,
    connect_suggestion,
    dismiss_suggestion,
    gather_suggestion_evidence,
    get_continuity,
    refresh_suggestions,
    remove_prep_item,
    sanitize_suggestions,
)
from tests.test_beyond import MANAGER, _run, _seed

TODAY = date.today()


def _refresh(db):
    # The limiter decorator wraps the route; call the undecorated function.
    fn = getattr(refresh_suggestions, "__wrapped__", refresh_suggestions)
    return fn(request=None, auth=(MANAGER, db))


def _noon(d: date) -> str:
    return datetime(d.year, d.month, d.day, 12, tzinfo=timezone.utc).isoformat()


def _meeting(mid, kind="one_on_one", day=None, summary=None, title=None, notes=None, series_id=None):
    return {
        "id": mid, "owner_id": MANAGER, "title": title, "kind": kind,
        "scheduled_at": _noon(day) if day else None, "notes": notes, "summary": summary,
        "logged_at": None, "created_at": "2026-09-01T00:00:00+00:00", "series_id": series_id,
        "prep_guide": None, "carry_forward_items": [], "prep_items": [],
    }


def _world():
    """Priya is the manager; Omar a peer. A logged 1:1 with Priya, the next
    one in 3 days, a logged group meeting with both, an upcoming 1:1 with
    Omar in 20 days. Commitments every way, including a report-owned one."""
    db = _seed()
    db.tables["outside_people"].append(
        {"id": "p-arch", "owner_id": MANAGER, "name": "Gone", "relationship": "peer", "archived_at": "2026-01-01"}
    )
    db.tables["outside_meetings"] = [
        _meeting("m-last", day=TODAY - timedelta(days=7), summary="Protect time for the pilot. Budget is flat.", title="Capacity"),
        _meeting("m-next", day=TODAY + timedelta(days=3)),
        _meeting("m-group", kind="group", day=TODAY - timedelta(days=2), summary="Pilot is 20 accounts. Analyst needed.", title="Launch sync"),
        _meeting("m-group-draft", kind="group", day=TODAY - timedelta(days=1), notes="raw", title="Ops review"),
        _meeting("m-omar", day=TODAY + timedelta(days=20)),
    ]
    db.tables["outside_meetings"][1]["carry_forward_items"] = ["Headcount ask"]
    db.tables["outside_meeting_people"] = [
        {"meeting_id": "m-last", "person_id": "p-priya", "owner_id": MANAGER},
        {"meeting_id": "m-next", "person_id": "p-priya", "owner_id": MANAGER},
        {"meeting_id": "m-group", "person_id": "p-priya", "owner_id": MANAGER},
        {"meeting_id": "m-group", "person_id": "p-omar", "owner_id": MANAGER},
        {"meeting_id": "m-group-draft", "person_id": "p-omar", "owner_id": MANAGER},
        {"meeting_id": "m-omar", "person_id": "p-omar", "owner_id": MANAGER},
    ]
    due_soon = (TODAY + timedelta(days=2)).isoformat()

    def c(cid, desc, by, person=None, report=None, source="m-last", due=None, status="open"):
        return {
            "id": cid, "owner_id": MANAGER, "description": desc, "due_date": due, "status": status,
            "committed_by": by, "direct_report_id": report, "outside_person_id": person,
            "source_type": "outside_meeting", "source_id": source, "created_at": "2026-09-01",
        }

    db.tables["commitments"] = [
        c("c-you", "Send the capacity sketch", "manager", person="p-priya", due=due_soon),
        c("c-priya", "Decide the tradeoff", "counterpart", person="p-priya"),
        c("c-group-you", "Share the exclusion list", "manager", source="m-group", due=due_soon),
        c("c-group-omar", "Confirm an analyst", "counterpart", person="p-omar", source="m-group"),
        c("c-report", "Draft the runbook", "direct_report", report="dr-sam", source="m-group"),
        c("c-done", "Old thing", "manager", person="p-priya", status="done"),
    ]
    db.tables["goals"] = [
        {"id": "g-1", "owner_id": MANAGER, "title": "Launch pricing", "level": "team", "status": "on_track", "description": "Ship new tiers", "due_date": None},
        {"id": "g-ind", "owner_id": MANAGER, "title": "Sam's growth goal", "level": "individual", "status": "active", "description": "private", "due_date": None},
    ]
    db.tables["projects"] = [
        {"id": "pr-1", "owner_id": MANAGER, "title": "Onboarding pilot", "status": "active", "description": "Kickoff Oct 2. Analyst needed for baseline.", "due_date": None, "direct_report_id": "dr-sam"},
        {"id": "pr-done", "owner_id": MANAGER, "title": "Old project", "status": "completed", "description": "", "due_date": None},
    ]
    db.tables["outside_meeting_links"] = [
        {"id": "l-report", "meeting_id": "m-group", "owner_id": MANAGER, "goal_id": None, "project_id": None,
         "direct_report_id": "dr-sam", "note": "Priya said Sam's demo was shaky", "created_at": "2026-09-20"},
    ]
    db.tables["outside_meeting_series"] = []
    db.tables["outside_suggestions"] = []
    db.tables["outside_suggestion_runs"] = []
    return db


# ---------------------------------------------------------------------------
# The aggregate
# ---------------------------------------------------------------------------

def test_continuity_shapes_people_groups_and_owners():
    db = _world()
    data = get_continuity(auth=(MANAGER, db))
    people = {p["id"]: p for p in data["people"]}
    assert "p-arch" not in people and "p-other" not in people

    priya = people["p-priya"]
    assert priya["next_meeting"]["id"] == "m-next" and priya["next_meeting"]["carried"] == ["Headcount ask"]
    # Where we left off is the latest reviewed 1:1, not the more recent group meeting.
    assert priya["latest_outcome"]["id"] == "m-last"
    assert [c["id"] for c in priya["you_owe"]] == ["c-you"]
    assert [c["id"] for c in priya["they_owe"]] == ["c-priya"] and priya["they_owe"][0]["owner_name"] == "Priya"

    omar = people["p-omar"]
    # Omar has no reviewed 1:1: his latest outcome is the group meeting, labelled as a group.
    assert omar["latest_outcome"]["id"] == "m-group" and omar["latest_outcome"]["kind"] == "group"
    # The counterpart commitment from the group meeting shows on his individual view
    # (same record, not a copy) with its group source.
    assert omar["they_owe"][0]["id"] == "c-group-omar"
    assert omar["they_owe"][0]["source_meeting"]["kind"] == "group"

    groups = {g["id"]: g for g in data["groups"]}
    assert list(groups) == ["m-group-draft", "m-group"]  # draft before written up
    owners = {c["id"]: (c["committed_by"], c["owner_name"]) for c in groups["m-group"]["open_commitments"]}
    # Report-owned keeps the report's name; the manager's is not folded into anyone else's.
    assert owners == {
        "c-group-you": ("manager", None),
        "c-group-omar": ("counterpart", "Omar"),
        "c-report": ("direct_report", "Sam"),
    }
    assert groups["m-group-draft"]["status"] == "draft" and groups["m-group-draft"]["has_notes"]
    assert [u["id"] for u in data["upcoming"]] == ["m-next", "m-omar"]
    assert data["prep_items_available"] and data["suggestions_available"]


def test_continuity_says_when_suggestions_could_not_load():
    db = _world()
    db.fail_on = "outside_suggestions"
    data = get_continuity(auth=(MANAGER, db))
    assert data["suggestions_available"] is False and data["suggestions"] == []
    # Deterministic items still arrive.
    assert data["brief"]


def test_prep_items_fail_soft_and_say_so():
    db = _world()
    db.fail_on = "outside_meetings"
    items, available = fetch_prep_items(db, MANAGER, ["m-next"])
    assert items == {} and available is False


# ---------------------------------------------------------------------------
# The brief
# ---------------------------------------------------------------------------

def test_brief_orders_dated_items_and_merges_duplicate_prompts():
    db = _world()
    data = get_continuity(auth=(MANAGER, db))
    kinds = [(i["kind"], i["id"]) for i in data["brief"] + data["brief_more"]]
    # Priya's 1:1 (in 3 days) absorbs "Send the capacity sketch" (owed to her);
    # the group promise has no person, so it stands alone and is due first.
    assert kinds[0] == ("commitment", "commitment:c-group-you")
    assert kinds[1] == ("upcoming", "upcoming:m-next")
    assert ("commitment", "commitment:c-you") not in kinds
    prep = data["brief"][1]
    assert "You owe Priya: Send the capacity sketch" in prep["reason"]
    assert "recorded as open" in prep["reason"]
    # Omar's 1:1 is 20 days out: not "next".
    assert "upcoming:m-omar" not in [i["id"] for i in data["brief"] + data["brief_more"]]
    # The group draft is an unfinished review.
    assert ("review", "review:m-group-draft") in kinds
    promise = data["brief"][0]
    assert promise["reason"].endswith("Recorded as open.") and "Launch sync" in promise["reason"]


def test_no_overdue_judgement_from_elapsed_time_alone():
    person = {
        "id": "p", "name": "Ana Ruiz", "next_meeting": None, "draft": None, "cadence_weeks": None,
        "you_owe": [], "they_owe": [], "last_met": "2025-01-01",
    }
    shown, more = build_brief(TODAY, [person], [], [], [])
    assert shown == [] and more == []


def test_cadence_gap_needs_an_explicit_repeat_rule_and_says_it_is_not_proof():
    person = {
        "id": "p", "name": "Ana Ruiz", "next_meeting": None, "draft": None, "cadence_weeks": 2,
        "you_owe": [], "they_owe": [],
    }
    shown, _ = build_brief(TODAY, [person], [], [], [])
    assert shown[0]["kind"] == "cadence"
    assert "every 2 weeks" in shown[0]["reason"] and "doesn't mean you haven't met" in shown[0]["reason"]
    assert shown[0]["action"]["href"].endswith("person=p&plan=1")


def test_reconnect_rests_on_recorded_open_work():
    person = {
        "id": "p", "name": "Ana Ruiz", "next_meeting": None, "draft": None, "cadence_weeks": None,
        "you_owe": [], "they_owe": [{"description": "Send the data", "committed_by": "counterpart"}],
    }
    shown, _ = build_brief(TODAY, [person], [], [], [])
    assert shown[0]["kind"] == "reconnect" and "Send the data" in shown[0]["reason"]
    assert "recorded open item" in shown[0]["reason"]


def test_one_slot_is_kept_for_a_suggestion_and_the_brief_stays_short():
    people = [
        {
            "id": f"p{i}", "name": f"Person {i}", "draft": None, "cadence_weeks": None, "you_owe": [], "they_owe": [],
            "next_meeting": {"id": f"m{i}", "date": _noon(TODAY + timedelta(days=i)), "carried": [], "prep_items": [], "prepared": False},
        }
        for i in range(1, 6)
    ]
    suggestion = {
        "id": "s1", "title": "Clarify analyst availability", "person": None,
        "source": {"meeting": {"id": "m-x", "title": "Pilot scope", "kind": "group", "date": _noon(TODAY), "people": []}},
        "target": {"title": "Onboarding pilot"},
    }
    shown, more = build_brief(TODAY, people, [], [], [suggestion])
    assert [i["kind"] for i in shown] == ["upcoming", "upcoming", "suggestion"]
    assert shown[2]["reason"].startswith("Possible connection: Pilot scope")
    assert len(more) == 3
    shown, more = build_brief(TODAY, people, [], [], [])
    assert len(shown) == 3 and len(more) == 2


# ---------------------------------------------------------------------------
# Private prep items
# ---------------------------------------------------------------------------

def test_a_thought_saves_privately_to_an_upcoming_conversation_only():
    db = _world()
    writes_before = len(db.writes)
    result = add_prep_item("m-next", PrepItemIn(text="  Ask whether an analyst can join  "), auth=(MANAGER, db))
    assert result["item"]["text"] == "Ask whether an analyst can join" and result["item"]["source"] == "thought"
    assert result["meeting"]["prep_items"][0]["id"] == result["item"]["id"]
    # One write, to that meeting. No commitment, check-in or link.
    new_writes = db.writes[writes_before:]
    assert [(t, op) for t, op, _ in new_writes] == [("outside_meetings", "update")]

    with pytest.raises(HTTPException) as logged:
        add_prep_item("m-last", PrepItemIn(text="x"), auth=(MANAGER, db))
    assert logged.value.status_code == 409
    with pytest.raises(HTTPException) as happened:
        add_prep_item("m-group-draft", PrepItemIn(text="x"), auth=(MANAGER, db))
    assert happened.value.status_code == 409
    with pytest.raises(HTTPException):
        add_prep_item("m-next", PrepItemIn(text="   "), auth=(MANAGER, db))

    removed = remove_prep_item("m-next", result["item"]["id"], auth=(MANAGER, db))
    assert removed["meeting"]["prep_items"] == []


def test_someone_elses_meeting_is_not_found():
    db = _world()
    db.tables["outside_meetings"].append({**_meeting("m-theirs", day=TODAY + timedelta(days=2)), "owner_id": "someone-else"})
    with pytest.raises(HTTPException) as err:
        add_prep_item("m-theirs", PrepItemIn(text="x"), auth=(MANAGER, db))
    assert err.value.status_code == 404


def test_saved_thoughts_reach_prep_as_the_managers_own_notes():
    db = _world()
    add_prep_item("m-next", PrepItemIn(text="Raise the analyst question"), auth=(MANAGER, db))
    meeting = next(m for m in db.tables["outside_meetings"] if m["id"] == "m-next")
    person = db.tables["outside_people"][0]
    sources = _gather_prep_sources(db, MANAGER, meeting, person)
    assert sources["saved"] == ["Raise the analyst question"]
    prompt = _build_outside_prep_prompt(sources, "", TODAY.isoformat())
    assert "THINGS THE MANAGER SAVED TO RAISE" in prompt and "Raise the analyst question" in prompt
    assert "not agreed commitments" in prompt


# ---------------------------------------------------------------------------
# Suggestions
# ---------------------------------------------------------------------------

def _ai(monkeypatch, payload, calls=None):
    def fake(prompt, **_k):
        if calls is not None:
            calls.append(prompt)
        return json.dumps(payload) if not isinstance(payload, str) else payload
    monkeypatch.setattr(bc, "generate_text", fake)


def _ref(evidence, *, commitment=None, target=None):
    if commitment:
        return next(s["ref"] for s in evidence["sources"] if s["commitment_id"] == commitment)
    return next(t["ref"] for t in evidence["targets"] if t["id"] == target)


def test_evidence_is_reviewed_work_only():
    db = _world()
    ev = gather_suggestion_evidence(db, MANAGER)
    commitment_ids = {s["commitment_id"] for s in ev["sources"] if s["commitment_id"]}
    # Report-owned commitments and closed ones are not material.
    assert commitment_ids == {"c-you", "c-priya", "c-group-you", "c-group-omar"}
    # Only logged meetings.
    assert {s["meeting_id"] for s in ev["sources"]} <= {"m-last", "m-group"}
    # No individual goals, no finished projects.
    assert {t["id"] for t in ev["targets"]} == {"g-1", "pr-1"}
    prompt = bc.build_suggestion_prompt(ev, TODAY.isoformat())
    # Nothing about a direct report: not the secondhand note, not the project's owner.
    assert "Sam" not in prompt and "demo" not in prompt and "dr-sam" not in prompt


def test_refresh_stores_sanitised_suggestions_with_record_excerpts(monkeypatch):
    db = _world()
    ev = gather_suggestion_evidence(db, MANAGER)
    c_ref = _ref(ev, commitment="c-group-omar")
    p_ref = _ref(ev, target="pr-1")
    _ai(monkeypatch, {"suggestions": [
        {"source_ref": c_ref, "target_ref": p_ref, "title": "Clarify analyst availability",
         "reason": "Omar is to confirm an analyst; the pilot needs one.", "suggested_prep": "Can an analyst join the kickoff?"},
        {"source_ref": "C99", "target_ref": p_ref, "title": "Invented", "reason": "x"},
        {"source_ref": c_ref, "target_ref": "P99", "title": "Invented", "reason": "x"},
    ]})
    result = _refresh(db)
    assert result["ran"] and result["added"] == 1
    row = db.tables["outside_suggestions"][0]
    assert row["status"] == "open" and row["project_id"] == "pr-1" and row["source_meeting_id"] == "m-group"
    assert row["person_id"] == "p-omar"
    # The evidence shown is from the records, not the model.
    assert row["source_excerpt"] == "Omar agreed to confirm an analyst."
    assert row["target_excerpt"].startswith("Kickoff Oct 2")

    data = get_continuity(auth=(MANAGER, db))
    assert data["suggestions"][0]["source"]["meeting"]["title"] == "Launch sync"
    assert data["brief"][-1]["kind"] == "suggestion"


def test_refresh_skips_the_model_when_evidence_is_unchanged(monkeypatch):
    db = _world()
    calls: list = []
    _ai(monkeypatch, {"suggestions": []}, calls)
    _refresh(db)
    _refresh(db)
    assert len(calls) == 1
    db.tables["projects"][0]["description"] = "Kickoff moved to Oct 9."
    _refresh(db)
    assert len(calls) == 2


def test_model_failure_leaves_everything_else_working(monkeypatch):
    db = _world()
    def boom(*_a, **_k):
        raise RuntimeError("overloaded")
    monkeypatch.setattr(bc, "generate_text", boom)
    result = _refresh(db)
    assert result["ai_failed"] and db.tables["outside_suggestions"] == []
    # No run is remembered, so the next visit tries again.
    assert db.tables["outside_suggestion_runs"] == []
    assert get_continuity(auth=(MANAGER, db))["brief"]


def _one_suggestion(monkeypatch, db):
    ev = gather_suggestion_evidence(db, MANAGER)
    _ai(monkeypatch, {"suggestions": [
        {"source_ref": _ref(ev, commitment="c-group-omar"), "target_ref": _ref(ev, target="pr-1"),
         "title": "Clarify analyst availability", "reason": "Both mention the analyst.", "suggested_prep": "Analyst?"},
    ]})
    _refresh(db)
    return db.tables["outside_suggestions"][-1]


def test_adding_to_prep_confirms_nothing_and_changes_no_work(monkeypatch):
    db = _world()
    s = _one_suggestion(monkeypatch, db)
    project_before = dict(db.tables["projects"][0])
    links_before = list(db.tables["outside_meeting_links"])
    result = add_prep_item("m-omar", PrepItemIn(text="Can an analyst join the kickoff?", suggestion_id=s["id"]), auth=(MANAGER, db))
    assert result["item"]["source"] == "suggestion" and result["item"]["suggestion_id"] == s["id"]
    assert s["status"] == "open" and s["added_meeting_id"] == "m-omar"
    assert db.tables["projects"][0] == project_before
    assert db.tables["outside_meeting_links"] == links_before and db.tables["check_ins"] == []
    # It leaves the brief once its prep line has a home.
    assert get_continuity(auth=(MANAGER, db))["suggestions"] == []


def test_confirming_writes_one_link_and_no_check_in(monkeypatch):
    db = _world()
    s = _one_suggestion(monkeypatch, db)
    project_before = dict(db.tables["projects"][0])
    first = connect_suggestion(s["id"], ConnectIn(note="Analyst dependency for the baseline"), auth=(MANAGER, db))
    again = connect_suggestion(s["id"], ConnectIn(), auth=(MANAGER, db))
    links = [l for l in db.tables["outside_meeting_links"] if l.get("project_id") == "pr-1"]
    assert len(links) == 1 and links[0]["meeting_id"] == "m-group" and links[0]["note"] == "Analyst dependency for the baseline"
    assert first["link_id"] == again["link_id"] == links[0]["id"]
    assert s["status"] == "connected"
    assert db.tables["check_ins"] == [] and db.tables["projects"][0] == project_before


def test_dismissal_is_remembered_until_the_evidence_changes(monkeypatch):
    db = _world()
    s = _one_suggestion(monkeypatch, db)
    commitments_before = [dict(c) for c in db.tables["commitments"]]
    dismiss_suggestion(s["id"], auth=(MANAGER, db))
    assert s["status"] == "dismissed" and db.tables["commitments"] == commitments_before
    with pytest.raises(HTTPException):
        add_prep_item("m-omar", PrepItemIn(text="x", suggestion_id=s["id"]), auth=(MANAGER, db))

    # Same evidence (forced re-run): not proposed again.
    db.tables["outside_suggestion_runs"].clear()
    _one_suggestion(monkeypatch, db)
    assert len(db.tables["outside_suggestions"]) == 1
    # Materially new evidence: may be proposed again.
    db.tables["projects"][0]["description"] = "Kickoff Oct 2. Two analysts now needed."
    _one_suggestion(monkeypatch, db)
    assert len(db.tables["outside_suggestions"]) == 2 and db.tables["outside_suggestions"][-1]["status"] == "open"


def test_a_suggestion_whose_source_closed_is_not_shown(monkeypatch):
    db = _world()
    _one_suggestion(monkeypatch, db)
    next(c for c in db.tables["commitments"] if c["id"] == "c-group-omar")["status"] = "done"
    assert get_continuity(auth=(MANAGER, db))["suggestions"] == []


def test_sanitize_needs_both_refs_and_text():
    ev = {
        "sources": [{"ref": "C1", "meeting_id": "m", "commitment_id": "c", "person_id": None, "excerpt": "x"}],
        "targets": [{"ref": "P1", "type": "project", "id": "p", "title": "T", "excerpt": None}],
    }
    assert sanitize_suggestions({"suggestions": [{"source_ref": "C1", "target_ref": "P1", "title": "", "reason": "r"}]}, ev) == []
    assert sanitize_suggestions({"suggestions": "nope"}, ev) == []
    ok = sanitize_suggestions({"suggestions": [{"source_ref": "C1", "target_ref": "P1", "title": "Do", "reason": "r"}] * 2}, ev)
    assert len(ok) == 1 and ok[0]["source_excerpt"] == "x"
