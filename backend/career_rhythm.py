"""Career conversations: when one is due, and which 1:1 it should be.

Pure and clock-injected (same discipline as mission_control_week.py): routes
read RLS-scoped rows and pass them in with the manager's local date. No AI.

The rules (Andrew, 2026-10-08; docs/CAREER_CONVERSATIONS_SCOPING.md):

- A career conversation is one of the person's ordinary 1:1s, chosen ahead of
  time and titled differently. It is never a separate meeting.
- Due date: the latest held or skipped career conversation + the org interval;
  with none on record, the day the person was added + FIRST_AFTER_DAYS.
  Interval None means the manager turned it off.
- The prompt opens WINDOW_DAYS before the due date (or at once when past it).
- The suggested 1:1 is the first known occurrence on or after
  max(due - LEAD_DAYS, today + MIN_NOTICE_DAYS): at least a week's notice, so
  the manager can book a longer slot and send the report a heads-up.
- A planned conversation more than MISSED_AFTER_DAYS past its date with no
  log is "missed": the manager says it happened or picks a new date.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

DEFAULT_INTERVAL_DAYS = 90
INTERVAL_OPTIONS = (60, 90, 120, 180)
FIRST_AFTER_DAYS = 30
WINDOW_DAYS = 14
LEAD_DAYS = 7
MIN_NOTICE_DAYS = 7
MISSED_AFTER_DAYS = 7
MAX_CHOICES = 4
SUGGESTED_LENGTH = "45–60 minutes"


def to_day(value: Any) -> date | None:
    if not value:
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).date()
    except (TypeError, ValueError):
        try:
            return date.fromisoformat(str(value)[:10])
        except (TypeError, ValueError):
            return None


def upcoming_dates(open_session: dict | None, today: date, count: int = 12) -> list[date]:
    """The person's known upcoming 1:1 days, earliest first.

    The open occurrence's own date first (if it is today or later), then its
    series steps. A singly moved occurrence steps from its usual day
    (series_slot_at), the same rule logging uses. Nothing is invented for a
    person with no dated occurrence."""
    if not open_session:
        return []
    current = to_day(open_session.get("scheduled_at"))
    if not current:
        return []
    days: list[date] = []
    if current >= today:
        days.append(current)
    series = open_session.get("one_on_one_series") or {}
    if isinstance(series, list):
        series = series[0] if series else {}
    weeks = series.get("interval_weeks") if series.get("active") else None
    if weeks:
        step = timedelta(weeks=int(weeks))
        cursor = to_day(open_session.get("series_slot_at")) or current
        while len(days) < count:
            cursor += step
            if cursor >= today and cursor > current and cursor not in days:
                days.append(cursor)
    return sorted(days)[:count]


def last_settled(rows: list[dict]) -> tuple[date | None, date | None]:
    """(last held day, last held-or-skipped day) from career rows."""
    held: list[date] = []
    settled: list[date] = []
    for row in rows:
        status = row.get("status")
        day = to_day(row.get("held_on") or row.get("planned_for"))
        if not day:
            continue
        if status == "held":
            held.append(day)
            settled.append(day)
        elif status == "skipped":
            settled.append(day)
    return (max(held) if held else None, max(settled) if settled else None)


def due_on(rows: list[dict], person_added: Any, interval_days: int | None) -> date | None:
    if not interval_days:
        return None
    _, anchor = last_settled(rows)
    if anchor:
        return anchor + timedelta(days=int(interval_days))
    added = to_day(person_added)
    return added + timedelta(days=FIRST_AFTER_DAYS) if added else None


def person_state(
    *,
    rows: list[dict],
    person_added: Any,
    open_session: dict | None,
    interval_days: int | None,
    today: date,
) -> dict:
    """Everything a surface needs to show one person's career rhythm."""
    last_held, _ = last_settled(rows)
    planned = next((r for r in rows if r.get("status") == "planned"), None)
    base = {
        "last_held_on": last_held.isoformat() if last_held else None,
        "planned": None,
        "due_on": None,
        "choices": [],
        "suggested": None,
    }
    if planned:
        day = to_day(planned.get("planned_for"))
        missed = bool(day and (today - day).days > MISSED_AFTER_DAYS)
        base["planned"] = {
            "id": planned["id"],
            "planned_for": day.isoformat() if day else None,
            "heads_up_sent_at": planned.get("heads_up_sent_at"),
            "one_on_one_id": planned.get("one_on_one_id"),
            "days_until": (day - today).days if day else None,
        }
        base["state"] = "missed" if missed else "planned"
        # Choices for "Change date" (planned) or "Pick a new date" (missed).
        base["choices"] = [d.isoformat() for d in upcoming_dates(open_session, today)[:MAX_CHOICES]]
        return base

    due = due_on(rows, person_added, interval_days)
    if due is None:
        base["state"] = "off"
        return base
    base["due_on"] = due.isoformat()
    if today < due - timedelta(days=WINDOW_DAYS):
        base["state"] = "not_due"
        return base

    base["state"] = "proposed"
    floor = max(due - timedelta(days=LEAD_DAYS), today + timedelta(days=MIN_NOTICE_DAYS))
    known = upcoming_dates(open_session, today)
    eligible = [d for d in known if d >= floor]
    # Fewer than a week away is still a choice the manager may make; it is
    # just never the suggestion.
    soon = [d for d in known if d < floor]
    choices = (eligible[:MAX_CHOICES]) or soon[-1:]
    base["choices"] = [d.isoformat() for d in choices]
    base["suggested"] = eligible[0].isoformat() if eligible else None
    return base


def calendar_title(report_name: str, manager_name: str | None) -> str:
    first = (report_name or "").split(" ")[0] or "Career"
    manager_first = (manager_name or "").split(" ")[0]
    return f"Career conversation: {first} / {manager_first}" if manager_first else f"Career conversation: {first}"


def heads_up_text(report_name: str, planned_for: date) -> str:
    """The manager's own note to the report, copied and sent by the manager.
    The product never contacts the report."""
    first = (report_name or "").split(" ")[0] or "there"
    when = f"{planned_for.strftime('%A')}, {planned_for.strftime('%B')} {planned_for.day}"
    return (
        f"Hi {first}, our 1:1 on {when} will be a career conversation instead of our usual check-in, "
        "and I've booked a bit longer for it. Before then, have a think about:\n"
        "- Where would you like to be in a year or two?\n"
        "- What work gives you energy right now, and what drains it?\n"
        "- What would help you most from me?\n"
        "No need to prepare anything formal. Bring whatever is on your mind."
    )
