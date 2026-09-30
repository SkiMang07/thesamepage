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


# ---- setup: a way back to the next step (setup mode chunk D) -----------------


def _setup(**over):
    base = {
        "user_id": "11111111-1111-1111-1111-111111111111",
        "next_step": "goals",
        "done_count": 2,
        "total": 3,
        "card_level": "quiet",
        "changes": "Links each person’s work to the goals it serves.",
        "label": "Add company or department goals",
        "href": "/app/dashboard?setup=goals",
    }
    base.update(over)
    return base


def _all(brief):
    return [c for c in [brief["primary"], *brief["secondary"]] if c]


def test_setup_candidate_is_offered_only_when_the_card_is_not_full():
    for level in ("quiet", "hidden"):
        snapshot = scenario("all_clear")
        snapshot["setup"] = _setup(card_level=level)
        brief = build_brief(snapshot, TODAY, now=NOW)
        assert brief["primary"]["candidate_type"] == "resume_setup_step"
    snapshot = scenario("all_clear")
    snapshot["setup"] = _setup(card_level="full")
    assert build_brief(snapshot, TODAY, now=NOW)["primary"] is None
    snapshot = scenario("all_clear")
    snapshot["setup"] = None
    assert build_brief(snapshot, TODAY, now=NOW)["primary"] is None


def test_setup_candidate_carries_the_step_and_a_real_workflow_link():
    snapshot = scenario("all_clear")
    snapshot["setup"] = _setup()
    candidate = build_brief(snapshot, TODAY, now=NOW)["primary"]
    assert candidate["entity_type"] == "setup" and candidate["entity_id"] == "11111111-1111-1111-1111-111111111111"
    assert candidate["action"] == {"label": "Add company or department goals", "href": "/app/dashboard?setup=goals"}
    assert candidate["score"] == 10 and [c["code"] for c in candidate["rank_basis"]] == ["setup"]
    assert "5 of 6 steps are done" in candidate["explanation"]


def test_setup_ranks_below_anything_with_a_date_and_never_changes_the_mode():
    busy = scenario("busy")
    busy["setup"] = _setup()
    brief = build_brief(busy, TODAY, now=NOW)
    assert brief["mode"] == "busy"
    assert "resume_setup_step" not in [c["candidate_type"] for c in _all(brief)]
    normal = build_brief(scenario("normal") | {"setup": _setup()}, TODAY, now=NOW)
    without = build_brief(scenario("normal"), TODAY, now=NOW)
    assert _all(normal)[-1]["candidate_type"] == "resume_setup_step"
    above = [c["candidate_key"] for c in _all(normal)][:-1]
    assert above == [c["candidate_key"] for c in _all(without)][:len(above)]         # nothing above it moved
    displaced = _all(without)[len(above)]                                            # what it edged out has no date
    assert displaced["score"] <= 10 and "urgency" not in [b["code"] for b in displaced["rank_basis"]]
    assert normal["mode"] == without["mode"] == "normal"
    early = build_brief(scenario("early") | {"setup": _setup()}, TODAY, now=NOW)
    types = [c["candidate_type"] for c in _all(early)]
    assert types[0] == "start_due_one_on_one_prep" and types[-1] == "resume_setup_step"
    assert early["mode"] == "early_use"
    clear = scenario("all_clear")
    clear["setup"] = _setup()
    brief = build_brief(clear, TODAY, now=NOW)
    assert brief["mode"] == "all_clear" and brief["eligible_count"] == 0     # setup is not due work


def test_setup_candidate_can_be_dismissed_for_the_day_and_returns_when_a_step_completes():
    snapshot = scenario("all_clear")
    snapshot["setup"] = _setup()
    candidate = build_brief(snapshot, TODAY, now=NOW)["primary"]
    dismissed = [{
        "candidate_key": candidate["candidate_key"],
        "evidence_fingerprint": candidate["evidence_fingerprint"],
        "event_type": "setup_dismissed_today",
        "snoozed_until": (NOW + timedelta(hours=8)).isoformat(),
        "created_at": NOW.isoformat(),
    }]
    assert build_brief(deepcopy(snapshot), TODAY, events=dismissed, now=NOW)["primary"] is None
    later = NOW + timedelta(hours=9)
    assert build_brief(deepcopy(snapshot), TODAY, events=dismissed, now=later)["primary"] is not None
    moved_on = deepcopy(snapshot)
    moved_on["setup"] = _setup(next_step="org", done_count=1)      # a different step, a different fingerprint
    assert build_brief(moved_on, TODAY, events=dismissed, now=NOW)["primary"] is not None
