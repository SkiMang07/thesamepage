"""
CRUD for the people a manager manages. Everything else (1:1s, commitments)
hangs off a direct_report_id.

Schema column: manager_id (the logged-in manager's auth.uid()).
RLS enforces this automatically, but we also pass it explicitly for
defense-in-depth. Matches direct_reports.manager_id in schema.sql.

Role-scoped views (Session 15, 2026-08-03 — see docs/SESSION_HISTORY.md and
the role_scoped_views project memory note): GET /rollup returns headcount +
a role-label/count breakdown per org unit the caller leads — never a named
report outside your own team, same aggregate-only contract as capacity's
rollup. Calls org_unit_people_rollup() (SECURITY DEFINER, gated by
led_org_unit_ids()).

Invites (Session 22, 2026-08-08 — Team Mission Control's "auth primitives
now, IC view later" scoping call, see docs/SESSION_HISTORY.md and the
team_mission_control project memory note): POST /{report_id}/invite
generates a one-time magic-link invite that lets a report create their own
account and claim direct_reports.user_id — see
accept_direct_report_invite() in schema.sql for the claim side, and
routes/invites.py for the public preview + accept endpoints an invited
report actually hits. This route also activates direct_reports.email, a
second dormant column (same "future hook" pattern as user_id) — there was
previously no way to set it anywhere in the app, so the invite form is where
a manager now enters/confirms it. No email is sent from the backend; the
manager copies the returned link and shares it themselves, same
manual-delivery posture Session 21 chose for team_messages.
"""
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from config import settings
from utils import get_authenticated_client

_INVITE_TTL_DAYS = 7

router = APIRouter()

# Mirrors settings.py's config-table mapping (kept local — settings owns the
# CRUD, this module only reads). kind -> (table, name column).
_EXPECTATION_TABLES = {
    "metrics": ("metric_configs", "metric_name"),
    "skills": ("skill_configs", "skill_name"),
    "values": ("value_configs", "value_name"),
}


def fetch_role_expectations(supabase, role_level_id: str | None) -> dict | None:
    """The DR's assigned role_level plus its metric/skill/value configs.

    Returns None when no role is assigned (or the role row is gone) so both
    the DR detail page and the prep prompt can degrade gracefully. Shared by
    GET /{report_id} here and the 1:1 prep prompt in one_on_ones.py.
    """
    if not role_level_id:
        return None

    role_rows = (
        supabase.table("role_levels")
        .select("id,job_role,job_level,functional_team,job_responsibilities")
        .eq("id", role_level_id)
        .execute()
        .data
    )
    if not role_rows:
        return None

    result: dict = {"role_level": role_rows[0]}
    for kind, (table, name_col) in _EXPECTATION_TABLES.items():
        # order_type sorts primary < secondary < tertiary alphabetically;
        # Postgres puts nulls last on ascending order.
        result[kind] = (
            supabase.table(table)
            .select("*")
            .eq("role_level_id", role_level_id)
            .order("order_type")
            .order(name_col)
            .execute()
            .data
        )
    return result


class DirectReportIn(BaseModel):
    name: str
    role_title: str | None = None
    notes: str | None = None
    # Settings page (Session 6): link a report to a configured role+level.
    role_level_id: str | None = None
    # Session 11: which team/department this report structurally sits in.
    # Separate from role_level_id — two reports can share a role/comp band
    # but sit on different real teams.
    org_unit_id: str | None = None
    # 1:1 cadence override, in days (nav rework pass 2, Session 38) — null
    # means inherit the org default. See resolve_cadence_days() in utils.py.
    one_on_one_cadence_days: int | None = None


@router.get("")
async def list_direct_reports(auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    result = (
        supabase.table("direct_reports")
        .select("*")
        .eq("manager_id", user_id)
        .order("name")
        .execute()
    )
    return result.data


# NOTE: declared before /{report_id} so FastAPI doesn't match "overview" as an id.
@router.get("/overview")
async def get_team_overview(auth=Depends(get_authenticated_client)):
    """Dashboard rollup: every direct report with their last 1:1 date and
    open commitment count. Three queries + a Python merge — fine at MVP
    scale (a manager has a handful of reports, not thousands)."""
    user_id, supabase = auth

    reports = (
        supabase.table("direct_reports")
        .select("id,name,role_title")
        .eq("manager_id", user_id)
        .order("name")
        .execute()
        .data
    )

    # Only COMPLETED meetings count toward "last 1:1" — a planned session
    # (prep sheet generated, meeting hasn't happened yet) must not reset the
    # 21-day cadence clock, or the badge would go stale the moment a manager
    # preps. Same rule applied in one_on_ones.py's prep recency logic —
    # these two share the threshold (see CLAUDE.md); don't change one alone.
    one_on_ones = (
        supabase.table("one_on_ones")
        .select("direct_report_id,created_at,summary")
        .eq("manager_id", user_id)
        .not_.is_("summary", "null")
        .order("created_at", desc=True)
        .execute()
        .data
    )

    open_commitments = (
        supabase.table("commitments")
        .select("direct_report_id")
        .eq("owner_id", user_id)
        .eq("status", "open")
        .execute()
        .data
    )

    # Newest-first order means the first occurrence per report is the latest 1:1.
    last_one_on_one: dict = {}
    for row in one_on_ones:
        last_one_on_one.setdefault(row["direct_report_id"], row["created_at"])

    commitment_counts: dict = {}
    for row in open_commitments:
        rid = row["direct_report_id"]
        commitment_counts[rid] = commitment_counts.get(rid, 0) + 1

    return [
        {
            **r,
            "last_one_on_one_at": last_one_on_one.get(r["id"]),
            "open_commitment_count": commitment_counts.get(r["id"], 0),
        }
        for r in reports
    ]


# NOTE: declared before /{report_id} so FastAPI doesn't match "rollup" as an id.
@router.get("/rollup")
async def get_people_rollup(auth=Depends(get_authenticated_client)):
    """Headcount + role breakdown across the org units the caller leads —
    aggregate-only, never a named individual outside your own team."""
    user_id, supabase = auth
    rollup_rows = supabase.rpc("org_unit_people_rollup", {}).execute().data
    unit_ids = sorted({row["org_unit_id"] for row in rollup_rows})
    units_by_id: dict = {}
    if unit_ids:
        units = supabase.table("org_units").select("id,name,unit_type").in_("id", unit_ids).execute().data
        units_by_id = {u["id"]: u for u in units}
    return [
        {
            "org_unit_id": row["org_unit_id"],
            "org_unit_name": units_by_id.get(row["org_unit_id"], {}).get("name"),
            "unit_type": units_by_id.get(row["org_unit_id"], {}).get("unit_type"),
            "direct_report_count": row["direct_report_count"],
            "role_breakdown": row["role_breakdown"] or [],
        }
        for row in rollup_rows
    ]


@router.post("")
async def create_direct_report(body: DirectReportIn, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    result = (
        supabase.table("direct_reports")
        .insert({**body.model_dump(), "manager_id": user_id})
        .execute()
    )
    return result.data[0]


class InviteIn(BaseModel):
    email: str


# NOTE: declared before /{report_id} so FastAPI doesn't match "{report_id}"
# routes ahead of this — not actually a conflict here since this is a
# two-segment path, but kept alongside overview/rollup's ordering note for
# consistency.
@router.post("/{report_id}/invite")
async def invite_direct_report(report_id: str, body: InviteIn, auth=Depends(get_authenticated_client)):
    """Generate a one-time invite link. Confirms the report belongs to this
    manager, backfills direct_reports.email, soft-expires any prior pending
    invite for this report (so an old copied link stops working once a
    fresh one is issued), then creates the new invite row. Returns the
    frontend URL for the manager to copy and send themselves."""
    user_id, supabase = auth
    email = body.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=422, detail="A valid email is required")

    result = (
        supabase.table("direct_reports")
        .update({"email": email})
        .eq("id", report_id)
        .eq("manager_id", user_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Direct report not found")
    if result.data[0].get("user_id"):
        raise HTTPException(status_code=400, detail="This person already has an account")

    now = datetime.now(timezone.utc)
    supabase.table("direct_report_invites").update({"expires_at": now.isoformat()}).eq(
        "direct_report_id", report_id
    ).is_("accepted_at", "null").execute()

    token = secrets.token_urlsafe(32)
    expires_at = now + timedelta(days=_INVITE_TTL_DAYS)
    supabase.table("direct_report_invites").insert(
        {
            "manager_id": user_id,
            "direct_report_id": report_id,
            "invited_email": email,
            "token": token,
            "expires_at": expires_at.isoformat(),
        }
    ).execute()

    return {"invite_url": f"{settings.FRONTEND_URL}/invite/{token}", "expires_at": expires_at.isoformat()}


@router.get("/{report_id}")
async def get_direct_report(report_id: str, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    try:
        result = (
            supabase.table("direct_reports")
            .select("*")
            .eq("id", report_id)
            .eq("manager_id", user_id)
            .single()
            .execute()
        )
    except Exception:
        raise HTTPException(status_code=404, detail="Direct report not found")
    if not result.data:
        raise HTTPException(status_code=404, detail="Direct report not found")
    report = result.data
    # Settings payoff: surface what "good" looks like for this person's role.
    # None (not an error) when no role is assigned.
    report["expectations"] = fetch_role_expectations(supabase, report.get("role_level_id"))
    return report


@router.put("/{report_id}")
async def update_direct_report(report_id: str, body: DirectReportIn, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    result = (
        supabase.table("direct_reports")
        .update(body.model_dump())
        .eq("id", report_id)
        .eq("manager_id", user_id)
        .execute()
    )
    return result.data[0]


@router.delete("/{report_id}")
async def delete_direct_report(report_id: str, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    supabase.table("direct_reports").delete().eq("id", report_id).eq("manager_id", user_id).execute()
    return {"deleted": True}
