"""
Beyond the team — Overview and conversation continuity.

Design: docs/design-proposals/2026-09-25-beyond-directions/ (overview-revised
+ option A's continuity). Current state: docs/systems/beyond.md.

Mounted at /api/beyond beside routes/beyond.py, whose helpers it reuses.
Adds:

  GET  /continuity                 one scoped aggregate for the four views
                                   (Overview, People, My manager, Group
                                   conversations) and the "What needs you
                                   next?" brief. Deterministic; no AI.
  POST /meetings/{id}/prep-items   save a private thing to raise in an
  DELETE /meetings/{id}/prep-items/{item_id}
                                   upcoming conversation (a thought, or an
                                   accepted suggestion's edited prep line)
  POST /suggestions/refresh        ask the model for evidence-backed
                                   connections between reviewed Beyond
                                   records and live goals/projects
  POST /suggestions/{id}/dismiss
  POST /suggestions/{id}/connect   confirm one: writes ONE
                                   outside_meeting_links row. Never a
                                   check-in, never a status change.

Truth rules this module holds (the brief's review checklist):
  - Recorded facts and AI suggestions are separate kinds. The brief never
    phrases a record as a judgement: "recorded as open", not "they haven't".
  - Absence of a record is not evidence. No elapsed-time "overdue" without an
    explicit repeat rule, and a cadence gap says nothing is on record, not
    that a conversation was missed.
  - Suggestions come only from REVIEWED records (open commitments from logged
    meetings, logged write-ups) and the manager's own live team-level work.
    Never direct-report links, secondhand report notes, assessments, 1:1
    notes, development plans, individual goals or a project's owner.
  - The evidence shown is copied from the records here, never model text,
    and a suggestion whose source is gone or closed is not shown.
  - Adding a prep line confirms nothing. Confirming a connection changes no
    work status. Saving never sends anything to anyone.
  - Group meetings stand alone. Nothing here infers a series from matching
    titles or attendees.

prep_items and the suggestion tables arrive with
database/migrations/2026-09-25_beyond_continuity.sql. Every read of them
fails soft and says so (…_available: false), so a deploy that lands before
the migration keeps every existing workflow working.
"""
import hashlib
import json
import logging
import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from ai_core import generate_text
from config import AI_DEFAULT_MODEL_LIGHT
from routes.beyond import (
    _ACTIVE_STATUSES,
    _MEETING_COLUMNS,
    _active_series,
    _clean,
    _fetch_meeting,
    _meeting_people,
    _meeting_status,
    _parse_json,
    _people_by_id,
    _serialize_meeting,
    fetch_prep_items,
)
from utils import get_authenticated_client, limiter, meeting_date_of, meeting_day_of, meeting_sort_key

logger = logging.getLogger(__name__)

router = APIRouter()

# How far ahead a dated conversation or promise counts as "next".
_SOON_DAYS = 7
# The brief shows three; the rest sit behind "show more", capped.
_BRIEF_SIZE = 3
_BRIEF_MORE_CAP = 6
# What the suggestion pass may look at.
_SUGGEST_MEETING_DAYS = 60
_SUGGEST_MAX_COMMITMENTS = 15
_SUGGEST_MAX_MEETINGS = 8
_SUGGEST_MAX_TARGETS = 20
_SUGGEST_MAX_RESULTS = 3
_PREP_ITEM_MAX_CHARS = 500
_PREP_ITEMS_PER_MEETING = 30


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def _day(value) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _meeting_ref(meeting: dict | None, people: dict[str, dict], joins: dict[str, list[str]]) -> dict | None:
    if not meeting:
        return None
    return {
        "id": meeting["id"],
        "title": meeting.get("title"),
        "kind": meeting.get("kind"),
        "date": meeting_date_of(meeting),
        "status": _meeting_status(meeting),
        "people": [
            {"id": pid, "name": people[pid]["name"]} for pid in joins.get(meeting["id"], []) if pid in people
        ],
    }


def _meeting_label(ref: dict | None) -> str:
    """How a meeting is named in a brief line, when it has no title."""
    if not ref:
        return "a meeting"
    if ref.get("title"):
        return ref["title"]
    names = [p["name"] for p in ref.get("people") or []]
    if ref.get("kind") == "one_on_one" and names:
        return f"your 1:1 with {names[0]}"
    return f"your meeting with {', '.join(names)}" if names else "a meeting"


def _short(day: date | None) -> str:
    return day.strftime("%b ") + str(day.day) if day else ""


def _first(name: str) -> str:
    return (name or "").split(" ")[0] or name


def _open_commitments(supabase, user_id: str) -> list[dict]:
    """Open commitments that belong to Beyond: anything owed to or by an
    outside person, plus anything a meeting beyond the team produced (a
    manager or report commitment from a group meeting has no person)."""
    columns = (
        "id,description,due_date,status,committed_by,direct_report_id,outside_person_id,"
        "source_type,source_id,created_at,direct_reports(name)"
    )
    by_person = (
        supabase.table("commitments")
        .select(columns)
        .eq("owner_id", user_id)
        .eq("status", "open")
        .not_.is_("outside_person_id", "null")
        .execute()
        .data
    )
    by_source = (
        supabase.table("commitments")
        .select(columns)
        .eq("owner_id", user_id)
        .eq("status", "open")
        .eq("source_type", "outside_meeting")
        .execute()
        .data
    )
    merged: dict[str, dict] = {}
    for row in [*by_person, *by_source]:
        joined = row.pop("direct_reports", None) or {}
        row["direct_report_name"] = joined.get("name") if isinstance(joined, dict) else None
        merged[row["id"]] = row
    return sorted(merged.values(), key=lambda c: (c.get("due_date") or "9999", c.get("created_at") or ""))


def _commitment_out(c: dict, meetings_by_id: dict[str, dict], people: dict[str, dict], joins: dict[str, list[str]]) -> dict:
    source = meetings_by_id.get(c.get("source_id") or "") if c.get("source_type") == "outside_meeting" else None
    person = people.get(c.get("outside_person_id") or "")
    return {
        "id": c["id"],
        "description": c["description"],
        "due_date": c.get("due_date"),
        "committed_by": c["committed_by"],
        # The real owner, never folded into "you": a report-owned commitment
        # keeps the report's name; a counterpart's keeps theirs.
        "owner_name": (
            person["name"] if c["committed_by"] == "counterpart" and person
            else c.get("direct_report_name") if c["committed_by"] == "direct_report"
            else None
        ),
        "outside_person_id": c.get("outside_person_id"),
        "source_meeting": _meeting_ref(source, people, joins),
    }


# ---------------------------------------------------------------------------
# The brief — pure, so it is testable without a database
# ---------------------------------------------------------------------------

def build_brief(
    today: date,
    people: list[dict],
    groups: list[dict],
    manager_commitments: list[dict],
    suggestions: list[dict],
) -> tuple[list[dict], list[dict]]:
    """Rank what needs the manager next. Returns (shown, more).

    Priority (a design recommendation from the brief): dated near-term
    preparation and promises first, unfinished write-ups next, then
    reconnects grounded in an explicit repeat rule or recorded open work,
    then at most one evidence-backed AI suggestion when there is one.
    Prompts about the same action are merged: a promise owed to someone whose
    conversation is already in the brief is folded into that item's reason.
    """
    soon = today + timedelta(days=_SOON_DAYS)
    dated: list[tuple[date, dict]] = []
    covered_people: set[str] = set()

    for p in people:
        nxt = p.get("next_meeting")
        day = _day(nxt.get("date")) if nxt else None
        if not nxt or not day or day > soon:
            continue
        first = _first(p["name"])
        facts: list[str] = []
        mine = [c for c in p["you_owe"] if c["committed_by"] == "manager"]
        if mine:
            c = mine[0]
            due = _day(c.get("due_date"))
            facts.append(f"You owe {first}: {c['description']}" + (f" (due {_short(due)})" if due else ""))
        if p["they_owe"]:
            facts.append(f"{first}'s “{p['they_owe'][0]['description']}” is recorded as open")
        if nxt.get("carried"):
            n = len(nxt["carried"])
            facts.append(f"{n} topic{'s' if n != 1 else ''} carried from last time")
        if nxt.get("prep_items"):
            n = len(nxt["prep_items"])
            facts.append(f"{n} saved thought{'s' if n != 1 else ''} to raise")
        if not facts:
            facts.append("Prepared" if nxt.get("prepared") else "Not prepared yet")
        dated.append(
            (
                day,
                {
                    "id": f"upcoming:{nxt['id']}",
                    "kind": "upcoming",
                    "title": f"Prepare for {first}",
                    "date": nxt["date"],
                    "reason": "; ".join(facts[:2]) + ".",
                    "source": {"label": "Scheduled 1:1", "meeting_id": nxt["id"]},
                    "action": {
                        "label": "Open prep" if nxt.get("prepared") else "Prepare",
                        "href": f"/app/beyond/meetings/{nxt['id']}",
                    },
                    "person_id": p["id"],
                },
            )
        )
        covered_people.add(p["id"])

    for g in groups:
        day = _day(g.get("date"))
        if g["status"] != "upcoming" or not day or day > soon:
            continue
        names = ", ".join(_first(x["name"]) for x in g["people"][:3]) or "no one added yet"
        dated.append(
            (
                day,
                {
                    "id": f"upcoming:{g['id']}",
                    "kind": "upcoming",
                    "title": g.get("title") or "Group conversation",
                    "date": g["date"],
                    "reason": f"Group conversation with {names}."
                    + (f" {len(g['prep_items'])} saved thought(s) to raise." if g.get("prep_items") else ""),
                    "source": {"label": "Scheduled group meeting", "meeting_id": g["id"]},
                    "action": {"label": "Open", "href": f"/app/beyond/meetings/{g['id']}"},
                    "person_id": None,
                },
            )
        )

    for c in manager_commitments:
        day = _day(c.get("due_date"))
        if not day or day > soon:
            continue
        if c.get("outside_person_id") in covered_people:
            continue  # already in that person's "Prepare for" reason
        src = c.get("source_meeting")
        src_day = _day(src.get("date")) if src else None
        overdue = day < today
        dated.append(
            (
                day,
                {
                    "id": f"commitment:{c['id']}",
                    "kind": "commitment",
                    "title": c["description"],
                    "date": c["due_date"],
                    "due_label": ("Was due " if overdue else "Due ") + _short(day),
                    "reason": (
                        f"You agreed in {_meeting_label(src)}" + (f", {_short(src_day)}" if src_day else "")
                        + ". Recorded as open."
                    ),
                    "source": {"label": "Recorded commitment", "meeting_id": src["id"] if src else None},
                    "action": {
                        "label": "View promise",
                        "href": f"/app/beyond/meetings/{src['id']}" if src else "/app/beyond?view=people",
                    },
                    "person_id": c.get("outside_person_id"),
                },
            )
        )

    dated.sort(key=lambda pair: pair[0])
    ranked = [item for _, item in dated]

    # Notes saved, outcome not reviewed: newest first.
    drafts: list[dict] = []
    for m in sorted(
        [p["draft"] for p in people if p.get("draft")] + [g for g in groups if g["status"] == "draft"],
        key=lambda m: m.get("date") or "",
        reverse=True,
    ):
        if any(d["id"] == f"review:{m['id']}" for d in drafts):
            continue
        day = _day(m.get("date"))
        drafts.append(
            {
                "id": f"review:{m['id']}",
                "kind": "review",
                "title": f"Write up {_meeting_label(m)}",
                "date": m.get("date"),
                "reason": ("Notes saved" if m.get("has_notes") else "Nothing written yet")
                + (f" · met {_short(day)}" if day else "")
                + " · outcome not reviewed yet.",
                "source": {"label": "Meeting draft", "meeting_id": m["id"]},
                "action": {"label": "Review notes", "href": f"/app/beyond/meetings/{m['id']}"},
                "person_id": None,
            }
        )
    ranked += drafts

    # Reconnects: an explicit repeat rule with nothing on record, or recorded
    # open work with no next conversation. Elapsed time alone never counts.
    for p in people:
        if p.get("next_meeting") or p.get("draft"):
            continue
        first = _first(p["name"])
        plan_href = f"/app/beyond/meetings/new?person={p['id']}&plan=1"
        if p.get("cadence_weeks"):
            weeks = p["cadence_weeks"]
            ranked.append(
                {
                    "id": f"cadence:{p['id']}",
                    "kind": "cadence",
                    "title": f"No next 1:1 with {first} on record",
                    "date": None,
                    "reason": f"Your 1:1s repeat {'weekly' if weeks == 1 else f'every {weeks} weeks'}, but no next one "
                    "is on record. That doesn't mean you haven't met.",
                    "source": {"label": "Repeat rule", "meeting_id": None},
                    "action": {"label": "Plan the next 1:1", "href": plan_href},
                    "person_id": p["id"],
                }
            )
            continue
        open_items = len(p["you_owe"]) + len(p["they_owe"])
        if open_items:
            example = (p["they_owe"] or p["you_owe"])[0]["description"]
            ranked.append(
                {
                    "id": f"reconnect:{p['id']}",
                    "kind": "reconnect",
                    "title": f"Open work with {first}, no next conversation",
                    "date": None,
                    "reason": f"{open_items} recorded open item{'s' if open_items != 1 else ''} between you, "
                    f"including “{example}”. No next conversation is on record.",
                    "source": {"label": "Recorded commitments", "meeting_id": None},
                    "action": {"label": "Plan a 1:1", "href": plan_href},
                    "person_id": p["id"],
                }
            )

    suggestion_items = [
        {
            "id": f"suggestion:{s['id']}",
            "kind": "suggestion",
            "title": s["title"],
            "date": None,
            "reason": f"Possible connection: {_meeting_label(s['source']['meeting'])}"
            + (f" ({_short(_day(s['source']['meeting'].get('date')))})" if s["source"]["meeting"].get("date") else "")
            + f" + {s['target']['title']}.",
            "source": {"label": "AI suggestion", "meeting_id": s["source"]["meeting"]["id"]},
            "action": {"label": "Review suggestion", "href": None},
            "suggestion_id": s["id"],
            "person_id": (s.get("person") or {}).get("id"),
        }
        for s in suggestions
    ]

    if suggestion_items:
        shown = ranked[: _BRIEF_SIZE - 1] + suggestion_items[:1]
        more = ranked[_BRIEF_SIZE - 1:] + suggestion_items[1:]
    else:
        shown, more = ranked[:_BRIEF_SIZE], ranked[_BRIEF_SIZE:]
    return shown, more[:_BRIEF_MORE_CAP]


# ---------------------------------------------------------------------------
# The aggregate
# ---------------------------------------------------------------------------

def _fetch_suggestions(supabase, user_id: str, status: str = "open") -> list[dict]:
    return (
        supabase.table("outside_suggestions")
        .select(
            "id,suggestion_key,evidence_hash,source_meeting_id,source_commitment_id,source_excerpt,goal_id,project_id,"
            "target_excerpt,person_id,title,reason,suggested_prep,status,added_meeting_id,added_at,created_at"
        )
        .eq("owner_id", user_id)
        .eq("status", status)
        .order("created_at", desc=True)
        .limit(20)
        .execute()
        .data
    )


def _serialize_suggestions(
    supabase,
    user_id: str,
    rows: list[dict],
    meetings_by_id: dict[str, dict],
    people: dict[str, dict],
    joins: dict[str, list[str]],
) -> list[dict]:
    """Attach the records a suggestion rests on. A suggestion whose source
    meeting is gone or not reviewed, whose source commitment has closed, or
    whose target is gone or no longer live is NOT shown — missing evidence is
    never presented as inspected evidence."""
    if not rows:
        return []
    goal_ids = [r["goal_id"] for r in rows if r.get("goal_id")]
    project_ids = [r["project_id"] for r in rows if r.get("project_id")]
    goals = {
        g["id"]: g
        for g in (
            supabase.table("goals").select("id,title,status,level").eq("owner_id", user_id).in_("id", goal_ids).execute().data
            if goal_ids
            else []
        )
    }
    projects = {
        p["id"]: p
        for p in (
            supabase.table("projects").select("id,title,status").eq("owner_id", user_id).in_("id", project_ids).execute().data
            if project_ids
            else []
        )
    }
    commitment_ids = [r["source_commitment_id"] for r in rows if r.get("source_commitment_id")]
    commitments = {
        c["id"]: c
        for c in (
            supabase.table("commitments").select("id,status").eq("owner_id", user_id).in_("id", commitment_ids).execute().data
            if commitment_ids
            else []
        )
    }
    out: list[dict] = []
    for r in rows:
        meeting = meetings_by_id.get(r["source_meeting_id"])
        if not meeting or not meeting.get("summary"):
            continue
        if r.get("source_commitment_id"):
            c = commitments.get(r["source_commitment_id"])
            if not c or c.get("status") != "open":
                continue
        target = goals.get(r.get("goal_id") or "") or projects.get(r.get("project_id") or "")
        if not target or target.get("status") not in _ACTIVE_STATUSES:
            continue
        person = people.get(r.get("person_id") or "")
        out.append(
            {
                "id": r["id"],
                "title": r["title"],
                "reason": r["reason"],
                "suggested_prep": r.get("suggested_prep"),
                "status": r["status"],
                "added_meeting_id": r.get("added_meeting_id"),
                "source": {
                    "type": "commitment" if r.get("source_commitment_id") else "meeting",
                    "commitment_id": r.get("source_commitment_id"),
                    "excerpt": r["source_excerpt"],
                    "meeting": _meeting_ref(meeting, people, joins),
                },
                "target": {
                    "type": "goal" if r.get("goal_id") else "project",
                    "id": target["id"],
                    "title": target["title"],
                    "excerpt": r.get("target_excerpt"),
                },
                "person": {"id": person["id"], "name": person["name"]} if person and not person.get("archived_at") else None,
            }
        )
    return out


@router.get("/continuity")
def get_continuity(auth=Depends(get_authenticated_client)):
    """Everything the four Beyond views read, in one scoped aggregate.

    Deterministic — no AI call. Sections that depend on the newer tables
    (saved thoughts, suggestions) say when they couldn't load rather than
    looking empty."""
    user_id, supabase = auth
    today = date.today()
    people = _people_by_id(supabase, user_id)
    meetings = (
        supabase.table("outside_meetings")
        .select(_MEETING_COLUMNS)
        .eq("owner_id", user_id)
        .order("scheduled_at", desc=True)
        .limit(300)
        .execute()
        .data
    )
    meetings.sort(key=meeting_sort_key, reverse=True)
    meetings_by_id = {m["id"]: m for m in meetings}
    joins = _meeting_people(supabase, user_id, [m["id"] for m in meetings])
    series = _active_series(supabase, user_id)
    cadence = {s_["person_id"]: s_["interval_weeks"] for s_ in series.values()}

    prep_items, prep_items_available = fetch_prep_items(
        supabase, user_id, [m["id"] for m in meetings if not m.get("summary")]
    )
    commitments = [_commitment_out(c, meetings_by_id, people, joins) for c in _open_commitments(supabase, user_id)]

    def meeting_out(m: dict) -> dict:
        ref = _meeting_ref(m, people, joins)
        return {
            **ref,
            "summary": m.get("summary"),
            "carried": m.get("carry_forward_items") or [],
            "prep_items": prep_items.get(m["id"], []),
            "prepared": bool(m.get("prep_guide")),
            "has_notes": bool((m.get("notes") or "").strip()),
            "recurrence_weeks": (series.get(m.get("series_id") or "") or {}).get("interval_weeks"),
        }

    # Per person: meetings they were in, newest first.
    by_person: dict[str, list[dict]] = {}
    for m in meetings:
        for pid in joins.get(m["id"], []):
            by_person.setdefault(pid, []).append(m)

    people_out: list[dict] = []
    for pid, person in people.items():
        if person.get("archived_at"):
            continue
        theirs = by_person.get(pid, [])
        one_on_ones = [m for m in theirs if m.get("kind") == "one_on_one"]
        upcoming = sorted(
            (m for m in one_on_ones if _meeting_status(m) == "upcoming"),
            key=lambda m: m.get("scheduled_at") or "9999",
        )
        drafts = [m for m in one_on_ones if _meeting_status(m) == "draft"]
        logged = [m for m in theirs if m.get("summary")]
        # Where we left off: the latest reviewed 1:1, else the latest reviewed
        # group meeting they were in — labelled as such, never merged.
        latest = next((m for m in logged if m.get("kind") == "one_on_one"), None) or (logged[0] if logged else None)
        mine = [c for c in commitments if c["outside_person_id"] == pid]
        people_out.append(
            {
                "id": pid,
                "name": person["name"],
                "relationship": person["relationship"],
                "role_title": person.get("role_title"),
                "next_meeting": meeting_out(upcoming[0]) if upcoming else None,
                "draft": meeting_out(drafts[0]) if drafts else None,
                "cadence_weeks": cadence.get(pid),
                "latest_outcome": meeting_out(latest) if latest else None,
                "last_met": meeting_date_of(logged[0]) if logged else None,
                "you_owe": [c for c in mine if c["committed_by"] != "counterpart"],
                "they_owe": [c for c in mine if c["committed_by"] == "counterpart"],
                "group_meeting_count": sum(1 for m in theirs if m.get("kind") == "group"),
            }
        )
    people_out.sort(key=lambda p: p["name"].lower())

    groups: list[dict] = []
    for m in meetings:
        if m.get("kind") != "group":
            continue
        out = meeting_out(m)
        out["open_commitments"] = [
            c for c in commitments if c["source_meeting"] and c["source_meeting"]["id"] == m["id"]
        ]
        groups.append(out)
    # Upcoming soonest first, then not-yet-written-up, then written up;
    # within the last two, newest first. Each row is one meeting — never a
    # series inferred from matching titles or attendees.
    upcoming_groups = sorted((g for g in groups if g["status"] == "upcoming"), key=lambda g: g.get("date") or "9999")
    draft_groups = sorted((g for g in groups if g["status"] == "draft"), key=lambda g: g.get("date") or "", reverse=True)
    logged_groups = sorted((g for g in groups if g["status"] == "logged"), key=lambda g: g.get("date") or "", reverse=True)
    groups = upcoming_groups + draft_groups + logged_groups

    # Upcoming conversations a prep line can go into, soonest first.
    targets = [
        meeting_out(m)
        for m in sorted(
            (m for m in meetings if _meeting_status(m) == "upcoming"),
            key=lambda m: m.get("scheduled_at") or "9999",
        )
    ]

    suggestions: list[dict] = []
    suggestions_available = True
    try:
        rows = [r for r in _fetch_suggestions(supabase, user_id) if not r.get("added_meeting_id")]
        suggestions = _serialize_suggestions(supabase, user_id, rows, meetings_by_id, people, joins)
    except Exception:
        logger.warning("beyond: suggestions unavailable", exc_info=True)
        suggestions_available = False

    manager_commitments = [
        c for c in commitments if c["committed_by"] == "manager"
    ]
    shown, more = build_brief(today, people_out, groups, manager_commitments, suggestions)

    return {
        "today": today.isoformat(),
        "people": people_out,
        "groups": groups,
        "upcoming": targets,
        "suggestions": suggestions,
        "brief": shown,
        "brief_more": more,
        "prep_items_available": prep_items_available,
        "suggestions_available": suggestions_available,
    }


# ---------------------------------------------------------------------------
# Private prep items on an upcoming conversation
# ---------------------------------------------------------------------------

class PrepItemIn(BaseModel):
    text: str
    # Set when the line came from an AI suggestion the manager reviewed.
    suggestion_id: str | None = None


def _require_prep_target(supabase, user_id: str, meeting_id: str) -> dict:
    meeting = _fetch_meeting(supabase, user_id, meeting_id)
    if meeting.get("summary"):
        raise HTTPException(status_code=409, detail="That conversation is already written up — pick an upcoming one")
    if _meeting_status(meeting) != "upcoming":
        raise HTTPException(status_code=409, detail="That conversation has already happened — write it up, or pick an upcoming one")
    return meeting


def _load_items(supabase, user_id: str, meeting_id: str) -> list[dict]:
    items, available = fetch_prep_items(supabase, user_id, [meeting_id])
    if not available:
        raise HTTPException(status_code=503, detail="Saving thoughts isn't available yet — the database update hasn't run")
    return items.get(meeting_id, [])


def _meeting_payload(supabase, user_id: str, meeting_id: str) -> dict:
    meeting = _fetch_meeting(supabase, user_id, meeting_id)
    people = _people_by_id(supabase, user_id)
    joins = _meeting_people(supabase, user_id, [meeting_id])
    items, _ = fetch_prep_items(supabase, user_id, [meeting_id])
    return {
        **_serialize_meeting(meeting, joins.get(meeting_id, []), people, _active_series(supabase, user_id)),
        "prep_items": items.get(meeting_id, []),
    }


@router.post("/meetings/{meeting_id}/prep-items")
def add_prep_item(meeting_id: str, body: PrepItemIn, auth=Depends(get_authenticated_client)):
    """Save something private to raise in an upcoming conversation. It is
    not an agreed commitment, it is not sent anywhere, and — when it came
    from a suggestion — it does not confirm that suggestion's connection."""
    user_id, supabase = auth
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status_code=422, detail="Write the thought first")
    if len(text) > _PREP_ITEM_MAX_CHARS:
        raise HTTPException(status_code=422, detail=f"Keep it under {_PREP_ITEM_MAX_CHARS} characters")
    _require_prep_target(supabase, user_id, meeting_id)
    items = _load_items(supabase, user_id, meeting_id)
    if len(items) >= _PREP_ITEMS_PER_MEETING:
        raise HTTPException(status_code=422, detail="This conversation already has a lot saved — remove some first")

    suggestion = None
    if body.suggestion_id:
        rows = (
            supabase.table("outside_suggestions")
            .select("id,status")
            .eq("id", body.suggestion_id)
            .eq("owner_id", user_id)
            .limit(1)
            .execute()
            .data
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Suggestion not found")
        suggestion = rows[0]
        if suggestion["status"] == "dismissed":
            raise HTTPException(status_code=409, detail="That suggestion was dismissed")

    item = {
        "id": str(uuid.uuid4()),
        "text": text,
        "source": "suggestion" if suggestion else "thought",
        "suggestion_id": suggestion["id"] if suggestion else None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    (
        supabase.table("outside_meetings")
        .update({"prep_items": [*items, item]})
        .eq("id", meeting_id)
        .eq("owner_id", user_id)
        .execute()
    )
    if suggestion:
        # Records where its prep line went. Status is untouched: adding to
        # prep is not confirming the connection.
        (
            supabase.table("outside_suggestions")
            .update({"added_meeting_id": meeting_id, "added_at": item["created_at"]})
            .eq("id", suggestion["id"])
            .eq("owner_id", user_id)
            .execute()
        )
    return {"item": item, "meeting": _meeting_payload(supabase, user_id, meeting_id)}


@router.delete("/meetings/{meeting_id}/prep-items/{item_id}")
def remove_prep_item(meeting_id: str, item_id: str, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    meeting = _fetch_meeting(supabase, user_id, meeting_id)
    if meeting.get("summary"):
        raise HTTPException(status_code=409, detail="A written-up conversation's saved thoughts stay as they were")
    items = _load_items(supabase, user_id, meeting_id)
    kept = [i for i in items if i.get("id") != item_id]
    if len(kept) == len(items):
        raise HTTPException(status_code=404, detail="Saved thought not found")
    (
        supabase.table("outside_meetings")
        .update({"prep_items": kept})
        .eq("id", meeting_id)
        .eq("owner_id", user_id)
        .execute()
    )
    return {"meeting": _meeting_payload(supabase, user_id, meeting_id)}


# ---------------------------------------------------------------------------
# AI suggestions — propose, never record
# ---------------------------------------------------------------------------

def _hash(*parts: str) -> str:
    return hashlib.sha256("␟".join(parts).encode("utf-8")).hexdigest()[:32]


def _trim(text: str | None, limit: int) -> str:
    value = " ".join((text or "").split())
    return value if len(value) <= limit else value[: limit - 1].rstrip() + "…"


def gather_suggestion_evidence(supabase, user_id: str, today: date | None = None) -> dict:
    """The only material a suggestion pass may see, assembled
    deterministically. Sources are REVIEWED Beyond records; targets are the
    manager's own live team-level work. Deliberately excluded: direct-report
    links and secondhand report notes, report-owned commitments, individual
    goals, a project's owner or report, assessments, 1:1 notes and
    development plans (none of those tables are read here)."""
    today = today or date.today()
    people = _people_by_id(supabase, user_id)
    meetings = (
        supabase.table("outside_meetings")
        .select(_MEETING_COLUMNS)
        .eq("owner_id", user_id)
        .not_.is_("summary", "null")
        .execute()
        .data
    )
    meetings.sort(key=meeting_sort_key, reverse=True)
    logged = {m["id"]: m for m in meetings}
    joins = _meeting_people(supabase, user_id, list(logged))

    commitments = [
        c
        for c in _open_commitments(supabase, user_id)
        if c["committed_by"] in ("manager", "counterpart")
        and c.get("source_type") == "outside_meeting"
        and c.get("source_id") in logged
    ][:_SUGGEST_MAX_COMMITMENTS]

    since = today - timedelta(days=_SUGGEST_MEETING_DAYS)
    recent = [m for m in meetings if (meeting_day_of(m) or date.min) >= since][:_SUGGEST_MAX_MEETINGS]

    goals = (
        supabase.table("goals")
        .select("id,title,description,level,status,due_date")
        .eq("owner_id", user_id)
        .neq("level", "individual")
        .in_("status", _ACTIVE_STATUSES)
        .execute()
        .data
    )[:_SUGGEST_MAX_TARGETS]
    projects = (
        supabase.table("projects")
        .select("id,title,description,status,due_date")
        .eq("owner_id", user_id)
        .in_("status", _ACTIVE_STATUSES)
        .execute()
        .data
    )[:_SUGGEST_MAX_TARGETS]

    def person_for(meeting_id: str, commitment: dict | None = None) -> str | None:
        if commitment and commitment.get("outside_person_id"):
            return commitment["outside_person_id"]
        m = logged.get(meeting_id)
        ids = joins.get(meeting_id, [])
        return ids[0] if m and m.get("kind") == "one_on_one" and len(ids) == 1 else None

    sources: list[dict] = []
    for i, c in enumerate(commitments, 1):
        who = people.get(c.get("outside_person_id") or "", {}).get("name") if c["committed_by"] == "counterpart" else "The manager"
        due = f" by {c['due_date']}" if c.get("due_date") else ""
        sources.append(
            {
                "ref": f"C{i}",
                "meeting_id": c["source_id"],
                "commitment_id": c["id"],
                "person_id": person_for(c["source_id"], c),
                "excerpt": _trim(f"{who or 'They'} agreed to {c['description'][0].lower()}{c['description'][1:]}{due}.", 300),
            }
        )
    for i, m in enumerate(recent, 1):
        sources.append(
            {
                "ref": f"M{i}",
                "meeting_id": m["id"],
                "commitment_id": None,
                "person_id": person_for(m["id"]),
                "excerpt": _trim(m.get("summary"), 400),
            }
        )

    targets: list[dict] = []
    for i, g in enumerate(goals, 1):
        detail = _trim(g.get("description"), 240)
        targets.append(
            {
                "ref": f"G{i}",
                "type": "goal",
                "id": g["id"],
                "title": g["title"],
                "excerpt": _trim(
                    " ".join(x for x in [detail, f"Due {g['due_date']}." if g.get("due_date") else ""] if x), 300
                ) or None,
            }
        )
    for i, p in enumerate(projects, 1):
        detail = _trim(p.get("description"), 240)
        targets.append(
            {
                "ref": f"P{i}",
                "type": "project",
                "id": p["id"],
                "title": p["title"],
                "excerpt": _trim(
                    " ".join(x for x in [detail, f"Due {p['due_date']}." if p.get("due_date") else ""] if x), 300
                ) or None,
            }
        )

    meeting_titles = {
        mid: _meeting_label(_meeting_ref(logged[mid], people, joins)) for mid in {s["meeting_id"] for s in sources}
    }
    return {"sources": sources, "targets": targets, "meeting_titles": meeting_titles, "logged": logged}


def _evidence_fingerprint(evidence: dict) -> str:
    parts = [f"{s['ref']}|{s['meeting_id']}|{s['commitment_id']}|{s['excerpt']}" for s in evidence["sources"]]
    parts += [f"{t['ref']}|{t['id']}|{t['title']}|{t['excerpt']}" for t in evidence["targets"]]
    return _hash(*sorted(parts))


def build_suggestion_prompt(evidence: dict, today_iso: str) -> str:
    source_lines = "\n".join(
        f"- {s['ref']} (from {evidence['meeting_titles'].get(s['meeting_id'], 'a meeting')}): {s['excerpt']}"
        for s in evidence["sources"]
    )
    target_lines = "\n".join(
        f"- {t['ref']} {t['type']} \"{t['title']}\"" + (f": {t['excerpt']}" if t.get("excerpt") else "")
        for t in evidence["targets"]
    )
    return f"""A manager keeps reviewed records of conversations OUTSIDE their own team (their boss, peers, cross-functional partners). Separately they own goals and projects for their team. Find the few places where something recorded in one of those conversations probably matters to one of their goals or projects — a dependency, a resource, a deadline, a decision — so they can raise it or connect it. These are SUGGESTIONS the manager will check against the sources before accepting; they are not facts.

Today's date: {today_iso}

REVIEWED RECORDS FROM CONVERSATIONS BEYOND THE TEAM:
{source_lines}

THE MANAGER'S LIVE GOALS AND PROJECTS:
{target_lines}

Rules:
- Only connect a record to a goal/project when BOTH texts are about the same specific piece of work: the same deliverable, dependency, resource, date or decision. A shared person's name, a shared broad theme ("hiring", "Q4") or a vague similarity is NOT enough.
- Never state progress, status or that anything is late. Never claim someone has or hasn't done something; say what is recorded.
- Never describe or assess an individual on the manager's team.
- title: what the manager might do, 12 words or fewer, starting with a verb.
- reason: one sentence naming what each source says and why they may connect.
- suggested_prep: one short question or point the manager could raise in their next conversation, 20 words or fewer.
- At most {_SUGGEST_MAX_RESULTS}. An empty list is the expected answer when nothing clearly connects.
- Use only the refs listed above (C…, M… for records; G…, P… for work).

Return ONLY valid JSON. No commentary, no markdown, no code fences.

{{"suggestions": [{{"source_ref": "C1", "target_ref": "P1", "title": "...", "reason": "...", "suggested_prep": "..."}}]}}"""


def sanitize_suggestions(parsed: dict, evidence: dict) -> list[dict]:
    """Keep only suggestions whose refs exist. Evidence excerpts come from
    the records, never from the model."""
    sources = {s["ref"]: s for s in evidence["sources"]}
    targets = {t["ref"]: t for t in evidence["targets"]}
    out: list[dict] = []
    seen: set[str] = set()
    for raw in parsed.get("suggestions") or []:
        if not isinstance(raw, dict):
            continue
        source = sources.get(str(raw.get("source_ref") or "").strip())
        target = targets.get(str(raw.get("target_ref") or "").strip())
        title = _trim(raw.get("title") if isinstance(raw.get("title"), str) else "", 120)
        reason = _trim(raw.get("reason") if isinstance(raw.get("reason"), str) else "", 400)
        prep = _trim(raw.get("suggested_prep") if isinstance(raw.get("suggested_prep"), str) else "", 240)
        if not source or not target or not title or not reason:
            continue
        key = f"{'commitment:' + source['commitment_id'] if source['commitment_id'] else 'meeting:' + source['meeting_id']}->{target['type']}:{target['id']}"
        if key in seen:
            continue
        seen.add(key)
        out.append(
            {
                "suggestion_key": key,
                "evidence_hash": _hash(source["excerpt"], target["title"], target.get("excerpt") or ""),
                "source_meeting_id": source["meeting_id"],
                "source_commitment_id": source["commitment_id"],
                "source_excerpt": source["excerpt"],
                "goal_id": target["id"] if target["type"] == "goal" else None,
                "project_id": target["id"] if target["type"] == "project" else None,
                "target_excerpt": target.get("excerpt"),
                "person_id": source["person_id"],
                "title": title,
                "reason": reason,
                "suggested_prep": prep or None,
            }
        )
        if len(out) >= _SUGGEST_MAX_RESULTS:
            break
    return out


@router.post("/suggestions/refresh")
@limiter.limit("6/minute")
def refresh_suggestions(request: Request, auth=Depends(get_authenticated_client)):
    """Ask the model only when the evidence changed since the last pass.
    Nothing here writes to a record the manager reviewed — only proposals.

    Returns {ran, ai_failed}. The Overview re-reads /continuity afterwards.
    A model failure is not an error: deterministic items and every manual
    workflow keep working, and the next visit tries again."""
    user_id, supabase = auth
    try:
        evidence = gather_suggestion_evidence(supabase, user_id)
        fingerprint = _evidence_fingerprint(evidence)
        run_rows = (
            supabase.table("outside_suggestion_runs")
            .select("owner_id,fingerprint")
            .eq("owner_id", user_id)
            .limit(1)
            .execute()
            .data
        )
    except Exception:
        logger.warning("beyond: suggestion evidence unavailable", exc_info=True)
        return {"ran": False, "ai_failed": False, "available": False}

    if run_rows and run_rows[0]["fingerprint"] == fingerprint:
        return {"ran": False, "ai_failed": False, "available": True}

    def remember_run() -> None:
        values = {"fingerprint": fingerprint, "ran_at": datetime.now(timezone.utc).isoformat()}
        if run_rows:
            supabase.table("outside_suggestion_runs").update(values).eq("owner_id", user_id).execute()
        else:
            supabase.table("outside_suggestion_runs").insert({"owner_id": user_id, **values}).execute()

    if not evidence["sources"] or not evidence["targets"]:
        remember_run()
        return {"ran": False, "ai_failed": False, "available": True}

    try:
        raw = generate_text(
            build_suggestion_prompt(evidence, date.today().isoformat()),
            model=AI_DEFAULT_MODEL_LIGHT,
            max_tokens=1200,
        )
        proposed = sanitize_suggestions(_parse_json(raw), evidence)
    except Exception:
        logger.warning("beyond: suggestion AI call failed", exc_info=True)
        return {"ran": False, "ai_failed": True, "available": True}

    existing = (
        supabase.table("outside_suggestions")
        .select("suggestion_key,evidence_hash,status")
        .eq("owner_id", user_id)
        .execute()
        .data
    )
    blocked = {(r["suggestion_key"], r["evidence_hash"]) for r in existing}
    showing = {r["suggestion_key"] for r in existing if r["status"] in ("open", "connected")}
    linked = {
        (row["meeting_id"], row.get("goal_id") or row.get("project_id"))
        for row in supabase.table("outside_meeting_links")
        .select("meeting_id,goal_id,project_id")
        .eq("owner_id", user_id)
        .execute()
        .data
    }
    fresh = [
        {**s, "owner_id": user_id, "status": "open"}
        for s in proposed
        if (s["suggestion_key"], s["evidence_hash"]) not in blocked
        and s["suggestion_key"] not in showing
        and (s["source_meeting_id"], s["goal_id"] or s["project_id"]) not in linked
    ]
    if fresh:
        supabase.table("outside_suggestions").insert(fresh).execute()
    remember_run()
    return {"ran": True, "ai_failed": False, "available": True, "added": len(fresh)}


def _fetch_suggestion(supabase, user_id: str, suggestion_id: str) -> dict:
    rows = (
        supabase.table("outside_suggestions")
        .select("id,status,source_meeting_id,goal_id,project_id,reason")
        .eq("id", suggestion_id)
        .eq("owner_id", user_id)
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    return rows[0]


@router.post("/suggestions/{suggestion_id}/dismiss")
def dismiss_suggestion(suggestion_id: str, auth=Depends(get_authenticated_client)):
    """Hide it. Its source records are untouched, and the same connection on
    the same evidence is never proposed again."""
    user_id, supabase = auth
    suggestion = _fetch_suggestion(supabase, user_id, suggestion_id)
    if suggestion["status"] == "connected":
        raise HTTPException(status_code=409, detail="That connection is already confirmed")
    (
        supabase.table("outside_suggestions")
        .update({"status": "dismissed", "resolved_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", suggestion_id)
        .eq("owner_id", user_id)
        .execute()
    )
    return {"ok": True}


class ConnectIn(BaseModel):
    # The manager's reason, shown on the goal/project's history. Defaults to
    # the suggestion's reason if left blank.
    note: str | None = None


@router.post("/suggestions/{suggestion_id}/connect")
def connect_suggestion(suggestion_id: str, body: ConnectIn, auth=Depends(get_authenticated_client)):
    """Confirm the connection: one outside_meeting_links row between the
    reviewed source meeting and the goal or project, with the reason.
    No check-in is created and no status or progress changes."""
    user_id, supabase = auth
    suggestion = _fetch_suggestion(supabase, user_id, suggestion_id)
    if suggestion["status"] == "dismissed":
        raise HTTPException(status_code=409, detail="That suggestion was dismissed")
    meeting = _fetch_meeting(supabase, user_id, suggestion["source_meeting_id"])
    if not meeting.get("summary"):
        raise HTTPException(status_code=409, detail="Its source meeting isn't written up yet")
    target_col, target_table = ("goal_id", "goals") if suggestion.get("goal_id") else ("project_id", "projects")
    target_id = suggestion.get(target_col)
    if not (
        supabase.table(target_table).select("id").eq("id", target_id).eq("owner_id", user_id).limit(1).execute().data
    ):
        raise HTTPException(status_code=404, detail="That goal or project no longer exists")

    note = _clean(body.note) or suggestion["reason"]
    existing = (
        supabase.table("outside_meeting_links")
        .select("id")
        .eq("owner_id", user_id)
        .eq("meeting_id", meeting["id"])
        .eq(target_col, target_id)
        .limit(1)
        .execute()
        .data
    )
    if suggestion["status"] == "connected" and existing:
        return {"ok": True, "link_id": existing[0]["id"], "already": True}
    link_id = (
        existing[0]["id"]
        if existing
        else supabase.table("outside_meeting_links")
        .insert({"meeting_id": meeting["id"], "owner_id": user_id, target_col: target_id, "note": note})
        .execute()
        .data[0]["id"]
    )
    (
        supabase.table("outside_suggestions")
        .update({"status": "connected", "link_id": link_id, "resolved_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", suggestion_id)
        .eq("owner_id", user_id)
        .execute()
    )
    return {"ok": True, "link_id": link_id, "already": bool(existing)}
