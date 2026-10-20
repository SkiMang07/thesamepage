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
from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field

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
def list_org_units(auth=Depends(get_authenticated_client)):
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
def list_led_org_units(auth=Depends(get_authenticated_client)):
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


def _mark_caller(rows: list[dict], user_id: str) -> list[dict]:
    """Tag the caller's own row so the picker can say "You" instead of an
    email address when they never gave a name (the fresh-setup walkthrough
    showed "Led by andrewgodlew+dana")."""
    return [{**row, "is_you": row.get("id") == user_id} for row in rows]


@router.get("/members")
def list_org_members(auth=Depends(get_authenticated_client)):
    """Org members for the leader picker. Relies on the existing
    users_select_own_org RLS policy (id = auth.uid() or same org_id) —
    no manual org_id filter needed, same pattern noted throughout
    ENGINEERING.md's RLS conventions."""
    user_id, supabase = auth
    rows = (
        supabase.table("users")
        .select("id,full_name,email")
        .order("full_name")
        .execute()
        .data
    )
    return _mark_caller(rows, user_id)


@router.post("")
def create_org_unit(
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


# ---- setup (step 4): your own unit, led by you ------------------------------
#
# Setup asks "What are you setting up? My team / My department" and creates (or
# claims) that unit with the caller as its leader, optionally under their boss's
# group. The path is never stored: it is read back from the top unit you lead.
# Leaders can still be changed on the Org page.


class SetupUnitIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    path: Literal["team", "department"]
    name: str | None = Field(default=None, max_length=120)
    # Claim a unit that already exists (made before setup asked) instead of
    # creating one. Its type follows the answer.
    existing_unit_id: str | None = Field(default=None, max_length=64)
    # Your boss's group (team path) or the group above yours (department path).
    parent_name: str | None = Field(default=None, max_length=120)


class AboveUnitIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(max_length=120)


def setup_plan(units: list[dict], user_id: str, body: SetupUnitIn) -> dict:
    """What setup will write, as plain data. Pure, so it is tested without a
    database. Raises HTTPException for a request it can't honour.

    Returns {"unit": {"id"|None, "name", "unit_type"}, "parent": {"id"|None,
    "name"} | None}. An id of None means "create it".
    """
    by_id = {u["id"]: u for u in units}
    if body.existing_unit_id:
        unit = by_id.get(body.existing_unit_id)
        if not unit:
            raise HTTPException(status_code=422, detail="That team or department wasn't found")
        if unit.get("leader_user_id") and unit["leader_user_id"] != user_id:
            raise HTTPException(status_code=409, detail=f"{unit['name']} already has a leader. Change it on the Org page.")
        if unit["unit_type"] != body.path and any(u.get("parent_unit_id") == unit["id"] for u in units):
            raise HTTPException(
                status_code=409,
                detail=f"{unit['name']} has teams under it, so it stays a department. Choose My department.",
            )
        planned = {"id": unit["id"], "name": unit["name"], "unit_type": body.path}
        has_parent = bool(unit.get("parent_unit_id"))
    else:
        planned = {"id": None, "name": _clean_name(body.name or ""), "unit_type": body.path}
        has_parent = False

    parent = None
    parent_name = (body.parent_name or "").strip()
    if parent_name and not has_parent:
        if parent_name.lower() == planned["name"].lower():
            raise HTTPException(status_code=422, detail="The group above yours needs a different name from yours")
        # Reuse a department of that name rather than making a second one.
        match = next(
            (u for u in units if u["unit_type"] == "department" and u["name"].strip().lower() == parent_name.lower()
             and u["id"] != planned["id"]),
            None,
        )
        parent = {"id": match["id"] if match else None, "name": match["name"] if match else parent_name}
    return {"unit": planned, "parent": parent}


def _all_units(supabase) -> list[dict]:
    return supabase.table("org_units").select("id,name,unit_type,parent_unit_id,leader_user_id").execute().data


@router.post("/setup")
def setup_own_unit(
    body: SetupUnitIn, auth=Depends(get_authenticated_client), authorization: str = Header(None)
):
    """Create or claim the caller's own team or department, led by them, and
    optionally the group above it. Returns {unit, parent}."""
    user_id, supabase = auth
    org_id = ensure_org(user_id, supabase, get_email_from_token(authorization))
    plan = setup_plan(_all_units(supabase), user_id, body)

    parent_row = None
    if plan["parent"]:
        if plan["parent"]["id"]:
            parent_row = next(u for u in _all_units(supabase) if u["id"] == plan["parent"]["id"])
        else:
            parent_row = (
                supabase.table("org_units")
                .insert({"name": plan["parent"]["name"], "unit_type": "department", "org_id": org_id})
                .execute()
                .data[0]
            )

    fields = {"unit_type": plan["unit"]["unit_type"], "leader_user_id": user_id}
    if parent_row:
        fields["parent_unit_id"] = parent_row["id"]
    if plan["unit"]["id"]:
        unit_row = supabase.table("org_units").update(fields).eq("id", plan["unit"]["id"]).execute().data
        if not unit_row:
            raise HTTPException(status_code=404, detail="Org unit not found")
        unit_row = unit_row[0]
    else:
        unit_row = (
            supabase.table("org_units")
            .insert({**fields, "name": plan["unit"]["name"], "org_id": org_id})
            .execute()
            .data[0]
        )
    return {"unit": unit_row, "parent": parent_row}


@router.post("/setup/above")
def setup_group_above(
    body: AboveUnitIn, auth=Depends(get_authenticated_client), authorization: str = Header(None)
):
    """"Your boss's group (name it)" from the org-goals review: a department
    above the caller's own unit. Placed over the top unit they lead when it has
    no parent; reused when a department of that name exists."""
    user_id, supabase = auth
    name = _clean_name(body.name)
    org_id = ensure_org(user_id, supabase, get_email_from_token(authorization))
    units = _all_units(supabase)
    led_ids = {u["id"] for u in units if u.get("leader_user_id") == user_id}
    top = [u for u in units if u["id"] in led_ids and u.get("parent_unit_id") not in led_ids]
    match = next((u for u in units if u["unit_type"] == "department" and u["name"].strip().lower() == name.lower()
                  and u["id"] not in led_ids), None)
    group = match or (
        supabase.table("org_units").insert({"name": name, "unit_type": "department", "org_id": org_id}).execute().data[0]
    )
    for u in top:
        if not u.get("parent_unit_id") and u["id"] != group["id"]:
            supabase.table("org_units").update({"parent_unit_id": group["id"]}).eq("id", u["id"]).execute()
    return group


@router.put("/{unit_id}")
def update_org_unit(unit_id: str, body: OrgUnitIn, auth=Depends(get_authenticated_client)):
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
def delete_org_unit(unit_id: str, auth=Depends(get_authenticated_client)):
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
