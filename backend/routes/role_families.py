"""
Role families — group role_levels rows into ladders (Session 40, 2026-08-18,
Plan S2 from docs/TEAM_SETUP_UX_REVIEW.md §6). See the team_setup_ux_review
project memory note for the scoping conversation.

Decisions locked before this file was written:
  - New table (role_families) + role_levels.role_family_id, not a rename of
    role_levels itself — mirrors org_units' shape (a lightweight grouping
    table other rows point at), same ensure_org() bootstrap-on-write pattern
    as settings.py/org_units.py.
  - Org-scoped like role_levels/org_units (org_id = current_org_id()), not
    manager-scoped.
  - The merge tool is not a separate endpoint: "move a level to another
    ladder" is just `PUT /api/role-levels/{id}` with a different
    role_family_id, handled in settings.py (role_levels CRUD lives there,
    unchanged file otherwise except for the role_family_id passthrough).
  - Deleting a family does not require it to be empty first — role_levels'
    FK is `on delete set null`, so any level in a deleted family falls into
    the "Ungrouped" bucket the frontend renders for role_family_id IS NULL,
    same "no manual unparenting needed" shape as org_units' own delete
    (see org_units.py's delete_org_unit comment).

Known limitation (same posture as org_units.py's parent-cycle note): moving
a level to a role_family_id from a DIFFERENT org is rejected, but only via
the RLS-backed existence check in settings.py's update/create role-level
handlers (a select scoped by current_org_id() that returns nothing for a
foreign family id) — there is no DB-level trigger enforcing role_levels.org_id
matches role_families.org_id. Acceptable for a solo manager who only ever
sees their own org's family ids from the UI; revisit if this becomes
multi-tenant-adjacent (e.g. an admin console operating across orgs).
"""
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from utils import ensure_org, get_authenticated_client, get_email_from_token

router = APIRouter()


class RoleFamilyIn(BaseModel):
    name: str


@router.get("")
async def list_role_families(auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    # RLS scopes to own org; empty list before the org bootstrap has run.
    return (
        supabase.table("role_families")
        .select("*")
        .order("name")
        .execute()
        .data
    )


@router.post("")
async def create_role_family(
    body: RoleFamilyIn, auth=Depends(get_authenticated_client), authorization: str = Header(None)
):
    user_id, supabase = auth
    org_id = ensure_org(user_id, supabase, get_email_from_token(authorization))
    result = (
        supabase.table("role_families")
        .insert({"name": body.name.strip(), "org_id": org_id})
        .execute()
    )
    return result.data[0]


@router.put("/{family_id}")
async def update_role_family(family_id: str, body: RoleFamilyIn, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    result = (
        supabase.table("role_families")
        .update({"name": body.name.strip()})
        .eq("id", family_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Role family not found")
    return result.data[0]


@router.delete("/{family_id}")
async def delete_role_family(family_id: str, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    # role_levels.role_family_id is ON DELETE SET NULL — any level in this
    # family falls into the "Ungrouped" bucket automatically, no manual
    # unlinking needed (same shape as org_units.delete_org_unit).
    supabase.table("role_families").delete().eq("id", family_id).execute()
    return {"deleted": True}
