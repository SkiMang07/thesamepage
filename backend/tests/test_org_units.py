from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from routes.org_units import (
    _clean_name,
    _validate_leader_assignment,
    _validate_parent_assignment,
)


class _RowsQuery:
    def __init__(self, rows):
        self.rows = rows
        self.filters = []
        self.limit_count = None

    def select(self, *_args):
        return self

    def eq(self, field, value):
        self.filters.append(lambda row, f=field, v=value: row.get(f) == v)
        return self

    def limit(self, count):
        self.limit_count = count
        return self

    def execute(self):
        matched = [row for row in self.rows if all(predicate(row) for predicate in self.filters)]
        if self.limit_count is not None:
            matched = matched[: self.limit_count]
        return SimpleNamespace(data=[{**row} for row in matched])


class _RowsClient:
    def __init__(self):
        self.rows = {
            "org_units": [
                {"id": "department", "parent_unit_id": None},
                {"id": "team", "parent_unit_id": "department"},
                {"id": "squad", "parent_unit_id": "team"},
            ],
            "users": [{"id": "member"}],
        }

    def table(self, name):
        return _RowsQuery(self.rows[name])


def test_parent_assignment_rejects_every_depth_of_cycle():
    client = _RowsClient()

    with pytest.raises(HTTPException) as exc:
        _validate_parent_assignment(client, "department", "squad")

    assert exc.value.status_code == 422
    assert "descendants" in exc.value.detail


def test_parent_assignment_allows_a_safe_move():
    client = _RowsClient()
    _validate_parent_assignment(client, "squad", "department")


def test_parent_and_leader_must_resolve_inside_visible_org_scope():
    client = _RowsClient()

    with pytest.raises(HTTPException, match="Parent unit not found"):
        _validate_parent_assignment(client, "team", "missing")
    with pytest.raises(HTTPException, match="Leader must be a member"):
        _validate_leader_assignment(client, "outsider")

    _validate_leader_assignment(client, "member")


def test_org_unit_name_is_trimmed_and_cannot_be_blank():
    assert _clean_name("  Customer Success  ") == "Customer Success"
    with pytest.raises(HTTPException, match="name cannot be empty"):
        _clean_name("   ")


def test_members_mark_only_the_caller():
    from routes.org_units import _mark_caller

    rows = [{"id": "me", "full_name": "", "email": "a@x.co"}, {"id": "them", "full_name": "Sam", "email": "s@x.co"}]
    marked = _mark_caller(rows, "me")
    assert [r["is_you"] for r in marked] == [True, False]
    assert rows[0].get("is_you") is None  # input rows are not mutated


# ---- setup (step 4): your own unit -------------------------------------------

from routes.org_units import SetupUnitIn, setup_plan


def _u(uid, kind, parent=None, leader=None, name=None):
    return {"id": uid, "name": name or uid, "unit_type": kind, "parent_unit_id": parent, "leader_user_id": leader}


def test_setup_creates_your_team_under_your_bosss_group():
    plan = setup_plan([], "m", SetupUnitIn(path="team", name="  Enterprise  ", parent_name="Customer Success"))
    assert plan == {
        "unit": {"id": None, "name": "Enterprise", "unit_type": "team"},
        "parent": {"id": None, "name": "Customer Success"},
    }


def test_setup_reuses_a_department_of_the_same_name_above_you():
    units = [_u("cs", "department", name="Customer Success")]
    plan = setup_plan(units, "m", SetupUnitIn(path="team", name="Enterprise", parent_name="customer success"))
    assert plan["parent"] == {"id": "cs", "name": "Customer Success"}


def test_setup_claims_an_existing_unit_and_its_type_follows_the_answer():
    # Susie made her group a Department before setup asked; she answers My team.
    units = [_u("s", "department", name="Support")]
    plan = setup_plan(units, "m", SetupUnitIn(path="team", existing_unit_id="s"))
    assert plan["unit"] == {"id": "s", "name": "Support", "unit_type": "team"}
    assert plan["parent"] is None


def test_setup_will_not_take_a_unit_someone_else_leads():
    with pytest.raises(HTTPException) as err:
        setup_plan([_u("s", "team", leader="other")], "m", SetupUnitIn(path="team", existing_unit_id="s"))
    assert err.value.status_code == 409


def test_setup_will_not_turn_a_department_with_teams_into_a_team():
    units = [_u("d", "department"), _u("t", "team", parent="d")]
    with pytest.raises(HTTPException) as err:
        setup_plan(units, "m", SetupUnitIn(path="team", existing_unit_id="d"))
    assert err.value.status_code == 409


def test_setup_ignores_a_parent_name_when_the_claimed_unit_already_has_a_parent():
    units = [_u("cs", "department"), _u("t", "team", parent="cs")]
    plan = setup_plan(units, "m", SetupUnitIn(path="team", existing_unit_id="t", parent_name="Something else"))
    assert plan["parent"] is None


def test_setup_needs_a_name_and_a_different_one_above():
    with pytest.raises(HTTPException):
        setup_plan([], "m", SetupUnitIn(path="department", name="   "))
    with pytest.raises(HTTPException):
        setup_plan([], "m", SetupUnitIn(path="team", name="Ops", parent_name="ops"))


class _WriteQuery:
    def __init__(self, store, name):
        self.store, self.name, self.op, self.payload, self.filters = store, name, "select", None, []

    def select(self, *_a):
        return self

    def insert(self, payload):
        self.op, self.payload = "insert", payload
        return self

    def update(self, payload):
        self.op, self.payload = "update", payload
        return self

    def eq(self, field, value):
        self.filters.append((field, value))
        return self

    def execute(self):
        rows = self.store[self.name]
        if self.op == "insert":
            row = {"id": f"new{len(rows)}", "parent_unit_id": None, "leader_user_id": None, **self.payload}
            rows.append(row)
            return SimpleNamespace(data=[dict(row)])
        hit = [r for r in rows if all(r.get(f) == v for f, v in self.filters)]
        if self.op == "update":
            for r in hit:
                r.update(self.payload)
        return SimpleNamespace(data=[dict(r) for r in hit])


class _WriteClient:
    def __init__(self, units):
        self.store = {"org_units": units}

    def table(self, name):
        return _WriteQuery(self.store, name)


def _no_org(monkeypatch):
    import routes.org_units as ou

    monkeypatch.setattr(ou, "ensure_org", lambda *a, **k: "org1")
    monkeypatch.setattr(ou, "get_email_from_token", lambda *_a: "m@example.com")
    return ou


def test_setup_endpoint_writes_your_team_led_by_you_under_a_new_group(monkeypatch):
    ou = _no_org(monkeypatch)
    client = _WriteClient([])
    out = ou.setup_own_unit(SetupUnitIn(path="team", name="Enterprise", parent_name="Customer Success"), ("m", client), "Bearer x")
    units = {u["name"]: u for u in client.store["org_units"]}
    assert units["Customer Success"]["unit_type"] == "department" and units["Customer Success"]["leader_user_id"] is None
    assert units["Enterprise"] == {**units["Enterprise"], "unit_type": "team", "leader_user_id": "m", "parent_unit_id": units["Customer Success"]["id"]}
    assert out["unit"]["id"] == units["Enterprise"]["id"]


def test_setup_endpoint_claims_an_existing_department_as_your_team(monkeypatch):
    ou = _no_org(monkeypatch)
    client = _WriteClient([_u("s", "department", name="Support")])
    ou.setup_own_unit(SetupUnitIn(path="team", existing_unit_id="s"), ("m", client), "Bearer x")
    assert client.store["org_units"] == [_u("s", "team", leader="m", name="Support")]


def test_boss_group_goes_above_the_unit_you_lead(monkeypatch):
    ou = _no_org(monkeypatch)
    client = _WriteClient([_u("t", "team", leader="m", name="Enterprise"), _u("x", "team", name="Other")])
    group = ou.setup_group_above(ou.AboveUnitIn(name="Customer Success"), ("m", client), "Bearer x")
    by_id = {u["id"]: u for u in client.store["org_units"]}
    assert group["unit_type"] == "department"
    assert by_id["t"]["parent_unit_id"] == group["id"] and by_id["x"]["parent_unit_id"] is None
