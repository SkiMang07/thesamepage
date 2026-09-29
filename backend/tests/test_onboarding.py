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
