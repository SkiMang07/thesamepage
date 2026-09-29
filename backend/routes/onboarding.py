"""
GET /api/onboarding/status and PUT /api/onboarding/knowledge-skipped.

A manager is onboarded when five things are true (Andrew, 2026-09-29; see
docs/design-proposals/2026-09-29-onboarding-path/BUILD_BRIEF.md):

  org           team and org set up: at least one org unit, and every active
                direct report sits in one
  expectations  every active direct report has a role, and every role in use
                has expectations configured
  knowledge     at least one confirmed document, or the manager has said there
                is nothing to import
  goals         an org-level goal (company or department) and a team goal
  log           a first 1:1 logged

The five are derived from real records on every call, so a step cannot drift
out of step with the data. Onboarded is sticky: the first time all five hold,
users.onboarded_at is stamped, and archiving a goal later does not undo it.
Once stamped, the endpoint answers from the user row alone (no step queries),
because every page load asks.

No AI is involved anywhere in this route.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict

import analytics
from routes.expectations_ai import _compute_coverage
from utils import get_authenticated_client

router = APIRouter()

STEP_ORDER = ("org", "expectations", "knowledge", "goals", "log")
ORG_LEVELS = {"company", "department"}


def evaluate(
    *,
    reports: list[dict],
    unit_count: int,
    covered_role_ids: set,
    confirmed_docs: int,
    knowledge_skipped: bool,
    goal_levels: set,
    logged: bool,
) -> dict:
    """The five conditions as plain data. Pure, so it is tested without a database.

    `reports` are the manager's active direct reports (role_level_id, org_unit_id).
    `covered_role_ids` are role levels with at least one configured expectation.
    """
    people = len(reports)
    without_team = sum(1 for r in reports if not r.get("org_unit_id"))
    without_role = sum(1 for r in reports if not r.get("role_level_id"))
    roles_in_use = {r["role_level_id"] for r in reports if r.get("role_level_id")}
    roles_covered = len(roles_in_use & set(covered_role_ids))

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
        },
        "knowledge": {
            "done": confirmed_docs > 0 or knowledge_skipped,
            "confirmed_documents": confirmed_docs,
            "skipped": knowledge_skipped,
        },
        "goals": {
            "done": has_org_goal and has_team_goal,
            "has_org_goal": has_org_goal,
            "has_team_goal": has_team_goal,
        },
        "log": {"done": bool(logged)},
    }


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _user_row(supabase, user_id: str) -> dict:
    rows = (
        supabase.table("users")
        .select("onboarded_at,knowledge_skipped_at")
        .eq("id", user_id)
        .execute()
        .data
    )
    return rows[0] if rows else {}


def build_status(user_id: str, supabase) -> dict:
    user = _user_row(supabase, user_id)
    if user.get("onboarded_at"):
        return {"onboarded": True, "onboarded_at": user["onboarded_at"], "done_count": len(STEP_ORDER), "total": len(STEP_ORDER), "steps": None}

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

    confirmed_docs = len(
        supabase.table("documents").select("id").eq("status", "confirmed").execute().data
    )
    goal_levels = {
        g["level"]
        for g in supabase.table("goals").select("level").neq("status", "cancelled").execute().data
    }
    logged = bool(
        supabase.table("one_on_ones")
        .select("id")
        .eq("manager_id", user_id)
        .not_.is_("summary", "null")
        .limit(1)
        .execute()
        .data
    )

    steps = evaluate(
        reports=reports,
        unit_count=unit_count,
        covered_role_ids=covered_role_ids,
        confirmed_docs=confirmed_docs,
        knowledge_skipped=bool(user.get("knowledge_skipped_at")),
        goal_levels=goal_levels,
        logged=logged,
    )
    done_count = sum(1 for k in STEP_ORDER if steps[k]["done"])

    onboarded_at = None
    if done_count == len(STEP_ORDER):
        # Set once. The update is scoped to rows still null so two tabs
        # loading at the same moment cannot stamp twice or fire two events.
        onboarded_at = _now_iso()
        stamped = (
            supabase.table("users")
            .update({"onboarded_at": onboarded_at})
            .eq("id", user_id)
            .is_("onboarded_at", "null")
            .execute()
            .data
        )
        if stamped:
            analytics.capture(user_id, "onboarded", {"knowledge_skipped": steps["knowledge"]["skipped"]})

    return {
        "onboarded": onboarded_at is not None,
        "onboarded_at": onboarded_at,
        "done_count": done_count,
        "total": len(STEP_ORDER),
        "steps": steps,
    }


@router.get("/status")
def get_onboarding_status(auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    return build_status(user_id, supabase)


class KnowledgeSkippedIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    skipped: bool


@router.put("/knowledge-skipped")
def set_knowledge_skipped(body: KnowledgeSkippedIn, auth=Depends(get_authenticated_client)):
    """'Nothing to import' on the knowledge step. Counts as done; can be undone."""
    user_id, supabase = auth
    supabase.table("users").update(
        {"knowledge_skipped_at": _now_iso() if body.skipped else None}
    ).eq("id", user_id).execute()
    return build_status(user_id, supabase)
