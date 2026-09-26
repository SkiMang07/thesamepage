"""C3 — get_entity_context packets for goals, projects and org units."""
import os
from datetime import date

import pytest
from fastapi import HTTPException

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-key")

import scribe_citations as sc
from assistant_engine import TOOLS
from routes.assistant import AssistantMessageIn, _validated_page_context
from scribe_context import get_entity_context

TODAY = date(2026, 9, 26)


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, rows):
        self.rows = [dict(row) for row in rows]
        self.filters = []
        self.ordering = []
        self.row_limit = None

    def select(self, _columns):
        return self

    def eq(self, column, value):
        self.filters.append(lambda row, c=column, v=value: str(row.get(c)) == str(v))
        return self

    def in_(self, column, values):
        allowed = {str(value) for value in values}
        self.filters.append(lambda row, c=column, a=allowed: str(row.get(c)) in a)
        return self

    def is_(self, column, value):
        assert value == "null"
        self.filters.append(lambda row, c=column: row.get(c) is None)
        return self

    def order(self, column, desc=False):
        self.ordering.append((column, desc))
        return self

    def limit(self, value):
        self.row_limit = value
        return self

    def execute(self):
        rows = [row for row in self.rows if all(predicate(row) for predicate in self.filters)]
        for column, desc in reversed(self.ordering):
            rows.sort(key=lambda row: str(row.get(column) or ""), reverse=desc)
        if self.row_limit is not None:
            rows = rows[: self.row_limit]
        return _Result(rows)


class _Supabase:
    def __init__(self, tables):
        self.tables = tables

    def table(self, name):
        return _Query(self.tables.get(name, []))


@pytest.fixture
def db():
    return _Supabase({
        "org_units": [
            {"id": "u-cs", "name": "Customer Success", "unit_type": "department", "parent_unit_id": None},
            {"id": "u-na", "name": "North America", "unit_type": "team", "parent_unit_id": "u-cs"},
            {"id": "u-latam", "name": "LATAM", "unit_type": "team", "parent_unit_id": "u-cs"},
            {"id": "u-eng", "name": "Engineering", "unit_type": "department", "parent_unit_id": None},
        ],
        "direct_reports": [
            {"id": "dr-beth", "manager_id": "m1", "name": "Beth", "role_title": "CSM",
             "org_unit_id": "u-na", "archived_at": None, "notes": "PRIVATE profile note"},
            {"id": "dr-izzy", "manager_id": "m1", "name": "Izzy", "role_title": "CSM",
             "org_unit_id": "u-latam", "archived_at": None, "notes": None},
            {"id": "dr-gone", "manager_id": "m1", "name": "Gone", "role_title": "CSM",
             "org_unit_id": "u-na", "archived_at": "2026-01-01T00:00:00Z"},
            {"id": "dr-other", "manager_id": "m2", "name": "Other", "role_title": "CSM",
             "org_unit_id": "u-na", "archived_at": None},
            {"id": "dr-eng", "manager_id": "m1", "name": "Eli", "role_title": "Engineer",
             "org_unit_id": "u-eng", "archived_at": None},
        ],
        "goals": [
            {"id": "g-nrr", "owner_id": "m1", "title": "Improve NRR", "level": "department",
             "org_unit_id": "u-cs", "status": "active", "parent_goal_id": None,
             "measure_label": "NRR", "measure_format": "percent", "measure_unit": None,
             "measure_target": 110, "measure_direction": "at_least", "created_at": "2026-07-01"},
            {"id": "g-na", "owner_id": "m1", "title": "NA renewals", "level": "team",
             "org_unit_id": "u-na", "status": "at_risk", "parent_goal_id": "g-nrr", "created_at": "2026-07-02"},
            {"id": "g-other", "owner_id": "m2", "title": "Someone else's goal", "level": "team",
             "org_unit_id": "u-na", "status": "active", "parent_goal_id": "g-nrr", "created_at": "2026-07-03"},
        ],
        "projects": [
            {"id": "p-play", "owner_id": "m1", "title": "Renewal playbook", "goal_id": "g-nrr",
             "org_unit_id": "u-na", "direct_report_id": "dr-beth", "status": "on_track", "created_at": "2026-07-05"},
            {"id": "p-other", "owner_id": "m2", "title": "Hidden project", "goal_id": "g-nrr",
             "org_unit_id": "u-na", "status": "active", "created_at": "2026-07-05"},
        ],
        "check_ins": [
            {"id": "ci-1", "owner_id": "m1", "goal_id": "g-nrr", "status": "active",
             "measured_value": 104, "note": "Q3 reading", "created_at": "2026-09-01T00:00:00Z"},
            {"id": "ci-2", "owner_id": "m1", "goal_id": "g-nrr", "status": "active",
             "measured_value": None, "note": "Still waiting on finance", "created_at": "2026-09-20T00:00:00Z"},
            {"id": "ci-3", "owner_id": "m1", "project_id": "p-play", "status": "on_track",
             "progress": 60, "created_at": "2026-09-18T00:00:00Z"},
            {"id": "ci-4", "owner_id": "m1", "goal_id": "g-na", "status": "at_risk",
             "created_at": "2026-09-10T00:00:00Z"},
        ],
        "commitments": [
            {"id": "c-goal", "owner_id": "m1", "source_type": "goal", "source_id": "g-nrr",
             "description": "Send NRR model", "status": "open", "due_date": "2026-09-30",
             "direct_report_id": "dr-beth", "created_at": "2026-09-01"},
            {"id": "c-proj", "owner_id": "m1", "source_type": "project", "source_id": "p-play",
             "description": "Draft playbook", "status": "done", "direct_report_id": "dr-beth",
             "created_at": "2026-09-02"},
            {"id": "c-beth-overdue", "owner_id": "m1", "direct_report_id": "dr-beth",
             "description": "x", "status": "open", "due_date": "2026-09-01", "created_at": "2026-08-01"},
            {"id": "c-team", "owner_id": "m1", "is_team_commitment": True, "org_unit_id": "u-latam",
             "description": "Share LATAM pricing", "status": "open", "due_date": "2026-10-03",
             "direct_report_id": "dr-izzy", "created_at": "2026-09-22"},
        ],
        "one_on_ones": [
            {"id": "o1", "direct_report_id": "dr-beth", "scheduled_at": "2026-09-23T12:00:00Z",
             "notes": "PRIVATE 1:1 notes"},
            {"id": "o2", "direct_report_id": "dr-beth", "scheduled_at": "2026-09-30T12:00:00Z"},
        ],
        "team_meetings": [
            {"id": "tm-1", "manager_id": "m1", "org_unit_id": "u-na", "scheduled_at": "2026-09-22T12:00:00Z",
             "summary": "Agreed renewal owners", "raw_notes": "RAW NOTES"},
            {"id": "tm-2", "manager_id": "m2", "org_unit_id": "u-na", "scheduled_at": "2026-09-21T12:00:00Z",
             "summary": "Other manager's meeting"},
        ],
        "team_meeting_agenda_items": [
            {"id": "a1", "meeting_id": "tm-1", "manager_id": "m1", "position": 0,
             "item": "Renewal risks", "covered": True, "notes": "item notes"},
        ],
        "team_callouts": [
            {"id": "tc-1", "manager_id": "m1", "org_unit_id": "u-na", "message": "Freeze on discounts",
             "updated_at": "2026-09-20"},
            {"id": "tc-2", "manager_id": "m1", "org_unit_id": "u-latam", "message": "  ", "updated_at": "2026-09-20"},
        ],
        "time_off_entries": [
            {"id": "t1", "direct_report_id": "dr-izzy", "start_date": "2026-10-05", "end_date": "2026-10-09", "type": "pto"},
            {"id": "t2", "direct_report_id": "dr-izzy", "start_date": "2026-12-20", "end_date": "2026-12-31", "type": "pto"},
            {"id": "t3", "direct_report_id": "dr-beth", "start_date": "2026-08-01", "end_date": "2026-08-05", "type": "pto"},
        ],
    })


def test_goal_packet_is_owner_scoped_and_reports_measure_as_data(db):
    packet = get_entity_context(db, "m1", "goal", "g-nrr", today=TODAY)
    assert packet["goal"]["_source"]["ref"] == "goal:g-nrr"
    assert packet["measure"]["target"] == 110
    assert packet["measure"]["latest_reading"] == 104
    assert packet["measure"]["readings_recorded"] == 1
    assert [g["id"] for g in packet["child_goals"]] == ["g-na"]
    assert packet["child_goals"][0]["latest_check_in"]["id"] == "ci-4"
    assert [p["id"] for p in packet["linked_projects"]] == ["p-play"]
    assert packet["linked_projects"][0]["latest_check_in"]["progress"] == 60
    assert [c["id"] for c in packet["check_ins"]] == ["ci-2", "ci-1"]
    assert [c["id"] for c in packet["commitments"]] == ["c-goal", "c-proj"]
    assert {p["id"] for p in packet["related_people"]} == {"dr-beth"}


def test_goal_and_project_outside_manager_scope_are_404(db):
    for kind, record in (("goal", "g-other"), ("project", "p-other"), ("goal", "missing")):
        with pytest.raises(HTTPException) as exc:
            get_entity_context(db, "m1", kind, record, today=TODAY)
        assert exc.value.status_code == 404


def test_unknown_entity_type_is_rejected(db):
    with pytest.raises(HTTPException) as exc:
        get_entity_context(db, "m1", "direct_report", "dr-beth", today=TODAY)
    assert exc.value.status_code == 422


def test_project_packet_carries_linked_goal_and_owner(db):
    packet = get_entity_context(db, "m1", "project", "p-play", today=TODAY)
    assert packet["owner_person"]["name"] == "Beth"
    assert packet["org_unit"]["name"] == "North America"
    assert packet["linked_goal"]["id"] == "g-nrr"
    assert packet["linked_goal"]["measure"]["latest_reading"] == 104
    assert [c["id"] for c in packet["commitments"]] == ["c-proj"]


def test_department_packet_rolls_up_subtree_with_only_managers_records(db):
    packet = get_entity_context(db, "m1", "org_unit", "u-cs", today=TODAY)
    assert [u["id"] for u in packet["units_in_scope"]] == ["u-cs", "u-latam", "u-na"]
    assert "other managers" in packet["coverage"]
    assert [p["name"] for p in packet["roster"]] == ["Beth", "Izzy"]  # no archived, no m2, no Eng
    beth = packet["roster"][0]
    assert beth["last_one_on_one_date"] == "2026-09-23"
    assert beth["next_one_on_one_date"] == "2026-09-30"
    assert beth["open_commitments"] == 2 and beth["overdue_commitments"] == 1
    assert {g["id"] for g in packet["goals"]} == {"g-nrr", "g-na"}
    assert [p["id"] for p in packet["projects"]] == ["p-play"]
    assert [m["id"] for m in packet["team_meetings"]] == ["tm-1"]
    assert packet["team_meetings"][0]["agenda_items"] == [{"item": "Renewal risks", "covered": True}]
    assert [c["id"] for c in packet["team_commitments"]] == ["c-team"]
    assert [c["id"] for c in packet["must_knows"]] == ["tc-1"]
    assert [t["id"] for t in packet["upcoming_time_off"]] == ["t1"]


def test_team_packet_leaves_out_private_and_raw_text(db):
    packet = get_entity_context(db, "m1", "org_unit", "u-na", today=TODAY)
    text = repr(packet)
    for private in ("PRIVATE profile note", "PRIVATE 1:1 notes", "RAW NOTES", "item notes"):
        assert private not in text
    assert [u["id"] for u in packet["units_in_scope"]] == ["u-na"]
    assert packet["parent_unit"]["id"] == "u-cs"


def test_missing_org_unit_is_404(db):
    with pytest.raises(HTTPException) as exc:
        get_entity_context(db, "m1", "org_unit", "u-nope", today=TODAY)
    assert exc.value.status_code == 404


def test_entity_packet_registers_every_citable_record(db):
    reg: sc.Registry = {}
    sc.collect("get_entity_context", get_entity_context(db, "m1", "org_unit", "u-cs", today=TODAY), reg)
    sc.collect("get_entity_context", get_entity_context(db, "m1", "project", "p-play", today=TODAY), reg)
    for key in (("org_unit", "u-cs"), ("org_unit", "u-na"), ("person", "dr-beth"),
                ("person", "dr-izzy"), ("goal", "g-nrr"), ("goal", "g-na"), ("project", "p-play")):
        assert key in reg
    assert reg[("org_unit", "u-latam")] == "LATAM"
    assert ("goal", "g-other") not in reg


def test_tool_is_declared_with_three_entity_types():
    tool = next(item for item in TOOLS if item["name"] == "get_entity_context")
    assert tool["input_schema"]["properties"]["entity_type"]["enum"] == ["goal", "project", "org_unit"]
    assert tool["input_schema"]["required"] == ["entity_type", "entity_id"]


def test_goal_and_org_unit_page_context_are_verified(db):
    goal_id = "22222222-2222-2222-2222-222222222222"
    unit_id = "33333333-3333-3333-3333-333333333333"
    supabase = _Supabase({
        "goals": [{"id": goal_id, "owner_id": "m1", "title": "Improve NRR"}],
        "org_units": [{"id": unit_id, "name": "LATAM"}],
    })
    goal_body = AssistantMessageIn(message="?", page_context_entity_type="goal", page_context_entity_id=goal_id)
    unit_body = AssistantMessageIn(message="?", page_context_entity_type="org_unit", page_context_entity_id=unit_id)
    assert _validated_page_context(supabase, "m1", goal_body) == f"Improve NRR [entity_type=goal, entity_id={goal_id}]"
    assert _validated_page_context(supabase, "m1", unit_body) == f"LATAM [entity_type=org_unit, entity_id={unit_id}]"
    with pytest.raises(HTTPException):
        _validated_page_context(supabase, "m2", goal_body)
