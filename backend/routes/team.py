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

Session 23 (2026-08-09) follow-up — two additions, same file since both are
team.py-scoped reads/writes on top of the Session 22 surface:
  - Meeting notes now carry an optional meeting_date. GET/POST /notes return
    it as-is; the "is this the upcoming agenda or a logged past meeting"
    split is derived client-side (today-or-future meeting_date = upcoming),
    same derived-status discipline as one_on_ones' planned/completed split
    — no stored status column here either.
  - GET/POST /commitments — team-level commitments. Not a new table: any
    commitments row can be flagged is_team_commitment (still assigned to
    exactly one direct_report_id), and this pair of endpoints is the
    team-wide read/write surface for that flag. Marking one done/dropped
    still goes through the existing PATCH /api/commitments/{id} in
    commitments.py — the flag doesn't change how a commitment resolves,
    only where it's listed.

Session 24 (2026-08-09) layout rework — visual redesign only, no changes
above this point. One new piece: GET/PUT /callout, the "critical callouts"
panel next to Meetings. This is "key updates" (deferred Sessions 22/23),
revived deliberately small — a single manager-authored text block per
manager (new team_callouts table, unique on manager_id), overwritten in
place on each edit rather than a dated log like team_meeting_notes. No
history, no per-line CRUD — the frontend just splits on newlines to render
bullets. See the team_page_redesign_options project memory note for the
scoping conversation (Andrew confirmed this shape via the mockup before it
was built).

Session 45 (2026-08-19) — team dropdown (see the team_dropdown_scoping
project memory note). A manager/director who leads more than one org_unit
had no way to tell, on /app/team, which of their teams they were looking
at — the roster was always every direct report at once. The fix is mostly
client-side: roster/initiatives/goals/commitments already carry enough
org_unit_id signal (via direct_reports.org_unit_id / goals.org_unit_id) for
the frontend to filter by the selected team without any backend change.
Meeting notes and callouts had no per-team signal at all, so those two
gained an org_unit_id column (null = "applies to all teams", shown under
every team's filter, same treatment as a company-level goal):
  - GET/POST /notes now carry org_unit_id as-is; still returns every note
    unfiltered (like before) — the frontend derives which ones apply to the
    selected team.
  - GET /callout changed shape: it now returns EVERY callout row for this
    manager (one per led team, plus at most one org_unit_id-null "all
    teams" row) instead of a single object, so the frontend can pick the
    row for whichever team is selected without a round trip per switch.
    PUT /callout takes org_unit_id in the body to say which row to
    upsert; since a plain DB-level ON CONFLICT doesn't handle the
    org_unit_id-null case cleanly (see schema.sql's team_callouts comment),
    this does a manual look-up-then-write instead of supabase's upsert().
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from routes.check_ins import enrich_with_check_ins
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
    # Optional YYYY-MM-DD. Set (to today or a future date) when this note is
    # the agenda for an upcoming meeting; omitted/null for a same-day log of
    # a meeting that already happened. See list_team_notes' docstring.
    meeting_date: str | None = None
    # Which led team this note is for (Session 45) — null means "all teams".
    org_unit_id: str | None = None


class TeamCommitmentIn(BaseModel):
    direct_report_id: str
    description: str
    due_date: str | None = None


class TeamCalloutIn(BaseModel):
    message: str
    # Which led team this callout is for (Session 45) — null means "all
    # teams". Identifies which row GET/PUT /callout act on now that a
    # manager can have more than one.
    org_unit_id: str | None = None


@router.get("")
async def get_team(auth=Depends(get_authenticated_client)):
    """Roster + what each person is working on right now, assembled from
    data that already exists. email/user_id (Session 22) drive the Invite
    action — user_id set means the report already claimed an account."""
    user_id, supabase = auth

    # Archived people (Session 43) drop off the roster — see
    # docs/TEAM_SETUP_UX_REVIEW.md §7.3, finding P1.
    reports = (
        supabase.table("direct_reports")
        .select("id,name,role_title,email,user_id")
        .eq("manager_id", user_id)
        .is_("archived_at", "null")
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
    goals filtered by level — no org rollup needed.

    Data-trust fix (2026-08-12 review, spec section 8 #3): this endpoint
    used to omit check-in progress entirely, so /app/team's goal-progress
    ring had nothing real to average and fell back to a status-count ratio
    instead — a different number from the per-goal progress % Mission
    Control shows for the same goals (goals.py's list_goals DOES call
    enrich_with_check_ins). Both now read from the same helper over the
    same underlying data.
    """
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
    return enrich_with_check_ins(supabase, user_id, rows, "goal_id")


@router.get("/notes")
async def list_team_notes(auth=Depends(get_authenticated_client)):
    """Standalone team-wide meeting-notes log, newest first — Mission
    Control's right column. See team_meeting_notes in schema.sql.

    meeting_date rides along as-is (nullable). The frontend derives which
    note is "the next meeting's agenda" (soonest meeting_date that's today
    or later) vs. a logged past meeting — same derived-status discipline as
    one_on_ones' planned/completed split (see the planned_sessions project
    memory note), so there's no stored status column to keep in sync."""
    user_id, supabase = auth
    rows = (
        supabase.table("team_meeting_notes")
        .select("id,note,meeting_date,org_unit_id,created_at")
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
    payload = {"manager_id": user_id, "note": note, "org_unit_id": body.org_unit_id}
    if body.meeting_date:
        payload["meeting_date"] = body.meeting_date
    result = (
        supabase.table("team_meeting_notes")
        .insert(payload)
        .execute()
    )
    return result.data[0]


@router.get("/commitments")
async def list_team_commitments(auth=Depends(get_authenticated_client)):
    """Team-level commitments — commitments rows flagged is_team_commitment,
    each still assigned to exactly one direct report. Same joined-name shape
    as commitments.py's list_commitments, filtered to the team-wide subset."""
    user_id, supabase = auth
    rows = (
        supabase.table("commitments")
        .select(
            "id,description,due_date,status,committed_by,created_at,completed_at,"
            "direct_report_id,direct_reports(name)"
        )
        .eq("owner_id", user_id)
        .eq("is_team_commitment", True)
        .order("due_date")
        .execute()
        .data
    )
    for row in rows:
        joined = row.pop("direct_reports", None) or {}
        row["direct_report_name"] = joined.get("name")
    return rows


@router.post("/commitments")
async def create_team_commitment(body: TeamCommitmentIn, auth=Depends(get_authenticated_client)):
    """Create a commitment assigned to one direct report, flagged so it also
    shows up on this team-wide list (in addition to wherever commitments
    already surface — dashboard, DR detail, prep). Manager-authored only, so
    committed_by is always 'manager' here; source_type 'manual' matches the
    existing convention for commitments not extracted from a 1:1 wrap-up."""
    user_id, supabase = auth
    description = body.description.strip()
    if not description:
        raise HTTPException(status_code=422, detail="Description cannot be empty")

    report = (
        supabase.table("direct_reports")
        .select("id,name")
        .eq("id", body.direct_report_id)
        .eq("manager_id", user_id)
        .execute()
        .data
    )
    if not report:
        raise HTTPException(status_code=404, detail="Direct report not found")

    result = (
        supabase.table("commitments")
        .insert(
            {
                "owner_id": user_id,
                "direct_report_id": body.direct_report_id,
                "description": description,
                "due_date": body.due_date,
                "committed_by": "manager",
                "source_type": "manual",
                "is_team_commitment": True,
            }
        )
        .execute()
    )
    row = result.data[0]
    row["direct_report_name"] = report[0]["name"]
    return row


@router.get("/callout")
async def get_team_callout(auth=Depends(get_authenticated_client)):
    """Every "critical callouts" row for this manager (Session 45) — one per
    led team that's ever had a callout saved, plus at most one
    org_unit_id-null "all teams" row. Used to be a single object; now a list
    so the frontend can switch teams without a round trip. An empty list is
    a normal, expected first-load state (no callout for any scope yet), not
    an error."""
    user_id, supabase = auth
    return (
        supabase.table("team_callouts")
        .select("message,updated_at,org_unit_id")
        .eq("manager_id", user_id)
        .execute()
        .data
    )


@router.put("/callout")
async def update_team_callout(body: TeamCalloutIn, auth=Depends(get_authenticated_client)):
    """Upserts the callout row for (manager, org_unit_id) — this is a pinned
    block that gets overwritten, not a log, so there's no create vs. update
    distinction for the caller. Empty string is a valid message (clearing
    the panel), so no emptiness check here unlike the other team.py POST
    endpoints.

    Session 45: manual look-up-then-write instead of supabase's upsert().
    team_callouts' uniqueness is now two partial indexes (see schema.sql)
    because a plain UNIQUE(manager_id, org_unit_id) constraint treats every
    NULL org_unit_id as distinct — supabase-py's on_conflict= only targets a
    single named constraint/column list, which can't express "conflict on
    org_unit_id equality, including when both sides are null.\""""
    user_id, supabase = auth
    query = supabase.table("team_callouts").select("id").eq("manager_id", user_id)
    query = query.is_("org_unit_id", "null") if body.org_unit_id is None else query.eq("org_unit_id", body.org_unit_id)
    existing = query.execute().data

    payload = {
        "manager_id": user_id,
        "org_unit_id": body.org_unit_id,
        "message": body.message.strip(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    if existing:
        result = (
            supabase.table("team_callouts")
            .update(payload)
            .eq("id", existing[0]["id"])
            .execute()
        )
    else:
        result = supabase.table("team_callouts").insert(payload).execute()
    return result.data[0]
