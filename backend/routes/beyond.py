"""
Beyond the team — a manager's meetings outside their own team: their boss,
skip-level, indirect reports, peers, peer managers' team meetings, and
cross-functional or project meetings. Spec: docs/BEYOND_THE_TEAM_SCOPING.md.
Current state: docs/systems/beyond.md.

The core product stays about managing your own team. This space is a real nav
item, but only its OUTPUTS reach the rest of the app: commitments, goal and
project check-ins, and secondhand context in a report's 1:1 prep. It never
gets a Mission Control card.

Tables (database/migrations/2026-09-22_beyond_the_team.sql): outside_people,
outside_meetings, outside_meeting_people, outside_meeting_links. All
owner-scoped (owner_id = auth.uid()), none readable through an IC login.

Draft-then-review (CLAUDE.md hard rule 6):
  - POST /meetings/{id}/wrapup is a pure AI call. NOTHING is written.
  - POST /meetings/{id}/log is the only write of what came out of a meeting,
    and it runs after the manager has confirmed every row on the review
    screen. It re-validates every id against what the manager owns, so a
    tampered or stale payload can't link to someone else's goal or report.

The extractor is handed the manager's actual people, reports, goals and
projects, and any id it returns that isn't on those lists is dropped. It
never invents a link; anything it can't match stays in the summary.
"""
import json
from datetime import date, datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from ai_core import generate_text
from config import AI_DEFAULT_MODEL_HEAVY
from routes.check_ins import CheckInIn, create_check_in
from routes.team import _encode_meeting_date
from utils import get_authenticated_client, get_org, limiter, meeting_date_of, meeting_sort_key

router = APIRouter()

RELATIONSHIPS = ("manager", "skip_level", "indirect_report", "peer", "cross_functional", "other")
KINDS = ("one_on_one", "group")
_CHECK_IN_STATUSES = ("active", "on_track", "at_risk", "completed", "cancelled")
# What the extractor may propose a check-in against: work that is still live.
_ACTIVE_STATUSES = ("active", "on_track", "at_risk")

_MEETING_COLUMNS = "id,title,kind,scheduled_at,notes,summary,logged_at,created_at"
_PERSON_COLUMNS = "id,name,relationship,role_title,email,notes,archived_at,created_at"


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class PersonIn(BaseModel):
    name: str
    relationship: str = "other"
    role_title: str | None = None
    email: str | None = None
    notes: str | None = None


class PersonPatch(BaseModel):
    name: str | None = None
    relationship: str | None = None
    role_title: str | None = None
    email: str | None = None
    notes: str | None = None
    # Archive, never delete — same posture as direct_reports.
    archived: bool | None = None


class MeetingIn(BaseModel):
    title: str | None = None
    kind: str = "one_on_one"
    # YYYY-MM-DD, encoded at noon UTC (docs/decisions/meeting-date-is-scheduled-at.md).
    scheduled_at: str | None = None
    person_ids: list[str] = Field(default_factory=list)
    notes: str | None = None


class MeetingPatch(BaseModel):
    title: str | None = None
    kind: str | None = None
    scheduled_at: str | None = None
    person_ids: list[str] | None = None
    notes: str | None = None
    # Only on an already-logged meeting: fixing the wording of the write-up.
    summary: str | None = None


class WrapUpRequest(BaseModel):
    raw_notes: str


class DraftCommitment(BaseModel):
    description: str
    # Who owes it. "you" = the manager (null direct_report_id, per
    # docs/decisions/nullable-commitment-owner.md); "report" = one of the
    # manager's direct reports; "counterpart" = someone outside the team.
    owner: Literal["you", "report", "counterpart"] = "you"
    direct_report_id: str | None = None
    outside_person_id: str | None = None
    due_date: str | None = None


class DraftCheckIn(BaseModel):
    goal_id: str | None = None
    project_id: str | None = None
    status: str
    note: str | None = None


class DraftReportNote(BaseModel):
    direct_report_id: str
    note: str


class WrapUpDraft(BaseModel):
    summary: str
    commitments: list[DraftCommitment]
    check_ins: list[DraftCheckIn]
    report_notes: list[DraftReportNote]


class LogMeetingIn(BaseModel):
    summary: str
    raw_notes: str | None = None
    meeting_date: str | None = None
    commitments: list[DraftCommitment] = Field(default_factory=list)
    check_ins: list[DraftCheckIn] = Field(default_factory=list)
    report_notes: list[DraftReportNote] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _clean(value: str | None) -> str | None:
    text = (value or "").strip()
    return text or None


def _valid_iso_date(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10]).isoformat()
    except (ValueError, TypeError):
        return None


def _fetch_meeting(supabase, user_id: str, meeting_id: str) -> dict:
    rows = (
        supabase.table("outside_meetings")
        .select(_MEETING_COLUMNS)
        .eq("id", meeting_id)
        .eq("owner_id", user_id)
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return rows[0]


def _fetch_person(supabase, user_id: str, person_id: str) -> dict:
    rows = (
        supabase.table("outside_people")
        .select(_PERSON_COLUMNS)
        .eq("id", person_id)
        .eq("owner_id", user_id)
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Person not found")
    return rows[0]


def _people_by_id(supabase, user_id: str) -> dict[str, dict]:
    rows = (
        supabase.table("outside_people")
        .select(_PERSON_COLUMNS)
        .eq("owner_id", user_id)
        .execute()
        .data
    )
    return {row["id"]: row for row in rows}


def _meeting_people(supabase, user_id: str, meeting_ids: list[str] | None = None) -> dict[str, list[str]]:
    """meeting_id -> [person_id, ...]."""
    query = supabase.table("outside_meeting_people").select("meeting_id,person_id").eq("owner_id", user_id)
    if meeting_ids is not None:
        if not meeting_ids:
            return {}
        query = query.in_("meeting_id", meeting_ids)
    grouped: dict[str, list[str]] = {}
    for row in query.execute().data:
        grouped.setdefault(row["meeting_id"], []).append(row["person_id"])
    return grouped


def _validate_people(person_ids: list[str], owned: dict[str, dict]) -> list[str]:
    cleaned: list[str] = []
    for pid in person_ids:
        if pid not in owned:
            raise HTTPException(status_code=404, detail="Person not found")
        if pid not in cleaned:
            cleaned.append(pid)
    return cleaned


def _validate_kind(kind: str, person_ids: list[str]) -> None:
    if kind not in KINDS:
        raise HTTPException(status_code=422, detail=f"kind must be one of {KINDS}")
    if kind == "one_on_one" and len(person_ids) != 1:
        raise HTTPException(status_code=422, detail="A 1:1 is with exactly one person")


def _set_meeting_people(supabase, user_id: str, meeting_id: str, person_ids: list[str]) -> None:
    (
        supabase.table("outside_meeting_people")
        .delete()
        .eq("meeting_id", meeting_id)
        .eq("owner_id", user_id)
        .execute()
    )
    if person_ids:
        (
            supabase.table("outside_meeting_people")
            .insert([{"meeting_id": meeting_id, "person_id": pid, "owner_id": user_id} for pid in person_ids])
            .execute()
        )


def _serialize_meeting(row: dict, person_ids: list[str], people: dict[str, dict]) -> dict:
    return {
        **row,
        # One canonical date for the frontend, same as 1:1s.
        "meeting_date": meeting_date_of(row),
        "status": "logged" if row.get("summary") else "draft",
        "people": [
            {
                "id": pid,
                "name": people[pid]["name"],
                "relationship": people[pid]["relationship"],
            }
            for pid in person_ids
            if pid in people
        ],
    }


def _team_context(supabase, user_id: str) -> tuple[list[dict], list[dict], list[dict]]:
    """The manager's own reports, live goals and live projects — the only
    things a meeting beyond the team is allowed to link to."""
    reports = (
        supabase.table("direct_reports")
        .select("id,name")
        .eq("manager_id", user_id)
        .is_("archived_at", "null")
        .order("name")
        .execute()
        .data
    )
    goals = (
        supabase.table("goals")
        .select("id,title,level,status")
        .eq("owner_id", user_id)
        .in_("status", _ACTIVE_STATUSES)
        .order("title")
        .execute()
        .data
    )
    projects = (
        supabase.table("projects")
        .select("id,title,status")
        .eq("owner_id", user_id)
        .in_("status", _ACTIVE_STATUSES)
        .order("title")
        .execute()
        .data
    )
    return reports, goals, projects


def _link_rows(supabase, user_id: str, meeting_ids: list[str]) -> list[dict]:
    """Links for these meetings, with the target's name attached."""
    if not meeting_ids:
        return []
    rows = (
        supabase.table("outside_meeting_links")
        .select(
            "id,meeting_id,goal_id,project_id,direct_report_id,note,created_at,"
            "goals(title),projects(title),direct_reports(name)"
        )
        .eq("owner_id", user_id)
        .in_("meeting_id", meeting_ids)
        .order("created_at")
        .execute()
        .data
    )
    for row in rows:
        goal = row.pop("goals", None) or {}
        project = row.pop("projects", None) or {}
        report = row.pop("direct_reports", None) or {}
        if row.get("goal_id"):
            row["target_type"], row["target_name"] = "goal", goal.get("title")
        elif row.get("project_id"):
            row["target_type"], row["target_name"] = "project", project.get("title")
        else:
            row["target_type"], row["target_name"] = "direct_report", report.get("name")
    return rows


def _commitment_rows(supabase, user_id: str, *, meeting_ids: list[str] | None = None, person_id: str | None = None) -> list[dict]:
    query = (
        supabase.table("commitments")
        .select(
            "id,description,due_date,status,committed_by,direct_report_id,outside_person_id,"
            "source_type,source_id,created_at,completed_at,direct_reports(name)"
        )
        .eq("owner_id", user_id)
    )
    if meeting_ids is not None:
        if not meeting_ids:
            return []
        query = query.eq("source_type", "outside_meeting").in_("source_id", meeting_ids)
    if person_id is not None:
        query = query.eq("outside_person_id", person_id)
    rows = query.order("created_at", desc=True).execute().data
    for row in rows:
        joined = row.pop("direct_reports", None) or {}
        row["direct_report_name"] = joined.get("name")
    return rows


# ---------------------------------------------------------------------------
# Overview
# ---------------------------------------------------------------------------

@router.get("")
async def get_overview(auth=Depends(get_authenticated_client)):
    """People (active, with last-met date and open items) and meetings,
    newest first. Also the nav door state: the date of the latest logged
    meeting."""
    user_id, supabase = auth
    people = _people_by_id(supabase, user_id)
    meetings = (
        supabase.table("outside_meetings")
        .select(_MEETING_COLUMNS)
        .eq("owner_id", user_id)
        .order("scheduled_at", desc=True)
        .limit(200)
        .execute()
        .data
    )
    meetings.sort(key=meeting_sort_key, reverse=True)
    joins = _meeting_people(supabase, user_id, [m["id"] for m in meetings])

    open_items = (
        supabase.table("commitments")
        .select("outside_person_id,committed_by")
        .eq("owner_id", user_id)
        .eq("status", "open")
        .not_.is_("outside_person_id", "null")
        .execute()
        .data
    )
    you_owe: dict[str, int] = {}
    they_owe: dict[str, int] = {}
    for row in open_items:
        bucket = they_owe if row["committed_by"] == "counterpart" else you_owe
        bucket[row["outside_person_id"]] = bucket.get(row["outside_person_id"], 0) + 1

    last_met: dict[str, str] = {}
    meeting_count: dict[str, int] = {}
    last_logged: str | None = None
    for meeting in meetings:
        if not meeting.get("summary"):
            continue
        when = meeting_date_of(meeting)
        if when and (last_logged is None or when > last_logged):
            last_logged = when
        for pid in joins.get(meeting["id"], []):
            meeting_count[pid] = meeting_count.get(pid, 0) + 1
            if when and (pid not in last_met or when > last_met[pid]):
                last_met[pid] = when

    people_out = [
        {
            **person,
            "last_met": last_met.get(pid),
            "meeting_count": meeting_count.get(pid, 0),
            "you_owe": you_owe.get(pid, 0),
            "they_owe": they_owe.get(pid, 0),
        }
        for pid, person in people.items()
        if not person.get("archived_at")
    ]
    people_out.sort(key=lambda p: p["name"].lower())

    return {
        "people": people_out,
        "meetings": [_serialize_meeting(m, joins.get(m["id"], []), people) for m in meetings],
        "last_logged": last_logged,
    }


# ---------------------------------------------------------------------------
# People
# ---------------------------------------------------------------------------

@router.post("/people")
async def create_person(body: PersonIn, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Name cannot be empty")
    if body.relationship not in RELATIONSHIPS:
        raise HTTPException(status_code=422, detail=f"relationship must be one of {RELATIONSHIPS}")
    org = get_org(user_id, supabase)
    row = (
        supabase.table("outside_people")
        .insert(
            {
                "owner_id": user_id,
                "org_id": (org or {}).get("id"),
                "name": name,
                "relationship": body.relationship,
                "role_title": _clean(body.role_title),
                "email": _clean(body.email),
                "notes": _clean(body.notes),
            }
        )
        .execute()
        .data[0]
    )
    return row


@router.patch("/people/{person_id}")
async def update_person(person_id: str, body: PersonPatch, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    _fetch_person(supabase, user_id, person_id)
    updates: dict = {}
    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=422, detail="Name cannot be empty")
        updates["name"] = name
    if body.relationship is not None:
        if body.relationship not in RELATIONSHIPS:
            raise HTTPException(status_code=422, detail=f"relationship must be one of {RELATIONSHIPS}")
        updates["relationship"] = body.relationship
    for field in ("role_title", "email", "notes"):
        value = getattr(body, field)
        if value is not None:
            updates[field] = _clean(value)
    if body.archived is not None:
        updates["archived_at"] = datetime.now(timezone.utc).isoformat() if body.archived else None
    if updates:
        (
            supabase.table("outside_people")
            .update(updates)
            .eq("id", person_id)
            .eq("owner_id", user_id)
            .execute()
        )
    return _fetch_person(supabase, user_id, person_id)


@router.get("/people/{person_id}")
async def get_person(person_id: str, auth=Depends(get_authenticated_client)):
    """Everything between the manager and one person: the meetings they were
    in, commitments either way, and what those meetings touched on the
    manager's own team."""
    user_id, supabase = auth
    person = _fetch_person(supabase, user_id, person_id)
    people = _people_by_id(supabase, user_id)

    meeting_ids = [
        row["meeting_id"]
        for row in (
            supabase.table("outside_meeting_people")
            .select("meeting_id")
            .eq("owner_id", user_id)
            .eq("person_id", person_id)
            .execute()
            .data
        )
    ]
    meetings = (
        supabase.table("outside_meetings")
        .select(_MEETING_COLUMNS)
        .eq("owner_id", user_id)
        .in_("id", meeting_ids)
        .execute()
        .data
        if meeting_ids
        else []
    )
    meetings.sort(key=meeting_sort_key, reverse=True)
    joins = _meeting_people(supabase, user_id, meeting_ids)

    return {
        "person": person,
        "meetings": [_serialize_meeting(m, joins.get(m["id"], []), people) for m in meetings],
        "commitments": _commitment_rows(supabase, user_id, person_id=person_id),
        "links": _link_rows(supabase, user_id, meeting_ids),
    }


# ---------------------------------------------------------------------------
# Meetings
# ---------------------------------------------------------------------------

@router.post("/meetings")
async def create_meeting(body: MeetingIn, auth=Depends(get_authenticated_client)):
    """Start a meeting record: who, when, and the raw notes. It stays a draft
    until the wrap-up is confirmed through /log."""
    user_id, supabase = auth
    people = _people_by_id(supabase, user_id)
    person_ids = _validate_people(body.person_ids, people)
    _validate_kind(body.kind, person_ids)
    org = get_org(user_id, supabase)
    created = (
        supabase.table("outside_meetings")
        .insert(
            {
                "owner_id": user_id,
                "org_id": (org or {}).get("id"),
                "title": _clean(body.title),
                "kind": body.kind,
                "scheduled_at": _encode_meeting_date(body.scheduled_at or date.today().isoformat()),
                "notes": _clean(body.notes),
            }
        )
        .execute()
        .data[0]
    )
    _set_meeting_people(supabase, user_id, created["id"], person_ids)
    return _serialize_meeting(created, person_ids, people)


@router.get("/meetings/{meeting_id}")
async def get_meeting(meeting_id: str, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    meeting = _fetch_meeting(supabase, user_id, meeting_id)
    people = _people_by_id(supabase, user_id)
    joins = _meeting_people(supabase, user_id, [meeting_id])
    return {
        **_serialize_meeting(meeting, joins.get(meeting_id, []), people),
        "commitments": _commitment_rows(supabase, user_id, meeting_ids=[meeting_id]),
        "links": _link_rows(supabase, user_id, [meeting_id]),
    }


@router.patch("/meetings/{meeting_id}")
async def update_meeting(meeting_id: str, body: MeetingPatch, auth=Depends(get_authenticated_client)):
    """Edit who, when, title and notes at any time. The write-up itself
    (summary) is only editable once the meeting is logged; before that it is
    produced through wrap-up review, never set directly."""
    user_id, supabase = auth
    meeting = _fetch_meeting(supabase, user_id, meeting_id)
    people = _people_by_id(supabase, user_id)
    joins = _meeting_people(supabase, user_id, [meeting_id])

    updates: dict = {}
    if body.title is not None:
        updates["title"] = _clean(body.title)
    if body.notes is not None:
        updates["notes"] = _clean(body.notes)
    if body.scheduled_at is not None:
        updates["scheduled_at"] = _encode_meeting_date(body.scheduled_at)
    if body.summary is not None:
        if not meeting.get("summary"):
            raise HTTPException(status_code=409, detail="This meeting hasn't been logged yet")
        summary = body.summary.strip()
        if not summary:
            raise HTTPException(status_code=422, detail="Summary cannot be empty")
        updates["summary"] = summary

    kind = body.kind if body.kind is not None else meeting["kind"]
    person_ids = joins.get(meeting_id, [])
    if body.person_ids is not None:
        person_ids = _validate_people(body.person_ids, people)
    if body.kind is not None or body.person_ids is not None:
        _validate_kind(kind, person_ids)
        updates["kind"] = kind

    if updates:
        (
            supabase.table("outside_meetings")
            .update(updates)
            .eq("id", meeting_id)
            .eq("owner_id", user_id)
            .execute()
        )
    if body.person_ids is not None:
        _set_meeting_people(supabase, user_id, meeting_id, person_ids)
    return _serialize_meeting(_fetch_meeting(supabase, user_id, meeting_id), person_ids, people)


@router.delete("/meetings/{meeting_id}")
async def delete_meeting(meeting_id: str, auth=Depends(get_authenticated_client)):
    """Drop a DRAFT meeting. A logged meeting is history: commitments and
    check-ins point at it through source_id, same posture as team meetings."""
    user_id, supabase = auth
    meeting = _fetch_meeting(supabase, user_id, meeting_id)
    if meeting.get("summary"):
        raise HTTPException(status_code=409, detail="A logged meeting can't be deleted")
    (
        supabase.table("outside_meetings")
        .delete()
        .eq("id", meeting_id)
        .eq("owner_id", user_id)
        .execute()
    )
    return {"ok": True}


# ---------------------------------------------------------------------------
# Wrap-up: draft (no writes) then log (the confirmed write)
# ---------------------------------------------------------------------------

_RELATIONSHIP_LABELS = {
    "manager": "the manager's own boss",
    "skip_level": "the manager's skip-level",
    "indirect_report": "an indirect report (on someone else's team)",
    "peer": "a peer",
    "cross_functional": "a cross-functional partner",
    "other": "someone outside the team",
}


def _build_wrapup_prompt(
    meeting: dict,
    attendees: list[dict],
    reports: list[dict],
    goals: list[dict],
    projects: list[dict],
    raw_notes: str,
    today_iso: str,
) -> str:
    """Same shape as the team and 1:1 wrap-ups: precision over coverage, an
    empty list is always a valid answer, and ids come only from the lists
    given. The routing sections are the new part, and each one is gated on
    the meeting actually touching the manager's own team."""
    def block(rows: list[dict], fmt) -> str:
        return "\n".join(fmt(row) for row in rows) if rows else "(none)"

    attendees_block = block(
        attendees,
        lambda p: f"- {p['name']} (id: {p['id']}) — {_RELATIONSHIP_LABELS.get(p['relationship'], 'someone outside the team')}",
    )
    reports_block = block(reports, lambda r: f"- {r['name']} (id: {r['id']})")
    goals_block = block(goals, lambda g: f"- {g['title']} (id: {g['id']}, {g['level']} goal, currently {g['status']})")
    projects_block = block(projects, lambda p: f"- {p['title']} (id: {p['id']}, currently {p['status']})")
    kind = "a 1:1" if meeting.get("kind") == "one_on_one" else "a group meeting"
    title = meeting.get("title") or "(untitled)"

    return f"""You are helping a manager log a meeting they had OUTSIDE their own team — {kind} titled "{title}". Distill the raw notes below into a clean, reviewable record. The manager will review and edit every item before anything is saved. Be precise, not exhaustive.

Today's date: {today_iso} (use it to resolve relative deadlines like "by Friday").

WHO WAS THERE (besides the manager):
{attendees_block}

THE MANAGER'S OWN DIRECT REPORTS:
{reports_block}

THE MANAGER'S LIVE GOALS:
{goals_block}

THE MANAGER'S LIVE PROJECTS / INITIATIVES:
{projects_block}

RAW MEETING NOTES (typed during the meeting, or pasted from a transcript — may be messy or fragmentary):
{raw_notes}

Many meetings like this have nothing to do with the manager's team. That is normal. Only fill the routing sections (2-4) when the notes clearly support it. Empty lists are the expected answer for most meetings.

Produce:

1. summary — 3-5 sentences: decisions made, asks, feedback, changes in direction. Write it so reading it a month from now restores context. State substance directly — no "we discussed X" padding.

2. commitments — explicit commitments only. Things someone actually agreed to DO; topics and vague intentions are not commitments.
   - owner: "you" when the manager owes it; "report" when one of the manager's direct reports now owes it (set direct_report_id from THE MANAGER'S OWN DIRECT REPORTS); "counterpart" when someone from WHO WAS THERE owes it to the manager (set outside_person_id from that list).
   - Never invent an id. If you can't tell exactly who owes it, use "you" only if the manager clearly took it on; otherwise leave it out.
   - due_date: YYYY-MM-DD only when a deadline was stated or clearly implied. Otherwise null.
   - One short sentence starting with a verb.

3. check_ins — only when something in the meeting clearly changes the state of one of THE MANAGER'S LIVE GOALS or LIVE PROJECTS (a decision that unblocks it, a new risk, a cut in scope, a deadline moving).
   - Exactly one of goal_id / project_id, copied from the lists above.
   - status: one of "on_track", "at_risk", "active", "completed", "cancelled" — the state the item is in now, given what was said.
   - note: one sentence saying what changed and why, e.g. "Pricing sign-off slipped to November per the pricing working group."
   - A meeting merely mentioning a topic is not enough. Never guess a match between a topic and a goal whose title doesn't clearly correspond.

4. report_notes — only when someone said something specific about one of THE MANAGER'S OWN DIRECT REPORTS (praise, a concern, a request, context on their work).
   - direct_report_id from that list; note: one sentence ATTRIBUTED to who said it ("Priya said Sam's demo landed well with the exec team"). These are secondhand and will be treated as such — never restate them as established fact.
   - Nothing about indirect reports or anyone not on the list.

Return ONLY valid JSON. No commentary, no markdown, no code fences.

{{"summary": "...", "commitments": [{{"description": "...", "owner": "counterpart", "direct_report_id": null, "outside_person_id": "...", "due_date": null}}], "check_ins": [{{"goal_id": "...", "project_id": null, "status": "at_risk", "note": "..."}}], "report_notes": [{{"direct_report_id": "...", "note": "..."}}]}}"""


def _parse_json(raw: str) -> dict:
    text = (raw or "").strip()
    if text.startswith("```") or not text.startswith("{"):
        start, end = text.find("{"), text.rfind("}") + 1
        text = text[start:end] if start != -1 and end > start else text
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


@router.post("/meetings/{meeting_id}/wrapup", response_model=WrapUpDraft)
@limiter.limit("10/minute")
async def wrap_up_meeting(
    request: Request,
    meeting_id: str,
    body: WrapUpRequest,
    auth=Depends(get_authenticated_client),
):
    """Raw notes -> a DRAFT. Pure AI call: NOTHING is written here.

    Any failure — the model call, a malformed response — returns an empty
    draft rather than an error, so the review screen degrades into "write it
    yourself" instead of losing the notes.
    """
    user_id, supabase = auth
    meeting = _fetch_meeting(supabase, user_id, meeting_id)
    people = _people_by_id(supabase, user_id)
    attendee_ids = _meeting_people(supabase, user_id, [meeting_id]).get(meeting_id, [])
    attendees = [people[pid] for pid in attendee_ids if pid in people]
    reports, goals, projects = _team_context(supabase, user_id)

    empty = WrapUpDraft(summary="", commitments=[], check_ins=[], report_notes=[])
    if not body.raw_notes.strip():
        return empty
    prompt = _build_wrapup_prompt(
        meeting, attendees, reports, goals, projects, body.raw_notes, date.today().isoformat()
    )
    try:
        parsed = _parse_json(generate_text(prompt, model=AI_DEFAULT_MODEL_HEAVY, max_tokens=2000))
    except Exception:
        return empty

    return _sanitize_draft(
        parsed,
        attendee_ids=set(attendee_ids),
        report_ids={r["id"] for r in reports},
        goal_ids={g["id"] for g in goals},
        project_ids={p["id"] for p in projects},
    )


def _sanitize_draft(parsed: dict, *, attendee_ids: set, report_ids: set, goal_ids: set, project_ids: set) -> WrapUpDraft:
    """Drop anything that points at an id the manager doesn't have. A
    hallucinated link is worse than none: it would put words about a meeting
    on a goal or a person it never touched."""
    commitments: list[DraftCommitment] = []
    for item in parsed.get("commitments") or []:
        if not isinstance(item, dict):
            continue
        description = (item.get("description") or "").strip()
        if not description:
            continue
        owner = item.get("owner")
        report_id = item.get("direct_report_id")
        person_id = item.get("outside_person_id")
        if owner == "report" and report_id in report_ids:
            person_id = None
        elif owner == "counterpart":
            report_id = None
            if person_id not in attendee_ids:
                # A 1:1 has exactly one counterpart, so "they owe it" can
                # only mean that person. In a group meeting, an unknown owner
                # is left for the manager to pick on the review screen.
                person_id = next(iter(attendee_ids)) if len(attendee_ids) == 1 else None
        else:
            owner, report_id, person_id = "you", None, None
        commitments.append(
            DraftCommitment(
                description=description,
                owner=owner,
                direct_report_id=report_id,
                outside_person_id=person_id,
                due_date=_valid_iso_date(item.get("due_date")),
            )
        )

    check_ins: list[DraftCheckIn] = []
    seen_targets: set[str] = set()
    for item in parsed.get("check_ins") or []:
        if not isinstance(item, dict):
            continue
        goal_id = item.get("goal_id") if item.get("goal_id") in goal_ids else None
        project_id = item.get("project_id") if item.get("project_id") in project_ids else None
        if bool(goal_id) == bool(project_id):
            continue
        target = goal_id or project_id
        if target in seen_targets:
            continue
        status = item.get("status")
        if status not in _CHECK_IN_STATUSES:
            continue
        seen_targets.add(target)
        check_ins.append(
            DraftCheckIn(goal_id=goal_id, project_id=project_id, status=status, note=_clean(item.get("note")))
        )

    report_notes: list[DraftReportNote] = []
    for item in parsed.get("report_notes") or []:
        if not isinstance(item, dict):
            continue
        report_id = item.get("direct_report_id")
        note = (item.get("note") or "").strip()
        if report_id in report_ids and note:
            report_notes.append(DraftReportNote(direct_report_id=report_id, note=note))

    summary = parsed.get("summary")
    return WrapUpDraft(
        summary=summary.strip() if isinstance(summary, str) else "",
        commitments=commitments,
        check_ins=check_ins,
        report_notes=report_notes,
    )


@router.post("/meetings/{meeting_id}/log")
async def log_meeting(meeting_id: str, body: LogMeetingIn, auth=Depends(get_authenticated_client)):
    """Save the reviewed wrap-up. Everything in the body has been confirmed
    by the manager on the review screen; every id is re-checked here anyway.

    Order matches team meetings: validate everything, mark the meeting
    logged, then write what it produced. A second /log on the same meeting is
    refused, so a retry can't duplicate commitments (the failure the 1:1
    date bug produced — docs/decisions/meeting-date-is-scheduled-at.md).
    """
    user_id, supabase = auth
    meeting = _fetch_meeting(supabase, user_id, meeting_id)
    if meeting.get("summary"):
        raise HTTPException(status_code=409, detail="This meeting is already logged")
    summary = body.summary.strip()
    if not summary:
        raise HTTPException(status_code=422, detail="Summary cannot be empty")

    attendee_ids = _meeting_people(supabase, user_id, [meeting_id]).get(meeting_id, [])
    owned_people = set(_people_by_id(supabase, user_id))
    # All of the manager's reports, archived included — a meeting logged
    # late can still be about someone who has since left the roster.
    report_ids = {
        r["id"]
        for r in supabase.table("direct_reports").select("id").eq("manager_id", user_id).execute().data
    }
    goal_ids = {g["id"] for g in supabase.table("goals").select("id").eq("owner_id", user_id).execute().data}
    project_ids = {p["id"] for p in supabase.table("projects").select("id").eq("owner_id", user_id).execute().data}

    commitment_rows: list[dict] = []
    for c in body.commitments:
        description = c.description.strip()
        if not description:
            continue
        report_id, person_id, committed_by = None, None, "manager"
        if c.owner == "report":
            if c.direct_report_id not in report_ids:
                raise HTTPException(status_code=404, detail="Direct report not found")
            report_id, committed_by = c.direct_report_id, "direct_report"
        elif c.owner == "counterpart":
            if not c.outside_person_id:
                raise HTTPException(status_code=422, detail=f'Pick who owes "{description}"')
            if c.outside_person_id not in owned_people:
                raise HTTPException(status_code=404, detail="Person not found")
            person_id, committed_by = c.outside_person_id, "counterpart"
        elif meeting["kind"] == "one_on_one" and len(attendee_ids) == 1:
            # In a 1:1, what you owe, you owe to them — so it shows on their page.
            person_id = attendee_ids[0]
        commitment_rows.append(
            {
                "owner_id": user_id,
                "description": description,
                "direct_report_id": report_id,
                "outside_person_id": person_id,
                "committed_by": committed_by,
                "due_date": _valid_iso_date(c.due_date),
                "source_type": "outside_meeting",
                "source_id": meeting_id,
                "status": "open",
            }
        )

    check_ins: list[DraftCheckIn] = []
    for ci in body.check_ins:
        if bool(ci.goal_id) == bool(ci.project_id):
            raise HTTPException(status_code=422, detail="A check-in is on exactly one goal or project")
        if ci.goal_id and ci.goal_id not in goal_ids:
            raise HTTPException(status_code=404, detail="Goal not found")
        if ci.project_id and ci.project_id not in project_ids:
            raise HTTPException(status_code=404, detail="Project not found")
        if ci.status not in _CHECK_IN_STATUSES:
            raise HTTPException(status_code=422, detail=f"status must be one of {_CHECK_IN_STATUSES}")
        check_ins.append(ci)

    report_notes: list[DraftReportNote] = []
    for rn in body.report_notes:
        if not rn.note.strip():
            continue
        if rn.direct_report_id not in report_ids:
            raise HTTPException(status_code=404, detail="Direct report not found")
        report_notes.append(rn)

    updates = {
        "summary": summary,
        "notes": _clean(body.raw_notes) or meeting.get("notes"),
        "logged_at": datetime.now(timezone.utc).isoformat(),
    }
    if body.meeting_date:
        updates["scheduled_at"] = _encode_meeting_date(body.meeting_date)
    (
        supabase.table("outside_meetings")
        .update(updates)
        .eq("id", meeting_id)
        .eq("owner_id", user_id)
        .execute()
    )

    if commitment_rows:
        supabase.table("commitments").insert(commitment_rows).execute()

    link_rows: list[dict] = []
    for ci in check_ins:
        parent = ("goals", "goal_id", ci.goal_id) if ci.goal_id else ("projects", "project_id", ci.project_id)
        create_check_in(
            supabase,
            user_id,
            parent[0],
            parent[1],
            parent[2],
            CheckInIn(status=ci.status, note=_clean(ci.note)),
            source_type="outside_meeting",
            source_id=meeting_id,
        )
        link_rows.append(
            {"meeting_id": meeting_id, "owner_id": user_id, parent[1]: parent[2], "note": _clean(ci.note)}
        )
    for rn in report_notes:
        link_rows.append(
            {
                "meeting_id": meeting_id,
                "owner_id": user_id,
                "direct_report_id": rn.direct_report_id,
                "note": rn.note.strip(),
            }
        )
    if link_rows:
        supabase.table("outside_meeting_links").insert(link_rows).execute()

    return await get_meeting(meeting_id, auth)


# ---------------------------------------------------------------------------
# Reads for other surfaces
# ---------------------------------------------------------------------------

@router.get("/links")
async def list_links(
    goal_id: str | None = None,
    project_id: str | None = None,
    direct_report_id: str | None = None,
    auth=Depends(get_authenticated_client),
):
    """Meetings beyond the team that touched one goal, project or report,
    newest first — for that item's history."""
    user_id, supabase = auth
    filters = [(k, v) for k, v in (("goal_id", goal_id), ("project_id", project_id), ("direct_report_id", direct_report_id)) if v]
    if len(filters) != 1:
        raise HTTPException(status_code=422, detail="Pass exactly one of goal_id, project_id, direct_report_id")
    column, value = filters[0]
    rows = (
        supabase.table("outside_meeting_links")
        .select("id,meeting_id,note,created_at,outside_meetings(title,kind,scheduled_at,created_at)")
        .eq("owner_id", user_id)
        .eq(column, value)
        .order("created_at", desc=True)
        .limit(50)
        .execute()
        .data
    )
    for row in rows:
        meeting = row.pop("outside_meetings", None) or {}
        row["meeting_title"] = meeting.get("title")
        row["meeting_kind"] = meeting.get("kind")
        row["meeting_date"] = meeting_date_of(meeting)
    return rows


def fetch_secondhand_notes(supabase, user_id: str, report_id: str, limit: int = 5, window_days: int = 90) -> list[dict]:
    """Recent things said about one of the manager's reports in meetings
    beyond the team, for that report's 1:1 prep. Secondhand and private:
    the prep prompt frames them as someone else's account, never as fact.

    Fails soft to [] — prep must never break because this table is missing
    (a deploy that lands before the migration runs) or a read hiccups.
    """
    try:
        since = (datetime.now(timezone.utc) - timedelta(days=window_days)).isoformat()
        rows = (
            supabase.table("outside_meeting_links")
            .select("meeting_id,note,created_at,outside_meetings(title,scheduled_at,created_at)")
            .eq("owner_id", user_id)
            .eq("direct_report_id", report_id)
            .gte("created_at", since)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
            .data
        )
        joins = _meeting_people(supabase, user_id, list({r["meeting_id"] for r in rows}))
        people = _people_by_id(supabase, user_id) if joins else {}
    except Exception:
        return []
    notes: list[dict] = []
    for row in rows:
        if not row.get("note"):
            continue
        meeting = row.get("outside_meetings") or {}
        notes.append(
            {
                "note": row["note"],
                "meeting_title": meeting.get("title"),
                "meeting_date": str(meeting_date_of(meeting) or "")[:10] or None,
                "people": [people[pid]["name"] for pid in joins.get(row["meeting_id"], []) if pid in people],
            }
        )
    return notes
