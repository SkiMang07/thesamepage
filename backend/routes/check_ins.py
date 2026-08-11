"""
Check-ins — shared helpers for the goals/projects progress layer (Session 26,
2026-08-11; see docs/SESSION_HISTORY.md for the scoping conversation).

Not a router. Goals and projects share the same status enum and the same
check-in shape, so the two routers (goals.py, projects.py) mount thin
wrappers around these helpers rather than duplicating the logic:

  - create_check_in(): verify the caller owns the parent row, insert the
    check-in, then WRITE THROUGH the check-in's status to the parent's
    `status` column. That write-through is the design's load-bearing trick:
    every existing status-reading surface (Mission Control, /app/team's KPI
    strip and progress ring, the org-unit rollup SQL functions, the DR detail
    sections) keeps working unchanged, while progress/trend/staleness are
    derived fresh from check_ins by the helpers below.
  - list_check_ins(): a parent's check-in history, newest first.
  - enrich_with_check_ins(): decorate a list endpoint's rows with
    `progress` (latest non-null % asserted — a note-only check-in never
    wipes the number), `trend` ("up"/"down"/"flat"/None, latest two
    non-null %s), `last_check_in_at`, and `last_check_in_note`.

Requires database/migrations/2026-08-11_check_ins.sql to have been run
against the live database. RLS on check_ins is owner-scoped
(owner_id = auth.uid()), same actor as the goals/projects rows themselves.
"""
from fastapi import HTTPException
from pydantic import BaseModel

_STATUSES = ("active", "on_track", "at_risk", "completed", "cancelled")

_CHECK_IN_COLUMNS = "id,goal_id,project_id,status,progress,note,created_at"


class CheckInIn(BaseModel):
    status: str
    # Manually-asserted percent complete, 0-100. Optional — a check-in can be
    # just a status/note without re-asserting a number.
    progress: int | None = None
    note: str | None = None


def _validate(body: CheckInIn):
    if body.status not in _STATUSES:
        raise HTTPException(status_code=422, detail=f"status must be one of {_STATUSES}")
    if body.progress is not None and not 0 <= body.progress <= 100:
        raise HTTPException(status_code=422, detail="progress must be between 0 and 100")


def create_check_in(
    supabase,
    user_id: str,
    parent_table: str,  # "goals" | "projects"
    parent_fk: str,  # "goal_id" | "project_id"
    parent_id: str,
    body: CheckInIn,
) -> dict:
    _validate(body)
    # Ownership check doubles as the 404 (RLS would also block, but a clean
    # 404 beats an opaque FK/RLS error).
    parent = (
        supabase.table(parent_table)
        .select("id")
        .eq("id", parent_id)
        .eq("owner_id", user_id)
        .execute()
        .data
    )
    if not parent:
        raise HTTPException(status_code=404, detail=f"{parent_table[:-1].capitalize()} not found")
    row = (
        supabase.table("check_ins")
        .insert(
            {
                "owner_id": user_id,
                parent_fk: parent_id,
                "status": body.status,
                "progress": body.progress,
                "note": body.note,
            }
        )
        .execute()
        .data[0]
    )
    # Write through to the parent so every existing status-reading surface
    # stays correct without knowing check_ins exists.
    supabase.table(parent_table).update({"status": body.status}).eq("id", parent_id).eq(
        "owner_id", user_id
    ).execute()
    return row


def list_check_ins(supabase, user_id: str, parent_fk: str, parent_id: str) -> list[dict]:
    return (
        supabase.table("check_ins")
        .select(_CHECK_IN_COLUMNS)
        .eq("owner_id", user_id)
        .eq(parent_fk, parent_id)
        .order("created_at", desc=True)
        .execute()
        .data
    )


def enrich_with_check_ins(supabase, user_id: str, rows: list[dict], parent_fk: str) -> list[dict]:
    """Attach progress/trend/freshness to already-shaped goal or project rows.

    One extra query per list call (all check-ins for the returned ids, newest
    first), grouped in Python — fine at this product's scale, and it keeps
    PostgREST embedding quirks out of the picture.
    """
    for row in rows:
        row["progress"] = None
        row["trend"] = None
        row["last_check_in_at"] = None
        row["last_check_in_note"] = None
    ids = [r["id"] for r in rows]
    if not ids:
        return rows
    check_ins = (
        supabase.table("check_ins")
        .select(_CHECK_IN_COLUMNS)
        .eq("owner_id", user_id)
        .in_(parent_fk, ids)
        .order("created_at", desc=True)
        .execute()
        .data
    )
    by_parent: dict[str, list[dict]] = {}
    for ci in check_ins:
        by_parent.setdefault(ci[parent_fk], []).append(ci)
    by_id = {r["id"]: r for r in rows}
    for parent_id, history in by_parent.items():
        row = by_id.get(parent_id)
        if row is None:
            continue
        row["last_check_in_at"] = history[0]["created_at"]
        row["last_check_in_note"] = history[0]["note"]
        # Progress = latest non-null % asserted; trend compares the latest
        # two non-null %s (a note-only check-in neither wipes nor moves it).
        with_progress = [ci["progress"] for ci in history if ci["progress"] is not None]
        if with_progress:
            row["progress"] = with_progress[0]
        if len(with_progress) >= 2:
            delta = with_progress[0] - with_progress[1]
            row["trend"] = "up" if delta > 0 else "down" if delta < 0 else "flat"
    return rows
