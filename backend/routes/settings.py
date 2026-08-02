"""
Settings — the configuration backbone (Session 6).

Three sections, matching the agreed v1 structure from the Miro Settings mockup:
  1. Profile & Company  -> users + organizations
  2. Roles & Levels     -> role_levels (the schema's central connector)
  3. Expectations       -> metric_configs / skill_configs / value_configs

Deliberately NOT built yet (deferred with Andrew on 2026-08-01):
  - scale definitions (metric/skill/value_scale_definitions)
  - evaluation weighting ("Performance Evaluations" card on the Miro board)
  - capacity/recruitment and project settings (department-tier features)
  - Edit Access / permissions (meaningless until multi-user exists)

RLS bootstrap: role_levels and the *_configs tables are scoped by
users.org_id, but the MVP has no users row or organization until the manager
first saves their profile. `ensure_org()` (backend/utils.py — shared with
org_units.py as of Session 11) creates both on demand. Requires the policies
in database/migrations/2026-08-01_settings_policies.sql.
"""
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from utils import ensure_org, get_authenticated_client, get_email_from_token

router = APIRouter()

_CONFIG_TABLES = {
    "metrics": ("metric_configs", "metric_name"),
    "skills": ("skill_configs", "skill_name"),
    "values": ("value_configs", "value_name"),
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# _get_email / _ensure_org used to live here as private helpers; moved to
# utils.py (get_email_from_token / ensure_org) once org_units.py needed the
# same org-bootstrap pattern. Local aliases kept so the rest of this file's
# call sites don't need touching.
_get_email = get_email_from_token
_ensure_org = ensure_org


def _get_profile(user_id: str, supabase):
    rows = supabase.table("users").select("*").eq("id", user_id).execute().data
    return rows[0] if rows else None


# ---------------------------------------------------------------------------
# Section 1 — Profile & Company
# ---------------------------------------------------------------------------

class ProfileIn(BaseModel):
    full_name: str
    company_name: str


@router.get("/profile")
async def get_profile(auth=Depends(get_authenticated_client), authorization: str = Header(None)):
    user_id, supabase = auth
    profile = _get_profile(user_id, supabase)
    org = None
    if profile and profile.get("org_id"):
        rows = supabase.table("organizations").select("*").eq("id", profile["org_id"]).execute().data
        org = rows[0] if rows else None
    return {
        "email": (profile or {}).get("email") or _get_email(authorization),
        "full_name": (profile or {}).get("full_name") or "",
        "company_name": (org or {}).get("name") or "",
        "org_ready": org is not None,
    }


@router.put("/profile")
async def update_profile(body: ProfileIn, auth=Depends(get_authenticated_client), authorization: str = Header(None)):
    user_id, supabase = auth
    email = _get_email(authorization)
    org_id = _ensure_org(user_id, supabase, email, company_name=body.company_name.strip() or None)
    supabase.table("users").update({"full_name": body.full_name.strip()}).eq("id", user_id).execute()
    if body.company_name.strip():
        supabase.table("organizations").update({"name": body.company_name.strip()}).eq("id", org_id).execute()
    return await get_profile(auth=auth, authorization=authorization)


# ---------------------------------------------------------------------------
# Section 2 — Roles & Levels
# ---------------------------------------------------------------------------

class RoleLevelIn(BaseModel):
    job_role: str
    job_level: int = 1
    functional_team: str | None = None
    job_responsibilities: str | None = None


@router.get("/role-levels")
async def list_role_levels(auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    # RLS scopes to own org; empty list before the org bootstrap has run.
    return (
        supabase.table("role_levels")
        .select("*")
        .order("job_role")
        .order("job_level")
        .execute()
        .data
    )


@router.post("/role-levels")
async def create_role_level(body: RoleLevelIn, auth=Depends(get_authenticated_client), authorization: str = Header(None)):
    user_id, supabase = auth
    org_id = _ensure_org(user_id, supabase, _get_email(authorization))
    result = (
        supabase.table("role_levels")
        .insert({**body.model_dump(), "org_id": org_id})
        .execute()
    )
    return result.data[0]


@router.put("/role-levels/{role_level_id}")
async def update_role_level(role_level_id: str, body: RoleLevelIn, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    result = (
        supabase.table("role_levels")
        .update(body.model_dump())
        .eq("id", role_level_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Role level not found")
    return result.data[0]


@router.delete("/role-levels/{role_level_id}")
async def delete_role_level(role_level_id: str, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    # No cascade on role_level_id FKs: unassign direct reports and remove the
    # role's expectations first (scale definitions do cascade off configs).
    supabase.table("direct_reports").update({"role_level_id": None}).eq(
        "role_level_id", role_level_id
    ).eq("manager_id", user_id).execute()
    for table, _ in _CONFIG_TABLES.values():
        supabase.table(table).delete().eq("role_level_id", role_level_id).execute()
    supabase.table("role_levels").delete().eq("id", role_level_id).execute()
    return {"deleted": True}


# ---------------------------------------------------------------------------
# Section 3 — Expectations (metrics / skills / values per role level)
# ---------------------------------------------------------------------------

class ExpectationIn(BaseModel):
    name: str
    role_level_id: str | None = None
    order_type: str | None = None  # primary / secondary / tertiary
    description: str | None = None
    expectation: str | None = None
    measurement_period: str | None = None  # metrics only
    value_type: str | None = None  # values only: team / company / department


def _expectation_row(kind: str, body: ExpectationIn) -> dict:
    _, name_col = _CONFIG_TABLES[kind]
    row = {
        name_col: body.name.strip(),
        "role_level_id": body.role_level_id,
        "order_type": body.order_type,
        "description": body.description,
    }
    if kind in ("metrics", "skills"):
        row["expectation"] = body.expectation
    if kind == "metrics":
        row["measurement_period"] = body.measurement_period
    if kind == "values":
        row["value_type"] = body.value_type or "company"
    return row


def _validate_kind(kind: str):
    if kind not in _CONFIG_TABLES:
        raise HTTPException(status_code=404, detail=f"Unknown expectation kind '{kind}'")


@router.get("/expectations/{kind}")
async def list_expectations(kind: str, role_level_id: str | None = None, auth=Depends(get_authenticated_client)):
    _validate_kind(kind)
    user_id, supabase = auth
    table, name_col = _CONFIG_TABLES[kind]
    query = supabase.table(table).select("*").order(name_col)
    if role_level_id:
        query = query.eq("role_level_id", role_level_id)
    return query.execute().data


@router.post("/expectations/{kind}")
async def create_expectation(kind: str, body: ExpectationIn, auth=Depends(get_authenticated_client), authorization: str = Header(None)):
    _validate_kind(kind)
    user_id, supabase = auth
    org_id = _ensure_org(user_id, supabase, _get_email(authorization))
    table, _ = _CONFIG_TABLES[kind]
    result = (
        supabase.table(table)
        .insert({**_expectation_row(kind, body), "org_id": org_id})
        .execute()
    )
    return result.data[0]


@router.put("/expectations/{kind}/{config_id}")
async def update_expectation(kind: str, config_id: str, body: ExpectationIn, auth=Depends(get_authenticated_client)):
    _validate_kind(kind)
    user_id, supabase = auth
    table, _ = _CONFIG_TABLES[kind]
    result = (
        supabase.table(table)
        .update(_expectation_row(kind, body))
        .eq("id", config_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Expectation not found")
    return result.data[0]


@router.delete("/expectations/{kind}/{config_id}")
async def delete_expectation(kind: str, config_id: str, auth=Depends(get_authenticated_client)):
    _validate_kind(kind)
    user_id, supabase = auth
    table, _ = _CONFIG_TABLES[kind]
    supabase.table(table).delete().eq("id", config_id).execute()
    return {"deleted": True}
