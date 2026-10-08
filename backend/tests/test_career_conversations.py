"""Career conversations: the timing rules (career_rhythm.py) and the routes
(routes/career.py), including the hooks that keep a planned conversation on
its 1:1 when that 1:1 moves or is logged."""
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

import career_rhythm as rhythm
from routes import career
from test_team_meetings import _DB, _EMBED_FK

MANAGER = "manager-1"
OTHER = "manager-2"
TODAY = datetime.now(timezone.utc).date()
_EMBED_FK.setdefault("one_on_one_series", "series_id")


def _noon(day: date) -> str:
    return f"{day.isoformat()}T12:00:00+00:00"


def _session(day, weeks=None, slot=None):
    s = {"id": "s1", "scheduled_at": _noon(day), "series_slot_at": _noon(slot) if slot else None}
    s["one_on_one_series"] = {"interval_weeks": weeks, "active": True} if weeks else {}
    return s


# ---------------------------------------------------------------- pure rules

def test_upcoming_dates_steps_the_series_and_skips_the_past():
    d = TODAY + timedelta(days=3)
    assert rhythm.upcoming_dates(_session(d, weeks=2), TODAY, 3) == [d, d + timedelta(weeks=2), d + timedelta(weeks=4)]
    past = TODAY - timedelta(days=2)
    assert rhythm.upcoming_dates(_session(past, weeks=1), TODAY, 2) == [past + timedelta(weeks=1), past + timedelta(weeks=2)]
    assert rhythm.upcoming_dates(_session(d), TODAY) == [d]
    assert rhythm.upcoming_dates(None, TODAY) == []
    assert rhythm.upcoming_dates({"scheduled_at": None}, TODAY) == []


def test_singly_moved_occurrence_steps_from_its_usual_day():
    usual = TODAY + timedelta(days=5)
    moved = TODAY + timedelta(days=6)
    assert rhythm.upcoming_dates(_session(moved, weeks=1, slot=usual), TODAY, 2) == [moved, usual + timedelta(weeks=1)]


def test_first_due_is_thirty_days_after_the_person_was_added():
    added = TODAY - timedelta(days=10)
    assert rhythm.due_on([], added.isoformat(), 90) == added + timedelta(days=30)


def test_due_runs_from_the_latest_held_or_skipped():
    rows = [
        {"status": "held", "planned_for": "2026-01-10", "held_on": "2026-01-12"},
        {"status": "skipped", "planned_for": "2026-04-20"},
        {"status": "planned", "planned_for": "2026-12-01"},
    ]
    assert rhythm.due_on(rows, "2025-01-01", 90) == date(2026, 4, 20) + timedelta(days=90)
    assert rhythm.last_settled(rows) == (date(2026, 1, 12), date(2026, 4, 20))


def test_off_means_nothing_is_due():
    state = rhythm.person_state(rows=[], person_added=TODAY, open_session=None, interval_days=None, today=TODAY)
    assert state["state"] == "off"


def test_not_due_until_the_window_opens():
    added = TODAY  # due in 30 days, window opens in 16
    state = rhythm.person_state(rows=[], person_added=added, open_session=None, interval_days=90, today=TODAY)
    assert state["state"] == "not_due"
    assert state["due_on"] == (TODAY + timedelta(days=30)).isoformat()


def test_proposal_suggests_a_1on1_at_least_a_week_out():
    added = TODAY - timedelta(days=40)  # overdue
    first = TODAY + timedelta(days=2)
    state = rhythm.person_state(rows=[], person_added=added, open_session=_session(first, weeks=1),
                                interval_days=90, today=TODAY)
    assert state["state"] == "proposed"
    assert state["suggested"] == (first + timedelta(weeks=1)).isoformat()
    assert state["choices"][0] == state["suggested"]
    assert len(state["choices"]) == rhythm.MAX_CHOICES


def test_proposal_aims_near_the_due_date_not_the_first_1on1():
    added = TODAY - timedelta(days=20)  # due in 10 days: floor is today + 7 (due - 7 = +3)
    first = TODAY + timedelta(days=1)
    state = rhythm.person_state(rows=[], person_added=added, open_session=_session(first, weeks=1),
                                interval_days=90, today=TODAY)
    assert state["suggested"] == (first + timedelta(weeks=1)).isoformat()


def test_only_a_near_1on1_is_offered_but_not_suggested():
    added = TODAY - timedelta(days=40)
    near = TODAY + timedelta(days=2)
    state = rhythm.person_state(rows=[], person_added=added, open_session=_session(near), interval_days=90, today=TODAY)
    assert state["suggested"] is None
    assert state["choices"] == [near.isoformat()]


def test_no_dated_1on1_gives_no_choices():
    state = rhythm.person_state(rows=[], person_added=TODAY - timedelta(days=40), open_session=None,
                                interval_days=90, today=TODAY)
    assert state["state"] == "proposed" and state["choices"] == [] and state["suggested"] is None


def test_planned_and_missed():
    rows = [{"id": "c1", "status": "planned", "planned_for": (TODAY + timedelta(days=9)).isoformat()}]
    state = rhythm.person_state(rows=rows, person_added=TODAY, open_session=None, interval_days=90, today=TODAY)
    assert state["state"] == "planned" and state["planned"]["days_until"] == 9
    rows = [{"id": "c1", "status": "planned", "planned_for": (TODAY - timedelta(days=8)).isoformat()}]
    state = rhythm.person_state(rows=rows, person_added=TODAY, open_session=None, interval_days=90, today=TODAY)
    assert state["state"] == "missed"
    # A planned conversation still shows when the manager has since turned it off.
    rows = [{"id": "c1", "status": "planned", "planned_for": (TODAY + timedelta(days=9)).isoformat()}]
    assert rhythm.person_state(rows=rows, person_added=TODAY, open_session=None, interval_days=None, today=TODAY)["state"] == "planned"


def test_copy_names_first_names_and_the_date():
    assert rhythm.calendar_title("Jonah Reyes", "Andrew Godlewski") == "Career conversation: Jonah / Andrew"
    assert rhythm.calendar_title("Jonah Reyes", None) == "Career conversation: Jonah"
    text = rhythm.heads_up_text("Jonah Reyes", date(2026, 10, 22))
    assert text.startswith("Hi Jonah, our 1:1 on Thursday, October 22 will be a career conversation")


# ---------------------------------------------------------------- routes

def _db():
    db = _DB()
    added = (datetime.now(timezone.utc) - timedelta(days=45)).isoformat()
    soon = TODAY + timedelta(days=3)
    db.tables = {
        "users": [{"id": MANAGER, "org_id": "org-1", "full_name": "Andrew Godlewski"}],
        "organizations": [{"id": "org-1", "career_conversation_interval_days": 90}],
        "direct_reports": [
            {"id": "dr-jonah", "manager_id": MANAGER, "name": "Jonah Reyes", "created_at": added, "archived_at": None},
            {"id": "dr-gone", "manager_id": MANAGER, "name": "Gone", "created_at": added, "archived_at": added},
            {"id": "dr-theirs", "manager_id": OTHER, "name": "Not yours", "created_at": added, "archived_at": None},
        ],
        "one_on_one_series": [{"id": "ser-1", "interval_weeks": 1, "active": True}],
        "one_on_ones": [
            {"id": "oo-open", "manager_id": MANAGER, "direct_report_id": "dr-jonah", "summary": None,
             "scheduled_at": _noon(soon), "series_slot_at": None, "series_id": "ser-1", "created_at": added},
        ],
        "career_conversations": [],
    }
    return db


def _auth(db, user=MANAGER):
    return (user, db)


def test_overview_scopes_to_the_managers_current_people():
    db = _db()
    out = career.build_overview(db, MANAGER, TODAY)
    assert [p["direct_report_id"] for p in out["people"]] == ["dr-jonah"]
    jonah = out["people"][0]
    assert jonah["state"] == "proposed"
    assert jonah["suggested"] == (TODAY + timedelta(days=10)).isoformat()
    assert jonah["calendar_title"] == "Career conversation: Jonah / Andrew"
    assert out["interval_days"] == 90


def test_interval_missing_column_defaults_and_null_is_off():
    assert career.interval_for(None) == 90
    assert career.interval_for({"id": "o"}) == 90
    assert career.interval_for({"career_conversation_interval_days": None}) is None


def test_plan_links_the_occurrence_on_that_day_and_moves_on_replan():
    db = _db()
    soon = (TODAY + timedelta(days=3)).isoformat()
    later = (TODAY + timedelta(days=10)).isoformat()
    out = career.plan_career_conversation("dr-jonah", career.PlanIn(planned_for=soon), None, _auth(db))
    assert out["state"] == "planned" and out["planned"]["one_on_one_id"] == "oo-open"
    assert "Hi Jonah" in out["heads_up"]
    plan_id = out["planned"]["id"]
    career.update_plan(plan_id, career.PlanUpdate(heads_up_sent=True), None, _auth(db))
    out = career.plan_career_conversation("dr-jonah", career.PlanIn(planned_for=later), None, _auth(db))
    rows = db.tables["career_conversations"]
    assert len(rows) == 1 and rows[0]["planned_for"] == later
    assert rows[0]["one_on_one_id"] is None and rows[0]["heads_up_sent_at"] is None  # old note named the old date


def test_plan_rejects_the_past_and_other_managers_people():
    db = _db()
    with pytest.raises(HTTPException) as e:
        career.plan_career_conversation("dr-jonah", career.PlanIn(planned_for=(TODAY - timedelta(days=1)).isoformat()), None, _auth(db))
    assert e.value.status_code == 422
    with pytest.raises(HTTPException) as e:
        career.plan_career_conversation("dr-theirs", career.PlanIn(planned_for=TODAY.isoformat()), None, _auth(db))
    assert e.value.status_code == 404
    db.tables["career_conversations"].append({"id": "c-theirs", "manager_id": OTHER, "direct_report_id": "dr-theirs",
                                              "status": "planned", "planned_for": TODAY.isoformat()})
    with pytest.raises(HTTPException):
        career.update_plan("c-theirs", career.PlanUpdate(heads_up_sent=True), None, _auth(db))


def test_moving_the_1on1_moves_the_plan_and_logging_marks_it_held():
    db = _db()
    soon = TODAY + timedelta(days=3)
    moved = TODAY + timedelta(days=4)
    career.plan_career_conversation("dr-jonah", career.PlanIn(planned_for=soon.isoformat()), None, _auth(db))
    before = dict(db.tables["one_on_ones"][0])
    after = {**before, "scheduled_at": _noon(moved)}
    career.on_session_moved(db, MANAGER, before, after)
    row = db.tables["career_conversations"][0]
    assert row["planned_for"] == moved.isoformat() and row["one_on_one_id"] == "oo-open"
    career.on_session_logged(db, MANAGER, "dr-jonah", {**after, "summary": "Talked growth"})
    assert row["status"] == "held" and row["held_on"] == moved.isoformat()
    out = career.career_person("dr-jonah", None, _auth(db))
    assert out["last_held_on"] == moved.isoformat() and out["state"] == "not_due"


def test_logging_a_different_1on1_leaves_the_plan_alone():
    db = _db()
    career.plan_career_conversation("dr-jonah", career.PlanIn(planned_for=(TODAY + timedelta(days=10)).isoformat()), None, _auth(db))
    career.on_session_logged(db, MANAGER, "dr-jonah", {"id": "oo-open", "scheduled_at": _noon(TODAY + timedelta(days=3))})
    assert db.tables["career_conversations"][0]["status"] == "planned"


def test_hooks_never_raise():
    class Broken:
        def table(self, _name):
            raise RuntimeError("down")
    career.on_session_logged(Broken(), MANAGER, "dr-jonah", {"id": "x", "scheduled_at": None})
    career.on_session_moved(Broken(), MANAGER, {"id": "x", "direct_report_id": "d"}, {})


def test_skip_restarts_the_clock_and_replaces_a_plan():
    db = _db()
    career.plan_career_conversation("dr-jonah", career.PlanIn(planned_for=(TODAY + timedelta(days=10)).isoformat()), None, _auth(db))
    out = career.skip("dr-jonah", None, _auth(db))
    rows = db.tables["career_conversations"]
    assert len(rows) == 1 and rows[0]["status"] == "skipped" and rows[0]["planned_for"] == TODAY.isoformat()
    assert out["state"] == "not_due" and out["due_on"] == (TODAY + timedelta(days=90)).isoformat()


def test_held_and_unplan():
    db = _db()
    out = career.plan_career_conversation("dr-jonah", career.PlanIn(planned_for=(TODAY + timedelta(days=3)).isoformat()), None, _auth(db))
    out = career.unplan(out["planned"]["id"], None, _auth(db))
    assert out["state"] == "proposed" and db.tables["career_conversations"] == []
    out = career.plan_career_conversation("dr-jonah", career.PlanIn(planned_for=(TODAY + timedelta(days=3)).isoformat()), None, _auth(db))
    out = career.mark_held(out["planned"]["id"], None, _auth(db))
    assert out["last_held_on"] == TODAY.isoformat()  # not in the future
    with pytest.raises(HTTPException) as e:
        career.mark_held(db.tables["career_conversations"][0]["id"], None, _auth(db))
    assert e.value.status_code == 409


def test_missing_table_reads_as_no_rows():
    db = _db()
    db.fail_on = ("career_conversations", "select")
    out = career.build_overview(db, MANAGER, TODAY)
    assert out["people"][0]["state"] == "proposed"
