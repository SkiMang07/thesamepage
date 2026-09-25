"""
Projects — activates the dormant `projects` table (Session 13 scoping
conversation with Andrew; see docs/SESSION_HISTORY.md and the
projects_scoping project memory note).

Decisions locked before this file was written (mirrors the Goals/Org/Team
"scope first, then build" pattern from Sessions 10-12):
  - Projects gets its own top-level page (frontend/app/app/projects), same
    reasoning as Goals — projects get created and status-updated regularly,
    unlike Settings' "configure once" tables.
  - A project can be assigned to a specific direct report (direct_report_id,
    added this session) or left unassigned (the manager's own initiative).
  - Deliberately NOT given its own level/org_unit_id like goals at this
    point — see Session 46 below, which reverses this once Andrew had a real
    need for it.
  - Commitments -> project linking (commitments.source_type = 'project',
    already in schema.sql's check constraint) stays deferred this pass, same
    scope discipline as Goals shipping without rollup calculation.

RLS note: schema.sql's goals/projects policies are named "*_all_own_org" but
actually scope by `owner_id = auth.uid()`, not org_id — same gotcha
documented in goals.py. This router does not populate org_id.

Role-scoped views (Session 15, 2026-08-03 — see docs/SESSION_HISTORY.md and
the role_scoped_views project memory note): GET /rollup returns status
counts across the org units the caller leads, scoped the same way a
project's own scope was derived before Session 46 (its goal's org_unit_id
first, falling back to its assigned direct report's org_unit_id). Calls
org_unit_projects_rollup() (SECURITY DEFINER, gated by led_org_unit_ids()),
mirroring capacity.py's get_rollup. Session 46 did NOT touch this function
to prefer the new direct org_unit_id column — flagged as a follow-up, not
done this pass (see the team_project_goal_hierarchy project memory note).

Session 46 (2026-08-20, team_project_goal_hierarchy project memory note):
projects gain a real org_unit_id, same mechanism as goals.org_unit_id
(Session 11) — this is the "project needs independent scope later" case the
original docstring above anticipated. Andrew wanted /app/team's Initiatives
card to filter by an explicitly-assigned team instead of proxying through
whoever the project happened to be assigned to. Unlike goals, projects have
no level enum, so org_unit_id can point at any org_unit regardless of
unit_type (team or department) — the picker on /app/projects shows both.
`database/migrations/2026-08-20_projects_org_unit.sql` backfills existing
projects' org_unit_id from their assignee's org_unit_id so nothing silently
drops out of a team-filtered view the moment this ships.

Projects in motion (2026-09-25, docs/systems/projects.md): the project
check-in write goes through record_project_check_in() — check-in plus status
write-through in one transaction, and a client_request_id makes a retried
submit return the row it already created. Linked report/goal/team ids are
checked against the caller's own records (a foreign key alone accepts
anyone's id). Each project can carry the manager's private next move
(project_follow_throughs): at most one open per project, completed moves kept,
independent of the project's status, never shown to anyone else.
"""
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from postgrest.exceptions import APIError
from pydantic import BaseModel

from routes.check_ins import CheckInIn, enrich_with_check_ins, list_check_ins
from utils import get_authenticated_client

router = APIRouter()

_STATUSES = ("active", "on_track", "at_risk", "completed", "cancelled")

_SELECT_COLUMNS = (
    "id,title,description,goal_id,status,due_date,direct_report_id,org_unit_id,"
    "created_at,direct_reports(name),goals(title),org_units(name)"
)


class ProjectIn(BaseModel):
    title: str
    description: str | None = None
    status: str = "active"
    due_date: str | None = None
    direct_report_id: str | None = None
    # Optional — a project can stand alone or hang off a goal (goals=what,
    # projects=how).
    goal_id: str | None = None
    # Session 46: which team/department this project belongs to. Null means
    # no team assigned — visible only under /app/team's "All teams", not
    # under any specific team's filter (same posture as an unassigned
    # direct report).
    org_unit_id: str | None = None


class ProjectStatusUpdate(BaseModel):
    status: str


class ProjectCheckInIn(CheckInIn):
    """A project update. Blank progress means no new completion; 0 is real.
    `client_request_id` is optional so older callers (the Scribe) send exactly
    what they always did."""

    client_request_id: UUID | None = None


class FollowThroughIn(BaseModel):
    body: str


class FollowThroughUpdate(BaseModel):
    body: str | None = None
    status: str | None = None  # 'open' | 'done'


_FOLLOW_COLUMNS = "id,project_id,body,status,completed_at,created_at,updated_at"
_FOLLOW_MAX = 1000


def _validate_status(status: str):
    if status not in _STATUSES:
        raise HTTPException(status_code=422, detail=f"status must be one of {_STATUSES}")


def _project_values(body: ProjectIn) -> dict:
    values = body.model_dump()
    values["title"] = values["title"].strip()
    if not values["title"]:
        raise HTTPException(status_code=422, detail="A project needs a name")
    for key in ("direct_report_id", "goal_id", "org_unit_id", "due_date", "description"):
        if isinstance(values.get(key), str) and not values[key].strip():
            values[key] = None
    return values


def _validate_references(supabase, user_id: str, values: dict) -> None:
    """A project can only point at the caller's own report and goal, and a
    team or department they can see."""
    report_id = values.get("direct_report_id")
    if report_id:
        found = (
            supabase.table("direct_reports").select("id").eq("id", report_id).eq("manager_id", user_id).execute().data
        )
        if not found:
            raise HTTPException(status_code=422, detail="That direct report isn't one of yours")
    goal_id = values.get("goal_id")
    if goal_id:
        found = supabase.table("goals").select("id").eq("id", goal_id).eq("owner_id", user_id).execute().data
        if not found:
            raise HTTPException(status_code=422, detail="That goal wasn't found")
    unit_id = values.get("org_unit_id")
    if unit_id:
        found = supabase.table("org_units").select("id").eq("id", unit_id).execute().data
        if not found:
            raise HTTPException(status_code=422, detail="That team or department wasn't found")


def _attach_follow_through(supabase, user_id: str, rows: list[dict]) -> list[dict]:
    """Each row's OPEN next move (or None). One query for the whole list. If
    it fails, `next_move_available` is False so the page says unavailable
    instead of showing an empty list as if nothing were open."""
    for row in rows:
        row["next_move"] = None
        row["next_move_available"] = True
    ids = [r["id"] for r in rows]
    if not ids:
        return rows
    try:
        items = (
            supabase.table("project_follow_throughs")
            .select(_FOLLOW_COLUMNS)
            .eq("owner_id", user_id)
            .eq("status", "open")
            .in_("project_id", ids)
            .execute()
            .data
        )
    except APIError:
        for row in rows:
            row["next_move_available"] = False
        return rows
    by_project = {item["project_id"]: item for item in items}
    for row in rows:
        row["next_move"] = by_project.get(row["id"])
    return rows


def _shape_rows(rows: list[dict]) -> list[dict]:
    """Flatten the joined direct_reports.name/goals.title/org_units.name,
    same pattern as goals.py's _shape_rows."""
    for row in rows:
        joined_report = row.pop("direct_reports", None) or {}
        row["direct_report_name"] = joined_report.get("name")
        joined_goal = row.pop("goals", None) or {}
        row["goal_title"] = joined_goal.get("title")
        joined_unit = row.pop("org_units", None) or {}
        row["org_unit_name"] = joined_unit.get("name")
    return rows


@router.get("")
def list_projects(
    direct_report_id: str | None = None,
    goal_id: str | None = None,
    org_unit_id: str | None = None,
    status: str | None = None,
    auth=Depends(get_authenticated_client),
):
    user_id, supabase = auth
    query = supabase.table("projects").select(_SELECT_COLUMNS).eq("owner_id", user_id)
    if direct_report_id:
        query = query.eq("direct_report_id", direct_report_id)
    if goal_id:
        query = query.eq("goal_id", goal_id)
    if org_unit_id:
        query = query.eq("org_unit_id", org_unit_id)
    if status:
        query = query.eq("status", status)
    rows = query.order("created_at", desc=True).execute().data
    # Session 26: decorate with progress/trend/last_check_in_at from the
    # check_ins temporal layer — see routes/check_ins.py.
    rows = enrich_with_check_ins(supabase, user_id, _shape_rows(rows), "project_id")
    return _attach_follow_through(supabase, user_id, rows)


@router.get("/{project_id}/check-ins")
def get_project_check_ins(project_id: str, auth=Depends(get_authenticated_client)):
    """Check-in history for one project, newest first (Session 26)."""
    user_id, supabase = auth
    return list_check_ins(supabase, user_id, "project_id", project_id)


_RPC_ERRORS = {"P0002": 404, "22023": 422, "28000": 401, "22P02": 422}


@router.post("/{project_id}/check-ins")
def create_project_check_in(project_id: str, body: ProjectCheckInIn, auth=Depends(get_authenticated_client)):
    """Record an update: status + optional whole-number completion % +
    optional note. One transaction via record_project_check_in(), which also
    writes the status through to projects.status. A retry carrying the same
    client_request_id returns the original row instead of saving twice."""
    user_id, supabase = auth
    _validate_status(body.status)
    if body.progress is not None and not 0 <= body.progress <= 100:
        raise HTTPException(status_code=422, detail="Completion must be a whole number from 0 to 100")
    try:
        rows = (
            supabase.rpc(
                "record_project_check_in",
                {
                    "p_project_id": project_id,
                    "p_status": body.status,
                    "p_progress": body.progress,
                    "p_note": body.note,
                    "p_client_request_id": str(body.client_request_id) if body.client_request_id else None,
                },
            )
            .execute()
            .data
        )
    except APIError as err:
        status = _RPC_ERRORS.get(getattr(err, "code", None) or "")
        if status is None:
            raise
        raise HTTPException(status_code=status, detail=getattr(err, "message", None) or "Couldn't save this update")
    row = rows[0] if isinstance(rows, list) and rows else rows if isinstance(rows, dict) else None
    if not row:
        raise HTTPException(status_code=500, detail="The update wasn't confirmed")
    return row


# --- private follow-through ---------------------------------------------------

def _owned_project(supabase, user_id: str, project_id: str) -> dict:
    rows = supabase.table("projects").select("id").eq("id", project_id).eq("owner_id", user_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Project not found")
    return rows[0]


def _clean_follow_body(text: str) -> str:
    text = (text or "").strip()
    if not text:
        raise HTTPException(status_code=422, detail="Write the next move first")
    if len(text) > _FOLLOW_MAX:
        raise HTTPException(status_code=422, detail=f"Keep the next move under {_FOLLOW_MAX} characters")
    return text


def _is_unique_violation(err: APIError) -> bool:
    return (getattr(err, "code", None) or "") == "23505"


@router.get("/{project_id}/follow-through")
def list_project_follow_through(project_id: str, auth=Depends(get_authenticated_client)):
    """Your next moves on one project, open first then newest completed."""
    user_id, supabase = auth
    _owned_project(supabase, user_id, project_id)
    rows = (
        supabase.table("project_follow_throughs")
        .select(_FOLLOW_COLUMNS)
        .eq("owner_id", user_id)
        .eq("project_id", project_id)
        .order("created_at", desc=True)
        .execute()
        .data
    )
    return sorted(rows, key=lambda r: 0 if r["status"] == "open" else 1)


@router.post("/{project_id}/follow-through")
def create_project_follow_through(project_id: str, body: FollowThroughIn, auth=Depends(get_authenticated_client)):
    """Set your next move. One open move per project: if one is already open
    with the same wording (a retried submit) it is returned; different
    wording is refused so nothing is silently replaced."""
    user_id, supabase = auth
    text = _clean_follow_body(body.body)
    _owned_project(supabase, user_id, project_id)

    def current_open():
        return (
            supabase.table("project_follow_throughs")
            .select(_FOLLOW_COLUMNS)
            .eq("owner_id", user_id)
            .eq("project_id", project_id)
            .eq("status", "open")
            .execute()
            .data
        )

    conflict = HTTPException(
        status_code=409, detail="This project already has an open next move. Mark it done or edit it first."
    )
    existing = current_open()
    if existing:
        if existing[0]["body"] == text:
            return existing[0]
        raise conflict
    try:
        return (
            supabase.table("project_follow_throughs")
            .insert({"owner_id": user_id, "project_id": project_id, "body": text, "status": "open"})
            .execute()
            .data[0]
        )
    except APIError as err:
        if not _is_unique_violation(err):
            raise
        existing = current_open()
        if existing and existing[0]["body"] == text:
            return existing[0]
        raise conflict


@router.patch("/follow-through/{item_id}")
def update_project_follow_through(item_id: str, body: FollowThroughUpdate, auth=Depends(get_authenticated_client)):
    """Edit the wording, mark done, or reopen. Reopening is refused while a
    newer move is open on the same project. Never touches project status."""
    user_id, supabase = auth
    values: dict = {}
    if body.body is not None:
        values["body"] = _clean_follow_body(body.body)
    if body.status is not None:
        if body.status not in ("open", "done"):
            raise HTTPException(status_code=422, detail="status must be open or done")
        values["status"] = body.status
        values["completed_at"] = datetime.now(timezone.utc).isoformat() if body.status == "done" else None
    if not values:
        raise HTTPException(status_code=422, detail="Nothing to change")
    current = (
        supabase.table("project_follow_throughs")
        .select(_FOLLOW_COLUMNS)
        .eq("id", item_id)
        .eq("owner_id", user_id)
        .execute()
        .data
    )
    if not current:
        raise HTTPException(status_code=404, detail="Next move not found")
    if values.get("status") == current[0]["status"]:
        # Already in that state (a retried click): keep its original date.
        values.pop("status")
        values.pop("completed_at")
        if not values:
            return current[0]
    values["updated_at"] = datetime.now(timezone.utc).isoformat()
    try:
        result = (
            supabase.table("project_follow_throughs")
            .update(values)
            .eq("id", item_id)
            .eq("owner_id", user_id)
            .execute()
        )
    except APIError as err:
        if _is_unique_violation(err):
            raise HTTPException(
                status_code=409,
                detail="Another next move is open on this project. Mark that one done before reopening this.",
            )
        raise
    if not result.data:
        raise HTTPException(status_code=404, detail="Next move not found")
    return result.data[0]


@router.get("/rollup")
def get_projects_rollup(auth=Depends(get_authenticated_client)):
    """Project status counts across the org units the caller leads —
    aggregate-only, same contract as capacity's rollup."""
    user_id, supabase = auth
    rollup_rows = supabase.rpc("org_unit_projects_rollup", {}).execute().data
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
            "project_count": row["project_count"],
        }
        for row in rollup_rows
    ]


@router.get("/{project_id}")
def get_project(project_id: str, auth=Depends(get_authenticated_client)):
    """Single project by id — used by the Scribe confirm handler when linking a project to a goal."""
    user_id, supabase = auth
    result = (
        supabase.table("projects")
        .select(_SELECT_COLUMNS)
        .eq("id", project_id)
        .eq("owner_id", user_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Project not found")
    return _shape_rows(result.data)[0]


@router.post("")
def create_project(body: ProjectIn, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    _validate_status(body.status)
    values = _project_values(body)
    _validate_references(supabase, user_id, values)
    result = (
        supabase.table("projects")
        .insert({**values, "owner_id": user_id})
        .execute()
    )
    return _shape_rows(result.data)[0]


@router.put("/{project_id}")
def update_project(project_id: str, body: ProjectIn, auth=Depends(get_authenticated_client)):
    """Edits current fields, status included. Never adds a dated check-in."""
    user_id, supabase = auth
    _validate_status(body.status)
    values = _project_values(body)
    _validate_references(supabase, user_id, values)
    result = (
        supabase.table("projects")
        .update(values)
        .eq("id", project_id)
        .eq("owner_id", user_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Project not found")
    return _shape_rows(result.data)[0]


@router.patch("/{project_id}")
def update_project_status(project_id: str, body: ProjectStatusUpdate, auth=Depends(get_authenticated_client)):
    """Status-only update for the inline status pill — mirrors goals.py's
    PATCH so the frontend doesn't need to resend the whole record."""
    user_id, supabase = auth
    _validate_status(body.status)
    result = (
        supabase.table("projects")
        .update({"status": body.status})
        .eq("id", project_id)
        .eq("owner_id", user_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Project not found")
    return _shape_rows(result.data)[0]


@router.delete("/{project_id}")
def delete_project(project_id: str, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    # No unparenting needed before delete (unlike goals.delete_goal) — nothing
    # references a project as its own parent; goal_id on a project points up
    # to a goal, not to another project.
    supabase.table("projects").delete().eq("id", project_id).eq("owner_id", user_id).execute()
    return {"deleted": True}
