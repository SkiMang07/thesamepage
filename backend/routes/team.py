"""
Team View — the "team space" surface Andrew floated 2026-08-03 (see
docs/SESSION_HISTORY.md and the team_space_brainstorm project memory note).
Distinct from role-scoped views (who can see what as the org grows past one
manager) — this is about having a single home for "my team" as a unit, which
matters even for a solo manager today. Team data was scattered across
direct_reports/projects/goals/capacity with no page tying them together.

Scope locked before this file was written (same "scope via AskUserQuestion,
then build same session" pattern as every other feature):
  - v1 is your own direct reports only, not an org_unit rollup like
    role-scoped views — matches Mission Control's scope today.
  - GET "" assembles data that already exists: each report's in-flight
    projects and individual-level priorities (goals), plus their latest
    logged update. Three-ish queries + a Python merge, same pattern as
    direct_reports.py's get_team_overview.
  - Messaging is the new piece: a free-text update a manager can log per
    report (team_messages, new table — see database/schema.sql and
    database/migrations/2026-08-08_team_messages.sql). STORE-ONLY for v1 —
    IC login isn't built (direct_reports.user_id is still just a future
    hook), so there is no surface for a report to read this today. This is
    deliberate groundwork, not a bug: whenever IC login ships, team_messages
    already has a history to surface. Andrew's explicit call over building
    email delivery this session.

RLS note: team_messages is manager-scoped via manager_id = auth.uid(), same
pattern as one_on_ones/assessments — not the owner_id-on-goals/projects
naming gotcha documented in goals.py/projects.py.

Team Mission Control (Session 22, 2026-08-08 — see docs/SESSION_HISTORY.md
and the team_mission_control project memory note): expands the roster above
into a 3-column surface. GET "" (roster) now also returns email/user_id per
report so the frontend can show an "Invite to log in" action (see
direct_reports.py's POST /{report_id}/invite) and know when a report has
already claimed an account. GET /goals is the middle column — company- and
team-level goal progress, deliberately excluding department/individual (see
that endpoint's docstring). GET/POST /notes is the right column — a
standalone team-wide meeting-notes log, new team_meeting_notes table,
deliberately separate from one_on_ones (stays per-report) and team_messages
(stays per-report). "Key updates" (a manager-authored broadcast feed) was
scoped and then explicitly deferred to a follow-up session — nothing for it
here.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from utils import get_authenticated_client

router = APIRouter()

# "What's currently happening" — Team View deliberately excludes
# completed/cancelled work from the roster view, same framing as Mission
# Control's Key Initiatives card. Full history is still on /app/projects
# and /app/goals.
_ACTIVE_STATUSES = ("active", "on_track", "at_risk")

# Team Mission Control's middle column shows ONLY company- and team-level
# goal progress, not department or individual (Andrew's explicit scoping
# call) — department stays a rollup concept for role-scoped views, and
# individual priorities are already the left column's per-report Priorities
# list.
_MISSION_CONTROL_GOAL_LEVELS = ("company", "team")


class TeamMessageIn(BaseModel):
    message: str


class TeamNoteIn(BaseModel):
    note: str


@router.get("")
async def get_team(auth=Depends(get_authenticated_client)):
    """Roster + what each person is working on right now, assembled from
    data that already exists. email/user_id (Session 22) drive the Invite
    action — user_id set means the report already claimed an account."""
    user_id, supabase = auth

    reports = (
        supabase.table("direct_reports")
        .select("id,name,role_title,email,user_id")
        .eq("manager_id", user_id)
        .order("name")
        .execute()
        .data
    )
    if not reports:
        return []
    report_ids = [r["id"] for r in reports]

    projects = (
        supabase.table("projects")
        .select("id,title,status,due_date,direct_report_id")
        .eq("owner_id", user_id)
        .in_("direct_report_id", report_ids)
        .in_("status", _ACTIVE_STATUSES)
        .order("due_date")
        .execute()
        .data
    )

    # Priorities = individual-level goals. Mission Control deliberately keeps
    # these off the dashboard (see dashboard/page.tsx's GOAL_CARD_LEVELS
    # comment — individual goals live on the report's own page); Team View is
    # exactly where "priorities per person" belongs.
    priorities = (
        supabase.table("goals")
        .select("id,title,status,due_date,direct_report_id")
        .eq("owner_id", user_id)
        .eq("level", "individual")
        .in_("direct_report_id", report_ids)
        .in_("status", _ACTIVE_STATUSES)
        .order("due_date")
        .execute()
        .data
    )

    latest_messages = (
        supabase.table("team_messages")
        .select("id,direct_report_id,message,created_at")
        .eq("manager_id", user_id)
        .in_("direct_report_id", report_ids)
        .order("created_at", desc=True)
        .execute()
        .data
    )

    projects_by_report: dict = {}
    for p in projects:
        projects_by_report.setdefault(p["direct_report_id"], []).append(p)

    priorities_by_report: dict = {}
    for g in priorities:
        priorities_by_report.setdefault(g["direct_report_id"], []).append(g)

    # Newest-first order means the first occurrence per report is the latest
    # message. Pop direct_report_id so what's left matches the shape of a
    # single message row (id, message, created_at).
    latest_message_by_report: dict = {}
    for m in latest_messages:
        rid = m.pop("direct_report_id")
        latest_message_by_report.setdefault(rid, m)

    return [
        {
            **r,
            "projects": projects_by_report.get(r["id"], []),
            "priorities": priorities_by_report.get(r["id"], []),
            "latest_message": latest_message_by_report.get(r["id"]),
        }
        for r in reports
    ]


@router.get("/{report_id}/messages")
async def list_team_messages(report_id: str, auth=Depends(get_authenticated_client)):
    """Full update history for one report, newest first."""
    user_id, supabase = auth
    rows = (
        supabase.table("team_messages")
        .select("id,message,created_at")
        .eq("manager_id", user_id)
        .eq("direct_report_id", report_id)
        .order("created_at", desc=True)
        .execute()
        .data
    )
    return rows


@router.post("/{report_id}/messages")
async def send_team_message(report_id: str, body: TeamMessageIn, auth=Depends(get_authenticated_client)):
    """Log a free-text update for one report. STORE-ONLY — see this module's
    docstring. Nothing is emailed or otherwise delivered."""
    user_id, supabase = auth
    message = body.message.strip()
    if not message:
        raise HTTPException(status_code=422, detail="Message cannot be empty")
    result = (
        supabase.table("team_messages")
        .insert({"manager_id": user_id, "direct_report_id": report_id, "message": message})
        .execute()
    )
    return result.data[0]


@router.get("/goals")
async def get_team_goals(auth=Depends(get_authenticated_client)):
    """Company- and team-level goal progress for Mission Control's middle
    column. Goals are owner-scoped everywhere in this codebase (see
    goals.py's RLS note — the "*_all_own_org" policy names are misleading,
    it's actually owner_id = auth.uid()), so this is just the manager's own
    goals filtered by level — no org rollup needed."""
    user_id, supabase = auth
    rows = (
        supabase.table("goals")
        .select("id,title,level,status,due_date,org_unit_id,org_units(name)")
        .eq("owner_id", user_id)
        .in_("level", _MISSION_CONTROL_GOAL_LEVELS)
        .order("due_date")
        .execute()
        .data
    )
    for row in rows:
        org_unit = row.pop("org_units", None) or {}
        row["org_unit_name"] = org_unit.get("name")
    return rows


@router.get("/notes")
async def list_team_notes(auth=Depends(get_authenticated_client)):
    """Standalone team-wide meeting-notes log, newest first — Mission
    Control's right column. See team_meeting_notes in schema.sql."""
    user_id, supabase = auth
    rows = (
        supabase.table("team_meeting_notes")
        .select("id,note,created_at")
        .eq("manager_id", user_id)
        .order("created_at", desc=True)
        .execute()
        .data
    )
    return rows


@router.post("/notes")
async def create_team_note(body: TeamNoteIn, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    note = body.note.strip()
    if not note:
        raise HTTPException(status_code=422, detail="Note cannot be empty")
    result = (
        supabase.table("team_meeting_notes")
        .insert({"manager_id": user_id, "note": note})
        .execute()
    )
    return result.data[0]
