from types import SimpleNamespace

import pytest

import routes.onboarding as onboarding
from routes.onboarding import STEP_ORDER, build_status, evaluate


def _reports(n, *, role="r1", unit="u1"):
    return [{"id": f"p{i}", "role_level_id": role, "org_unit_id": unit} for i in range(n)]


def _all_true(**over):
    base = dict(
        reports=_reports(2),
        unit_count=1,
        covered_role_ids={"r1"},
        confirmed_docs=1,
        knowledge_skipped=False,
        goal_levels={"company", "team"},
        logged=True,
    )
    base.update(over)
    return evaluate(**base)


def _done(steps):
    return {k: steps[k]["done"] for k in STEP_ORDER}


def test_everything_true_is_all_done():
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


def test_knowledge_counts_a_confirmed_document_or_nothing_to_import():
    assert not _all_true(confirmed_docs=0)["knowledge"]["done"]
    assert _all_true(confirmed_docs=0, knowledge_skipped=True)["knowledge"]["done"]


def test_goals_need_an_org_level_goal_and_a_team_goal():
    assert not _all_true(goal_levels={"team"})["goals"]["done"]
    assert not _all_true(goal_levels={"company"})["goals"]["done"]
    assert not _all_true(goal_levels={"individual", "team"})["goals"]["done"]
    assert _all_true(goal_levels={"department", "team"})["goals"]["done"]


def test_log_step_is_the_first_logged_one_on_one():
    assert not _all_true(logged=False)["log"]["done"]


# ---- build_status against a fake client -------------------------------------


class _Not:
    def __init__(self, q):
        self.q = q

    def is_(self, field, _null):
        self.q.filters.append(lambda r, f=field: r.get(f) is not None)
        return self.q


class _Q:
    def __init__(self, rows):
        self.rows, self.filters, self.values, self.cap = rows, [], None, None

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

    def table(self, name):
        return _Q(self.tables[name])


def _tables(**over):
    t = {
        "users": [{"id": "m", "onboarded_at": None, "knowledge_skipped_at": None}],
        "direct_reports": [{"id": "p1", "manager_id": "m", "role_level_id": "r1", "org_unit_id": "u1", "archived_at": None}],
        "org_units": [{"id": "u1"}],
        "documents": [{"id": "d", "status": "confirmed"}],
        "goals": [{"level": "company", "status": "active"}, {"level": "team", "status": "active"}],
        "one_on_ones": [{"id": "s", "manager_id": "m", "summary": "held"}],
    }
    t.update(over)
    return t


@pytest.fixture(autouse=True)
def _coverage_and_events(monkeypatch):
    monkeypatch.setattr(onboarding, "_compute_coverage", lambda _c: {"roles": [{"role_level_id": "r1", "metrics_count": 2, "skills_count": 0, "values_count": 0}]})
    sent = []
    monkeypatch.setattr(onboarding.analytics, "capture", lambda uid, ev, props=None: sent.append((uid, ev, props)))
    return sent


def test_complete_account_is_stamped_once_and_stays_onboarded(_coverage_and_events):
    tables = _tables()
    client = _Client(tables)

    first = build_status("m", client)
    assert first["onboarded"] is True and first["done_count"] == 5
    assert tables["users"][0]["onboarded_at"]
    assert _coverage_and_events == [("m", "onboarded", {"knowledge_skipped": False})]

    # A goal archived later must not take it back, and no second event fires.
    tables["goals"].clear()
    second = build_status("m", client)
    assert second["onboarded"] is True and second["steps"] is None
    assert len(_coverage_and_events) == 1


def test_incomplete_account_reports_progress_and_is_not_stamped(_coverage_and_events):
    tables = _tables(goals=[{"level": "team", "status": "active"}], one_on_ones=[])
    status = build_status("m", _Client(tables))
    assert status["onboarded"] is False
    assert status["done_count"] == 3
    assert status["steps"]["goals"]["has_org_goal"] is False
    assert status["steps"]["log"]["done"] is False
    assert tables["users"][0]["onboarded_at"] is None
    assert _coverage_and_events == []


def test_cancelled_goals_do_not_count():
    tables = _tables(goals=[{"level": "company", "status": "cancelled"}, {"level": "team", "status": "active"}])
    assert build_status("m", _Client(tables))["steps"]["goals"]["done"] is False


def test_archived_reports_and_unsummarised_sessions_do_not_count():
    tables = _tables(
        direct_reports=[{"id": "p1", "manager_id": "m", "role_level_id": "r1", "org_unit_id": "u1", "archived_at": "2026-09-01"}],
        one_on_ones=[{"id": "s", "manager_id": "m", "summary": None}],
    )
    steps = build_status("m", _Client(tables))["steps"]
    assert steps["org"]["done"] is False
    assert steps["log"]["done"] is False


def test_nothing_to_import_completes_the_knowledge_step():
    tables = _tables(documents=[])
    tables["users"][0]["knowledge_skipped_at"] = "2026-09-29T00:00:00+00:00"
    steps = build_status("m", _Client(tables))["steps"] or {}
    # All five hold, so the account is stamped and the endpoint short-circuits next call.
    assert tables["users"][0]["onboarded_at"]
    assert steps["knowledge"]["skipped"] is True
