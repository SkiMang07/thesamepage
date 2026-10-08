"""Career conversations — /api/career.

One of a person's ordinary 1:1s, chosen ahead of time as the quarterly career
conversation (Andrew, 2026-10-08; docs/CAREER_CONVERSATIONS_SCOPING.md). The
timing rules live in career_rhythm.py; this module reads rows, writes the
manager's choices, and keeps a planned conversation attached to its 1:1 when
that 1:1 moves or is logged.

All reads and writes go through the caller's RLS-scoped client, with an
explicit manager predicate on every query.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import career_rhythm as rhythm
from utils import get_authenticated_client, get_org, meeting_day_of

logger = logging.getLogger("routes.career")
router = APIRouter()


class PlanIn(BaseModel):
    planned_for: str


class PlanUpdate(BaseModel):
    planned_for: str | None = None
    heads_up_sent: bool | None = None


def _local_today(raw: str | None) -> date:
    utc_today = datetime.now(timezone.utc).date()
    if not raw:
        return utc_today
    try:
        parsed = date.fromisoformat(raw)
    except ValueError:
        raise HTTPException(status_code=422, detail="local_date must be YYYY-MM-DD")
    if abs((parsed - utc_today).days) > 1:
        raise HTTPException(status_code=422, detail="local_date is outside the accepted range")
    return parsed


def _parse_day(raw: str | None, field: str = "planned_for") -> date:
    day = rhythm.to_day(raw)
    if not day:
        raise HTTPException(status_code=422, detail=f"{field} must be a date (YYYY-MM-DD)")
    return day


def interval_for(org: dict | None) -> int | None:
    """The org's interval. Missing org or column (migration not yet run) means
    the default; an explicit null means the manager turned it off."""
    if not org or "career_conversation_interval_days" not in org:
        return rhythm.DEFAULT_INTERVAL_DAYS
    return org.get("career_conversation_interval_days")


def _manager_name(supabase, user_id: str) -> str | None:
    rows = supabase.table("users").select("full_name").eq("id", user_id).limit(1).execute().data
    return (rows[0].get("full_name") if rows else None) or None


def _open_sessions(supabase, user_id: str, report_ids: list[str]) -> dict[str, dict]:
    """Each person's current unfinished occurrence (newest), with its series."""
    if not report_ids:
        return {}
    rows = (
        supabase.table("one_on_ones")
        .select("id,direct_report_id,scheduled_at,series_slot_at,created_at,one_on_one_series(interval_weeks,active)")
        .eq("manager_id", user_id)
        .in_("direct_report_id", report_ids)
        .is_("summary", "null")
        .order("created_at", desc=True)
        .execute()
        .data
        or []
    )
    found: dict[str, dict] = {}
    for row in rows:
        found.setdefault(row["direct_report_id"], row)
    return found


def _career_rows(supabase, user_id: str, report_ids: list[str]) -> dict[str, list[dict]]:
    if not report_ids:
        return {}
    try:
        rows = (
            supabase.table("career_conversations")
            .select("*")
            .eq("manager_id", user_id)
            .in_("direct_report_id", report_ids)
            .execute()
            .data
            or []
        )
    except Exception as exc:  # table not there until the migration runs
        logger.warning("career_conversations unreadable: %s", type(exc).__name__)
        return {}
    grouped: dict[str, list[dict]] = {}
    for row in rows:
        grouped.setdefault(row["direct_report_id"], []).append(row)
    return grouped


def _people(supabase, user_id: str, report_id: str | None = None) -> list[dict]:
    query = (
        supabase.table("direct_reports")
        .select("id,name,created_at,archived_at")
        .eq("manager_id", user_id)
        .is_("archived_at", "null")
    )
    if report_id:
        query = query.eq("id", report_id)
    return query.order("name").execute().data or []


def _person_payload(person: dict, state: dict, manager_name: str | None) -> dict:
    payload = {"direct_report_id": person["id"], "name": person["name"], **state}
    payload["calendar_title"] = rhythm.calendar_title(person["name"], manager_name)
    planned_day = rhythm.to_day((state.get("planned") or {}).get("planned_for"))
    payload["heads_up"] = rhythm.heads_up_text(person["name"], planned_day) if planned_day else None
    return payload


def build_overview(supabase, user_id: str, today: date, report_id: str | None = None) -> dict:
    interval = interval_for(get_org(user_id, supabase))
    people = _people(supabase, user_id, report_id)
    ids = [p["id"] for p in people]
    sessions = _open_sessions(supabase, user_id, ids)
    careers = _career_rows(supabase, user_id, ids)
    manager_name = _manager_name(supabase, user_id)
    out = []
    for person in people:
        state = rhythm.person_state(
            rows=careers.get(person["id"], []),
            person_added=person.get("created_at"),
            open_session=sessions.get(person["id"]),
            interval_days=interval,
            today=today,
        )
        out.append(_person_payload(person, state, manager_name))
    return {
        "interval_days": interval,
        "interval_options": list(rhythm.INTERVAL_OPTIONS),
        "suggested_length": rhythm.SUGGESTED_LENGTH,
        "people": out,
    }


@router.get("/overview")
def career_overview(local_date: str | None = None, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    return build_overview(supabase, user_id, _local_today(local_date))


@router.get("/person/{direct_report_id}")
def career_person(direct_report_id: str, local_date: str | None = None, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    overview = build_overview(supabase, user_id, _local_today(local_date), direct_report_id)
    if not overview["people"]:
        raise HTTPException(status_code=404, detail="Person not found")
    return {**overview["people"][0], "interval_days": overview["interval_days"],
            "suggested_length": overview["suggested_length"]}


def _require_person(supabase, user_id: str, direct_report_id: str) -> dict:
    people = _people(supabase, user_id, direct_report_id)
    if not people:
        raise HTTPException(status_code=404, detail="Person not found")
    return people[0]


def _planned_row(supabase, user_id: str, direct_report_id: str) -> dict | None:
    rows = (
        supabase.table("career_conversations")
        .select("*")
        .eq("manager_id", user_id)
        .eq("direct_report_id", direct_report_id)
        .eq("status", "planned")
        .limit(1)
        .execute()
        .data
    )
    return rows[0] if rows else None


def _row(supabase, user_id: str, plan_id: str) -> dict:
    rows = (
        supabase.table("career_conversations")
        .select("*")
        .eq("id", plan_id)
        .eq("manager_id", user_id)
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Career conversation not found")
    return rows[0]


def _session_on(supabase, user_id: str, direct_report_id: str, day: date) -> str | None:
    """The unfinished occurrence dated `day`, if there is one."""
    session = _open_sessions(supabase, user_id, [direct_report_id]).get(direct_report_id)
    if session and rhythm.to_day(session.get("scheduled_at")) == day:
        return session["id"]
    return None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@router.post("/person/{direct_report_id}/plan")
def plan_career_conversation(
    direct_report_id: str, body: PlanIn, local_date: str | None = None, auth=Depends(get_authenticated_client)
):
    """Make the 1:1 on `planned_for` this person's career conversation. One
    planned conversation per person: planning again moves it."""
    user_id, supabase = auth
    _require_person(supabase, user_id, direct_report_id)
    today = _local_today(local_date)
    day = _parse_day(body.planned_for)
    if day < today:
        raise HTTPException(status_code=422, detail="Pick today or a later 1:1")
    values = {
        "planned_for": day.isoformat(),
        "one_on_one_id": _session_on(supabase, user_id, direct_report_id, day),
        "updated_at": _now(),
    }
    existing = _planned_row(supabase, user_id, direct_report_id)
    if existing:
        if rhythm.to_day(existing.get("planned_for")) != day:
            values["heads_up_sent_at"] = None  # the note named the old date
        supabase.table("career_conversations").update(values).eq("id", existing["id"]).eq("manager_id", user_id).execute()
    else:
        supabase.table("career_conversations").insert(
            {"manager_id": user_id, "direct_report_id": direct_report_id, "status": "planned", **values}
        ).execute()
    return career_person(direct_report_id, local_date, auth)


@router.patch("/plans/{plan_id}")
def update_plan(plan_id: str, body: PlanUpdate, local_date: str | None = None, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    row = _row(supabase, user_id, plan_id)
    if row.get("status") != "planned":
        raise HTTPException(status_code=409, detail="This career conversation is no longer planned")
    values: dict = {"updated_at": _now()}
    if body.planned_for is not None:
        day = _parse_day(body.planned_for)
        if day < _local_today(local_date):
            raise HTTPException(status_code=422, detail="Pick today or a later 1:1")
        if rhythm.to_day(row.get("planned_for")) != day:
            values["heads_up_sent_at"] = None
        values["planned_for"] = day.isoformat()
        values["one_on_one_id"] = _session_on(supabase, user_id, row["direct_report_id"], day)
    if body.heads_up_sent is not None:
        values["heads_up_sent_at"] = _now() if body.heads_up_sent else None
    supabase.table("career_conversations").update(values).eq("id", plan_id).eq("manager_id", user_id).execute()
    return career_person(row["direct_report_id"], local_date, auth)


@router.post("/plans/{plan_id}/held")
def mark_held(plan_id: str, local_date: str | None = None, auth=Depends(get_authenticated_client)):
    """'It happened' — for a planned conversation whose 1:1 was never logged."""
    user_id, supabase = auth
    row = _row(supabase, user_id, plan_id)
    if row.get("status") != "planned":
        raise HTTPException(status_code=409, detail="This career conversation is no longer planned")
    today = _local_today(local_date)
    planned = rhythm.to_day(row.get("planned_for"))
    held_on = min(planned, today) if planned else today
    supabase.table("career_conversations").update(
        {"status": "held", "held_on": held_on.isoformat(), "updated_at": _now()}
    ).eq("id", plan_id).eq("manager_id", user_id).execute()
    return career_person(row["direct_report_id"], local_date, auth)


@router.delete("/plans/{plan_id}")
def unplan(plan_id: str, local_date: str | None = None, auth=Depends(get_authenticated_client)):
    """Undo a plan: the person goes back to the suggestion."""
    user_id, supabase = auth
    row = _row(supabase, user_id, plan_id)
    if row.get("status") != "planned":
        raise HTTPException(status_code=409, detail="This career conversation is no longer planned")
    supabase.table("career_conversations").delete().eq("id", plan_id).eq("manager_id", user_id).execute()
    return career_person(row["direct_report_id"], local_date, auth)


@router.post("/person/{direct_report_id}/skip")
def skip(direct_report_id: str, local_date: str | None = None, auth=Depends(get_authenticated_client)):
    """'Not this time': the clock restarts from today. A planned conversation
    becomes the skipped one rather than leaving two rows."""
    user_id, supabase = auth
    _require_person(supabase, user_id, direct_report_id)
    today = _local_today(local_date).isoformat()
    existing = _planned_row(supabase, user_id, direct_report_id)
    if existing:
        supabase.table("career_conversations").update(
            {"status": "skipped", "planned_for": today, "one_on_one_id": None, "updated_at": _now()}
        ).eq("id", existing["id"]).eq("manager_id", user_id).execute()
    else:
        supabase.table("career_conversations").insert(
            {"manager_id": user_id, "direct_report_id": direct_report_id, "status": "skipped", "planned_for": today}
        ).execute()
    return career_person(direct_report_id, local_date, auth)


# ---------------------------------------------------------------------------
# Keeping a planned conversation attached to its 1:1 (called from
# one_on_ones.py; never allowed to fail the 1:1 write that called it).
# ---------------------------------------------------------------------------

def _matching_plan(supabase, user_id: str, direct_report_id: str, session_id: str, day: date | None) -> dict | None:
    row = _planned_row(supabase, user_id, direct_report_id)
    if not row:
        return None
    if row.get("one_on_one_id") == session_id:
        return row
    if not row.get("one_on_one_id") and day and rhythm.to_day(row.get("planned_for")) == day:
        return row
    return None


def on_session_logged(supabase, user_id: str, direct_report_id: str, meeting: dict) -> None:
    try:
        day = meeting_day_of(meeting)
        row = _matching_plan(supabase, user_id, direct_report_id, meeting["id"], day)
        if not row:
            return
        supabase.table("career_conversations").update({
            "status": "held",
            "held_on": (day or rhythm.to_day(row.get("planned_for"))).isoformat(),
            "one_on_one_id": meeting["id"],
            "updated_at": _now(),
        }).eq("id", row["id"]).eq("manager_id", user_id).execute()
    except Exception as exc:
        logger.warning("career conversation not marked held: %s", type(exc).__name__)


def on_session_moved(supabase, user_id: str, before: dict, after: dict) -> None:
    try:
        old_day = rhythm.to_day(before.get("scheduled_at"))
        new_day = rhythm.to_day(after.get("scheduled_at"))
        row = _matching_plan(supabase, user_id, before["direct_report_id"], before["id"], old_day)
        if not row:
            return
        values = {"one_on_one_id": before["id"], "updated_at": _now()}
        if new_day and new_day != old_day:
            values["planned_for"] = new_day.isoformat()
        supabase.table("career_conversations").update(values).eq("id", row["id"]).eq("manager_id", user_id).execute()
    except Exception as exc:
        logger.warning("career conversation not moved with its 1:1: %s", type(exc).__name__)
