"""
Goals — activates the dormant `goals` table (Session 10 scoping conversation
with Andrew, 2026-08-02; see docs/SESSION_HISTORY.md and the goals_scoping
project memory note).

Decisions locked before this file was written:
  - Goals gets its own top-level page (frontend/app/app/goals), not folded
    into Settings — goals are written to constantly (created per period,
    status updated regularly), unlike Settings' "configure once" tables.
  - Full company/department/team/individual hierarchy ships now
    (goals.level), even though role-scoped views (manager/dept-head/
    individual) don't exist yet (see ENGINEERING.md open questions). That
    means company/department goals are usable today but don't yet have a
    distinct audience beyond the creating manager — an acknowledged gap,
    not an oversight.
  - `projects` stays dormant this pass — goals only.
  - Rollup/status calculation (a parent goal's status computed from its
    children) is explicitly NOT built. `status` is a plain manually-set
    field; PRODUCT_VISION.md's rollup concept is future work.

Follow-up (same session, 2026-08-02): added `success_metrics` — a single
free-text field, the SMART-framework "Measurable" anchor (title/description
already cover Specific; due_date covers Time-bound). Deliberately
unstructured per Andrew: it's meant to be read by AI/agents, not parsed or
scored, so no dedicated metric table — that would just produce blank fields
for goals that don't fit a rigid shape. Requires
`database/migrations/2026-08-02_goals_success_metrics.sql` to be run against
the live database before this field will persist.

RLS note: schema.sql's goals/projects policies are named "*_all_own_org" but
actually scope by `owner_id = auth.uid()`, not org_id — unlike role_levels /
metric_configs / skill_configs / value_configs, which scope by
`org_id = current_org_id()`. So (like direct_reports.manager_id and
one_on_ones.manager_id) this router does NOT populate org_id — it isn't
required for isolation, and no other owner-scoped router in this codebase
bothers with the Settings org-bootstrap dance either.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from utils import get_authenticated_client

router = APIRouter()

_LEVELS = ("company", "department", "team", "individual")
_STATUSES = ("active", "on_track", "at_risk", "completed", "cancelled")

_SELECT_COLUMNS = (
    "id,title,description,success_metrics,level,status,due_date,direct_report_id,"
    "parent_goal_id,org_unit_id,created_at,direct_reports(name),org_units(name,unit_type)"
)


class GoalIn(BaseModel):
    title: str
    description: str | None = None
    success_metrics: str | None = None
    level: str
    status: str = "active"
    due_date: str | None = None
    direct_report_id: str | None = None
    parent_goal_id: str | None = None
    # Session 11: which specific department/team this goal belongs to. Null
    # for company/individual-level goals. The frontend filters the org_unit
    # picker by unit_type = level, so the two can't disagree.
    org_unit_id: str | None = None


class GoalStatusUpdate(BaseModel):
    status: str


def _validate_level(level: str):
    if level not in _LEVELS:
        raise HTTPException(status_code=422, detail=f"level must be one of {_LEVELS}")


def _validate_status(status: str):
    if status not in _STATUSES:
        raise HTTPException(status_code=422, detail=f"status must be one of {_STATUSES}")


def _shape_rows(rows: list[dict]) -> list[dict]:
    """Flatten the joined direct_reports.name and attach a parent goal's
    title when the parent happens to be in this same result set (true for
    the Goals page's unfiltered fetch; a filtered fetch — e.g. the DR detail
    page's per-report call — may leave this null, which is fine since that
    caller doesn't render parent info)."""
    by_id = {r["id"]: r for r in rows}
    for row in rows:
        joined = row.pop("direct_reports", None) or {}
        row["direct_report_name"] = joined.get("name")
        org_unit = row.pop("org_units", None) or {}
        row["org_unit_name"] = org_unit.get("name")
        parent = by_id.get(row.get("parent_goal_id"))
        row["parent_goal_title"] = parent["title"] if parent else None
    return rows


@router.get("")
async def list_goals(
    level: str | None = None,
    direct_report_id: str | None = None,
    org_unit_id: str | None = None,
    status: str | None = None,
    auth=Depends(get_authenticated_client),
):
    user_id, supabase = auth
    query = supabase.table("goals").select(_SELECT_COLUMNS).eq("owner_id", user_id)
    if level:
        query = query.eq("level", level)
    if direct_report_id:
        query = query.eq("direct_report_id", direct_report_id)
    if org_unit_id:
        query = query.eq("org_unit_id", org_unit_id)
    if status:
        query = query.eq("status", status)
    rows = query.order("created_at", desc=True).execute().data
    return _shape_rows(rows)


@router.post("")
async def create_goal(body: GoalIn, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    _validate_level(body.level)
    _validate_status(body.status)
    result = (
        supabase.table("goals")
        .insert({**body.model_dump(), "owner_id": user_id})
        .execute()
    )
    return _shape_rows(result.data)[0]


@router.put("/{goal_id}")
async def update_goal(goal_id: str, body: GoalIn, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    _validate_level(body.level)
    _validate_status(body.status)
    result = (
        supabase.table("goals")
        .update(body.model_dump())
        .eq("id", goal_id)
        .eq("owner_id", user_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Goal not found")
    return _shape_rows(result.data)[0]


@router.patch("/{goal_id}")
async def update_goal_status(goal_id: str, body: GoalStatusUpdate, auth=Depends(get_authenticated_client)):
    """Status is the one field goals get updated on constantly — a
    lightweight sibling to PUT, mirroring commitments.py's status-only
    PATCH so the frontend's inline status select doesn't need to resend the
    whole record."""
    user_id, supabase = auth
    _validate_status(body.status)
    result = (
        supabase.table("goals")
        .update({"status": body.status})
        .eq("id", goal_id)
        .eq("owner_id", user_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Goal not found")
    return _shape_rows(result.data)[0]


@router.delete("/{goal_id}")
async def delete_goal(goal_id: str, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    # parent_goal_id has no ON DELETE clause (defaults to NO ACTION) — unparent
    # any children first so deleting a goal with sub-goals never blocks on the
    # FK. Mirrors delete_role_level's unlink-before-delete pattern in settings.py.
    supabase.table("goals").update({"parent_goal_id": None}).eq(
        "parent_goal_id", goal_id
    ).eq("owner_id", user_id).execute()
    supabase.table("goals").delete().eq("id", goal_id).eq("owner_id", user_id).execute()
    return {"deleted": True}
