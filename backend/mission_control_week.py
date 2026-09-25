"""Mission Control's "Your week, in focus" view — pure, clock-injected.

The action brief (mission_control_engine.py) decides what deserves the
manager's attention. This module answers a different, factual question: what
does this week actually look like? Which conversations are dated this week and
in what state, how follow-through is going, and where goals stand by their
latest recorded check-in.

Rules this module holds, so the page can't drift from them:

- A conversation is on the calendar only because it has a date this week.
  Being due by cadence is not a calendar event; those people are returned
  separately as `unscheduled_due`.
- Meetings carry a date, not a time (`scheduled_at` is encoded at noon UTC —
  docs/decisions/meeting-date-is-scheduled-at.md). Nothing here invents a
  start time.
- Commitment states are mutually exclusive, and ownership is too. Every count
  the page shows is the length of a list returned here, so a count and its
  drill-down cannot disagree.
- A goal percentage exists only when a real check-in recorded one, and it
  travels with the date of that check-in. No percentage is inferred from a
  status, averaged across goals, or back-filled.
- No AI. Everything is a deterministic read of stored records.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from utils import meeting_day_of

STALE_CHECK_IN_DAYS = 14  # same threshold as CheckInPanel.STALE_CHECK_IN_DAYS
GOAL_ACTIVE_STATUSES = {"active", "on_track", "at_risk"}
PROJECT_OPEN_STATUSES = {"active", "on_track", "at_risk"}
DUE_SOON_DAYS = 14  # the dashboard's existing goal/project "due soon" window


def _day(value: Any) -> date | None:
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


def week_bounds(local_date: date) -> tuple[date, date]:
    """Monday through Sunday containing the manager's local date."""
    start = local_date - timedelta(days=local_date.weekday())
    return start, start + timedelta(days=6)


def _commitment_title(row: dict) -> str:
    return (row.get("title") or row.get("description") or "").strip() or "Untitled commitment"


def _agenda_titles(prep_guide: Any, limit: int = 4) -> list[str]:
    if not isinstance(prep_guide, dict):
        return []
    titles = []
    for item in prep_guide.get("agenda_items") or []:
        if isinstance(item, dict) and str(item.get("title") or "").strip():
            titles.append(str(item["title"]).strip())
    return titles[:limit]


def _excerpt(text: str | None, limit: int = 240) -> str | None:
    if not text:
        return None
    clean = " ".join(str(text).split())
    return clean if len(clean) <= limit else clean[: limit - 1].rstrip() + "…"


def _meeting_state(*, completed: bool, prepared: bool, day: date, today: date) -> str:
    if completed:
        return "completed"
    if day < today:
        # Happened (by date) but nothing was written up. Distinct from "to
        # prepare" so a past meeting never reads as upcoming.
        return "not_logged"
    return "prep_saved" if prepared else "to_prepare"


def _conversations(snapshot: dict, week_start: date, week_end: date, today: date) -> list[dict]:
    reports = {row["id"]: row for row in snapshot.get("reports", [])}
    items: list[dict] = []

    for row in snapshot.get("one_on_ones", []):
        report = reports.get(row.get("direct_report_id"))
        day = meeting_day_of(row) if row.get("scheduled_at") else None
        if not report or not day or not (week_start <= day <= week_end):
            continue
        completed = bool(row.get("summary"))
        prepared = bool(row.get("prep_guide"))
        state = _meeting_state(completed=completed, prepared=prepared, day=day, today=today)
        rid = report["id"]
        if completed:
            href = f"/app/reports/{rid}"
        elif prepared:
            href = f"/app/reports/{rid}/prep?resume={row['id']}"
        else:
            href = f"/app/reports/{rid}/prep"
        items.append({
            "id": f"one_on_one:{row['id']}",
            "kind": "one_on_one",
            "record_id": row["id"],
            "date": day.isoformat(),
            "title": report["name"],
            "subtitle": report.get("role_title"),
            "direct_report_id": rid,
            "participants": [report["name"]],
            "state": state,
            "href": href,
            "person_href": f"/app/reports/{rid}",
            "agenda": _agenda_titles(row.get("prep_guide")) if not completed else [],
            "summary": _excerpt(row.get("summary")) if completed else None,
            "carry_forward_count": len(row.get("carry_forward_items") or []) if not completed else 0,
        })

    agenda_counts = snapshot.get("team_agenda_counts", {})
    agenda_items = snapshot.get("team_agenda_items", {})
    for row in snapshot.get("team_meetings", []):
        day = _day(row.get("scheduled_at"))
        if not day or not (week_start <= day <= week_end):
            continue
        completed = bool(row.get("summary"))
        has_agenda = agenda_counts.get(row["id"], 0) > 0 or bool((row.get("agenda_note") or "").strip())
        state = _meeting_state(completed=completed, prepared=has_agenda, day=day, today=today)
        unit_name = (row.get("org_units") or {}).get("name")
        items.append({
            "id": f"team_meeting:{row['id']}",
            "kind": "team_meeting",
            "record_id": row["id"],
            "date": day.isoformat(),
            "title": f"{unit_name} team meeting" if unit_name else "Team meeting",
            "subtitle": unit_name,
            "direct_report_id": None,
            "participants": [],
            "state": state,
            "href": f"/app/team/meetings/{row['id']}",
            "person_href": None,
            "agenda": (agenda_items.get(row["id"]) or [])[:4] if not completed else [],
            "summary": _excerpt(row.get("summary")) if completed else None,
            "carry_forward_count": 0,
        })

    people = snapshot.get("outside_people", {})
    meeting_people = snapshot.get("outside_meeting_people", {})
    for row in snapshot.get("outside_meetings", []):
        day = _day(row.get("scheduled_at"))
        if not day or not (week_start <= day <= week_end):
            continue
        names = [people[pid]["name"] for pid in meeting_people.get(row["id"], []) if pid in people]
        completed = bool(row.get("summary"))
        prepared = bool(row.get("prep_guide"))
        state = _meeting_state(completed=completed, prepared=prepared, day=day, today=today)
        group = row.get("kind") == "group"
        title = (row.get("title") or "").strip() or (", ".join(names) if names else "Meeting")
        if not group and names and not (row.get("title") or "").strip():
            title = names[0]
        items.append({
            "id": f"outside_meeting:{row['id']}",
            "kind": "outside_group" if group else "outside_one_on_one",
            "record_id": row["id"],
            "date": day.isoformat(),
            "title": title,
            "subtitle": None,
            "direct_report_id": None,
            "participants": names,
            "state": state,
            "href": f"/app/beyond/meetings/{row['id']}",
            "person_href": None,
            "agenda": _agenda_titles(row.get("prep_guide")) if not completed else [],
            "summary": _excerpt(row.get("summary")) if completed else None,
            "carry_forward_count": len(row.get("carry_forward_items") or []) if not completed else 0,
        })

    kind_order = {"one_on_one": 0, "outside_one_on_one": 1, "team_meeting": 2, "outside_group": 3}
    items.sort(key=lambda item: (item["date"], kind_order.get(item["kind"], 9), item["title"].lower(), item["id"]))
    return items


def _commitments(snapshot: dict, week_start: date, week_end: date, today: date) -> dict:
    """The follow-through cohort.

    Ownership (mutually exclusive):
      mine — the manager committed, or no direct report owns it (a null
             report is the manager's own: docs/decisions/nullable-commitment-owner.md)
      team — a direct report committed
    Counterpart commitments (someone outside the team owes the manager) are
    excluded before this function sees them.

    State (mutually exclusive):
      completed — status done, completed_at within this week up to today
      overdue   — still open, due date before today
      due       — still open, due today through the end of this week
    Open commitments with no due date, or due after this week, are not in
    the cohort; undated ones are counted so the page can say so.
    """
    reports = {row["id"]: row for row in snapshot.get("reports", [])}
    records: list[dict] = []
    undated = {"mine": 0, "team": 0}
    open_by_report: dict[str, list[dict]] = {}

    for row in snapshot.get("commitments", []):
        if row.get("committed_by") == "counterpart":
            continue
        rid = row.get("direct_report_id")
        if rid and rid not in reports:
            continue  # archived person — not part of the current team
        owner = "team" if (rid and row.get("committed_by") == "direct_report") else "mine"
        status = row.get("status")
        due = _day(row.get("due_date"))
        completed_day = _day(row.get("completed_at"))

        if status == "open" and rid:
            open_by_report.setdefault(rid, []).append(row)

        state = None
        if status == "done" and completed_day and week_start <= completed_day <= today:
            state = "completed"
        elif status == "open" and due and due < today:
            state = "overdue"
        elif status == "open" and due and today <= due <= week_end:
            state = "due"
        elif status == "open" and not due:
            undated[owner] += 1
        if not state:
            continue

        owner_name = "You" if owner == "mine" else reports[rid]["name"]
        if rid:
            href = f"/app/reports/{rid}"
        elif row.get("source_type") == "team_meeting" and row.get("source_id"):
            href = f"/app/team/meetings/{row['source_id']}"
        else:
            href = "/app/team"
        records.append({
            "id": row["id"],
            "title": _commitment_title(row),
            "owner": owner,
            "owner_name": owner_name,
            "direct_report_id": rid,
            "about_name": reports[rid]["name"] if (rid and owner == "mine") else None,
            "state": state,
            "due_date": due.isoformat() if due else None,
            "completed_at": row.get("completed_at") if state == "completed" else None,
            "source_type": row.get("source_type"),
            "href": href,
        })

    order = {"overdue": 0, "due": 1, "completed": 2}
    records.sort(key=lambda r: (order[r["state"]], r["due_date"] or "9999", r["title"].lower()))

    # Open commitments per person, for a conversation's detail panel.
    person_open: dict[str, list[dict]] = {}
    for rid, rows in open_by_report.items():
        rows.sort(key=lambda r: (r.get("due_date") or "9999", r.get("created_at") or ""))
        person_open[rid] = [
            {
                "id": r["id"],
                "title": _commitment_title(r),
                "due_date": r.get("due_date"),
                "owner_name": reports[rid]["name"] if r.get("committed_by") == "direct_report" else "You",
            }
            for r in rows[:3]
        ]
        if len(rows) > 3:
            person_open[rid].append({"id": f"{rid}:more", "title": None, "due_date": None, "owner_name": None, "more": len(rows) - 3})

    return {"records": records, "undated_open": undated, "open_by_report": person_open}


def _goals(snapshot: dict, today: date) -> list[dict]:
    reports = {row["id"]: row for row in snapshot.get("reports", [])}
    history_by_goal: dict[str, list[dict]] = {}
    for ci in snapshot.get("goal_check_ins", []):
        history_by_goal.setdefault(ci["goal_id"], []).append(ci)
    for rows in history_by_goal.values():
        rows.sort(key=lambda r: r.get("created_at") or "", reverse=True)

    projects_by_goal: dict[str, list[dict]] = {}
    for p in snapshot.get("projects", []):
        if p.get("goal_id"):
            projects_by_goal.setdefault(p["goal_id"], []).append(p)
    commitments_by_goal: dict[str, list[dict]] = {}
    for c in snapshot.get("commitments", []):
        if c.get("source_type") == "goal" and c.get("source_id") and c.get("status") == "open" and c.get("committed_by") != "counterpart":
            commitments_by_goal.setdefault(c["source_id"], []).append(c)

    result = []
    for g in snapshot.get("goals", []):
        if g.get("status") not in GOAL_ACTIVE_STATUSES:
            continue
        if g.get("level") == "individual" and g.get("direct_report_id") and g["direct_report_id"] not in reports:
            continue  # archived person
        history = history_by_goal.get(g["id"], [])
        latest = history[0] if history else None
        with_progress = [ci for ci in history if ci.get("progress") is not None]
        progress_ci = with_progress[0] if with_progress else None
        last_day = _day(latest.get("created_at")) if latest else None
        progress_day = _day(progress_ci.get("created_at")) if progress_ci else None
        days_since = (today - last_day).days if last_day else None
        stale = days_since is None or days_since > STALE_CHECK_IN_DAYS
        trend = None
        if len(with_progress) >= 2:
            delta = with_progress[0]["progress"] - with_progress[1]["progress"]
            trend = "up" if delta > 0 else "down" if delta < 0 else "flat"

        reasons: list[dict] = []
        if g.get("status") == "at_risk":
            reasons.append({"label": "At risk", "severe": True})
        due = _day(g.get("due_date"))
        if due:
            d = (due - today).days
            if d < 0:
                reasons.append({"label": f"Overdue {-d}d", "severe": True})
            elif d == 0:
                reasons.append({"label": "Due today", "severe": True})
            elif d <= DUE_SOON_DAYS:
                reasons.append({"label": f"Due in {d}d", "severe": False})
        if stale:
            reasons.append({"label": "Never checked in" if not latest else f"No check-in in {days_since}d", "severe": False})

        org_unit = g.get("org_units") or {}
        dr = reports.get(g.get("direct_report_id") or "")
        result.append({
            "id": g["id"],
            "title": g["title"],
            "level": g["level"],
            "status": g["status"],
            "due_date": g.get("due_date"),
            "success_metrics": g.get("success_metrics"),
            "direct_report_id": g.get("direct_report_id"),
            "direct_report_name": dr["name"] if dr else None,
            "org_unit_name": org_unit.get("name"),
            "progress": progress_ci["progress"] if progress_ci else None,
            "progress_at": progress_day.isoformat() if progress_day else None,
            "trend": trend,
            "last_check_in_at": last_day.isoformat() if last_day else None,
            "last_check_in_status": latest.get("status") if latest else None,
            "last_check_in_note": latest.get("note") if latest else None,
            "days_since_check_in": days_since,
            "stale": stale,
            "attention_reasons": reasons,
            "projects": [
                {"id": p["id"], "title": p["title"], "status": p["status"]}
                for p in sorted(projects_by_goal.get(g["id"], []), key=lambda p: (p.get("status") not in PROJECT_OPEN_STATUSES, p["title"].lower()))
            ][:5],
            "commitments": [
                {"id": c["id"], "title": _commitment_title(c), "due_date": c.get("due_date"),
                 "owner_name": reports[c["direct_report_id"]]["name"] if (c.get("committed_by") == "direct_report" and c.get("direct_report_id") in reports) else "You"}
                for c in commitments_by_goal.get(g["id"], [])
            ][:5],
        })

    # The dashboard's existing exception-first order: at risk, then anything
    # overdue/due today, then other attention reasons, then healthy — no new
    # cross-goal priority score.
    def severity(item: dict) -> tuple:
        if item["status"] == "at_risk":
            rank = 0
        elif any(r["severe"] for r in item["attention_reasons"]):
            rank = 1
        elif item["attention_reasons"]:
            rank = 2
        else:
            rank = 3
        return (rank, -len(item["attention_reasons"]), item["due_date"] or "9999", item["title"].lower())

    result.sort(key=severity)
    return result


def build_week(snapshot: dict, local_date: date) -> dict:
    week_start, week_end = week_bounds(local_date)
    today = local_date
    conversations = _conversations(snapshot, week_start, week_end, today)
    follow = _commitments(snapshot, week_start, week_end, today)

    scheduled_ids = {c["direct_report_id"] for c in conversations if c["kind"] == "one_on_one"}
    unscheduled_due = []
    for row in snapshot.get("cadence", []):
        if not row.get("is_due"):
            continue
        planned = row.get("planned_session") or {}
        planned_day = _day(planned.get("meeting_date") or planned.get("scheduled_at"))
        if row["direct_report_id"] in scheduled_ids or (planned_day and planned_day >= today):
            continue  # it has a date; the calendar or /app/1-1s shows it
        unscheduled_due.append({
            "direct_report_id": row["direct_report_id"],
            "name": row["name"],
            "days_since_last": row.get("days_since_last"),
            "cadence_days": row.get("cadence_days"),
            "cadence_source": row.get("cadence_source"),
            "href": f"/app/reports/{row['direct_report_id']}/prep",
        })

    return {
        "week": {
            "start": week_start.isoformat(),
            "end": week_end.isoformat(),
            "today": today.isoformat(),
        },
        "conversations": conversations,
        "unscheduled_due": unscheduled_due,
        "commitments": follow["records"],
        "undated_open_commitments": follow["undated_open"],
        "open_commitments_by_report": follow["open_by_report"],
        "goals": _goals(snapshot, today),
        "reports": [{"id": r["id"], "name": r["name"]} for r in snapshot.get("reports", [])],
        "coverage": snapshot.get("coverage", {}),
    }
