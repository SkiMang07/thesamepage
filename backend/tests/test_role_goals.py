"""From their role: a person's role expectations as their starting goals
(docs/GOAL_ATTRIBUTION_SCOPING.md Part B, docs/systems/goals.md).

Covers reading the role's bar, the live view, readings on metric_entries,
and goals that keep a link to the expectation they started from. Uses the
in-memory client from test_goals; the policy and constraints are verified
against local Postgres."""
import pytest
from fastapi import HTTPException

import expectation_bar as bar
import routes.goals as goals
import routes.role_goals as role_goals
from test_goals import ME, NO_MEASURE, OTHER, _DB

ROLE = {"id": "rl-support", "job_role": "Support Specialist", "job_level": 2}
METRICS = [
    {"id": "m-res", "metric_name": "Median resolution time", "expectation": "Median resolution at or below 8 hours",
     "target": "8 hours", "target_status": "set", "measurement_period": "month", "role_level_id": "rl-support"},
    {"id": "m-csat", "metric_name": "CSAT on cases they own", "expectation": "CSAT on owned cases",
     "target": "92% or above", "target_status": "set", "measurement_period": "month", "role_level_id": "rl-support"},
    {"id": "m-open", "metric_name": "First-contact resolution", "expectation": "Resolve on first contact",
     "target": None, "target_status": "unresolved", "measurement_period": "quarter", "role_level_id": "rl-support"},
]
SKILLS = [
    {"id": "s-esc", "skill_name": "Escalation handling", "area": "responsibility", "expectation": "Escalates the right cases"},
    {"id": "s-write", "skill_name": "Clear writing", "area": "skill", "expectation": "Writes clearly"},
]
VALUES = [{"id": "v-own", "value_name": "Ownership", "description": "Owns the outcome", "role_level_id": None}]
EXPECTATIONS = {"role_level": ROLE, "metrics": METRICS, "skills": SKILLS, "values": VALUES}


@pytest.fixture(autouse=True)
def _role(monkeypatch):
    def fetch(_supabase, role_level_id, org_id=None):
        return EXPECTATIONS if role_level_id == "rl-support" else None
    monkeypatch.setattr(role_goals, "fetch_role_expectations", fetch)
    monkeypatch.setattr(goals, "fetch_role_expectations", fetch)


def _goal_row(id_, **extra):
    base = {"id": id_, "owner_id": ME, "title": id_, "level": "individual", "status": "active",
            "org_unit_id": None, "direct_report_id": "dr-bram", "parent_goal_id": None, "description": None,
            "success_metrics": None, "due_date": None, "created_at": "2026-10-01",
            "source_metric_config_id": None, "source_skill_config_id": None, **NO_MEASURE}
    return {**base, **extra}


def _seed():
    return _DB({
        "direct_reports": [
            {"id": "dr-bram", "manager_id": ME, "name": "Bram", "role_level_id": "rl-support"},
            {"id": "dr-norole", "manager_id": ME, "name": "Ines", "role_level_id": None},
            {"id": "dr-theirs", "manager_id": OTHER, "name": "Theirs", "role_level_id": "rl-support"},
        ],
        "metric_entries": [
            {"id": "e1", "direct_report_id": "dr-bram", "metric_config_id": "m-res", "value": 9.5, "period": "Sep 2026",
             "recorded_at": "2026-10-01T10:00:00+00:00", "recorded_by": ME, "performance_review_id": None, "notes": None},
            {"id": "e2", "direct_report_id": "dr-bram", "metric_config_id": "m-res", "value": 7.2, "period": "Oct 2026",
             "recorded_at": "2026-10-15T10:00:00+00:00", "recorded_by": ME, "performance_review_id": None, "notes": None},
            {"id": "e3", "direct_report_id": "dr-bram", "metric_config_id": "m-csat", "value": 90, "period": "Q3 2026",
             "recorded_at": "2026-09-30T10:00:00+00:00", "recorded_by": ME, "performance_review_id": "pr-1", "notes": None},
        ],
        "metric_configs": [
            {"id": "m-old", "metric_name": "Tickets closed", "retired_at": "2026-10-10", "role_level_id": "rl-support"},
            *[{**m, "retired_at": None} for m in METRICS],
        ],
        "skill_configs": [{**s, "retired_at": None, "role_level_id": "rl-support"} for s in SKILLS],
        "goals": [
            _goal_row("g-stretch", title="CSAT 95% by end of Q4", source_metric_config_id="m-csat",
                      measure_label="CSAT", measure_format="percent", measure_unit="%", measure_target=95,
                      measure_direction="at_least"),
            _goal_row("g-own", title="Bring front-line feedback to the PMs' review"),
            _goal_row("g-retired", title="Close 40 tickets a week", source_metric_config_id="m-old"),
        ],
        "check_ins": [],
    })


def _auth(db):
    return (ME, db)


# --- reading the bar -----------------------------------------------------------

@pytest.mark.parametrize("target,expectation,expected", [
    ("8 hours", "Median resolution at or below 8 hours", {"value": 8, "direction": "at_most"}),
    ("92% or above", None, {"value": 92, "direction": "at_least"}),
    ("at least 20 calls", None, {"value": 20, "direction": "at_least"}),
    ("under 24h", None, {"value": 24, "direction": "at_most"}),
    ("1,200 or more", None, {"value": 1200, "direction": "at_least"}),
])
def test_bar_reads_one_number_and_a_stated_direction(target, expectation, expected):
    assert bar.parse_bar(target, expectation) == expected


@pytest.mark.parametrize("target,expectation", [
    ("8 hours", None),                       # no direction anywhere
    ("between 4 and 8 hours", None),         # two numbers
    ("8 hours", "at or below 8, above 2"),   # the meets wording names another number
    ("at least 8, at most 10", None),        # two numbers, both directions
    ("", None),
    (None, "92% or above"),
])
def test_bar_says_nothing_when_it_is_ambiguous(target, expectation):
    assert bar.parse_bar(target, expectation) is None


def test_verdict_is_factual_and_needs_a_reading():
    assert bar.verdict(7.2, {"value": 8, "direction": "at_most"}) == "meets"
    assert bar.verdict(9.5, {"value": 8, "direction": "at_most"}) == "below"
    assert bar.verdict(92, {"value": 92, "direction": "at_least"}) == "meets"
    assert bar.verdict(None, {"value": 92, "direction": "at_least"}) is None
    assert bar.verdict(90, None) is None


# --- the live view -------------------------------------------------------------

def test_live_view_reads_the_role_with_latest_readings_and_linked_goals():
    view = role_goals.get_role_goals("dr-bram", auth=_auth(_seed()))
    assert view["role"]["job_role"] == "Support Specialist"
    res, csat, fcr = view["measured"]
    assert res["latest"]["value"] == 7.2 and res["latest"]["period"] == "Oct 2026"
    assert res["reading_count"] == 2 and res["verdict"] == "meets"
    assert csat["latest"]["from_assessment"] is True and csat["verdict"] == "below"
    assert [g["id"] for g in csat["goals"]] == ["g-stretch"]
    # A deliberately unresolved target is never judged against a number.
    assert fcr["target"] is None and fcr["bar"] is None and fcr["verdict"] is None
    assert [r["name"] for r in view["responsibilities"]] == ["Escalation handling"]
    assert [s["name"] for s in view["skills"]] == ["Clear writing"]
    assert view["values"][0]["company_wide"] is True
    # A goal whose expectation was retired stays, marked.
    assert view["unlinked_goals"] == [{"id": "g-retired", "title": "Close 40 tickets a week", "status": "active",
                                       "due_date": None, "source_name": "Tickets closed", "reason": "retired"}]


def test_live_view_with_no_role_is_empty_not_an_error():
    view = role_goals.get_role_goals("dr-norole", auth=_auth(_seed()))
    assert view["role"] is None and view["measured"] == [] and view["unlinked_goals"] == []


def test_another_managers_report_is_not_found():
    with pytest.raises(HTTPException) as exc:
        role_goals.get_role_goals("dr-theirs", auth=_auth(_seed()))
    assert exc.value.status_code == 404


# --- readings ------------------------------------------------------------------

def test_add_a_reading_writes_metric_entries_with_period():
    db = _seed()
    row = role_goals.add_reading("dr-bram", role_goals.ReadingIn(metric_config_id="m-csat", value=0, period=" Oct 2026 "),
                                 auth=_auth(db))
    assert row["value"] == 0 and row["period"] == "Oct 2026" and row["from_assessment"] is False
    stored = db.tables["metric_entries"][-1]
    assert stored["recorded_by"] == ME and stored["direct_report_id"] == "dr-bram"


@pytest.mark.parametrize("body,status", [
    ({"metric_config_id": "m-old", "value": 1, "period": "Oct"}, 422),       # retired: not in the current role
    ({"metric_config_id": "s-esc", "value": 1, "period": "Oct"}, 422),       # not a measured expectation
    ({"metric_config_id": "m-csat", "value": float("inf"), "period": "Oct"}, 422),
    ({"metric_config_id": "m-csat", "value": 1, "period": "   "}, 422),
    ({"metric_config_id": "m-csat", "value": 1, "period": "x" * 41}, 422),
])
def test_bad_readings_are_refused_before_any_write(body, status):
    db = _seed()
    before = len(db.tables["metric_entries"])
    with pytest.raises(HTTPException) as exc:
        role_goals.add_reading("dr-bram", role_goals.ReadingIn(**body), auth=_auth(db))
    assert exc.value.status_code == status
    assert len(db.tables["metric_entries"]) == before


def test_reading_for_someone_elses_report_is_refused():
    with pytest.raises(HTTPException) as exc:
        role_goals.add_reading("dr-theirs", role_goals.ReadingIn(metric_config_id="m-csat", value=1, period="Oct"),
                               auth=_auth(_seed()))
    assert exc.value.status_code == 404


def test_a_manual_reading_can_be_removed_but_an_assessments_cannot():
    db = _seed()
    role_goals.delete_reading("dr-bram", "e2", auth=_auth(db))
    assert "e2" not in {e["id"] for e in db.tables["metric_entries"]}
    with pytest.raises(HTTPException) as exc:
        role_goals.delete_reading("dr-bram", "e3", auth=_auth(db))
    assert exc.value.status_code == 409


# --- goals that start from an expectation ---------------------------------------

def test_linked_goal_reads_the_expectations_readings():
    rows = goals.list_goals(direct_report_id="dr-bram", auth=_auth(_seed()))
    stretch = next(g for g in rows if g["id"] == "g-stretch")
    assert stretch["source"]["name"] == "CSAT on cases they own" and stretch["source"]["retired"] is False
    assert stretch["readings_from"] == "role"
    assert stretch["latest_reading"]["value"] == 90 and stretch["latest_reading"]["period"] == "Q3 2026"
    assert stretch["reading_count"] == 1
    own = next(g for g in rows if g["id"] == "g-own")
    assert own["source"] is None and own["readings_from"] == "goal"
    retired = next(g for g in rows if g["id"] == "g-retired")
    assert retired["source"]["retired"] is True


def _body(**kw):
    return goals.GoalIn(title="CSAT 95%", level="individual", direct_report_id="dr-bram", **kw)


def test_create_keeps_the_link_to_a_current_expectation():
    db = _seed()
    g = goals.create_goal(_body(source_metric_config_id="m-res"), auth=_auth(db))
    assert g["source"]["id"] == "m-res" and g["readings_from"] == "role"


@pytest.mark.parametrize("kw", [
    {"source_metric_config_id": "m-old"},                                   # retired
    {"source_skill_config_id": "m-res"},                                    # wrong kind
    {"source_metric_config_id": "m-res", "source_skill_config_id": "s-esc"},  # two links
])
def test_create_refuses_a_link_outside_the_current_role(kw):
    with pytest.raises(HTTPException) as exc:
        goals.create_goal(_body(**kw), auth=_auth(_seed()))
    assert exc.value.status_code == 422


def test_link_is_cleared_when_a_goal_stops_being_individual():
    db = _seed()
    goals.update_goal("g-stretch", goals.GoalIn(title="Team CSAT", level="team"), auth=_auth(db))
    row = next(g for g in db.tables["goals"] if g["id"] == "g-stretch")
    assert row["source_metric_config_id"] is None and row["source_skill_config_id"] is None


def test_edit_without_the_link_leaves_it_alone_even_when_retired():
    db = _seed()
    goals.update_goal("g-retired", _body(), auth=_auth(db))
    assert next(g for g in db.tables["goals"] if g["id"] == "g-retired")["source_metric_config_id"] == "m-old"
    # Sending the same retired link back is allowed too.
    goals.update_goal("g-retired", _body(source_metric_config_id="m-old"), auth=_auth(db))


def test_check_in_on_a_linked_goal_cannot_carry_its_own_reading():
    db = _seed()
    with pytest.raises(HTTPException) as exc:
        goals.create_goal_check_in("g-stretch", goals.GoalCheckInIn(status="on_track", measured_value=96), auth=_auth(db))
    assert exc.value.status_code == 422 and db.rpc_calls == []
    goals.create_goal_check_in("g-stretch", goals.GoalCheckInIn(status="on_track", note="coaching on tone"), auth=_auth(db))
    assert len(db.rpc_calls) == 1


# --- assessments show a personalised goal under its expectation ---------------

def test_assessment_catalog_and_prompt_put_the_goal_under_its_expectation():
    import routes.assessment_reviews as ar

    scorecard = {
        "levels": [],
        "overall": None,
        "skills": [],
        "values": [],
        "metrics": [{
            "config_id": "m-csat", "name": "CSAT on cases they own", "expectation": "CSAT on owned cases",
            "measurement_period": "month", "order_type": "primary", "target": "92% or above", "target_status": "set",
            "scale_min": 1, "scale_max": 4, "scale_definitions": [], "latest": None,
            "linked_goals": [{"id": "g-stretch", "title": "CSAT 95% by end of Q4", "status": "active", "due_date": None,
                              "measure_target": 95, "measure_unit": "%", "measure_direction": "at_least"}],
        }],
    }
    catalog = ar._catalog(scorecard)
    metric = next(e for e in catalog if e["kind"] == "metric")
    assert [g["id"] for g in metric["linked_goals"]] == ["g-stretch"]
    # One catalog item for the expectation; the goal is not a second item.
    assert [e["key"] for e in catalog] == ["overall", "metric:m-csat"]
    block = ar._item_block(catalog, {e["key"]: f"K{i}" for i, e in enumerate(catalog)})
    assert "their own goal on this expectation (part of judging it, not a separate item): CSAT 95% by end of Q4, target 95 %" in block
