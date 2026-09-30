from types import SimpleNamespace

import pytest

import routes.onboarding as onboarding
from routes.onboarding import STEP_ORDER, build_status, carried_forward, evaluate, next_step


def _reports(n, *, role="r1", unit="u1"):
    return [{"id": f"p{i}", "role_level_id": role, "org_unit_id": unit} for i in range(n)]


def _all_true(**over):
    base = dict(
        reports=_reports(2),
        unit_count=1,
        covered_role_ids={"r1"},
        goal_levels={"company", "team"},
    )
    base.update(over)
    return evaluate(**base)


def _done(steps):
    return {k: steps[k]["done"] for k in STEP_ORDER}


def test_setup_is_org_expectations_and_goals():
    assert STEP_ORDER == ("org", "expectations", "goals")
    assert all(_done(_all_true()).values())


def test_org_needs_people_a_unit_and_everyone_placed():
    assert not _all_true(reports=[])["org"]["done"]
    assert not _all_true(unit_count=0)["org"]["done"]
    placed = _reports(2) + [{"id": "x", "role_level_id": "r1", "org_unit_id": None}]
    steps = _all_true(reports=placed)
    assert not steps["org"]["done"]
    assert steps["org"]["people_without_team"] == 1


def test_expectations_wait_on_org_and_cover_every_role_in_use():
    steps = _all_true(reports=_reports(2, unit=None))
    assert steps["expectations"]["blocked"] is True

    two_roles = [
        {"id": "a", "role_level_id": "r1", "org_unit_id": "u1"},
        {"id": "b", "role_level_id": "r2", "org_unit_id": "u1"},
    ]
    partial = _all_true(reports=two_roles, covered_role_ids={"r1"})
    assert not partial["expectations"]["done"]
    assert (partial["expectations"]["roles_covered"], partial["expectations"]["roles_in_use"]) == (1, 2)
    assert _all_true(reports=two_roles, covered_role_ids={"r1", "r2"})["expectations"]["done"]


def test_a_person_without_a_role_blocks_expectations():
    people = _reports(1) + [{"id": "n", "role_level_id": None, "org_unit_id": "u1"}]
    steps = _all_true(reports=people)
    assert not steps["expectations"]["done"]
    assert steps["expectations"]["people_without_role"] == 1


def test_a_role_nobody_holds_does_not_block():
    # covered_role_ids may include roles no one is in; only roles in use count.
    assert _all_true(covered_role_ids={"r1", "unused"})["expectations"]["done"]


def test_people_ready_counts_people_whose_role_has_expectations():
    people = [
        {"id": "a", "role_level_id": "r1", "org_unit_id": "u1"},
        {"id": "b", "role_level_id": "r2", "org_unit_id": "u1"},
        {"id": "c", "role_level_id": None, "org_unit_id": "u1"},
    ]
    assert _all_true(reports=people, covered_role_ids={"r1"})["expectations"]["people_ready"] == 1
    assert _all_true(reports=[], covered_role_ids={"r1"})["expectations"]["people_ready"] == 0


def test_goals_need_an_org_level_goal_and_a_team_goal():
    assert not _all_true(goal_levels={"team"})["goals"]["done"]
    assert not _all_true(goal_levels={"company"})["goals"]["done"]
    assert not _all_true(goal_levels={"individual", "team"})["goals"]["done"]
    assert _all_true(goal_levels={"department", "team"})["goals"]["done"]


# ---- next_step --------------------------------------------------------------


def test_next_step_is_the_first_undone_step_and_skips_blocked_ones():
    # Nothing set up: org comes first; expectations are blocked behind it.
    assert next_step(_all_true(reports=[], goal_levels=set())) == "org"
    # Org done, expectations not: expectations is next.
    assert next_step(_all_true(covered_role_ids=set(), goal_levels=set())) == "expectations"
    # Org and expectations done: goals.
    assert next_step(_all_true(goal_levels=set())) == "goals"
    assert next_step(_all_true()) is None


def test_next_step_skips_a_blocked_step_rather_than_pointing_at_it():
    # Org is not done, so expectations is blocked; goals (any order) is next
    # only once org itself is done. With org undone, org stays the pointer.
    steps = _all_true(reports=_reports(1, unit=None), goal_levels=set())
    assert steps["expectations"]["blocked"] is True
    assert next_step(steps) == "org"


# ---- carried_forward --------------------------------------------------------


def _row(rid, who, when):
    return {"id": rid, "direct_report_id": who, "scheduled_at": when, "created_at": "2026-01-01T00:00:00+00:00"}


def test_a_later_sheet_for_the_same_person_carries_forward():
    logged = [_row("a", "p1", "2026-09-01T15:00:00+00:00")]
    assert carried_forward(logged, [_row("b", "p1", "2026-09-15T15:00:00+00:00")])


def test_the_logged_row_is_not_its_own_later_sheet():
    logged = [_row("a", "p1", "2026-09-01T15:00:00+00:00")]
    assert not carried_forward(logged, [_row("a", "p1", "2026-09-01T15:00:00+00:00")])


def test_a_sheet_for_someone_else_or_from_before_the_log_does_not_count():
    logged = [_row("a", "p1", "2026-09-10T15:00:00+00:00")]
    assert not carried_forward(logged, [_row("b", "p2", "2026-09-20T15:00:00+00:00")])
    assert not carried_forward(logged, [_row("c", "p1", "2026-09-01T15:00:00+00:00")])
    assert not carried_forward([], [_row("b", "p1", "2026-09-20T15:00:00+00:00")])


# ---- build_status against a fake client -------------------------------------


class _Not:
    def __init__(self, q):
        self.q = q

    def is_(self, field, _null):
        self.q.filters.append(lambda r, f=field: r.get(f) is not None)
        return self.q


class _Q:
    def __init__(self, rows, log):
        self.rows, self.filters, self.values, self.cap, self.log = rows, [], None, None, log

    def select(self, *_a):
        return self

    def eq(self, f, v):
        self.filters.append(lambda r, f=f, v=v: r.get(f) == v)
        return self

    def neq(self, f, v):
        self.filters.append(lambda r, f=f, v=v: r.get(f) != v)
        return self

    def is_(self, f, _null):
        self.filters.append(lambda r, f=f: r.get(f) is None)
        return self

    @property
    def not_(self):
        return _Not(self)

    def limit(self, n):
        self.cap = n
        return self

    def update(self, values):
        self.values = values
        return self

    def execute(self):
        hit = [r for r in self.rows if all(p(r) for p in self.filters)]
        if self.values is not None:
            for r in hit:
                r.update(self.values)
        if self.cap is not None:
            hit = hit[: self.cap]
        return SimpleNamespace(data=[{**r} for r in hit])


class _Client:
    def __init__(self, tables):
        self.tables = tables
        self.touched = []

    def table(self, name):
        self.touched.append(name)
        return _Q(self.tables[name], self.touched)


def _user(**over):
    row = {
        "id": "m",
        "set_up_at": None,
        "onboarded_at": None,
        "setup_org_at": None,
        "setup_expectations_at": None,
        "setup_goals_at": None,
    }
    row.update(over)
    return row


def _tables(**over):
    t = {
        "users": [_user()],
        "direct_reports": [{"id": "p1", "manager_id": "m", "role_level_id": "r1", "org_unit_id": "u1", "archived_at": None}],
        "org_units": [{"id": "u1"}],
        "goals": [{"level": "company", "status": "active"}, {"level": "team", "status": "active"}],
        "one_on_ones": [],
        "role_levels": [{"id": "r1", "job_role": "CSM", "job_level": 2}],
        "role_expectation_drafts": [],
    }
    t.update(over)
    return t


def _sheet(rid="s1", who="p1", when="2026-09-20T15:00:00+00:00", *, summary=None, prep=True):
    return {
        "id": rid,
        "manager_id": "m",
        "direct_report_id": who,
        "scheduled_at": when,
        "created_at": when,
        "summary": summary,
        "prep_guide": {"topics": []} if prep else None,
    }


@pytest.fixture(autouse=True)
def _coverage_and_events(monkeypatch):
    monkeypatch.setattr(
        onboarding,
        "_compute_coverage",
        lambda _c: {"roles": [{"role_level_id": "r1", "metrics_count": 2, "skills_count": 0, "values_count": 0}]},
    )
    sent = []
    monkeypatch.setattr(onboarding.analytics, "capture", lambda uid, ev, props=None: sent.append((uid, ev, props)))
    return sent


def test_a_complete_setup_is_stamped_once_and_stays_set_up(_coverage_and_events):
    tables = _tables(one_on_ones=[_sheet()])
    client = _Client(tables)

    first = build_status("m", client)
    assert first["set_up"] is True and first["onboarded"] is False
    assert first["activated"] is True
    assert first["steps"] is None and first["next_step"] is None
    assert first["done_count"] == first["total"] == 3
    user = tables["users"][0]
    assert user["set_up_at"] and all(user[c] for c in onboarding.STEP_COLUMN.values())
    events = [(e, p) for _u, e, p in _coverage_and_events]
    assert [e for e, _ in events] == ["setup_step_completed"] * 3 + ["set_up"]
    assert [p["step"] for e, p in events if e == "setup_step_completed"] == list(STEP_ORDER)

    # A goal archived later must not take it back, and nothing fires twice.
    tables["goals"].clear()
    second = build_status("m", client)
    assert second["set_up"] is True and second["steps"] is None
    assert len(_coverage_and_events) == 4


def test_knowledge_documents_are_not_required():
    # No documents table at all: nothing in setup reads it.
    build_status("m", _Client(_tables(one_on_ones=[_sheet()])))


def test_incomplete_setup_reports_progress_and_points_at_the_next_step(_coverage_and_events):
    tables = _tables(goals=[{"level": "team", "status": "active"}])
    status = build_status("m", _Client(tables))
    assert status["set_up"] is False and status["onboarded"] is False
    assert status["done_count"] == 2
    assert status["next_step"] == "goals"
    assert status["steps"]["goals"]["has_org_goal"] is False
    assert status["assessable_people"] == 1
    assert tables["users"][0]["set_up_at"] is None
    # The two finished steps each fire once; set_up does not.
    assert [(e, p["step"]) for _u, e, p in _coverage_and_events] == [
        ("setup_step_completed", "org"),
        ("setup_step_completed", "expectations"),
    ]


def test_a_step_that_completed_once_does_not_fire_again_when_it_flips(_coverage_and_events):
    tables = _tables(goals=[{"level": "team", "status": "active"}])
    client = _Client(tables)
    build_status("m", client)
    before = len(_coverage_and_events)

    # Org stops holding (a person is moved out of every unit), then holds again.
    tables["direct_reports"][0]["org_unit_id"] = None
    build_status("m", client)
    tables["direct_reports"][0]["org_unit_id"] = "u1"
    build_status("m", client)
    assert len(_coverage_and_events) == before


def test_cancelled_goals_do_not_count():
    tables = _tables(goals=[{"level": "company", "status": "cancelled"}, {"level": "team", "status": "active"}])
    assert build_status("m", _Client(tables))["steps"]["goals"]["done"] is False


def test_archived_reports_do_not_count():
    tables = _tables(
        direct_reports=[{"id": "p1", "manager_id": "m", "role_level_id": "r1", "org_unit_id": "u1", "archived_at": "2026-09-01"}]
    )
    assert build_status("m", _Client(tables))["steps"]["org"]["done"] is False


def test_activated_is_a_prep_sheet_and_nothing_more():
    assert build_status("m", _Client(_tables(one_on_ones=[])))["activated"] is False
    assert build_status("m", _Client(_tables(one_on_ones=[_sheet(prep=False)])))["activated"] is False
    assert build_status("m", _Client(_tables(one_on_ones=[_sheet()])))["activated"] is True


def test_onboarded_needs_setup_a_log_and_a_later_sheet(_coverage_and_events):
    log = _sheet("log", when="2026-09-01T15:00:00+00:00", summary="held")
    later = _sheet("next", when="2026-09-15T15:00:00+00:00")

    # Set up and logged, but no later sheet yet.
    tables = _tables(one_on_ones=[log])
    status = build_status("m", _Client(tables))
    assert status["set_up"] is True and status["onboarded"] is False

    # The later sheet arrives: onboarded, stamped, one event.
    tables["one_on_ones"].append(later)
    client = _Client(tables)
    status = build_status("m", client)
    assert status["onboarded"] is True and status["onboarded_at"]
    assert tables["users"][0]["onboarded_at"]
    assert [e for _u, e, _p in _coverage_and_events].count("onboarded") == 1

    # Sticky: an emptied history does not undo it, and it answers from the user row.
    tables["one_on_ones"].clear()
    client = _Client({"users": tables["users"]})
    again = build_status("m", client)
    assert again["onboarded"] is True and again["set_up"] is True and again["activated"] is True
    assert client.touched == ["users"]
    assert [e for _u, e, _p in _coverage_and_events].count("onboarded") == 1


def test_a_log_alone_does_not_onboard_someone_who_is_not_set_up():
    tables = _tables(goals=[], one_on_ones=[_sheet("log", summary="held"), _sheet("next", when="2026-10-01T15:00:00+00:00")])
    status = build_status("m", _Client(tables))
    assert status["set_up"] is False and status["onboarded"] is False


def test_a_grandfathered_account_is_set_up_and_onboarded_without_any_queries(_coverage_and_events):
    client = _Client({"users": [_user(onboarded_at="2026-09-29T00:00:00+00:00", set_up_at="2026-09-29T00:00:00+00:00")]})
    status = build_status("m", client)
    assert status["set_up"] and status["onboarded"] and status["activated"]
    assert client.touched == ["users"]
    assert _coverage_and_events == []


# ---- the setup-step-started telemetry route ---------------------------------


def _telemetry_client():
    import main
    import utils
    from fastapi.testclient import TestClient

    utils.limiter.reset()
    main.app.dependency_overrides[utils.get_authenticated_client] = lambda: ("u1", None)
    return TestClient(main.app), main, utils


def test_setup_step_started_sends_the_step_and_whether_it_was_next(_coverage_and_events):
    client, main, utils = _telemetry_client()
    try:
        r = client.post("/api/telemetry/setup-step-started", json={"step": "goals", "is_next": True})
        assert r.status_code == 200, r.text
        assert _coverage_and_events == [("u1", "setup_step_started", {"step": "goals", "is_next": True})]
    finally:
        main.app.dependency_overrides.clear()
        utils.limiter.reset()


@pytest.mark.parametrize(
    "bad",
    [
        {"step": "knowledge", "is_next": False},  # no longer a step
        {"step": "goals", "is_next": False, "note": "Priya's goal"},  # no extra fields
        {"step": "goals"},
    ],
)
def test_setup_step_started_refuses_anything_but_the_enum_and_a_flag(_coverage_and_events, bad):
    client, main, utils = _telemetry_client()
    try:
        assert client.post("/api/telemetry/setup-step-started", json=bad).status_code == 422
        assert _coverage_and_events == []
    finally:
        main.app.dependency_overrides.clear()
        utils.limiter.reset()


# ---- chunk C: who to set expectations for next, and "Don't know yet" ---------

from routes.onboarding import expectation_queue  # noqa: E402


def _people():
    return [
        {"id": "a", "name": "Ana", "role_level_id": "r1"},
        {"id": "b", "name": "Ben", "role_level_id": "r2"},
        {"id": "c", "name": "Cy", "role_level_id": "r2"},
        {"id": "d", "name": "Di", "role_level_id": None},
        {"id": "e", "name": "Eve", "role_level_id": "r3"},
    ]


def test_queue_puts_the_soonest_1on1_first_and_skips_covered_roles():
    labels = {"r1": "CSM L2", "r2": "AE L1", "r3": "SE L3"}
    q = expectation_queue(_people(), labels, {"r1"}, {"c": "2026-10-02", "e": "2026-10-05"})
    assert [(x["report_id"], x["role_label"]) for x in q] == [("c", "AE L1"), ("e", "SE L3"), ("d", None)]
    assert q[0]["next_1on1_on"] == "2026-10-02" and q[2]["next_1on1_on"] is None


def test_a_shared_role_appears_once_and_undated_people_follow_by_name():
    q = expectation_queue(_people(), {}, set(), {})
    assert [x["person_name"] for x in q] == ["Ana", "Ben", "Di", "Eve"]     # Cy shares Ben's role


def test_queue_is_capped_and_empty_when_everything_is_covered():
    many = [{"id": f"p{i}", "name": f"P{i:02}", "role_level_id": f"r{i}"} for i in range(9)]
    assert len(expectation_queue(many, {}, set(), {})) == 5
    assert expectation_queue(_people()[:1], {}, {"r1"}, {}) == []


def test_status_carries_the_next_role_and_ignores_past_meetings():
    tables = _tables(
        direct_reports=[
            {"id": "p1", "name": "Priya", "manager_id": "m", "role_level_id": "r9", "org_unit_id": "u1", "archived_at": None},
            {"id": "p2", "name": "Sam", "manager_id": "m", "role_level_id": None, "org_unit_id": "u1", "archived_at": None},
        ],
        role_levels=[{"id": "r9", "job_role": "AE", "job_level": 1}],
        one_on_ones=[
            {**_sheet("s1", "p1", "2020-01-01T15:00:00+00:00", prep=False)},
            {**_sheet("s2", "p2", "2999-01-01T15:00:00+00:00", prep=False)},
        ],
    )
    steps = build_status("m", _Client(tables))["steps"]
    nxt = steps["expectations"]["next_role"]
    assert nxt["report_id"] == "p2" and nxt["role_level_id"] is None and nxt["next_1on1_on"] == "2999-01-01"
    assert [x["report_id"] for x in steps["expectations"]["queue"]] == ["p2", "p1"]


def test_dont_know_yet_parks_the_goals_step_without_completing_it():
    steps = evaluate(reports=_reports(2), unit_count=1, covered_role_ids={"r1"},
                     goal_levels={"team"}, org_goals_unknown=True)
    assert steps["goals"]["done"] is False and steps["goals"]["parked"] is True
    assert next_step(steps) is None                       # nothing to highlight, set up stays open


def test_dont_know_yet_does_not_park_while_the_team_goal_is_also_missing():
    steps = evaluate(reports=_reports(2), unit_count=1, covered_role_ids={"r1"},
                     goal_levels=set(), org_goals_unknown=True)
    assert steps["goals"]["unknown"] is True and steps["goals"]["parked"] is False
    assert next_step(steps) == "goals"


def test_an_org_goal_ends_the_unknown_answer():
    steps = evaluate(reports=_reports(2), unit_count=1, covered_role_ids={"r1"},
                     goal_levels={"company", "team"}, org_goals_unknown=True)
    assert steps["goals"]["done"] is True and steps["goals"]["unknown"] is False and steps["goals"]["parked"] is False


def test_status_clears_the_flag_once_an_org_goal_exists():
    tables = _tables(users=[_user(org_goals_unknown_at="2026-09-29T00:00:00+00:00")],
                     goals=[{"level": "company", "status": "active"}])
    build_status("m", _Client(tables))
    assert tables["users"][0]["org_goals_unknown_at"] is None


# ---- chunk D: the fading card, the entry modal, the completion receipt -------

from datetime import datetime, timedelta, timezone  # noqa: E402

from routes.onboarding import (  # noqa: E402
    QUIET_AFTER_DAYS,
    card_level,
    compose_receipt,
    setup_prompt,
    snooze_days,
    step_target,
)

NOW = datetime(2026, 10, 1, 15, 0, tzinfo=timezone.utc)


def _ago(days):
    return (NOW - timedelta(days=days)).isoformat()


def _later(days):
    return (NOW + timedelta(days=days)).isoformat()


def test_card_is_full_until_dismissed_or_left_alone_for_a_week():
    assert card_level(dismissals=0, snoozed_until=None, since=_ago(1), now=NOW) == "full"
    assert card_level(dismissals=0, snoozed_until=None, since=None, now=NOW) == "full"
    assert card_level(dismissals=0, snoozed_until=None, since=_ago(QUIET_AFTER_DAYS), now=NOW) == "quiet"
    assert card_level(dismissals=1, snoozed_until=None, since=_ago(0), now=NOW) == "quiet"


def test_a_running_snooze_hides_the_card_and_an_expired_one_does_not():
    assert card_level(dismissals=2, snoozed_until=_later(1), since=_ago(20), now=NOW) == "hidden"
    assert card_level(dismissals=2, snoozed_until=_ago(1), since=_ago(20), now=NOW) == "quiet"
    assert card_level(dismissals=0, snoozed_until="not a date", since=None, now=NOW) == "full"


def test_each_dismissal_hides_the_card_longer_up_to_a_cap():
    assert [snooze_days(n) for n in (1, 2, 3, 4, 5, 40)] == [1, 3, 7, 14, 14, 14]


def _prompt_user(**over):
    """A manager mid-setup whose org and expectations steps were stamped days ago."""
    base = dict(
        setup_intro_seen_at=_ago(1),
        setup_receipt_seen_at=None,
        setup_card_dismissals=0,
        setup_card_snoozed_until=None,
        setup_org_at=_ago(1),
        setup_expectations_at=_ago(1),
    )
    base.update(over)
    return _user(**base)


def _incomplete(**over):
    # Team goal missing, so the manager is mid-setup with the goals step next.
    return _tables(goals=[{"level": "company", "status": "active"}], one_on_ones=[_sheet()], **over)


def test_the_entry_modal_is_pending_once_activated_and_until_it_is_closed():
    tables = _incomplete(users=[_user(setup_intro_seen_at=None, setup_card_dismissals=0)])
    status = build_status("m", _Client(tables))
    assert status["intro_pending"] is True and status["card"]["level"] == "full"
    tables = _incomplete(users=[_prompt_user()])
    status = build_status("m", _Client(tables))
    assert status["intro_pending"] is False and status["card"]["level"] == "full"


def test_the_entry_modal_waits_for_the_first_prep_sheet():
    tables = _tables(goals=[], one_on_ones=[], users=[_user(setup_intro_seen_at=None, setup_card_dismissals=0)])
    assert build_status("m", _Client(tables))["intro_pending"] is False


def test_the_card_goes_quiet_then_hidden_from_the_stored_state():
    quiet = build_status("m", _Client(_incomplete(users=[_prompt_user(setup_card_dismissals=1)])))
    assert quiet["card"]["level"] == "quiet"
    stale = _prompt_user(setup_intro_seen_at=_ago(9), setup_org_at=_ago(9), setup_expectations_at=_ago(9))
    assert build_status("m", _Client(_incomplete(users=[stale])))["card"]["level"] == "quiet"
    hidden = build_status(
        "m", _Client(_incomplete(users=[_prompt_user(setup_card_dismissals=2, setup_card_snoozed_until=_later(2))]))
    )
    assert hidden["card"]["level"] == "hidden"
    assert hidden["next_step"] == "goals"           # the requirement does not fade, only the volume


def test_finishing_a_step_earns_the_full_card_back():
    unstamped = _prompt_user(setup_card_dismissals=3, setup_card_snoozed_until=_later(5),
                             setup_org_at=None, setup_expectations_at=None)
    tables = _incomplete(users=[unstamped])
    status = build_status("m", _Client(tables))     # org and expectations hold for the first time
    assert status["card"] == {"level": "full", "dismissals": 0, "snoozed_until": None}
    user = tables["users"][0]
    assert user["setup_card_dismissals"] == 0 and user["setup_card_snoozed_until"] is None


def test_without_the_migration_the_prompt_layer_is_simply_absent(monkeypatch):
    real = _Q.select

    def select(self, *cols):
        if cols and "setup_intro_seen_at" in cols[0]:
            raise RuntimeError("column users.setup_intro_seen_at does not exist")
        return real(self, *cols)

    monkeypatch.setattr(_Q, "select", select)
    status = build_status("m", _Client(_incomplete()))
    assert status["steps"] is not None and status["next_step"] == "goals"
    assert status["intro_pending"] is False and status["receipt_pending"] is False and status["card"] is None


def test_the_receipt_is_pending_from_the_moment_setup_completes_until_it_is_closed():
    tables = _tables(users=[_prompt_user()], one_on_ones=[_sheet()])
    status = build_status("m", _Client(tables))
    assert status["set_up"] and status["receipt_pending"] is True and status["card"] is None
    tables = _tables(users=[_prompt_user(set_up_at=_ago(1), setup_receipt_seen_at=_ago(1))], one_on_ones=[_sheet()])
    assert build_status("m", _Client(tables))["receipt_pending"] is False


def test_a_finished_account_with_the_receipt_unseen_still_answers_from_the_user_row(_coverage_and_events):
    user = _prompt_user(set_up_at=_ago(2), onboarded_at=_ago(1))
    client = _Client({"users": [user]})
    status = build_status("m", client)
    assert status["receipt_pending"] is True and client.touched == ["users"]


def _receipt(**over):
    base = dict(
        people=[{"id": "a", "role_level_id": "r1"}, {"id": "b", "role_level_id": "r1"}, {"id": "c", "role_level_id": "r2"}],
        unit_count=2,
        covered_role_ids={"r1", "r2"},
        org_goals=1,
        team_goals=2,
        prepped_report_ids={"a", "b", "c"},
        project_count=1,
        check_in_count=1,
    )
    base.update(over)
    return compose_receipt(**base)


def test_the_receipt_states_what_is_on_record_in_plain_counts():
    receipt = _receipt()
    assert receipt["lines"][0] == "3 people placed across 2 teams."
    assert receipt["lines"][1] == "2 roles with expectations, covering 3 people."
    assert receipt["lines"][2] == "1 org goal and 2 team goals on record."
    assert receipt["next"] == []                    # nothing left that is worth listing


def test_next_when_there_is_time_lists_only_what_has_something_to_act_on_in_a_fixed_order():
    receipt = _receipt(prepped_report_ids={"a"}, project_count=0, check_in_count=0)
    assert [n["key"] for n in receipt["next"]] == ["prep_others", "first_check_in", "first_project"]
    assert receipt["next"][0]["label"] == "Prepare sheets for 2 more people."
    only_project = _receipt(project_count=0)
    assert [n["key"] for n in only_project["next"]] == ["first_project"]
    no_goals = _receipt(org_goals=0, team_goals=0, check_in_count=0)
    assert "first_check_in" not in [n["key"] for n in no_goals["next"]]


def test_the_receipt_never_uses_watching_words_or_cheer():
    receipt = _receipt(prepped_report_ids=set(), project_count=0, check_in_count=0)
    text = " ".join(receipt["lines"] + [f"{n['label']} {n['detail']}" for n in receipt["next"]]).lower()
    for banned in ("watch", "track", "monitor", "congrat", "great", "!", "the same page"):
        assert banned not in text


def test_step_targets_mirror_what_the_card_offers():
    steps = _all_true(goal_levels={"team"}, queue=[{"report_id": "p9", "person_name": "Sam Lee", "role_level_id": None,
                                                    "role_label": None, "next_1on1_on": None}])
    assert step_target(steps, "org") == {"label": "Set up team and org", "href": "/app/org"}
    assert step_target(steps, "expectations") == {"label": "Pick a role for Sam", "href": "/app/expectations/new?assign=p9"}
    assert step_target(steps, "goals")["href"] == "/app/dashboard?setup=goals"
    steps = _all_true(queue=[{"report_id": "p9", "person_name": "Sam Lee", "role_level_id": "r4",
                              "role_label": "AE L1", "next_1on1_on": None}])
    assert step_target(steps, "expectations") == {"label": "Set expectations for AE L1", "href": "/app/expectations/r4"}
    assert step_target(steps, "goals") == {"label": "Write a team goal", "href": "/app/goals"}


def test_setup_prompt_offers_a_way_back_only_mid_setup():
    mid = setup_prompt("m", _Client(_incomplete(users=[_prompt_user(setup_card_dismissals=1)])))
    assert mid["next_step"] == "goals" and mid["card_level"] == "quiet" and mid["user_id"] == "m"
    assert mid["done_count"] == 2 and mid["total"] == 3 and mid["href"] == "/app/goals"
    assert setup_prompt("m", _Client(_tables(users=[_prompt_user()], one_on_ones=[_sheet()]))) is None   # set up
    not_activated = _tables(goals=[], one_on_ones=[], users=[_prompt_user()])
    assert setup_prompt("m", _Client(not_activated)) is None


def test_setup_prompt_never_raises():
    class Broken:
        def table(self, _name):
            raise RuntimeError("down")

    assert setup_prompt("m", Broken()) is None


# ---- chunk D routes ----------------------------------------------------------


def _route_client(users):
    import main
    import utils
    from fastapi.testclient import TestClient

    utils.limiter.reset()
    fake = _Client({"users": users})
    main.app.dependency_overrides[utils.get_authenticated_client] = lambda: ("m", fake)
    return TestClient(main.app), main, utils


def _teardown(main, utils):
    main.app.dependency_overrides.clear()
    utils.limiter.reset()


def test_the_entry_modal_is_stamped_and_reported_once(_coverage_and_events):
    users = [_user(setup_intro_seen_at=None, setup_card_dismissals=0)]
    client, main, utils = _route_client(users)
    try:
        assert client.post("/api/onboarding/intro-seen", json={"action": "later"}).status_code == 200
        assert client.post("/api/onboarding/intro-seen", json={"action": "started"}).status_code == 200
        assert users[0]["setup_intro_seen_at"] is not None
        assert _coverage_and_events == [("m", "setup_intro_resolved", {"action": "later"})]
        assert client.post("/api/onboarding/intro-seen", json={"action": "later", "note": "x"}).status_code == 422
        assert client.post("/api/onboarding/intro-seen", json={"action": "dismissed"}).status_code == 422
    finally:
        _teardown(main, utils)


def test_not_now_snoozes_longer_each_time_and_reports_counts_only(_coverage_and_events):
    users = [_prompt_user()]
    client, main, utils = _route_client(users)
    try:
        for expected_days in (1, 3, 7, 14, 14):
            before = datetime.now(timezone.utc)
            assert client.post("/api/onboarding/card-dismissed").status_code == 200
            until = datetime.fromisoformat(users[0]["setup_card_snoozed_until"])
            days = (until - before).total_seconds() / 86400
            assert expected_days - 0.01 <= days <= expected_days + 0.01
        assert users[0]["setup_card_dismissals"] == 5
        assert _coverage_and_events[0] == ("m", "setup_card_dismissed", {"dismissals": 1, "level_before": "full"})
        assert all(e[2]["level_before"] in ("full", "quiet") and set(e[2]) == {"dismissals", "level_before"}
                   for e in _coverage_and_events)
    finally:
        _teardown(main, utils)


def test_not_now_does_nothing_once_set_up(_coverage_and_events):
    users = [_prompt_user(set_up_at=_ago(1))]
    client, main, utils = _route_client(users)
    try:
        assert client.post("/api/onboarding/card-dismissed").json()["snoozed_until"] is None
        assert users[0]["setup_card_dismissals"] == 0 and _coverage_and_events == []
    finally:
        _teardown(main, utils)


def test_the_receipt_is_stamped_once_and_never_before_setup_is_done(_coverage_and_events):
    early = [_prompt_user()]
    client, main, utils = _route_client(early)
    try:
        client.post("/api/onboarding/receipt-seen")
        assert early[0]["setup_receipt_seen_at"] is None and _coverage_and_events == []
        assert client.get("/api/onboarding/receipt").json() is None
    finally:
        _teardown(main, utils)
    done = [_prompt_user(set_up_at=_ago(1))]
    client, main, utils = _route_client(done)
    try:
        client.post("/api/onboarding/receipt-seen")
        client.post("/api/onboarding/receipt-seen")
        assert done[0]["setup_receipt_seen_at"] is not None
        assert _coverage_and_events == [("m", "set_up_receipt_seen", {})]
    finally:
        _teardown(main, utils)



# ---- drafts waiting for review (the 2026-09-30 Dana rerun) -------------------
# After the batch box, the card still said "Describe each person's role" and
# never mentioned the drafts sitting in Needs review. Drafts don't complete
# the step (approval does); they change what it asks for.

def _dana_status(drafts):
    people = [("p1", "Andre Okafor", "rA"), ("p2", "Kwame Mensah", "rK"), ("p3", "Lena Fischer", "rL"),
              ("p4", "Mei Tanaka", "rM"), ("p5", "Sofia Reyes", "rS"), ("p6", "Tomás Silva", "r1")]
    tables = _tables(
        direct_reports=[{"id": i, "name": n, "manager_id": "m", "role_level_id": r, "org_unit_id": "u1", "archived_at": None}
                        for i, n, r in people],
        role_levels=[{"id": r, "job_role": f"Role {r}", "job_level": 1} for *_, r in people],
        role_expectation_drafts=drafts,
    )
    return build_status("m", _Client(tables))


def _draft(role, state="composed", started=None):
    analysis = {"status": state, "source": "batch"}
    if started:
        analysis["started_at"] = started
    return {"role_level_id": role, "status": "open", "analysis": analysis}


def test_drafts_waiting_are_counted_named_and_lead_the_step():
    status = _dana_status([_draft("rK"), _draft("rL"), _draft("rM"), _draft("rS", "ready")])
    exp = status["steps"]["expectations"]
    assert exp["done"] is False and status["done_count"] == 2              # approval, not a draft, completes it
    assert exp["drafts_to_review"] == 4 and exp["drafts_writing"] == 0
    assert exp["review_people"] == ["Kwame Mensah", "Lena Fischer", "Mei Tanaka", "Sofia Reyes"]
    # The next role to describe is the one with nothing yet, never one already drafted.
    assert [q["role_level_id"] for q in exp["queue"]] == ["rA"]
    assert onboarding.step_target(status["steps"], "expectations") == {
        "label": "Review 4 drafts", "href": "/app/expectations#needs-review"}


def test_a_draft_still_being_written_is_writing_not_review():
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    status = _dana_status([_draft("rK", "drafting", started=now), _draft("rL", "drafting", started="2020-01-01T00:00:00+00:00")])
    exp = status["steps"]["expectations"]
    # Kwame's is being written; Lena's went stale, reads as failed, and waits in Needs review for Retry.
    assert exp["drafts_writing"] == 1 and exp["drafts_to_review"] == 1 and exp["review_people"] == ["Lena Fischer"]
    assert "rK" not in [q["role_level_id"] for q in exp["queue"]]


def test_a_revision_on_an_approved_role_or_a_role_nobody_holds_is_not_setup_work():
    status = _dana_status([_draft("r1"), _draft("r-unused")])
    exp = status["steps"]["expectations"]
    assert exp["drafts_to_review"] == 0 and exp["review_people"] == []


def test_evaluate_without_drafts_is_unchanged():
    steps = _all_true()
    assert steps["expectations"]["drafts_to_review"] == 0 and steps["expectations"]["drafts_writing"] == 0
