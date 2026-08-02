"""
Projects — activates the dormant `projects` table (Session 13 scoping
conversation with Andrew; see docs/SESSION_HISTORY.md and the
projects_scoping project memory note).

Decisions locked before this file was written (mirrors the Goals/Org/Team
"scope first, then build" pattern from Sessions 10-12):
  - Projects gets its own top-level page (frontend/app/app/projects), same
    reasoning as Goals — projects get created and status-updated regularly,
    unlike Settings' "configure once" tables.
  - A project can be assigned to a specific direct report (direct_report_id,
    added this session) or left unassigned (the manager's own initiative).
  - Deliberately NOT given its own level/org_unit_id like goals. Per
    PRODUCT_VISION.md, "goals = what, projects = how" — a project's scope is
    derived from whatever it's linked to (its parent goal's level, or the
    report it's assigned to), not duplicated as a parallel hierarchy. If a
    project needs independent scope later (e.g. a team-level project with no
    goal attached), org_unit_id/level can be added then.
  - Commitments -> project linking (commitments.source_type = 'project',
    already in schema.sql's check constraint) stays deferred this pass, same
    scope discipline as Goals shipping without rollup calculation.

RLS note: schema.sql's goals/projects policies are named "*_all_own_org" but
actually scope by `owner_id = auth.uid()`, not org_id — same gotcha
documented in goals.py. This router does not populate org_id.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from utils import get_authenticated_client

router = APIRouter()

_STATUSES = ("active", "on_track", "at_risk", "completed", "cancelled")

_SELECT_COLUMNS = (
    "id,title,description,goal_id,status,due_date,direct_report_id,"
    "created_at,direct_reports(name),goals(title)"
)


class ProjectIn(BaseModel):
    title: str
    description: str | None = None
    status: str = "active"
    due_date: str | None = None
    direct_report_id: str | None = None
    # Optional — a project can stand alone or hang off a goal (goals=what,
    # projects=how).
    goal_id: str | None = None


class ProjectStatusUpdate(BaseModel):
    status: str


def _validate_status(status: str):
    if status not in _STATUSES:
        raise HTTPException(status_code=422, detail=f"status must be one of {_STATUSES}")


def _shape_rows(rows: list[dict]) -> list[dict]:
    """Flatten the joined direct_reports.name and goals.title, same pattern
    as goals.py's _shape_rows."""
    for row in rows:
        joined_report = row.pop("direct_reports", None) or {}
        row["direct_report_name"] = joined_report.get("name")
        joined_goal = row.pop("goals", None) or {}
        row["goal_title"] = joined_goal.get("title")
    return rows


@router.get("")
async def list_projects(
    direct_report_id: str | None = None,
    goal_id: str | None = None,
    status: str | None = None,
    auth=Depends(get_authenticated_client),
):
    user_id, supabase = auth
    query = supabase.table("projects").select(_SELECT_COLUMNS).eq("owner_id", user_id)
    if direct_report_id:
        query = query.eq("direct_report_id", direct_report_id)
    if goal_id:
        query = query.eq("goal_id", goal_id)
    if status:
        query = query.eq("status", status)
    rows = query.order("created_at", desc=True).execute().data
    return _shape_rows(rows)


@router.post("")
async def create_project(body: ProjectIn, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    _validate_status(body.status)
    result = (
        supabase.table("projects")
        .insert({**body.model_dump(), "owner_id": user_id})
        .execute()
    )
    return _shape_rows(result.data)[0]


@router.put("/{project_id}")
async def update_project(project_id: str, body: ProjectIn, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    _validate_status(body.status)
    result = (
        supabase.table("projects")
        .update(body.model_dump())
        .eq("id", project_id)
        .eq("owner_id", user_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Project not found")
    return _shape_rows(result.data)[0]


@router.patch("/{project_id}")
async def update_project_status(project_id: str, body: ProjectStatusUpdate, auth=Depends(get_authenticated_client)):
    """Status-only update for the inline status pill — mirrors goals.py's
    PATCH so the frontend doesn't need to resend the whole record."""
    user_id, supabase = auth
    _validate_status(body.status)
    result = (
        supabase.table("projects")
        .update({"status": body.status})
        .eq("id", project_id)
        .eq("owner_id", user_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Project not found")
    return _shape_rows(result.data)[0]


@router.delete("/{project_id}")
async def delete_project(project_id: str, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    # No unparenting needed before delete (unlike goals.delete_goal) — nothing
    # references a project as its own parent; goal_id on a project points up
    # to a goal, not to another project.
    supabase.table("projects").delete().eq("id", project_id).eq("owner_id", user_id).execute()
    return {"deleted": True}
