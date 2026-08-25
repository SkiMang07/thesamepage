from __future__ import annotations

import re
import sys
from datetime import date, timedelta
from pathlib import Path


SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from forkcast_demo_data import (  # noqa: E402
    SYNTHETIC_MANAGERS,
    build_demo_data,
    seed_id,
    validate_demo_data,
)
from seed_forkcast_demo import _is_service_role_key


def _dataset(anchor: date = date(2026, 8, 25)):
    keys = ["demo", *SYNTHETIC_MANAGERS]
    manager_ids = {key: seed_id(f"test-auth:{key}") for key in keys}
    manager_emails = {
        "demo": "demo-manager@example.com",
        **{key: profile["email"] for key, profile in SYNTHETIC_MANAGERS.items()},
    }
    return build_demo_data(anchor, manager_ids, manager_emails), manager_ids


def test_forkcast_dataset_is_valid_and_deterministic():
    first, _ = _dataset()
    second, _ = _dataset()

    assert first == second
    assert validate_demo_data(first) == []
    assert sum(len(rows) for rows in first.values()) == 462


def test_live_key_guard_accepts_only_privileged_key_shapes():
    assert _is_service_role_key("sb_secret_project-specific-value")
    assert not _is_service_role_key("sb_publishable_public-value")
    assert not _is_service_role_key("not-a-key")


def test_primary_manager_has_seven_people_and_mixed_performance():
    rows, manager_ids = _dataset()
    reports = [row for row in rows["direct_reports"] if row["manager_id"] == manager_ids["demo"]]
    report_ids = {row["id"] for row in reports}

    assert len(reports) == 7
    assert {row["email"].split("@", 1)[1] for row in reports} == {"forkcast.example"}

    latest = {}
    for assessment in sorted(rows["assessments"], key=lambda row: row["created_at"]):
        if assessment["direct_report_id"] in report_ids:
            latest[assessment["direct_report_id"]] = assessment["level_ordinal"]
    assert {2, 3, 4} <= set(latest.values())


def test_mina_story_is_connected_across_prep_commitments_and_work():
    rows, _ = _dataset()
    mina = next(row for row in rows["direct_reports"] if row["name"] == "Mina Okafor")
    planned = next(
        row
        for row in rows["one_on_ones"]
        if row["direct_report_id"] == mina["id"] and row["prep_guide"] is not None
    )
    prep_commitment_ids = {
        item["id"] for item in planned["prep_guide"]["open_commitments_to_check"]
    }
    live_commitment_ids = {
        row["id"]
        for row in rows["commitments"]
        if row["direct_report_id"] == mina["id"] and row["status"] == "open"
    }
    copper_goal = next(row for row in rows["goals"] if row["title"] == "Stabilize the Copper Kettle rollout")
    copper_project = next(row for row in rows["projects"] if row["title"] == "Copper Kettle rollout recovery")

    assert prep_commitment_ids <= live_commitment_ids
    assert planned["prep_guide"]["agenda_items"][-1]["title"] == "Anything else?"
    assert copper_goal["direct_report_id"] == mina["id"]
    assert copper_project["direct_report_id"] == mina["id"]
    assert copper_project["goal_id"] == copper_goal["id"]
    assert copper_project["status"] == "at_risk"


def test_seed_has_unsuppressed_mission_control_candidates():
    anchor = date(2026, 8, 25)
    rows, _ = _dataset(anchor)

    open_due_soon = [
        row
        for row in rows["commitments"]
        if row["status"] == "open"
        and row["due_date"]
        and date.fromisoformat(row["due_date"]) <= anchor + timedelta(days=7)
    ]
    at_risk_due_soon = [
        row
        for row in [*rows["goals"], *rows["projects"]]
        if row["status"] == "at_risk"
        and row["due_date"]
        and date.fromisoformat(row["due_date"]) <= anchor + timedelta(days=14)
    ]
    planned_sessions = [row for row in rows["one_on_ones"] if row["prep_guide"] and row["summary"] is None]

    assert open_due_soon
    assert at_risk_due_soon
    assert planned_sessions
    assert "mission_control_events" not in rows


def test_anchor_moves_dates_without_changing_identity():
    first, _ = _dataset(date(2026, 8, 25))
    second, _ = _dataset(date(2026, 9, 1))

    first_commitments = {row["id"]: row["due_date"] for row in first["commitments"]}
    second_commitments = {row["id"]: row["due_date"] for row in second["commitments"]}
    assert first_commitments.keys() == second_commitments.keys()
    for row_id, first_due in first_commitments.items():
        assert date.fromisoformat(second_commitments[row_id]) - date.fromisoformat(first_due) == timedelta(days=7)


def test_every_seed_field_exists_in_current_schema():
    schema_path = Path(__file__).resolve().parents[2] / "database" / "schema.sql"
    schema = schema_path.read_text()
    columns = {}
    for match in re.finditer(r"(?ims)^create table\s+(\w+)\s*\((.*?)^\);", schema):
        table, body = match.groups()
        table_columns = set()
        for line in body.splitlines():
            column = re.match(r"^\s{2}([a-z_][a-z0-9_]*)\s+", line)
            if column and column.group(1) not in {"constraint", "primary", "unique", "check", "foreign"}:
                table_columns.add(column.group(1))
        columns[table] = table_columns

    rows, _ = _dataset()
    for table, table_rows in rows.items():
        assert table in columns
        for row in table_rows:
            assert set(row) <= columns[table]
