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

Role-scoped views (Session 15, 2026-08-03 — see docs/SESSION_HISTORY.md and
the role_scoped_views project memory note): this closes the "distinct
audience" gap called out above. GET /rollup returns status counts for
department/team-level goals (org_unit_id set) within the org units the
caller leads — never a named goal, just counts. Calls the
org_unit_goals_rollup() SQL function (SECURITY DEFINER, gated by
led_org_unit_ids()), mirroring capacity.py's get_rollup. Individual-level
goals aren't included — a deliberate v1 scope limit, see the SQL function's
comment in schema.sql.

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

Goal measures (2026-09-25, docs/systems/goals.md): one optional numeric
measure per goal (measure_* columns) with readings on check_ins.measured_value.
The goal check-in write goes through the record_goal_check_in() SQL function
so the check-in and the status write-through land in one transaction, and a
client_request_id makes a retried submit return the row it already created.
PUT only touches the measure when the body includes `measure`, so callers
that predate it never clear one.
"""
import math
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from postgrest.exceptions import APIError
from pydantic import BaseModel

from routes.check_ins import (
    GOAL_CHECK_IN_COLUMNS,
    CheckInIn,
    enrich_with_check_ins,
    list_check_ins,
)
from utils import get_authenticated_client

router = APIRouter()

_LEVELS = ("company", "department", "team", "individual")
_STATUSES = ("active", "on_track", "at_risk", "completed", "cancelled")
_OPEN_STATUSES = ("active", "on_track", "at_risk")
_MEASURE_COLUMNS = ("measure_label", "measure_format", "measure_unit", "measure_target", "measure_direction")

_SELECT_COLUMNS = (
    "id,title,description,success_metrics,level,status,due_date,direct_report_id,"
    "parent_goal_id,org_unit_id,created_at," + ",".join(_MEASURE_COLUMNS) + ","
    "direct_reports(name),org_units(name,unit_type)"
)

# Parent chains are short in practice; this bounds the cycle walk.
_MAX_PARENT_DEPTH = 50
UPDATES_DEFAULT_LIMIT = 150
UPDATES_MAX_LIMIT = 300


class GoalMeasureIn(BaseModel):
    """One optional numeric measure. `format` drives validation only:
    count = whole number >= 0, number = any finite value, percent = any
    finite value (not capped at 100). `unit` is a display label and is never
    parsed. `direction` is how a reading compares with the target."""

    label: str
    format: Literal["count", "number", "percent"]
    unit: str | None = None
    target: float
    direction: Literal["at_least", "at_most", "below"]


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
    # Omitted = leave the stored measure alone. null = no measure.
    measure: GoalMeasureIn | None = None


class GoalStatusUpdate(BaseModel):
    status: str


class GoalCheckInIn(CheckInIn):
    """A goal check-in. `progress` stays the manually asserted completion %;
    `measured_value` is a reading of the goal's numeric measure. Blank (null)
    means no new reading and 0 is a real one. Both new fields are optional so
    older callers (the Scribe) send exactly what they always did."""

    measured_value: float | None = None
    client_request_id: str | None = None


def _validate_level(level: str):
    if level not in _LEVELS:
        raise HTTPException(status_code=422, detail=f"level must be one of {_LEVELS}")


def _validate_status(status: str):
    if status not in _STATUSES:
        raise HTTPException(status_code=422, detail=f"status must be one of {_STATUSES}")


def validate_measure_value(fmt: str, value: float, what: str = "value") -> None:
    if not math.isfinite(value):
        raise HTTPException(status_code=422, detail=f"The {what} must be a finite number")
    if fmt == "count" and (value < 0 or not float(value).is_integer()):
        raise HTTPException(status_code=422, detail=f"A count {what} must be a whole number of zero or more")


def _measure_columns(measure: GoalMeasureIn | None) -> dict:
    if measure is None:
        return {col: None for col in _MEASURE_COLUMNS}
    label = measure.label.strip()
    if not label:
        raise HTTPException(status_code=422, detail="A measure needs a description of what is counted")
    validate_measure_value(measure.format, measure.target, "target")
    unit = (measure.unit or "").strip() or None
    if measure.format == "percent":
        unit = "%"
    target = int(measure.target) if measure.format == "count" else measure.target
    return {
        "measure_label": label,
        "measure_format": measure.format,
        "measure_unit": unit,
        "measure_target": target,
        "measure_direction": measure.direction,
    }


def _shape_rows(rows: list[dict]) -> list[dict]:
    """Flatten the joined direct_reports.name and attach a parent goal's
    title when the parent happens to be in this same result set (true for
    the Goals page's unfiltered fetch; a filtered fetch — e.g. the DR detail
    page's per-report call — may leave this null, which is fine since that
    caller doesn't render parent info). The measure columns are also
    gathered into one `measure` object (null when none is configured)."""
    by_id = {r["id"]: r for r in rows}
    for row in rows:
        joined = row.pop("direct_reports", None) or {}
        row["direct_report_name"] = joined.get("name")
        org_unit = row.pop("org_units", None) or {}
        row["org_unit_name"] = org_unit.get("name")
        parent = by_id.get(row.get("parent_goal_id"))
        row["parent_goal_title"] = parent["title"] if parent else None
        cols = {col: row.pop(col, None) for col in _MEASURE_COLUMNS}
        row["measure"] = (
            {
                "label": cols["measure_label"],
                "format": cols["measure_format"],
                "unit": cols["measure_unit"],
                "target": _num(cols["measure_target"]),
                "direction": cols["measure_direction"],
            }
            if cols["measure_format"]
            else None
        )
    return rows


def _num(value):
    if value is None or isinstance(value, (int, float)):
        return value
    as_float = float(value)
    return int(as_float) if as_float.is_integer() else as_float


def _normalize_associations(values: dict) -> dict:
    """Keep each association consistent with the level, as the form does:
    a report only on an individual goal, an org unit only on a team or
    department goal."""
    if values["level"] != "individual":
        values["direct_report_id"] = None
    if values["level"] not in ("team", "department"):
        values["org_unit_id"] = None
    return values


def _validate_references(supabase, user_id: str, values: dict, goal_id: str | None = None) -> None:
    """A goal can only point at the caller's own report, an org unit visible
    to them of the goal's level, and one of their own goals without making a
    cycle. Foreign keys alone would accept anyone's id."""
    report_id = values.get("direct_report_id")
    if report_id:
        found = (
            supabase.table("direct_reports").select("id").eq("id", report_id).eq("manager_id", user_id).execute().data
        )
        if not found:
            raise HTTPException(status_code=422, detail="That direct report isn't one of yours")
    unit_id = values.get("org_unit_id")
    if unit_id:
        units = supabase.table("org_units").select("id,unit_type").eq("id", unit_id).execute().data
        if not units:
            raise HTTPException(status_code=422, detail="That team or department wasn't found")
        if units[0].get("unit_type") != values["level"]:
            raise HTTPException(status_code=422, detail=f"Pick a {values['level']} for a {values['level']} goal")
    parent_id = values.get("parent_goal_id")
    if parent_id:
        if goal_id and parent_id == goal_id:
            raise HTTPException(status_code=422, detail="A goal can't be its own parent")
        seen: set[str] = set()
        current = parent_id
        for _ in range(_MAX_PARENT_DEPTH):
            rows = (
                supabase.table("goals").select("id,parent_goal_id").eq("id", current).eq("owner_id", user_id).execute().data
            )
            if not rows:
                if current == parent_id:
                    raise HTTPException(status_code=422, detail="Parent goal not found")
                return
            nxt = rows[0].get("parent_goal_id")
            if not nxt:
                return
            if (goal_id and nxt == goal_id) or nxt in seen:
                raise HTTPException(status_code=422, detail="That parent would make a goal its own ancestor")
            seen.add(current)
            current = nxt
        raise HTTPException(status_code=422, detail="That parent chain is too deep")


def _goal_values(body: GoalIn) -> dict:
    values = body.model_dump(exclude={"measure"})
    values["title"] = values["title"].strip()
    if not values["title"]:
        raise HTTPException(status_code=422, detail="A goal needs a title")
    return _normalize_associations(values)


def _scoped_goal_query(supabase, user_id: str, columns: str, level, direct_report_id, org_unit_id, unassociated, status):
    query = supabase.table("goals").select(columns).eq("owner_id", user_id)
    if level:
        _validate_level(level)
        query = query.eq("level", level)
    if unassociated:
        # "Not linked" is its own scope, distinct from "All": individual goals
        # with no report, team/department goals with no org unit.
        column = "direct_report_id" if level == "individual" else "org_unit_id"
        query = query.is_(column, "null")
    else:
        if direct_report_id:
            query = query.eq("direct_report_id", direct_report_id)
        if org_unit_id:
            query = query.eq("org_unit_id", org_unit_id)
    if status:
        query = query.eq("status", status)
    return query


@router.get("")
def list_goals(
    level: str | None = None,
    direct_report_id: str | None = None,
    org_unit_id: str | None = None,
    status: str | None = None,
    auth=Depends(get_authenticated_client),
):
    user_id, supabase = auth
    query = _scoped_goal_query(supabase, user_id, _SELECT_COLUMNS, level, direct_report_id, org_unit_id, False, status)
    rows = query.order("created_at", desc=True).execute().data
    # Session 26: decorate with progress/trend/last_check_in_at from the
    # check_ins temporal layer — see routes/check_ins.py. Goal rows also get
    # latest_reading / recent_readings / reading_count.
    return enrich_with_check_ins(supabase, user_id, _shape_rows(rows), "goal_id")


@router.get("/updates")
def list_goal_updates(
    level: str | None = None,
    direct_report_id: str | None = None,
    org_unit_id: str | None = None,
    unassociated: bool = False,
    closed: bool = False,
    limit: int = UPDATES_DEFAULT_LIMIT,
    auth=Depends(get_authenticated_client),
):
    """Existing goal check-ins in one level/scope, newest first, for the
    Goals page's Updates view. `closed` picks closed goals instead of open
    ones, matching the board's filter. Bounded by `limit`."""
    user_id, supabase = auth
    limit = max(1, min(limit, UPDATES_MAX_LIMIT))
    goals = _scoped_goal_query(
        supabase, user_id, "id,status", level, direct_report_id, org_unit_id, unassociated, None
    ).execute().data
    ids = [g["id"] for g in goals if (g["status"] in _OPEN_STATUSES) != closed]
    if not ids:
        return []
    rows = (
        supabase.table("check_ins")
        .select(GOAL_CHECK_IN_COLUMNS)
        .eq("owner_id", user_id)
        .in_("goal_id", ids)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
        .data
    )
    for row in rows:
        row["measured_value"] = _num(row.get("measured_value"))
    return rows


@router.get("/{goal_id}/check-ins")
def get_goal_check_ins(goal_id: str, auth=Depends(get_authenticated_client)):
    """Check-in history for one goal, newest first (Session 26)."""
    user_id, supabase = auth
    rows = list_check_ins(supabase, user_id, "goal_id", goal_id)
    for row in rows:
        row["measured_value"] = _num(row.get("measured_value"))
    return rows


_RPC_ERRORS = {"P0002": 404, "22023": 422, "28000": 401, "23514": 409}


def _raise_from_api_error(err: APIError):
    status = _RPC_ERRORS.get(getattr(err, "code", None) or "")
    if status is None:
        raise err
    raise HTTPException(status_code=status, detail=getattr(err, "message", None) or "Couldn't save this goal")


@router.post("/{goal_id}/check-ins")
def create_goal_check_in(goal_id: str, body: GoalCheckInIn, auth=Depends(get_authenticated_client)):
    """Add an update: status (+ optional completion %, + optional measured
    reading, + optional note). One transaction via record_goal_check_in(),
    which also writes the status through to goals.status. A retry carrying
    the same client_request_id returns the original row."""
    user_id, supabase = auth
    _validate_status(body.status)
    if body.progress is not None and not 0 <= body.progress <= 100:
        raise HTTPException(status_code=422, detail="progress must be between 0 and 100")
    if body.measured_value is not None and not math.isfinite(body.measured_value):
        raise HTTPException(status_code=422, detail="A measured value must be a finite number")
    try:
        rows = (
            supabase.rpc(
                "record_goal_check_in",
                {
                    "p_goal_id": goal_id,
                    "p_status": body.status,
                    "p_progress": body.progress,
                    "p_measured_value": body.measured_value,
                    "p_note": body.note,
                    "p_client_request_id": body.client_request_id,
                },
            )
            .execute()
            .data
        )
    except APIError as err:
        _raise_from_api_error(err)
    row = rows[0] if isinstance(rows, list) else rows
    if not row:
        raise HTTPException(status_code=500, detail="The update wasn't confirmed")
    row["measured_value"] = _num(row.get("measured_value"))
    return row


@router.get("/rollup")
def get_goals_rollup(auth=Depends(get_authenticated_client)):
    """Department/team goal status counts across the org units the caller
    leads (see led_org_unit_ids()) — aggregate-only, same contract as
    capacity's rollup. Joined here with org_units purely to attach display
    names, same pattern as capacity.py's get_rollup."""
    user_id, supabase = auth
    rollup_rows = supabase.rpc("org_unit_goals_rollup", {}).execute().data
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
            "status": row["status"],
            "goal_count": row["goal_count"],
        }
        for row in rollup_rows
    ]


def _fetch_one(supabase, user_id: str, goal_id: str) -> dict:
    """Re-read a goal with its joins and check-in enrichment, so a mutation
    response carries the same fields as the list and the client never drops
    progress or readings it already had."""
    rows = supabase.table("goals").select(_SELECT_COLUMNS).eq("id", goal_id).eq("owner_id", user_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Goal not found")
    shaped = _shape_rows(rows)
    parent_id = shaped[0].get("parent_goal_id")
    if parent_id:
        parent = supabase.table("goals").select("title").eq("id", parent_id).eq("owner_id", user_id).execute().data
        shaped[0]["parent_goal_title"] = parent[0]["title"] if parent else None
    return enrich_with_check_ins(supabase, user_id, shaped, "goal_id")[0]


@router.post("")
def create_goal(body: GoalIn, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    _validate_level(body.level)
    _validate_status(body.status)
    values = _goal_values(body)
    _validate_references(supabase, user_id, values)
    if "measure" in body.model_fields_set:
        values.update(_measure_columns(body.measure))
    result = supabase.table("goals").insert({**values, "owner_id": user_id}).execute()
    return _fetch_one(supabase, user_id, result.data[0]["id"])


@router.put("/{goal_id}")
def update_goal(goal_id: str, body: GoalIn, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    _validate_level(body.level)
    _validate_status(body.status)
    values = _goal_values(body)
    _validate_references(supabase, user_id, values, goal_id)
    if "measure" in body.model_fields_set:
        new_measure = _measure_columns(body.measure)
        existing = (
            supabase.table("goals").select("measure_format,measure_unit").eq("id", goal_id).eq("owner_id", user_id).execute().data
        )
        if not existing:
            raise HTTPException(status_code=404, detail="Goal not found")
        changed = (
            existing[0].get("measure_format") != new_measure["measure_format"]
            or existing[0].get("measure_unit") != new_measure["measure_unit"]
        )
        if changed:
            has_readings = (
                supabase.table("check_ins")
                .select("id")
                .eq("owner_id", user_id)
                .eq("goal_id", goal_id)
                .not_.is_("measured_value", "null")
                .limit(1)
                .execute()
                .data
            )
            if has_readings:
                raise HTTPException(
                    status_code=409,
                    detail="This measure already has recorded values, so its format and unit can't change. "
                    "Edit the wording or target, or start a new goal for a different measure.",
                )
        values.update(new_measure)
    try:
        result = supabase.table("goals").update(values).eq("id", goal_id).eq("owner_id", user_id).execute()
    except APIError as err:
        _raise_from_api_error(err)
    if not result.data:
        raise HTTPException(status_code=404, detail="Goal not found")
    return _fetch_one(supabase, user_id, goal_id)


@router.patch("/{goal_id}")
def update_goal_status(goal_id: str, body: GoalStatusUpdate, auth=Depends(get_authenticated_client)):
    """Status is the one field goals get updated on constantly — a
    lightweight sibling to PUT, mirroring commitments.py's status-only
    PATCH so the frontend's inline status select doesn't need to resend the
    whole record. A status-only change is not a check-in: it never touches
    check_ins or any evidence date."""
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
def delete_goal(goal_id: str, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    # parent_goal_id has no ON DELETE clause (defaults to NO ACTION) — unparent
    # any children first so deleting a goal with sub-goals never blocks on the
    # FK. Mirrors delete_role_level's unlink-before-delete pattern in settings.py.
    supabase.table("goals").update({"parent_goal_id": None}).eq(
        "parent_goal_id", goal_id
    ).eq("owner_id", user_id).execute()
    supabase.table("goals").delete().eq("id", goal_id).eq("owner_id", user_id).execute()
    return {"deleted": True}
