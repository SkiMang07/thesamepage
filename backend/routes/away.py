"""
Away periods — "I'll be out from X to Y, push everything that would go
delinquent while I'm gone" (2026-09-01 scoping conversation with Andrew,
prompted by his own upcoming ten-day trip).

Decisions locked before this file was written:
  - v1 is manager-only. A direct report's own out-of-office is a real, but
    separate, follow-up (see the docstring on time_off_entries in
    capacity.py for the existing — and currently inert — employee-side
    concept).
  - Shift strategy is "move by the window length": every affected item's
    date advances by exactly the number of calendar days the manager is
    away (Sept 10-19 inclusive = 10 days), not "collapse everything onto
    the return date". A meeting date that lands on a weekend is nudged
    forward to the next Monday; a due date is left wherever it lands — a
    Saturday due date is harmless, a Saturday 1:1 is not.
  - Scope of what gets swept: the manager's own upcoming 1:1s and team
    meetings (the single next occurrence per series — see
    one_on_ones_upcoming_idx / team_meetings_open_idx, this app never
    materializes a batch of future rows), plus due dates on commitments,
    goals, and projects the MANAGER owns — never something a direct report
    owes. Concretely: commitments.committed_by = 'manager' (not
    'direct_report'), and goals/projects with direct_report_id IS NULL (the
    manager's own initiative, not one assigned to a report). A direct
    report's own commitment or assigned goal isn't blocked by the manager
    being out, so it's deliberately left untouched.
  - No notification to direct reports yet. This ships as internal schedule
    hygiene for the manager's own dashboard/lists; telling a direct report
    their 1:1 moved is on the manager for now.
  - Every write is recomputed fresh at apply time rather than trusting a
    client-held preview — a preview can go stale between the manager
    opening it and clicking confirm (someone logs a 1:1 in between, a
    commitment gets marked done, etc.).

See database/schema.sql's AWAY PERIODS section and docs/systems/away.md for
the full design, including why this is a new table pair rather than a
generalization of time_off_entries.
"""
from datetime import date, datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from utils import get_authenticated_client

router = APIRouter()

_OPEN_STATUSES = ("active", "on_track", "at_risk")

# entity_type -> (table, date column, owner column). Shared by the sweep
# computation (which only reads) and the apply step (which writes) so the
# two never drift on which column means what.
_ENTITY_TABLES = {
    "one_on_one": ("one_on_ones", "scheduled_at", "manager_id"),
    "team_meeting": ("team_meetings", "scheduled_at", "manager_id"),
    "commitment": ("commitments", "due_date", "owner_id"),
    "goal": ("goals", "due_date", "owner_id"),
    "project": ("projects", "due_date", "owner_id"),
}


class AwayPeriodIn(BaseModel):
    start_date: date
    end_date: date
    reason: str | None = None


def _validate_window(start: date, end: date) -> None:
    if end < start:
        raise HTTPException(status_code=422, detail="end_date must be on or after start_date")


def _window_days(start: date, end: date) -> int:
    """Inclusive day count — away Sept 10-19 is 10 days, and everything
    affected shifts forward by exactly that many days."""
    return (end - start).days + 1


def _shift_date(d: date, days: int) -> date:
    return d + timedelta(days=days)


def _nudge_off_weekend(d: date) -> date:
    """Push a Saturday/Sunday forward to the following Monday. Only applied
    to meeting occurrences (1:1s, team meetings) — see the module
    docstring for why due dates are left alone."""
    if d.weekday() == 5:  # Saturday
        return d + timedelta(days=2)
    if d.weekday() == 6:  # Sunday
        return d + timedelta(days=1)
    return d


def _noon_utc(d: date) -> str:
    """scheduled_at's stable encoding for a plain calendar date, exactly as
    utils.meeting_date_of()'s docstring and the 2026-08-28 migration use it
    — noon UTC so the calendar day can't roll over in any timezone."""
    return datetime.combine(d, time(12, 0), tzinfo=timezone.utc).isoformat()


def _day_bounds_utc(start: date, end: date) -> tuple[str, str]:
    """[start, end) as UTC timestamp bounds for a gte/lt range query against
    a timestamptz column, inclusive of the whole end_date."""
    start_ts = datetime.combine(start, time.min, tzinfo=timezone.utc).isoformat()
    end_ts = datetime.combine(end + timedelta(days=1), time.min, tzinfo=timezone.utc).isoformat()
    return start_ts, end_ts


def _compute_sweep(user_id: str, supabase, start: date, end: date) -> tuple[int, list[dict]]:
    """Read-only: find everything that would move, and where to. Used by
    both the preview endpoint (which stops here) and the apply endpoint
    (which recomputes this fresh, then writes it)."""
    shift_days = _window_days(start, end)
    items: list[dict] = []
    start_ts, end_ts = _day_bounds_utc(start, end)

    # 1:1s — only the single upcoming, not-yet-logged occurrence per series
    # can exist in the future at all (see one_on_ones_upcoming_idx).
    one_on_ones = (
        supabase.table("one_on_ones")
        .select("id,scheduled_at,direct_reports(name)")
        .eq("manager_id", user_id)
        .is_("summary", "null")
        .not_.is_("scheduled_at", "null")
        .gte("scheduled_at", start_ts)
        .lt("scheduled_at", end_ts)
        .execute()
        .data
    )
    for row in one_on_ones:
        old_day = datetime.fromisoformat(row["scheduled_at"].replace("Z", "+00:00")).date()
        new_day = _nudge_off_weekend(_shift_date(old_day, shift_days))
        name = (row.get("direct_reports") or {}).get("name") or "your direct report"
        items.append({
            "entity_type": "one_on_one",
            "entity_id": row["id"],
            "label": f"1:1 with {name}",
            "old_date": old_day.isoformat(),
            "new_date": new_day.isoformat(),
        })

    # Team meetings — same shape as 1:1s.
    team_meetings = (
        supabase.table("team_meetings")
        .select("id,scheduled_at,org_units(name)")
        .eq("manager_id", user_id)
        .is_("summary", "null")
        .not_.is_("scheduled_at", "null")
        .gte("scheduled_at", start_ts)
        .lt("scheduled_at", end_ts)
        .execute()
        .data
    )
    for row in team_meetings:
        old_day = datetime.fromisoformat(row["scheduled_at"].replace("Z", "+00:00")).date()
        new_day = _nudge_off_weekend(_shift_date(old_day, shift_days))
        unit = row.get("org_units") or {}
        label = f"{unit['name']} team meeting" if unit.get("name") else "Team meeting"
        items.append({
            "entity_type": "team_meeting",
            "entity_id": row["id"],
            "label": label,
            "old_date": old_day.isoformat(),
            "new_date": new_day.isoformat(),
        })

    # Commitments the MANAGER owes — never one a direct report owes, even
    # though owner_id is the manager on every row (owner_id = "who keeps the
    # record", committed_by = "who owes it").
    commitments = (
        supabase.table("commitments")
        .select("id,description,due_date")
        .eq("owner_id", user_id)
        .eq("committed_by", "manager")
        .eq("status", "open")
        .gte("due_date", start.isoformat())
        .lte("due_date", end.isoformat())
        .execute()
        .data
    )
    for row in commitments:
        old_day = date.fromisoformat(row["due_date"])
        new_day = _shift_date(old_day, shift_days)
        items.append({
            "entity_type": "commitment",
            "entity_id": row["id"],
            "label": row.get("description") or "Commitment",
            "old_date": old_day.isoformat(),
            "new_date": new_day.isoformat(),
        })

    # Goals — only the manager's own initiative (direct_report_id null),
    # only ones still open.
    goals = (
        supabase.table("goals")
        .select("id,title,due_date")
        .eq("owner_id", user_id)
        .is_("direct_report_id", "null")
        .in_("status", _OPEN_STATUSES)
        .gte("due_date", start.isoformat())
        .lte("due_date", end.isoformat())
        .execute()
        .data
    )
    for row in goals:
        old_day = date.fromisoformat(row["due_date"])
        new_day = _shift_date(old_day, shift_days)
        items.append({
            "entity_type": "goal",
            "entity_id": row["id"],
            "label": row["title"],
            "old_date": old_day.isoformat(),
            "new_date": new_day.isoformat(),
        })

    # Projects — same rule as goals.
    projects = (
        supabase.table("projects")
        .select("id,title,due_date")
        .eq("owner_id", user_id)
        .is_("direct_report_id", "null")
        .in_("status", _OPEN_STATUSES)
        .gte("due_date", start.isoformat())
        .lte("due_date", end.isoformat())
        .execute()
        .data
    )
    for row in projects:
        old_day = date.fromisoformat(row["due_date"])
        new_day = _shift_date(old_day, shift_days)
        items.append({
            "entity_type": "project",
            "entity_id": row["id"],
            "label": row["title"],
            "old_date": old_day.isoformat(),
            "new_date": new_day.isoformat(),
        })

    return shift_days, items


@router.post("/preview")
async def preview_away_period(body: AwayPeriodIn, auth=Depends(get_authenticated_client)):
    """Compute what would move without persisting anything."""
    user_id, supabase = auth
    _validate_window(body.start_date, body.end_date)
    shift_days, items = _compute_sweep(user_id, supabase, body.start_date, body.end_date)
    return {"window_days": shift_days, "items": items}


@router.post("")
async def apply_away_period(body: AwayPeriodIn, auth=Depends(get_authenticated_client)):
    """Recompute the sweep fresh (see module docstring on staleness), then
    apply it: create the away_periods row, update every affected item's
    date, and write one away_period_shifts audit row per item moved."""
    user_id, supabase = auth
    _validate_window(body.start_date, body.end_date)
    shift_days, items = _compute_sweep(user_id, supabase, body.start_date, body.end_date)

    period = (
        supabase.table("away_periods")
        .insert({
            "manager_id": user_id,
            "start_date": body.start_date.isoformat(),
            "end_date": body.end_date.isoformat(),
            "reason": body.reason,
        })
        .execute()
        .data[0]
    )

    shift_rows = []
    for item in items:
        table_name, column, owner_column = _ENTITY_TABLES[item["entity_type"]]
        new_value = (
            _noon_utc(date.fromisoformat(item["new_date"]))
            if column == "scheduled_at"
            else item["new_date"]
        )
        (
            supabase.table(table_name)
            .update({column: new_value})
            .eq("id", item["entity_id"])
            .eq(owner_column, user_id)
            .execute()
        )
        shift_rows.append({
            "away_period_id": period["id"],
            "manager_id": user_id,
            "entity_type": item["entity_type"],
            "entity_id": item["entity_id"],
            "label": item["label"],
            "old_date": item["old_date"],
            "new_date": item["new_date"],
        })

    if shift_rows:
        supabase.table("away_period_shifts").insert(shift_rows).execute()

    return {"id": period["id"], "window_days": shift_days, "items": items}


@router.get("")
async def list_away_periods(auth=Depends(get_authenticated_client)):
    """History of past away periods, each with how many items it moved."""
    user_id, supabase = auth
    periods = (
        supabase.table("away_periods")
        .select("id,start_date,end_date,reason,applied_at,created_at")
        .eq("manager_id", user_id)
        .order("start_date", desc=True)
        .execute()
        .data
    )
    if not periods:
        return []

    period_ids = [p["id"] for p in periods]
    shifts = (
        supabase.table("away_period_shifts")
        .select("away_period_id")
        .in_("away_period_id", period_ids)
        .execute()
        .data
    )
    counts: dict[str, int] = {}
    for s in shifts:
        counts[s["away_period_id"]] = counts.get(s["away_period_id"], 0) + 1
    for p in periods:
        p["shift_count"] = counts.get(p["id"], 0)
    return periods


@router.get("/{period_id}")
async def get_away_period(period_id: str, auth=Depends(get_authenticated_client)):
    """One past away period plus the full list of items it moved."""
    user_id, supabase = auth
    periods = (
        supabase.table("away_periods")
        .select("id,start_date,end_date,reason,applied_at,created_at")
        .eq("id", period_id)
        .eq("manager_id", user_id)
        .execute()
        .data
    )
    if not periods:
        raise HTTPException(status_code=404, detail="Away period not found")

    shifts = (
        supabase.table("away_period_shifts")
        .select("id,entity_type,entity_id,label,old_date,new_date")
        .eq("away_period_id", period_id)
        .order("entity_type")
        .execute()
        .data
    )
    return {**periods[0], "shifts": shifts}
