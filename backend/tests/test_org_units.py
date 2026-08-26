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
