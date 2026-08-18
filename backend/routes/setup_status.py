"""
GET /api/setup-status (Session 41, Plan S1 from docs/TEAM_SETUP_UX_REVIEW.md
§6 — the last of the four S1-S5 setup-UX build sessions, see
docs/TEAM_SETUP_BUILD_SESSIONS.md).

Single endpoint feeding three surfaces at once: the People section's
progress header, its roster row badges (per-person has_role/has_team/
role_has_expectations), and the Foundation door's "not finished" state in
ZoneMap.tsx (replacing that door's previous org_ready-only check, which only
meant "the org row exists," not "setup is actually done").

Reuses expectations_ai.py's _compute_coverage() (Plan S3) for the
per-role "has expectations" check rather than re-deriving it a second way —
per the plan's own note ("setup-status feeds ... reuses S3's coverage
query").
"""
from fastapi import APIRouter, Depends

from routes.expectations_ai import _compute_coverage
from utils import get_authenticated_client

router = APIRouter()


@router.get("")
async def get_setup_status(auth=Depends(get_authenticated_client)):
    user_id, supabase = auth

    reports = (
        supabase.table("direct_reports")
        .select("id,name,role_level_id,org_unit_id")
        .eq("manager_id", user_id)
        .order("name")
        .execute()
        .data
    )

    # org_units is org-scoped (not leader-scoped like the role-scoped-views
    # rollups) — same "every unit in the org" list org_units.py's own
    # GET "" returns, just a count here.
    teams_count = len(supabase.table("org_units").select("id").execute().data)

    coverage = _compute_coverage(supabase)
    covered_role_ids = {
        r["role_level_id"]
        for r in coverage["roles"]
        if r["metrics_count"] + r["skills_count"] + r["values_count"] > 0
    }

    people = [
        {
            "id": r["id"],
            "name": r["name"],
            "has_role": r["role_level_id"] is not None,
            "has_team": r["org_unit_id"] is not None,
            # None (not False) when no role is assigned yet — the roster chip
            # needs to tell "no role" apart from "has a role with 0 configured
            # expectations."
            "role_has_expectations": (
                None if r["role_level_id"] is None else r["role_level_id"] in covered_role_ids
            ),
        }
        for r in reports
    ]

    return {
        "people_count": len(reports),
        "teams_count": teams_count,
        "roles_count": len(coverage["roles"]),
        "roles_with_expectations_count": len(covered_role_ids),
        "people_without_role_count": sum(1 for p in people if not p["has_role"]),
        "people_without_team_count": sum(1 for p in people if not p["has_team"]),
        "people": people,
    }
