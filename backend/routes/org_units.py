"""
Org units — team/department entities with parent/child relationships
(Session 11 scoping conversation with Andrew, 2026-08-02; see
docs/SESSION_HISTORY.md and the org_hierarchy_scoping project memory note).

Core model:
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
  - /app/org is an organization overview with an inspectable hierarchy.
    Structure management is a secondary mode on that page rather than a
    separate chart/build workflow.

Role-scoped views (Session 15, 2026-08-03 — see docs/SESSION_HISTORY.md and
the role_scoped_views project memory note): leader_user_id on OrgUnitIn is
new. Any org member can assign any other org member as a unit's leader —
same permissiveness level org_units CRUD already had (no owner/admin check
existed before this either); revisit if that ever needs tightening.
GET /led and GET /members below exist to support the leader picker and the
"which units can I see rollups for" UI on the Org and Capacity pages.
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
    # Session 15: who leads this unit — the scoping mechanism for role-scoped
    # rollup views (People/Goals/Projects/Capacity). None = no leader
    # assigned yet, so this unit contributes nothing to anyone's rollup.
    leader_user_id: str | None = None


def _validate_unit_type(unit_type: str):
    if unit_type not in _UNIT_TYPES:
        raise HTTPException(status_code=422, detail=f"unit_type must be one of {_UNIT_TYPES}")


def _clean_name(name: str) -> str:
    cleaned = name.strip()
    if not cleaned:
        raise HTTPException(status_code=422, detail="name cannot be empty")
    return cleaned


def _validate_parent_assignment(supabase, unit_id: str | None, parent_unit_id: str | None):
    """Reject missing parents and every depth of cycle before writing.

    The frontend also removes descendants from the parent picker, but the API
    remains the source of truth because a crafted request must not be able to
    make the hierarchy disappear or make recursive rollups loop forever.
    """
    if not parent_unit_id:
        return
    rows = supabase.table("org_units").select("id,parent_unit_id").execute().data
    parent_by_id = {row["id"]: row.get("parent_unit_id") for row in rows}
    if parent_unit_id not in parent_by_id:
        raise HTTPException(status_code=422, detail="Parent unit not found")

    seen: set[str] = set()
    current: str | None = parent_unit_id
    while current:
        if unit_id and current == unit_id:
            raise HTTPException(status_code=422, detail="A unit cannot report into one of its descendants")
        if current in seen:
            raise HTTPException(status_code=422, detail="The organization hierarchy contains a cycle")
        seen.add(current)
        current = parent_by_id.get(current)


def _validate_leader_assignment(supabase, leader_user_id: str | None):
    if not leader_user_id:
        return
    member = (
        supabase.table("users")
        .select("id")
        .eq("id", leader_user_id)
        .limit(1)
        .execute()
        .data
    )
    if not member:
        raise HTTPException(status_code=422, detail="Leader must be a member of this organization")


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


@router.get("/led")
async def list_led_org_units(auth=Depends(get_authenticated_client)):
    """Units the caller DIRECTLY leads (not the descendant scope
    led_org_unit_ids() computes server-side for the rollup functions) — the
    Org and Capacity pages use this to know which subtrees to render a
    rollup for, and to show an empty state when the caller leads nothing
    yet."""
    user_id, supabase = auth
    return (
        supabase.table("org_units")
        .select("*")
        .eq("leader_user_id", user_id)
        .order("unit_type")
        .order("name")
        .execute()
        .data
    )


@router.get("/members")
async def list_org_members(auth=Depends(get_authenticated_client)):
    """Org members for the leader picker. Relies on the existing
    users_select_own_org RLS policy (id = auth.uid() or same org_id) —
    no manual org_id filter needed, same pattern noted throughout
    ENGINEERING.md's RLS conventions."""
    user_id, supabase = auth
    return (
        supabase.table("users")
        .select("id,full_name,email")
        .order("full_name")
        .execute()
        .data
    )


@router.post("")
async def create_org_unit(
    body: OrgUnitIn, auth=Depends(get_authenticated_client), authorization: str = Header(None)
):
    user_id, supabase = auth
    _validate_unit_type(body.unit_type)
    _validate_parent_assignment(supabase, None, body.parent_unit_id)
    _validate_leader_assignment(supabase, body.leader_user_id)
    org_id = ensure_org(user_id, supabase, get_email_from_token(authorization))
    payload = {**body.model_dump(), "name": _clean_name(body.name), "org_id": org_id}
    result = (
        supabase.table("org_units")
        .insert(payload)
        .execute()
    )
    return result.data[0]


@router.put("/{unit_id}")
async def update_org_unit(unit_id: str, body: OrgUnitIn, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    _validate_unit_type(body.unit_type)
    _validate_parent_assignment(supabase, unit_id, body.parent_unit_id)
    _validate_leader_assignment(supabase, body.leader_user_id)
    payload = {**body.model_dump(), "name": _clean_name(body.name)}
    result = (
        supabase.table("org_units")
        .update(payload)
        .eq("id", unit_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Org unit not found")
    return result.data[0]


@router.delete("/{unit_id}")
async def delete_org_unit(unit_id: str, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    children = (
        supabase.table("org_units")
        .select("id")
        .eq("parent_unit_id", unit_id)
        .limit(1)
        .execute()
        .data
    )
    if children:
        raise HTTPException(
            status_code=409,
            detail="Move or remove child teams and departments before deleting this unit",
        )
    # Leaf deletion still requires an explicit review step in the UI because
    # foreign keys intentionally clear or cascade linked org-scoped records.
    supabase.table("org_units").delete().eq("id", unit_id).execute()
    return {"deleted": True}
