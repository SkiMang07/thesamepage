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

Session 46 (2026-08-20) — goal/project team hierarchy (see the
team_project_goal_hierarchy project memory note). Andrew wanted a team's
goals/initiatives to include its parent org_unit's goals/initiatives too
(a department OKR should show up on every team beneath it), and for
projects to get a real team attachment instead of Session 45's
assignee-proxy. Two changes here:
  - _MISSION_CONTROL_GOAL_LEVELS now includes "department" (was
    company/team only) — department-level goals have somewhere to cascade
    to now that /app/team can walk the org_units tree. GET /goals is
    otherwise unchanged; the level filter still happens here, but which
    specific department/team goals apply to a given team is resolved
    client-side (see page.tsx's ancestorChain()), same "most of this needs
    no backend change" pattern as Session 45.
  - Initiatives no longer proxy through the assignee's org_unit_id —
    projects.py now carries a real org_unit_id (Session 46 there too), and
    the frontend filters on that directly.

Session 47 (2026-08-20) — Development (see the development_scoping project
memory note). GET/PUT /dev-focus is the team-level half of the Development
feature (individual plans live in routes/development.py, on the direct
report detail page): a lightweight "this month's training focus" pinned
note per (manager, org_unit), new team_dev_focus table. Deliberately copies
/callout's shape exactly (same manual look-up-then-write upsert, same
org_unit_id-null-means-all-teams convention, same every-row-at-once GET) —
a distinct table so it doesn't collide with Critical Callouts' "key
updates" concept in one text block.

2026-08-24 — team meetings (see the team_meetings_scoping project memory
note). GET/POST /notes is gone; a team meeting is now a real occurrence
rather than a loose note, and /meetings replaces it. The old model wrote
the agenda and the write-up as two unrelated team_meeting_notes rows, so
there was no way to log notes *against* the meeting you planned. Now:
  - team_meeting_notes is renamed team_meetings and gains summary /
    raw_notes / scheduled_at / series_id / logged_at. STATUS DERIVES FROM
    summary, NOT THE DATE — the date only orders meetings. That is what
    stops a held-and-logged meeting from sitting in the "next meeting"
    slot for the rest of the day.
  - team_meeting_agenda_items holds the agenda as rows, so notes attach to
    the item they belong to and an uncovered item can carry forward with
    its lineage intact (carried_from_item_id).
  - team_meeting_series owns the repeat rule, mirroring one_on_one_series
    down to _next_occurrence_at()'s skip-stale-occurrences rule. Logging
    rolls the next occurrence forward from the prior SCHEDULED date, never
    from when the manager happened to log it.
  - POST /meetings/{id}/wrapup is a pure AI draft — nothing is written.
    POST /meetings/{id}/log is the confirmed write. Draft-then-review is
    not optional here: these produce commitments, which are accountability
    records.
  - Team commitments may now be owned by the manager: direct_report_id is
    optional on POST /commitments and on wrap-up extraction. The column was
    always nullable and RLS is a flat owner_id = auth.uid(); only this
    route and the list rendering assumed a person.
"""
import json
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from ai_core import generate_text
from config import AI_DEFAULT_MODEL_HEAVY
from routes.check_ins import enrich_with_check_ins
from utils import get_authenticated_client, limiter

router = APIRouter()

# "What's currently happening" — Team View deliberately excludes
# completed/cancelled work from the roster view, same framing as Mission
# Control's Key Initiatives card. Full history is still on /app/projects
# and /app/goals.
_ACTIVE_STATUSES = ("active", "on_track", "at_risk")

# Team Mission Control's middle column shows company/department/team-level
# goal progress, never individual (individual priorities are already the
# left column's per-report Priorities list). Department was excluded until
# Session 46 — see this module's docstring — added once the team dropdown
# (Session 45) gave department-level goals somewhere to cascade to via
# org_units' parent_unit_id hierarchy.
_MISSION_CONTROL_GOAL_LEVELS = ("company", "department", "team")


class TeamMessageIn(BaseModel):
    message: str


class TeamCommitmentIn(BaseModel):
    # Optional since 2026-08-24: a team meeting routinely produces work the
    # manager owns ("open the CSM req"), and there is no direct_reports row
    # for the manager. Null means "mine".
    direct_report_id: str | None = None
    description: str
    due_date: str | None = None


class TeamCalloutIn(BaseModel):
    message: str
    # Which led team this callout is for (Session 45) — null means "all
    # teams". Identifies which row GET/PUT /callout act on now that a
    # manager can have more than one.
    org_unit_id: str | None = None


class TeamDevFocusIn(BaseModel):
    message: str
    # Which led team this focus note is for (Session 47) — null means "all
    # teams", same convention as TeamCalloutIn.org_unit_id.
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
    """Company/department/team-level goal progress for Mission Control's
    middle column (department added Session 46 — see this module's
    docstring). Goals are owner-scoped everywhere in this codebase (see
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


# ---------------------------------------------------------------------------
# TEAM MEETINGS
#
# A meeting is one team_meetings row plus its agenda items. Status is derived
# from summary, never stored — the same discipline one_on_ones uses. The date
# only orders meetings; it does not decide whether one is still open.
# ---------------------------------------------------------------------------


class AgendaOutcomeIn(BaseModel):
    id: str
    covered: bool = False
    notes: str | None = None


class TeamMeetingIn(BaseModel):
    # YYYY-MM-DD. Encoded at noon UTC on the way in (see _encode_meeting_date)
    # so the date stays put across timezones and the column can carry a real
    # start time later without a migration.
    scheduled_at: str | None = None
    agenda_items: list[str] = Field(default_factory=list)
    org_unit_id: str | None = None
    # 1-4 starts (or keeps) a weekly-to-monthly series; null means one-off.
    recurrence_weeks: int | None = None


class TeamMeetingPatch(BaseModel):
    scheduled_at: str | None = None
    agenda_items: list[str] | None = None
    recurrence_weeks: int | None = None
    # Explicit, because "recurrence_weeks omitted" and "stop repeating" are
    # different intentions and null cannot express both.
    clear_recurrence: bool = False
    # Only meaningful on an already-logged meeting — fixing the wording of a
    # write-up. See update_team_meeting for why that is the one thing a
    # logged meeting will accept.
    summary: str | None = None


class TeamWrapUpRequest(BaseModel):
    raw_notes: str


class TeamWrapUpCommitment(BaseModel):
    description: str
    direct_report_id: str | None = None  # null = the manager owns it
    due_date: str | None = None


class TeamWrapUpDraft(BaseModel):
    summary: str
    commitments: list[TeamWrapUpCommitment]
    carry_forward_items: list[str]


class LogTeamMeetingIn(BaseModel):
    summary: str
    raw_notes: str | None = None
    agenda_outcomes: list[AgendaOutcomeIn] = Field(default_factory=list)
    commitments: list[TeamWrapUpCommitment] = Field(default_factory=list)
    carry_forward_items: list[str] = Field(default_factory=list)


def _encode_meeting_date(value: str | None) -> str | None:
    """YYYY-MM-DD (or a full ISO timestamp) -> noon UTC ISO timestamp.

    Noon rather than midnight for the same reason one_on_ones does it: a date
    encoded at midnight UTC reads as the previous day for anyone west of
    Greenwich, and noon keeps the calendar date stable in every timezone the
    app is used in.
    """
    if not value:
        return None
    try:
        if len(value) == 10:
            parsed = datetime.fromisoformat(value).replace(
                hour=12, minute=0, second=0, microsecond=0, tzinfo=timezone.utc
            )
        else:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
    except (ValueError, AttributeError):
        raise HTTPException(status_code=422, detail="scheduled_at must be a date or ISO timestamp")
    return parsed.astimezone(timezone.utc).isoformat()


def _next_occurrence_at(scheduled_at: str, interval_weeks: int, now: datetime | None = None) -> str:
    """Advance from the scheduled occurrence, preserving the series rhythm.

    Copied deliberately from one_on_ones: stepping from the prior *scheduled*
    date rather than from now keeps a weekly meeting on its weekday even when
    it gets logged three days late, and the loop skips occurrences that are
    already past instead of creating scheduled shells in the past.
    """
    current = datetime.fromisoformat(scheduled_at.replace("Z", "+00:00"))
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    reference = now or datetime.now(timezone.utc)
    step = timedelta(weeks=interval_weeks)
    candidate = current + step
    while candidate <= reference:
        candidate += step
    return candidate.astimezone(timezone.utc).isoformat()


def _clean_items(values, limit: int = 20) -> list[str]:
    """Trim, drop blanks, de-duplicate case-insensitively, cap the count."""
    cleaned: list[str] = []
    seen: set[str] = set()
    for value in values or []:
        if not isinstance(value, str):
            continue
        text = value.strip()
        if not text:
            continue
        key = text.lower()
        if key in seen:
            continue
        cleaned.append(text[:500])
        seen.add(key)
        if len(cleaned) == limit:
            break
    return cleaned


def _validate_recurrence(recurrence_weeks: int | None, scheduled_at: str | None) -> None:
    if recurrence_weeks is not None and recurrence_weeks not in (1, 2, 3, 4):
        raise HTTPException(status_code=422, detail="recurrence_weeks must be between 1 and 4")
    if recurrence_weeks is not None and not scheduled_at:
        raise HTTPException(status_code=422, detail="A repeating meeting needs a date")


def _set_series(
    supabase, user_id: str, org_unit_id: str | None, interval_weeks: int, anchor_at: str
) -> str:
    """Deactivate whatever active series this (manager, team) has and start a
    new one. Deactivate-then-insert rather than update, so the partial unique
    indexes (which only cover active rows) never see two live series at once."""
    query = (
        supabase.table("team_meeting_series")
        .update({"active": False})
        .eq("manager_id", user_id)
        .eq("active", True)
    )
    query = query.is_("org_unit_id", "null") if org_unit_id is None else query.eq("org_unit_id", org_unit_id)
    query.execute()

    created = (
        supabase.table("team_meeting_series")
        .insert(
            {
                "manager_id": user_id,
                "org_unit_id": org_unit_id,
                "interval_weeks": interval_weeks,
                "anchor_at": anchor_at,
                "timezone": "UTC",
                "active": True,
            }
        )
        .execute()
    )
    return created.data[0]["id"]


def _deactivate_series(supabase, user_id: str, series_id: str | None) -> None:
    if not series_id:
        return
    (
        supabase.table("team_meeting_series")
        .update({"active": False})
        .eq("id", series_id)
        .eq("manager_id", user_id)
        .execute()
    )


def _fetch_meeting(supabase, user_id: str, meeting_id: str) -> dict:
    rows = (
        supabase.table("team_meetings")
        .select("*")
        .eq("id", meeting_id)
        .eq("manager_id", user_id)
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return rows[0]


def _replace_agenda_items(
    supabase, user_id: str, meeting_id: str, items: list[str], carried_from: list[str | None] | None = None
) -> None:
    """Agenda edits replace the item set wholesale.

    Per-item notes only exist after a meeting is logged, and a logged meeting's
    agenda is never edited, so nothing typed can be destroyed by this.
    """
    supabase.table("team_meeting_agenda_items").delete().eq("meeting_id", meeting_id).eq(
        "manager_id", user_id
    ).execute()
    cleaned = _clean_items(items)
    if not cleaned:
        return
    lineage = carried_from or []
    payload = [
        {
            "meeting_id": meeting_id,
            "manager_id": user_id,
            "position": index,
            "item": text,
            "carried_from_item_id": lineage[index] if index < len(lineage) else None,
        }
        for index, text in enumerate(cleaned)
    ]
    supabase.table("team_meeting_agenda_items").insert(payload).execute()


def _meeting_day(scheduled_at: str | None) -> date | None:
    """The calendar day a scheduled_at falls on, or None if undated."""
    if not scheduled_at:
        return None
    try:
        parsed = datetime.fromisoformat(scheduled_at.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None
    return parsed.date()


def _serialize_meeting(row: dict, items_by_meeting: dict[str, list[dict]]) -> dict:
    """Adds the derived status the whole frontend keys off.

    open       — not logged yet and dated today or later (or not dated at all)
    needs_log  — not logged yet and the date has passed
    logged     — summary set, whatever the date says
    """
    series = row.get("team_meeting_series") or {}
    if isinstance(series, list):
        series = series[0] if series else {}
    scheduled_at = row.get("scheduled_at")
    if row.get("summary"):
        status = "logged"
    elif _meeting_day(scheduled_at) and _meeting_day(scheduled_at) < date.today():
        # Compared by DAY, not by instant: a meeting scheduled for today is
        # still open at 4pm even though noon UTC has passed.
        status = "needs_log"
    else:
        status = "open"
    return {
        **{k: v for k, v in row.items() if k != "team_meeting_series"},
        "status": status,
        "agenda_items": items_by_meeting.get(row["id"], []),
        "recurrence_weeks": series.get("interval_weeks") if series.get("active") else None,
    }


@router.get("/meetings")
async def list_team_meetings(auth=Depends(get_authenticated_client)):
    """Every meeting for this manager, newest scheduled first, with agenda
    items attached. Which team a meeting belongs to is filtered client-side
    (null org_unit_id means "all teams" and shows under every team), same
    convention as callouts and notes before it."""
    user_id, supabase = auth
    rows = (
        supabase.table("team_meetings")
        .select("*,team_meeting_series(interval_weeks,active)")
        .eq("manager_id", user_id)
        .order("scheduled_at", desc=True)
        .execute()
        .data
    )
    items = (
        supabase.table("team_meeting_agenda_items")
        .select("*")
        .eq("manager_id", user_id)
        .order("position")
        .execute()
        .data
    )
    items_by_meeting: dict[str, list[dict]] = {}
    for item in items:
        items_by_meeting.setdefault(item["meeting_id"], []).append(item)
    return [_serialize_meeting(row, items_by_meeting) for row in rows]


@router.post("/meetings")
async def create_team_meeting(body: TeamMeetingIn, auth=Depends(get_authenticated_client)):
    """Plan a meeting: a date, an agenda, and optionally a repeat rule."""
    user_id, supabase = auth
    scheduled_at = _encode_meeting_date(body.scheduled_at)
    _validate_recurrence(body.recurrence_weeks, scheduled_at)

    series_id = None
    if body.recurrence_weeks:
        series_id = _set_series(
            supabase, user_id, body.org_unit_id, body.recurrence_weeks, scheduled_at
        )

    created = (
        supabase.table("team_meetings")
        .insert(
            {
                "manager_id": user_id,
                "org_unit_id": body.org_unit_id,
                "scheduled_at": scheduled_at,
                "series_id": series_id,
            }
        )
        .execute()
        .data[0]
    )
    _replace_agenda_items(supabase, user_id, created["id"], body.agenda_items)
    return _serialize_meeting(
        {**created, "team_meeting_series": {"interval_weeks": body.recurrence_weeks, "active": True}
         if series_id else {}},
        {created["id"]: _fetch_agenda_items(supabase, user_id, created["id"])},
    )


def _fetch_agenda_items(supabase, user_id: str, meeting_id: str) -> list[dict]:
    return (
        supabase.table("team_meeting_agenda_items")
        .select("*")
        .eq("meeting_id", meeting_id)
        .eq("manager_id", user_id)
        .order("position")
        .execute()
        .data
    )


@router.patch("/meetings/{meeting_id}")
async def update_team_meeting(
    meeting_id: str, body: TeamMeetingPatch, auth=Depends(get_authenticated_client)
):
    """Edit an unlogged meeting's date, agenda, or repeat rule — or fix the
    wording of a logged meeting's summary.

    A logged meeting's date, agenda and repeat rule stay frozen. Agenda items
    carry the per-item notes written during the wrap-up, and this endpoint
    replaces the item set wholesale, so allowing an agenda edit after logging
    would silently destroy what was typed. Correcting a typo in a summary
    destroys nothing, so that one is allowed.
    """
    user_id, supabase = auth
    meeting = _fetch_meeting(supabase, user_id, meeting_id)

    if meeting.get("summary"):
        if (
            body.scheduled_at is not None
            or body.agenda_items is not None
            or body.recurrence_weeks is not None
            or body.clear_recurrence
        ):
            raise HTTPException(
                status_code=409,
                detail="A logged meeting's date and agenda can't be changed",
            )
        summary = (body.summary or "").strip()
        if not summary:
            raise HTTPException(status_code=422, detail="Summary cannot be empty")
        (
            supabase.table("team_meetings")
            .update({"summary": summary})
            .eq("id", meeting_id)
            .eq("manager_id", user_id)
            .execute()
        )
        return _serialize_meeting(
            {**meeting, "summary": summary},
            {meeting_id: _fetch_agenda_items(supabase, user_id, meeting_id)},
        )

    if body.summary is not None:
        raise HTTPException(status_code=409, detail="This meeting hasn't been logged yet")

    updates: dict = {}
    scheduled_at = meeting.get("scheduled_at")
    if body.scheduled_at is not None:
        scheduled_at = _encode_meeting_date(body.scheduled_at)
        updates["scheduled_at"] = scheduled_at

    if body.clear_recurrence:
        _deactivate_series(supabase, user_id, meeting.get("series_id"))
        updates["series_id"] = None
    elif body.recurrence_weeks is not None:
        _validate_recurrence(body.recurrence_weeks, scheduled_at)
        updates["series_id"] = _set_series(
            supabase, user_id, meeting.get("org_unit_id"), body.recurrence_weeks, scheduled_at
        )

    if updates:
        (
            supabase.table("team_meetings")
            .update(updates)
            .eq("id", meeting_id)
            .eq("manager_id", user_id)
            .execute()
        )

    if body.agenda_items is not None:
        _replace_agenda_items(supabase, user_id, meeting_id, body.agenda_items)

    refreshed = (
        supabase.table("team_meetings")
        .select("*,team_meeting_series(interval_weeks,active)")
        .eq("id", meeting_id)
        .eq("manager_id", user_id)
        .limit(1)
        .execute()
        .data[0]
    )
    return _serialize_meeting(refreshed, {meeting_id: _fetch_agenda_items(supabase, user_id, meeting_id)})


@router.delete("/meetings/{meeting_id}")
async def delete_team_meeting(meeting_id: str, auth=Depends(get_authenticated_client)):
    """Drop a PLANNED meeting. Agenda items cascade.

    A logged meeting is history and is not deletable here — the same posture
    as 1:1s, where logging is the point of no return. Deleting one would also
    orphan any commitments pointing at it through source_id.
    """
    user_id, supabase = auth
    meeting = _fetch_meeting(supabase, user_id, meeting_id)
    if meeting.get("summary"):
        raise HTTPException(status_code=409, detail="A logged meeting can't be deleted")
    _deactivate_series(supabase, user_id, meeting.get("series_id"))
    (
        supabase.table("team_meetings")
        .delete()
        .eq("id", meeting_id)
        .eq("manager_id", user_id)
        .execute()
    )
    return {"ok": True}


def _build_team_wrapup_prompt(
    agenda_items: list[dict], roster: list[dict], raw_notes: str, today_iso: str
) -> str:
    """Distill raw team-meeting notes into a draft record.

    Deliberately the same shape as one_on_ones' _build_wrapup_prompt: the
    manager edits everything before it saves, so the prompt optimizes for
    precision over coverage and says outright that an empty list is a valid
    answer. The roster is included only so extracted commitments can name a
    real person instead of a guess.
    """
    agenda_block = (
        "\n".join(f"- {item['item']}" for item in agenda_items)
        if agenda_items
        else "(no agenda was planned)"
    )
    roster_block = (
        "\n".join(f"- {person['name']} (id: {person['id']})" for person in roster)
        if roster
        else "(no direct reports on file)"
    )
    return f"""You are helping a manager log a team meeting they just ran. Distill the raw notes below into a clean, reviewable record. The manager will edit your draft before saving — be precise, not exhaustive.

Today's date: {today_iso} (use it to resolve relative deadlines like "by Friday" or "end of month").

THE PLANNED AGENDA:
{agenda_block}

THE TEAM (use these exact ids when a commitment clearly belongs to one person):
{roster_block}

RAW MEETING NOTES (typed during the meeting, or pasted from a transcript/recording tool — may be messy, fragmentary, or verbatim):
{raw_notes}

Produce:

1. summary — 3-5 sentences capturing what the team actually covered: decisions made, risks raised, changes in direction. Write it so that reading it a month from now instantly restores context. State the substance directly — no "the team discussed X" padding.

2. commitments — every explicit commitment made in the meeting. Rules:
   - Include only things someone actually agreed to DO. Topics discussed, open questions, and vague intentions ("we should think about...") are NOT commitments unless clearly accepted as an action.
   - direct_report_id: the id from THE TEAM list when one named person owns it. Use null when the manager owns it or when no single owner was named. NEVER invent an id.
   - due_date: ISO date (YYYY-MM-DD) only when a deadline was stated or clearly implied — resolve relative dates from today's date. Otherwise null. Never guess a date.
   - Phrase each as one short actionable sentence starting with a verb ("Send Finance the pricing scenarios").
   - Do NOT invent commitments. An empty list is a valid answer.

3. carry_forward_items — agenda topics that were not reached, plus anything explicitly deferred to the next meeting. Rules:
   - These are NOT actions someone agreed to take; those belong in commitments.
   - Prefer the exact wording of an unreached agenda item so the manager recognizes it.
   - Do NOT invent items. An empty list is a valid answer.

Return ONLY valid JSON. No commentary, no markdown, no code fences.

{{"summary": "...", "commitments": [{{"description": "...", "direct_report_id": null, "due_date": "2026-08-28"}}], "carry_forward_items": ["Overview of the QBR generator"]}}"""


@router.post("/meetings/{meeting_id}/wrapup", response_model=TeamWrapUpDraft)
@limiter.limit("10/minute")
async def wrap_up_team_meeting(
    request: Request,
    meeting_id: str,
    body: TeamWrapUpRequest,
    auth=Depends(get_authenticated_client),
):
    """Raw notes -> DRAFT summary, commitments and carry-forward items.

    Pure AI call: NOTHING is written here. The manager reviews the draft and
    POSTs /log to save it. Extraction failure returns an empty draft rather
    than an error, so a bad model response degrades into "write it yourself"
    instead of losing the notes.
    """
    user_id, supabase = auth
    _fetch_meeting(supabase, user_id, meeting_id)
    agenda_items = _fetch_agenda_items(supabase, user_id, meeting_id)
    roster = (
        supabase.table("direct_reports")
        .select("id,name")
        .eq("manager_id", user_id)
        .is_("archived_at", "null")
        .execute()
        .data
    )
    valid_ids = {person["id"] for person in roster}

    prompt = _build_team_wrapup_prompt(
        agenda_items=agenda_items,
        roster=roster,
        raw_notes=body.raw_notes,
        today_iso=date.today().isoformat(),
    )
    raw = generate_text(prompt, model=AI_DEFAULT_MODEL_HEAVY, max_tokens=1500)

    raw_clean = raw.strip()
    if raw_clean.startswith("```"):
        start = raw_clean.find("{")
        end = raw_clean.rfind("}") + 1
        raw_clean = raw_clean[start:end] if start != -1 else raw_clean
    try:
        parsed = json.loads(raw_clean)
    except json.JSONDecodeError:
        parsed = {"summary": "", "commitments": [], "carry_forward_items": []}

    commitments: list[TeamWrapUpCommitment] = []
    for item in parsed.get("commitments", []):
        if not isinstance(item, dict):
            continue
        description = (item.get("description") or "").strip()
        if not description:
            continue
        # A hallucinated id is worse than no owner: it would silently attach
        # someone else's name to a commitment they never made.
        report_id = item.get("direct_report_id")
        if report_id not in valid_ids:
            report_id = None
        due_date = item.get("due_date") or None
        if due_date:
            try:
                date.fromisoformat(due_date)
            except (ValueError, TypeError):
                due_date = None
        commitments.append(
            TeamWrapUpCommitment(
                description=description, direct_report_id=report_id, due_date=due_date
            )
        )

    return TeamWrapUpDraft(
        summary=parsed.get("summary", "") or "",
        commitments=commitments,
        carry_forward_items=_clean_items(parsed.get("carry_forward_items") or []),
    )


@router.post("/meetings/{meeting_id}/log")
async def log_team_meeting(
    meeting_id: str, body: LogTeamMeetingIn, auth=Depends(get_authenticated_client)
):
    """Save the reviewed wrap-up, then roll the series forward.

    Everything here is manager-confirmed — the AI draft from /wrapup has been
    through the review screen by the time this runs.
    """
    user_id, supabase = auth
    meeting = _fetch_meeting(supabase, user_id, meeting_id)
    summary = body.summary.strip()
    if not summary:
        raise HTTPException(status_code=422, detail="Summary cannot be empty")

    now_iso = datetime.now(timezone.utc).isoformat()
    (
        supabase.table("team_meetings")
        .update(
            {
                "summary": summary,
                "raw_notes": (body.raw_notes or "").strip() or None,
                "logged_at": now_iso,
            }
        )
        .eq("id", meeting_id)
        .eq("manager_id", user_id)
        .execute()
    )

    owned_items = {item["id"] for item in _fetch_agenda_items(supabase, user_id, meeting_id)}
    for outcome in body.agenda_outcomes:
        if outcome.id not in owned_items:
            continue
        (
            supabase.table("team_meeting_agenda_items")
            .update(
                {
                    "covered": outcome.covered,
                    "notes": (outcome.notes or "").strip() or None,
                }
            )
            .eq("id", outcome.id)
            .eq("manager_id", user_id)
            .execute()
        )

    roster_ids = {
        person["id"]
        for person in (
            supabase.table("direct_reports")
            .select("id")
            .eq("manager_id", user_id)
            .execute()
            .data
        )
    }
    for commitment in body.commitments:
        description = commitment.description.strip()
        if not description:
            continue
        report_id = commitment.direct_report_id
        if report_id and report_id not in roster_ids:
            raise HTTPException(status_code=404, detail="Direct report not found")
        (
            supabase.table("commitments")
            .insert(
                {
                    "owner_id": user_id,
                    "direct_report_id": report_id,
                    "description": description,
                    "due_date": commitment.due_date or None,
                    "committed_by": "manager",
                    "source_type": "team_meeting",
                    "source_id": meeting_id,
                    "status": "open",
                    "is_team_commitment": True,
                }
            )
            .execute()
        )

    carried = _clean_items(body.carry_forward_items)
    next_meeting = _roll_forward(supabase, user_id, meeting, carried)

    return {
        "meeting": _serialize_meeting(
            {**meeting, "summary": summary, "logged_at": now_iso},
            {meeting_id: _fetch_agenda_items(supabase, user_id, meeting_id)},
        ),
        "next_meeting": next_meeting,
    }


def _roll_forward(supabase, user_id: str, meeting: dict, carried: list[str]) -> dict | None:
    """Create or top up the next occurrence.

    Three cases, in order:
      - an already-planned open meeting for this series: append the carried
        items to it rather than creating a second one
      - an active series: create the next occurrence from the PRIOR SCHEDULED
        date plus the interval
      - no series, but items were carried: create an undated meeting so the
        carried items have somewhere to live. The frontend shows it as
        needing a date rather than silently dropping what carried.
    """
    series = None
    if meeting.get("series_id"):
        rows = (
            supabase.table("team_meeting_series")
            .select("id,interval_weeks,anchor_at,active")
            .eq("id", meeting["series_id"])
            .eq("manager_id", user_id)
            .eq("active", True)
            .limit(1)
            .execute()
            .data
        )
        series = rows[0] if rows else None

    open_rows = (
        supabase.table("team_meetings")
        .select("*,team_meeting_series(interval_weeks,active)")
        .eq("manager_id", user_id)
        .is_("summary", "null")
        .neq("id", meeting["id"])
        .order("scheduled_at")
        .execute()
        .data
    )
    same_team = [
        row for row in open_rows if row.get("org_unit_id") == meeting.get("org_unit_id")
    ]
    if same_team:
        target = same_team[0]
        if carried:
            _append_agenda_items(supabase, user_id, target["id"], carried)
        return _serialize_meeting(
            target, {target["id"]: _fetch_agenda_items(supabase, user_id, target["id"])}
        )

    if not series and not carried:
        return None

    scheduled_at = None
    if series:
        current_at = meeting.get("scheduled_at") or series["anchor_at"]
        scheduled_at = _next_occurrence_at(current_at, series["interval_weeks"])

    created = (
        supabase.table("team_meetings")
        .insert(
            {
                "manager_id": user_id,
                "org_unit_id": meeting.get("org_unit_id"),
                "scheduled_at": scheduled_at,
                "series_id": series["id"] if series else None,
            }
        )
        .execute()
        .data[0]
    )
    if carried:
        _append_agenda_items(supabase, user_id, created["id"], carried)
    return _serialize_meeting(
        {
            **created,
            "team_meeting_series": {"interval_weeks": series["interval_weeks"], "active": True}
            if series
            else {},
        },
        {created["id"]: _fetch_agenda_items(supabase, user_id, created["id"])},
    )


def _append_agenda_items(supabase, user_id: str, meeting_id: str, items: list[str]) -> None:
    """Add items after whatever is already on that agenda, skipping duplicates
    so an item carried twice doesn't appear twice on the same agenda."""
    existing = _fetch_agenda_items(supabase, user_id, meeting_id)
    existing_text = {row["item"].strip().lower() for row in existing}
    start = max((row["position"] for row in existing), default=-1) + 1
    payload = []
    for offset, text in enumerate(_clean_items(items)):
        if text.lower() in existing_text:
            continue
        payload.append(
            {
                "meeting_id": meeting_id,
                "manager_id": user_id,
                "position": start + offset,
                "item": text,
            }
        )
    if payload:
        supabase.table("team_meeting_agenda_items").insert(payload).execute()


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

    report = None
    if body.direct_report_id:
        rows = (
            supabase.table("direct_reports")
            .select("id,name")
            .eq("id", body.direct_report_id)
            .eq("manager_id", user_id)
            .execute()
            .data
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Direct report not found")
        report = rows[0]

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
    # None, not "You" — who the manager is called is the frontend's business.
    row["direct_report_name"] = report["name"] if report else None
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


@router.get("/dev-focus")
async def get_team_dev_focus(auth=Depends(get_authenticated_client)):
    """Every "training focus" row for this manager — one per led team that's
    ever had a focus note saved, plus at most one org_unit_id-null "all
    teams" row. Same list-not-single-object shape as GET /callout (Session
    45) for the same reason: the frontend switches teams without a round
    trip. An empty list is a normal first-load state, not an error."""
    user_id, supabase = auth
    return (
        supabase.table("team_dev_focus")
        .select("message,updated_at,org_unit_id")
        .eq("manager_id", user_id)
        .execute()
        .data
    )


@router.put("/dev-focus")
async def update_team_dev_focus(body: TeamDevFocusIn, auth=Depends(get_authenticated_client)):
    """Upserts the focus-note row for (manager, org_unit_id) — a pinned
    block that gets overwritten, same manual look-up-then-write as
    update_team_callout (see that function's docstring for why a plain
    supabase upsert() can't express the null-org_unit_id case)."""
    user_id, supabase = auth
    query = supabase.table("team_dev_focus").select("id").eq("manager_id", user_id)
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
            supabase.table("team_dev_focus")
            .update(payload)
            .eq("id", existing[0]["id"])
            .execute()
        )
    else:
        result = supabase.table("team_dev_focus").insert(payload).execute()
    return result.data[0]
