import json
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from mission_control_engine import build_brief


FIXTURE_PATH = Path(__file__).parent / "fixtures" / "mission_control_reference.json"
FIXTURES = json.loads(FIXTURE_PATH.read_text())
TODAY = date.fromisoformat(FIXTURES["anchor_date"])
NOW = datetime(2026, 8, 24, 16, tzinfo=timezone.utc)


def scenario(name: str):
    return deepcopy(FIXTURES["scenarios"][name])


def test_normal_week_is_stable_and_action_first():
    first = build_brief(scenario("normal"), TODAY, now=NOW)
    second = build_brief(scenario("normal"), TODAY, now=NOW)
    assert first == second
    assert first["mode"] == "normal"
    assert first["primary"]["candidate_type"] == "resume_one_on_one_prep"
    assert first["primary"]["entity_id"] == "leah"
    assert len(first["secondary"]) == 2
    assert first["truth_signal"]["kind"] == "progress"


def test_busy_week_never_exposes_more_than_three_items():
    brief = build_brief(scenario("busy"), TODAY, now=NOW)
    assert brief["mode"] == "busy"
    assert brief["eligible_count"] > 3
    assert len([brief["primary"], *brief["secondary"]]) == 3


def test_early_use_makes_no_team_judgment():
    brief = build_brief(scenario("early"), TODAY, now=NOW)
    assert brief["mode"] == "early_use"
    assert brief["primary"]["candidate_type"] == "start_due_one_on_one_prep"
    assert brief["truth_signal"]["kind"] == "limited"
    assert brief["optional_context"] is not None


def test_all_clear_requires_complete_core_coverage():
    clear = build_brief(scenario("all_clear"), TODAY, now=NOW)
    assert clear["mode"] == "all_clear"
    assert clear["primary"] is None
    partial_snapshot = scenario("all_clear")
    partial_snapshot["coverage"]["goals"] = "unavailable"
    partial = build_brief(partial_snapshot, TODAY, now=NOW)
    assert partial["mode"] == "partial"
    assert partial["truth_signal"]["kind"] != "all_clear"


def test_new_goal_without_check_in_is_not_immediately_stale():
    snapshot = scenario("all_clear")
    snapshot["goals"].append({"id": "new", "title": "New goal", "status": "active", "due_date": None, "created_at": TODAY.isoformat()})
    brief = build_brief(snapshot, TODAY, now=NOW)
    assert all(candidate["entity_id"] != "new" for candidate in [brief["primary"], *brief["secondary"]] if candidate)


def test_status_conflict_is_inspectable_and_not_resolved_silently():
    snapshot = scenario("all_clear")
    snapshot["projects"][0]["status"] = "on_track"
    snapshot["check_ins"][1]["status"] = "at_risk"
    brief = build_brief(snapshot, TODAY, now=NOW)
    assert brief["primary"]["candidate_type"] == "project_status_integrity"
    assert brief["primary"]["evidence"][0]["code"] == "status_conflict"


def test_missing_commitment_due_date_never_becomes_urgent():
    snapshot = scenario("all_clear")
    snapshot["commitments"].append({"id": "undated", "direct_report_id": "leah", "status": "open", "committed_by": "manager", "due_date": None, "created_at": "2026-01-01T12:00:00Z", "completed_at": None})
    brief = build_brief(snapshot, TODAY, now=NOW)
    assert brief["mode"] == "all_clear"


def test_capacity_only_corroborates_a_dated_commitment():
    snapshot = scenario("all_clear")
    snapshot["capacity"]["leah"] = {"actual_time_off_hours": 24}
    assert build_brief(snapshot, TODAY, now=NOW)["mode"] == "all_clear"
    snapshot["commitments"][0]["due_date"] = (TODAY + timedelta(days=2)).isoformat()
    brief = build_brief(snapshot, TODAY, now=NOW)
    assert brief["primary"]["candidate_type"] == "commitment_follow_up"
    assert any(item["code"] == "logged_time_off" for item in brief["primary"]["evidence"])


def test_capacity_cannot_corroborate_when_either_domain_is_partial():
    snapshot = scenario("all_clear")
    snapshot["capacity"]["leah"] = {"actual_time_off_hours": 24}
    snapshot["commitments"][0]["due_date"] = (TODAY + timedelta(days=2)).isoformat()
    snapshot["coverage"]["capacity"] = "unavailable"
    brief = build_brief(snapshot, TODAY, now=NOW)
    assert all(item["code"] != "logged_time_off" for item in brief["primary"]["evidence"])


def test_dispositions_suppress_only_the_exact_fingerprint():
    initial = build_brief(scenario("normal"), TODAY, now=NOW)
    primary = initial["primary"]
    event = {
        "event_type": "addressed",
        "candidate_key": primary["candidate_key"],
        "evidence_fingerprint": primary["evidence_fingerprint"],
        "created_at": NOW.isoformat(),
    }
    suppressed = build_brief(scenario("normal"), TODAY, events=[event], now=NOW)
    assert suppressed["primary"]["candidate_key"] != primary["candidate_key"]
    changed = scenario("normal")
    changed["commitments"][0]["due_date"] = "2026-08-24"
    resurfaced = build_brief(changed, TODAY, events=[event], now=NOW)
    assert resurfaced["primary"]["candidate_key"] == primary["candidate_key"]
    assert resurfaced["primary"]["evidence_fingerprint"] != primary["evidence_fingerprint"]


def test_active_snooze_suppresses_and_expired_snooze_restores():
    initial = build_brief(scenario("normal"), TODAY, now=NOW)
    primary = initial["primary"]
    base = {
        "event_type": "snoozed",
        "candidate_key": primary["candidate_key"],
        "evidence_fingerprint": primary["evidence_fingerprint"],
        "created_at": NOW.isoformat(),
    }
    active = {**base, "snoozed_until": (NOW + timedelta(days=1)).isoformat()}
    expired = {**base, "snoozed_until": (NOW - timedelta(minutes=1)).isoformat()}
    assert build_brief(scenario("normal"), TODAY, events=[active], now=NOW)["primary"]["candidate_key"] != primary["candidate_key"]
    assert build_brief(scenario("normal"), TODAY, events=[expired], now=NOW)["primary"]["candidate_key"] == primary["candidate_key"]


def test_early_use_setup_context_can_be_dismissed_without_changing_setup():
    initial = build_brief(scenario("early"), TODAY, now=NOW)
    context = initial["optional_context"]
    event = {
        "event_type": "setup_dismissed_today",
        "candidate_key": context["candidate_key"],
        "evidence_fingerprint": context["evidence_fingerprint"],
        "snoozed_until": (NOW + timedelta(days=1)).isoformat(),
        "created_at": NOW.isoformat(),
    }
    dismissed = build_brief(scenario("early"), TODAY, events=[event], now=NOW)
    assert dismissed["optional_context"] is None
    assert dismissed["primary"] == initial["primary"]


def test_linked_goal_and_project_review_use_one_slot():
    snapshot = scenario("normal")
    snapshot["check_ins"][1]["created_at"] = "2026-08-01T12:00:00Z"
    brief = build_brief(snapshot, TODAY, now=NOW)
    work = [candidate for candidate in [brief["primary"], *brief["secondary"]] if candidate and candidate["entity_type"] in {"goal", "project"}]
    assert len(work) == 1
    assert any(item["code"] == "linked_work_review" for item in work[0]["evidence"])
