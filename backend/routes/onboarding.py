"""
GET /api/onboarding/status.

Three states, all derived from real records on every call and stamped once
(Andrew, 2026-09-29; docs/design-proposals/2026-09-29-onboarding-path/
SETUP_MODE_BRIEF.md):

  activated  a prep sheet exists. Reached in the first run.
  set up     three things hold: org, expectations, goals.
               org           at least one org unit, and every active direct
                             report sits in one
               expectations  every active direct report has a role, and every
                             role in use has expectations configured
               goals         an org-level goal (company or department) and a
                             team goal
  onboarded  set up, plus a logged 1:1, plus a later prep sheet for the same
             person (the sheet that carries forward from that log).

Knowledge documents are not a setup step: they arrive through the notes dump
and stay optional. The first logged 1:1 belongs to onboarded, not to setup.

Both set up and onboarded are sticky. The first time each holds,
users.set_up_at / users.onboarded_at is stamped, and archiving a goal later
does not undo it. Once set up, the step queries stop; once onboarded, the
endpoint answers from the user row alone, because every page load asks. Each
step's first completion is stamped too (users.setup_<step>_at), which is what
lets its analytics event fire exactly once.

No AI is involved anywhere in this route.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends

import analytics
from routes.expectations_ai import _compute_coverage
from utils import get_authenticated_client, meeting_day_of

router = APIRouter()

STEP_ORDER = ("org", "expectations", "goals")
STEP_COLUMN = {step: f"setup_{step}_at" for step in STEP_ORDER}
ORG_LEVELS = {"company", "department"}


def evaluate(
    *,
    reports: list[dict],
    unit_count: int,
    covered_role_ids: set,
    goal_levels: set,
) -> dict:
    """The setup conditions as plain data. Pure, so it is tested without a database.

    `reports` are the manager's active direct reports (role_level_id, org_unit_id).
    `covered_role_ids` are role levels with at least one configured expectation.
    """
    people = len(reports)
    without_team = sum(1 for r in reports if not r.get("org_unit_id"))
    without_role = sum(1 for r in reports if not r.get("role_level_id"))
    roles_in_use = {r["role_level_id"] for r in reports if r.get("role_level_id")}
    roles_covered = len(roles_in_use & set(covered_role_ids))
    people_ready = sum(1 for r in reports if r.get("role_level_id") in set(covered_role_ids))

    org_done = people > 0 and unit_count > 0 and without_team == 0
    exp_done = people > 0 and without_role == 0 and roles_covered == len(roles_in_use)
    has_org_goal = bool(goal_levels & ORG_LEVELS)
    has_team_goal = "team" in goal_levels

    return {
        "org": {
            "done": org_done,
            "people": people,
            "people_without_team": without_team,
            "units": unit_count,
        },
        "expectations": {
            "done": exp_done,
            "blocked": not org_done,
            "people_without_role": without_role,
            "roles_in_use": len(roles_in_use),
            "roles_covered": roles_covered,
            # People whose role has expectations: the ones an assessment can
            # be drafted against. Feeds the Assessments door.
            "people_ready": people_ready,
        },
        "goals": {
            "done": has_org_goal and has_team_goal,
            "has_org_goal": has_org_goal,
            "has_team_goal": has_team_goal,
        },
    }


def next_step(steps: dict) -> str | None:
    """The one step to point at: the first not done and not waiting on another.

    Order is the order a manager can actually do them in; expectations wait on
    org because roles come from there. None when every step is done.
    """
    for key in STEP_ORDER:
        step = steps[key]
        if not step["done"] and not step.get("blocked"):
            return key
    return None


def carried_forward(logged: list[dict], prepped: list[dict]) -> bool:
    """A prep sheet exists for a person, dated after a 1:1 already logged with them.

    That is the second-cycle activation: the sheet is built on top of a log,
    not only on what the manager typed the first time. "Dated after" is the
    meeting date (utils.meeting_day_of), the only resolver for when a 1:1
    happened or is planned; the logged row itself never counts as its own
    later sheet.
    """
    earliest_log: dict = {}
    for row in logged:
        day = meeting_day_of(row)
        who = row.get("direct_report_id")
        if day is None or who is None:
            continue
        if who not in earliest_log or day < earliest_log[who]:
            earliest_log[who] = day
    for row in prepped:
        day = meeting_day_of(row)
        who = row.get("direct_report_id")
        if day is not None and who in earliest_log and day > earliest_log[who]:
            return True
    return False


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


_USER_COLUMNS = ",".join(["set_up_at", "onboarded_at", *STEP_COLUMN.values()])


def _user_row(supabase, user_id: str) -> dict:
    rows = supabase.table("users").select(_USER_COLUMNS).eq("id", user_id).execute().data
    return rows[0] if rows else {}


def _stamp(supabase, user_id: str, column: str) -> bool:
    """Set a timestamp column once. True only for the call that set it.

    The update is scoped to rows still null, so two tabs loading at the same
    moment cannot stamp twice or fire an event twice.
    """
    rows = (
        supabase.table("users")
        .update({column: _now_iso()})
        .eq("id", user_id)
        .is_(column, "null")
        .execute()
        .data
    )
    return bool(rows)


def _has_prep_sheet(supabase, user_id: str) -> bool:
    return bool(
        supabase.table("one_on_ones")
        .select("id")
        .eq("manager_id", user_id)
        .not_.is_("prep_guide", "null")
        .limit(1)
        .execute()
        .data
    )


def _is_onboarded(supabase, user_id: str) -> bool:
    """A logged 1:1, then a later prep sheet for the same person. Cheap first: no log, no second query."""
    logged = (
        supabase.table("one_on_ones")
        .select("id,direct_report_id,scheduled_at,created_at")
        .eq("manager_id", user_id)
        .not_.is_("summary", "null")
        .execute()
        .data
    )
    if not logged:
        return False
    prepped = (
        supabase.table("one_on_ones")
        .select("id,direct_report_id,scheduled_at,created_at")
        .eq("manager_id", user_id)
        .not_.is_("prep_guide", "null")
        .execute()
        .data
    )
    return carried_forward(logged, prepped)


def _status(*, activated, set_up_at, onboarded_at, steps, done_count, assessable_people) -> dict:
    return {
        "activated": activated,
        "set_up": set_up_at is not None,
        "set_up_at": set_up_at,
        "onboarded": onboarded_at is not None,
        "onboarded_at": onboarded_at,
        "done_count": done_count,
        "total": len(STEP_ORDER),
        "next_step": next_step(steps) if steps else None,
        # People an assessment can be drafted for. None once set up, when the
        # question no longer matters to the door.
        "assessable_people": assessable_people,
        "steps": steps,
    }


def build_status(user_id: str, supabase) -> dict:
    user = _user_row(supabase, user_id)
    total = len(STEP_ORDER)

    if user.get("onboarded_at"):
        return _status(
            activated=True,
            set_up_at=user.get("set_up_at") or user["onboarded_at"],
            onboarded_at=user["onboarded_at"],
            steps=None,
            done_count=total,
            assessable_people=None,
        )

    activated = _has_prep_sheet(supabase, user_id)
    set_up_at = user.get("set_up_at")
    steps = None
    done_count = total
    assessable = None

    if not set_up_at:
        reports = (
            supabase.table("direct_reports")
            .select("id,role_level_id,org_unit_id")
            .eq("manager_id", user_id)
            .is_("archived_at", "null")
            .execute()
            .data
        )
        unit_count = len(supabase.table("org_units").select("id").execute().data)
        coverage = _compute_coverage(supabase)
        covered_role_ids = {
            r["role_level_id"]
            for r in coverage["roles"]
            if r["metrics_count"] + r["skills_count"] + r["values_count"] > 0
        }
        goal_levels = {
            g["level"]
            for g in supabase.table("goals").select("level").neq("status", "cancelled").execute().data
        }
        steps = evaluate(
            reports=reports,
            unit_count=unit_count,
            covered_role_ids=covered_role_ids,
            goal_levels=goal_levels,
        )
        done_count = sum(1 for k in STEP_ORDER if steps[k]["done"])
        assessable = steps["expectations"]["people_ready"]

        for key in STEP_ORDER:
            if steps[key]["done"] and not user.get(STEP_COLUMN[key]):
                if _stamp(supabase, user_id, STEP_COLUMN[key]):
                    analytics.capture(user_id, "setup_step_completed", {"step": key, "done_count": done_count})

        if done_count == total:
            set_up_at = _now_iso()
            if _stamp(supabase, user_id, "set_up_at"):
                analytics.capture(user_id, "set_up", {})
            steps = None
            assessable = None

    onboarded_at = None
    if set_up_at and _is_onboarded(supabase, user_id):
        onboarded_at = _now_iso()
        if _stamp(supabase, user_id, "onboarded_at"):
            analytics.capture(user_id, "onboarded", {})

    return _status(
        activated=activated,
        set_up_at=set_up_at,
        onboarded_at=onboarded_at,
        steps=steps,
        done_count=done_count,
        assessable_people=assessable,
    )


@router.get("/status")
def get_onboarding_status(auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    return build_status(user_id, supabase)
