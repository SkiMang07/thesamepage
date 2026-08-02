"""
Org units — team/department entities with parent/child relationships
(Session 11 scoping conversation with Andrew, 2026-08-02; see
docs/SESSION_HISTORY.md and the org_hierarchy_scoping project memory note).

Decisions locked before this file was written:
  - One self-referencing table (org_units), not separate department/team
    tables — mirrors goals.parent_goal_id and users.manager_id, patterns
    already in this schema.
  - unit_type is 'department' or 'team' only. "Company" is NOT a row in this
    table — it's the existing organizations row, shown as the chart's root.
    A department with parent_unit_id = null sits directly under it.
  - Org-scoped like role_levels/assessment_levels (org_id = current_org_id()),
    not manager-scoped like direct_reports/goals — team/department structure
    belongs to the org, not to one manager's private view of it. Uses the
    same ensure_org() bootstrap-on-write pattern as settings.py.
  - Builder UI is a hybrid: a tree to build/edit, a read-only chart to view.
    Own top-level nav page (/app/org), not folded into Settings.

Known limitation: update_org_unit only guards against a unit being its own
direct parent. It does not walk the tree to reject a deeper cycle (A's
parent set to B when B's parent is already A). Acceptable for a solo
manager building a small tree by hand; revisit if this becomes multi-editor.
"""
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from utils import ensure_org, get_authenticated_client, get_email_from_token

router = APIRouter()

_UNIT_TYPES = ("department", "team")


class OrgUnitIn(BaseModel):
    name: str
    unit_type: str
    parent_unit_id: str | None = None


def _validate_unit_type(unit_type: str):
    if unit_type not in _UNIT_TYPES:
        raise HTTPException(status_code=422, detail=f"unit_type must be one of {_UNIT_TYPES}")


@router.get("")
async def list_org_units(auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    # RLS scopes to own org; empty list before the org bootstrap has run
    # (e.g. a brand new manager who hasn't saved their Settings profile yet).
    return (
        supabase.table("org_units")
        .select("*")
        .order("unit_type")
        .order("name")
        .execute()
        .data
    )


@router.post("")
async def create_org_unit(
    body: OrgUnitIn, auth=Depends(get_authenticated_client), authorization: str = Header(None)
):
    user_id, supabase = auth
    _validate_unit_type(body.unit_type)
    org_id = ensure_org(user_id, supabase, get_email_from_token(authorization))
    result = (
        supabase.table("org_units")
        .insert({**body.model_dump(), "org_id": org_id})
        .execute()
    )
    return result.data[0]


@router.put("/{unit_id}")
async def update_org_unit(unit_id: str, body: OrgUnitIn, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    _validate_unit_type(body.unit_type)
    if body.parent_unit_id == unit_id:
        raise HTTPException(status_code=422, detail="A unit cannot be its own parent")
    result = (
        supabase.table("org_units")
        .update(body.model_dump())
        .eq("id", unit_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Org unit not found")
    return result.data[0]


@router.delete("/{unit_id}")
async def delete_org_unit(unit_id: str, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    # parent_unit_id, direct_reports.org_unit_id, and goals.org_unit_id all
    # use ON DELETE SET NULL — children and references clear automatically,
    # no manual unparenting needed (unlike goals.delete_goal's parent_goal_id,
    # which has no ON DELETE clause).
    supabase.table("org_units").delete().eq("id", unit_id).execute()
    return {"deleted": True}
