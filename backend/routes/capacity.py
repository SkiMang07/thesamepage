"""
Capacity — how much bandwidth each person, team, and department has
(Session 14 scoping conversation with Andrew, 2026-08-02; see
docs/SESSION_HISTORY.md and the capacity_scoping project memory note).

Decisions locked before this file was written:
  - v1 is supply only. This answers "how much capacity exists", not "what's
    consuming it" — no wiring into Projects/Goals allocation yet. That's an
    explicit, acknowledged follow-up (see ENGINEERING.md scope discipline),
    not an oversight.
  - Hours are the shared currency under the hood. work_unit_configs is an
    optional per-role-level display layer on top (tickets/points/campaigns),
    so a team can see its native unit without breaking cross-team rollup.
  - "Max capacity" is never 100% — two SEPARATE buffers, not one blended
    number:
      1. capacity_settings.default_target_utilization_pct (default 75) —
         the WITHIN-a-day overhead (meetings, admin, the unexpected), same
         as a services-org billable-utilization target.
      2. capacity_settings.default_off_days_per_year (default 21 — 15
         vacation + 6 sick, Andrew's own default) — WHOLE DAYS not worked
         at all. Added same session, before this ever ran live, after
         Andrew flagged that the original formula had no answer for "how
         many days off per year should we assume". Precedence vs. actual
         time_off_entries (to avoid double-counting someone who logs real
         dates): ACTUAL LOGGED TIME OFF WINS for whatever period it
         overlaps; otherwise the calculation falls back to a prorated
         share of the annual default (off_days_per_year × hours/day ×
         period_weeks / 52). See _effective_off_hours() below.
  - Rollup goes to department/org level via the org_units tree (Session 11),
    not just "my own team" — but a viewer outside their own team only ever
    sees AGGREGATE numbers per org unit, never another manager's individual
    reports. See org_unit_capacity_rollup() in the schema/migration for how
    that's enforced (SECURITY DEFINER, aggregate-only return shape).

Role-scoped views (Session 15, 2026-08-03 — see docs/SESSION_HISTORY.md and
the role_scoped_views project memory note): get_rollup below is now gated by
led_org_unit_ids() — the caller only sees units they lead (org_units.
leader_user_id = them) plus every descendant. This closes the gap flagged
above ("no second manager yet to build a real permissions system against")
by adding an explicit per-unit leader instead. Before this, any
authenticated org member could read the whole org's rollup; now a caller who
leads nothing gets an empty list.

Two computation paths exist and must be kept in sync:
  - "My team" (get_overview below): the caller's own direct_reports, RLS
    already scopes this so it's computed here in Python.
  - Department/org rollup (get_rollup below): calls the org_unit_capacity_
    rollup() SQL function, which duplicates this same formula (including the
    off-days precedence rule) because it needs to run SECURITY DEFINER
    across managers. If the formula changes, change it in both places — see
    database/schema.sql's comment on that function.
"""
from datetime import date

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from utils import ensure_org, get_authenticated_client, get_email_from_token

router = APIRouter()

_TIME_OFF_TYPES = ("pto", "sick", "holiday", "other")

_DEFAULT_HOURS_PER_WEEK = 40.0
_DEFAULT_TARGET_UTILIZATION_PCT = 75.0
_DEFAULT_OFF_DAYS_PER_YEAR = 21.0  # 15 vacation + 6 sick, Andrew's own default


# ---------------------------------------------------------------------------
# Shared capacity math — mirrors org_unit_capacity_rollup() in schema.sql.
# ---------------------------------------------------------------------------

def _period_weeks(start: date, end: date) -> float:
    return max((end - start).days + 1, 0) / 7.0


def _time_off_hours(entries: list[dict], start: date, end: date, fallback_daily_hours: float) -> float:
    total = 0.0
    for e in entries:
        e_start = max(date.fromisoformat(e["start_date"]), start)
        e_end = min(date.fromisoformat(e["end_date"]), end)
        days = (e_end - e_start).days + 1
        if days <= 0:
            continue
        daily = e["hours_per_day"] if e.get("hours_per_day") is not None else fallback_daily_hours
        total += days * daily
    return total


def _effective_off_hours(
    actual_time_off_hours: float, off_days_per_year: float, hours_per_day: float, weeks: float
) -> tuple[float, str]:
    """Actual logged time off wins for the period it overlaps ("logged");
    otherwise fall back to a prorated share of the annual off_days_per_year
    default ("assumed"). Mirrors org_unit_capacity_rollup()'s CASE — keep
    both in sync if this changes."""
    if actual_time_off_hours > 0:
        return actual_time_off_hours, "logged"
    return off_days_per_year * hours_per_day * (weeks / 52.0), "assumed"


def _available_hours(contracted_hours_per_week: float, target_utilization_pct: float, weeks: float, off_hours: float) -> float:
    baseline = contracted_hours_per_week * weeks * (target_utilization_pct / 100.0)
    return max(baseline - off_hours, 0.0)


def _get_org_id(user_id: str, supabase) -> str | None:
    """Read-only org lookup — unlike ensure_org(), never creates one. A page
    load (e.g. GET /settings before anything's been saved) shouldn't bootstrap
    an organization; only a write should."""
    rows = supabase.table("users").select("org_id").eq("id", user_id).execute().data
    return rows[0]["org_id"] if rows and rows[0].get("org_id") else None


# ---------------------------------------------------------------------------
# Settings — org-wide defaults (Settings > Capacity, "configured once")
# ---------------------------------------------------------------------------

class CapacitySettingsIn(BaseModel):
    default_hours_per_week: float = _DEFAULT_HOURS_PER_WEEK
    default_target_utilization_pct: float = _DEFAULT_TARGET_UTILIZATION_PCT
    default_off_days_per_year: float = _DEFAULT_OFF_DAYS_PER_YEAR


@router.get("/settings")
async def get_capacity_settings(auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    org_id = _get_org_id(user_id, supabase)
    row = None
    if org_id:
        rows = supabase.table("capacity_settings").select("*").eq("org_id", org_id).execute().data
        row = rows[0] if rows else None
    return {
        "default_hours_per_week": (row or {}).get("default_hours_per_week", _DEFAULT_HOURS_PER_WEEK),
        "default_target_utilization_pct": (row or {}).get(
            "default_target_utilization_pct", _DEFAULT_TARGET_UTILIZATION_PCT
        ),
        "default_off_days_per_year": (row or {}).get("default_off_days_per_year", _DEFAULT_OFF_DAYS_PER_YEAR),
    }


@router.put("/settings")
async def update_capacity_settings(
    body: CapacitySettingsIn, auth=Depends(get_authenticated_client), authorization: str = Header(None)
):
    user_id, supabase = auth
    org_id = ensure_org(user_id, supabase, get_email_from_token(authorization))
    supabase.table("capacity_settings").upsert(
        {**body.model_dump(), "org_id": org_id}, on_conflict="org_id"
    ).execute()
    return await get_capacity_settings(auth=auth)


# ---------------------------------------------------------------------------
# Work unit configs — optional per-role-level display translation
# (Settings > Capacity, alongside the org defaults)
# ---------------------------------------------------------------------------

class WorkUnitConfigIn(BaseModel):
    role_level_id: str
    unit_name: str
    hours_per_unit: float


@router.get("/work-units")
async def list_work_unit_configs(auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    return supabase.table("work_unit_configs").select("*").execute().data


@router.post("/work-units")
async def create_work_unit_config(
    body: WorkUnitConfigIn, auth=Depends(get_authenticated_client), authorization: str = Header(None)
):
    user_id, supabase = auth
    if body.hours_per_unit <= 0:
        raise HTTPException(status_code=422, detail="hours_per_unit must be greater than 0")
    org_id = ensure_org(user_id, supabase, get_email_from_token(authorization))
    # One config per role_level — upsert so re-adding for the same role edits
    # in place instead of erroring on the unique constraint.
    result = (
        supabase.table("work_unit_configs")
        .upsert({**body.model_dump(), "org_id": org_id}, on_conflict="role_level_id")
        .execute()
    )
    return result.data[0]


@router.delete("/work-units/{config_id}")
async def delete_work_unit_config(config_id: str, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    supabase.table("work_unit_configs").delete().eq("id", config_id).execute()
    return {"deleted": True}


# ---------------------------------------------------------------------------
# Capacity profiles — per-direct-report override of the org defaults
# ---------------------------------------------------------------------------

class CapacityProfileIn(BaseModel):
    contracted_hours_per_week: float | None = None
    target_utilization_pct: float | None = None
    off_days_per_year: float | None = None


@router.get("/profiles/{direct_report_id}")
async def get_capacity_profile(direct_report_id: str, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    # RLS (direct_reports_all_own) blocks reading a report that isn't this
    # manager's, so a report the caller can't see 404s here rather than
    # silently returning someone else's data.
    owns = (
        supabase.table("direct_reports").select("id").eq("id", direct_report_id).execute().data
    )
    if not owns:
        raise HTTPException(status_code=404, detail="Direct report not found")
    rows = (
        supabase.table("capacity_profiles")
        .select("contracted_hours_per_week,target_utilization_pct,off_days_per_year")
        .eq("direct_report_id", direct_report_id)
        .execute()
        .data
    )
    if rows:
        return rows[0]
    return {"contracted_hours_per_week": None, "target_utilization_pct": None, "off_days_per_year": None}


@router.put("/profiles/{direct_report_id}")
async def upsert_capacity_profile(
    direct_report_id: str, body: CapacityProfileIn, auth=Depends(get_authenticated_client)
):
    user_id, supabase = auth
    result = (
        supabase.table("capacity_profiles")
        .upsert(
            {**body.model_dump(), "direct_report_id": direct_report_id},
            on_conflict="direct_report_id",
        )
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Direct report not found")
    return result.data[0]


# ---------------------------------------------------------------------------
# Time off — PTO / sick / holiday / other, logged per direct report
# ---------------------------------------------------------------------------

class TimeOffIn(BaseModel):
    direct_report_id: str
    start_date: date
    end_date: date
    type: str = "pto"
    hours_per_day: float | None = None
    notes: str | None = None


def _validate_time_off(body: TimeOffIn):
    if body.type not in _TIME_OFF_TYPES:
        raise HTTPException(status_code=422, detail=f"type must be one of {_TIME_OFF_TYPES}")
    if body.end_date < body.start_date:
        raise HTTPException(status_code=422, detail="end_date must be on or after start_date")


@router.get("/time-off")
async def list_time_off(direct_report_id: str | None = None, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    query = supabase.table("time_off_entries").select("*")
    if direct_report_id:
        query = query.eq("direct_report_id", direct_report_id)
    return query.order("start_date", desc=True).execute().data


@router.post("/time-off")
async def create_time_off(body: TimeOffIn, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    _validate_time_off(body)
    payload = body.model_dump(mode="json")
    result = supabase.table("time_off_entries").insert(payload).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Direct report not found")
    return result.data[0]


@router.delete("/time-off/{entry_id}")
async def delete_time_off(entry_id: str, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    supabase.table("time_off_entries").delete().eq("id", entry_id).execute()
    return {"deleted": True}


# ---------------------------------------------------------------------------
# Overview — "my team" for a given period. Manager-scoped (RLS), computed in
# Python. Individual + team-total view; the frontend sums these client-side
# for the team total, same as it already sums org_units client-side for the
# org chart.
# ---------------------------------------------------------------------------

@router.get("/overview")
async def get_overview(period_start: date, period_end: date, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    if period_end < period_start:
        raise HTTPException(status_code=422, detail="period_end must be on or after period_start")

    # Archived people (Session 43) don't count toward capacity — see
    # docs/TEAM_SETUP_UX_REVIEW.md §7.3, finding P1.
    reports = (
        supabase.table("direct_reports")
        .select("id,name,role_title,role_level_id,org_unit_id")
        .eq("manager_id", user_id)
        .is_("archived_at", "null")
        .order("name")
        .execute()
        .data
    )
    if not reports:
        return []

    org_id = _get_org_id(user_id, supabase)
    settings_rows = (
        supabase.table("capacity_settings").select("*").eq("org_id", org_id).execute().data if org_id else []
    )
    org_defaults = settings_rows[0] if settings_rows else {}
    default_hours = org_defaults.get("default_hours_per_week", _DEFAULT_HOURS_PER_WEEK)
    default_utilization = org_defaults.get("default_target_utilization_pct", _DEFAULT_TARGET_UTILIZATION_PCT)
    default_off_days = org_defaults.get("default_off_days_per_year", _DEFAULT_OFF_DAYS_PER_YEAR)

    report_ids = [r["id"] for r in reports]
    profiles = (
        supabase.table("capacity_profiles")
        .select("*")
        .in_("direct_report_id", report_ids)
        .execute()
        .data
    )
    profile_by_report = {p["direct_report_id"]: p for p in profiles}

    time_off = (
        supabase.table("time_off_entries")
        .select("direct_report_id,start_date,end_date,hours_per_day")
        .in_("direct_report_id", report_ids)
        .lte("start_date", period_end.isoformat())
        .gte("end_date", period_start.isoformat())
        .execute()
        .data
    )
    time_off_by_report: dict[str, list[dict]] = {}
    for t in time_off:
        time_off_by_report.setdefault(t["direct_report_id"], []).append(t)

    weeks = _period_weeks(period_start, period_end)
    out = []
    for r in reports:
        profile = profile_by_report.get(r["id"], {})
        contracted_hours = profile.get("contracted_hours_per_week") or default_hours
        target_utilization = profile.get("target_utilization_pct") or default_utilization
        off_days_per_year = profile.get("off_days_per_year") or default_off_days
        entries = time_off_by_report.get(r["id"], [])
        hours_per_day = contracted_hours / 5.0
        actual_time_off_hours = _time_off_hours(entries, period_start, period_end, hours_per_day)
        off_hours, off_hours_source = _effective_off_hours(actual_time_off_hours, off_days_per_year, hours_per_day, weeks)
        available_hours = _available_hours(contracted_hours, target_utilization, weeks, off_hours)
        out.append(
            {
                "direct_report_id": r["id"],
                "name": r["name"],
                "role_title": r["role_title"],
                "role_level_id": r["role_level_id"],
                "org_unit_id": r["org_unit_id"],
                "contracted_hours_per_week": contracted_hours,
                "target_utilization_pct": target_utilization,
                "off_days_per_year": off_days_per_year,
                # off_hours: the figure actually subtracted this period — either
                # real logged time off ("logged") or a prorated share of
                # off_days_per_year ("assumed"). See _effective_off_hours().
                "off_hours": round(off_hours, 1),
                "off_hours_source": off_hours_source,
                "available_hours": round(available_hours, 1),
            }
        )
    return out


# ---------------------------------------------------------------------------
# Rollup — department/org level via the org_units tree. Calls the
# SECURITY DEFINER SQL function so it can aggregate across every manager in
# the org; the response is aggregate-only (org_unit_id + count + hours),
# joined here with org_units purely to attach display names — never a named
# individual.
#
# Gated by led_org_unit_ids() as of Session 15 (see docs/SESSION_HISTORY.md
# and the role_scoped_views project memory note): previously this cross-
# joined every org_unit in the org (readable by any org member) and
# zero-filled units with no data. Now the org_units side of the join is
# ALSO restricted to the caller's led scope — cross-joining against the
# full org list here would zero-fill units outside that scope, which would
# misread as "this team has 0 capacity" instead of "you can't see this
# team." A caller who leads nothing gets an empty list, not a wall of
# zeros — see the frontend's empty state for that case.
# ---------------------------------------------------------------------------

@router.get("/rollup")
async def get_rollup(period_start: date, period_end: date, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    if period_end < period_start:
        raise HTTPException(status_code=422, detail="period_end must be on or after period_start")

    led_scope = [row["unit_id"] for row in supabase.rpc("led_org_unit_ids", {}).execute().data]
    if not led_scope:
        return []

    rollup_rows = (
        supabase.rpc(
            "org_unit_capacity_rollup",
            {"p_period_start": period_start.isoformat(), "p_period_end": period_end.isoformat()},
        )
        .execute()
        .data
    )
    rollup_by_unit = {row["org_unit_id"]: row for row in rollup_rows}

    org_units = supabase.table("org_units").select("*").in_("id", led_scope).execute().data
    return [
        {
            "org_unit_id": ou["id"],
            "name": ou["name"],
            "unit_type": ou["unit_type"],
            "parent_unit_id": ou["parent_unit_id"],
            "direct_report_count": rollup_by_unit.get(ou["id"], {}).get("direct_report_count", 0),
            "available_hours": round(rollup_by_unit.get(ou["id"], {}).get("available_hours", 0) or 0, 1),
        }
        for ou in org_units
    ]
