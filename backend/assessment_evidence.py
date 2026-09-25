"""
Evidence for a period assessment — what the manager's own records say about
one direct report over one explicit period. Not a route; routes/
assessment_reviews.py calls gather_evidence() and stores the result on the
performance_reviews row so the picture, the draft and the completed
assessment all cite the same, inspectable set.

Every query runs on the caller's authenticated client (RLS applies) and is
additionally scoped to the manager and the report. Nothing here writes.

Source rules (docs/systems/assessments.md → Evidence):
- In-period records count as this period's evidence. A few earlier records
  are kept as labelled BACKGROUND and never presented as in-period results.
- Goals, projects and the development plan are CONTEXT: the goal is the
  standard, its check-ins in the period are the evidence.
- A project assigned to the report is labelled as assigned: assignment is
  not proof of who produced its results.
- Private material (1:1 private notes, capture notes, secondhand notes from
  meetings beyond the team) is read only when the manager explicitly turned
  it on for this assessment, and every item is labelled private.
- Each source reports its own coverage state: included, none found, off
  (private), not inspected (no reliable person link), or failed. "No records
  found" and "retrieval failed" are never the same answer.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone

from utils import meeting_date_of

logger = logging.getLogger(__name__)

DETAIL_LIMIT = 700
BACKGROUND_ONE_ON_ONES = 3
MAX_PER_SOURCE = 60

# Sources the app has but cannot reliably tie to one person. Reported in the
# coverage matrix so "everything" is never implied.
NOT_INSPECTED = [
    ("team_meetings", "Team meetings", "Agenda items and notes are not linked to one person."),
    ("documents", "Context documents", "Documents are scoped to teams or the company, not to a person."),
    ("team_messages", "Team messages", "Updates you sent are not evidence of their work."),
    ("external", "Outside tools (CRM, tickets, calendar)", "Not connected to The Same Page."),
]


def _day(value) -> date | None:
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


def _clip(text: str | None, limit: int = DETAIL_LIMIT) -> str:
    text = (text or "").strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _in(d: date | None, start: date, end: date) -> bool:
    return d is not None and start <= d <= end


def _iso(d: date | None) -> str | None:
    return d.isoformat() if d else None


class _Collector:
    def __init__(self) -> None:
        self.items: list[dict] = []
        self.coverage: list[dict] = []

    def add(self, **item) -> None:
        item.setdefault("private", False)
        item["detail"] = _clip(item.get("detail"))
        self.items.append(item)

    def cover(self, source: str, label: str, status: str, in_period: int = 0, background: int = 0, note: str = "") -> None:
        self.coverage.append({
            "source": source,
            "label": label,
            "status": status,
            "in_period": in_period,
            "background": background,
            "note": note,
        })


def gather_evidence(
    supabase,
    user_id: str,
    report: dict,
    start: date,
    end: date,
    metric_configs: dict[str, str],
    include_private: bool = False,
) -> dict:
    """Collect the evidence set for one report and period.

    metric_configs maps the report's configured metric config_id -> name, so
    only readings for this role's metrics are gathered. Returns
    {generated_at, period_start, period_end, include_private, items, coverage}
    with a stable short `ref` (S1, S2, ...) on every item for prompts."""
    report_id = report["id"]
    name = report.get("name") or "They"
    c = _Collector()
    today = datetime.now(timezone.utc).date()
    end_plus = (end + timedelta(days=1)).isoformat()

    # --- 1:1 write-ups ------------------------------------------------------
    one_rows: list[dict] = []
    try:
        one_rows = (
            supabase.table("one_on_ones")
            .select("id,scheduled_at,created_at,summary,notes")
            .eq("manager_id", user_id)
            .eq("direct_report_id", report_id)
            .not_.is_("summary", "null")
            .order("scheduled_at", desc=True)
            .limit(300)
            .execute()
            .data
        )
        dated = [(r, _day(meeting_date_of(r))) for r in one_rows if (r.get("summary") or "").strip()]
        in_period = [(r, d) for r, d in dated if _in(d, start, end)][:MAX_PER_SOURCE]
        before = sorted([(r, d) for r, d in dated if d and d < start], key=lambda x: x[1], reverse=True)[:BACKGROUND_ONE_ON_ONES]
        for r, d in in_period:
            c.add(id=f"one_on_one:{r['id']}", kind="one_on_one", date=_iso(d), timing="in_period",
                  title="1:1 conversation", detail=r["summary"], attribution="Your reviewed 1:1 write-up",
                  href=f"/app/reports/{report_id}")
        for r, d in before:
            c.add(id=f"one_on_one:{r['id']}", kind="one_on_one", date=_iso(d), timing="background",
                  title="Earlier 1:1 conversation", detail=r["summary"], attribution="Before this period — background only",
                  href=f"/app/reports/{report_id}")
        c.cover("one_on_ones", "1:1 write-ups", "included" if in_period or before else "none_found",
                len(in_period), len(before),
                "" if in_period else "No completed 1:1 write-ups dated in this period.")
    except Exception:
        logger.warning("assessment evidence: 1:1s failed", exc_info=True)
        c.cover("one_on_ones", "1:1 write-ups", "failed", note="Could not be read just now.")

    # --- commitments --------------------------------------------------------
    try:
        rows = (
            supabase.table("commitments")
            .select("id,title,description,committed_by,status,due_date,completed_at,created_at")
            .eq("owner_id", user_id)
            .eq("direct_report_id", report_id)
            .order("created_at", desc=True)
            .limit(400)
            .execute()
            .data
        )
        added = 0
        for r in rows:
            text = r.get("description") or r.get("title") or ""
            if not text.strip():
                continue
            created = _day(r.get("created_at"))
            done = _day(r.get("completed_at"))
            due = _day(r.get("due_date"))
            owner = name if r.get("committed_by") == "direct_report" else "You" if r.get("committed_by") == "manager" else "Someone outside the team"
            status = r.get("status")
            title = None
            item_date = None
            if status == "done" and _in(done, start, end):
                title, item_date = "Commitment completed", done
            elif status == "done" and done is None and _in(created, start, end):
                title, item_date = "Commitment marked done (completion date not recorded)", created
            elif status == "open" and created and created <= end and due and due <= end:
                overdue = due < min(end, today)
                title, item_date = ("Commitment overdue" if overdue else "Commitment due in period"), due
            elif status == "open" and _in(created, start, end):
                title, item_date = "Commitment still open", created
            elif status == "dropped" and _in(created, start, end):
                title, item_date = "Commitment dropped", created
            if not title:
                continue
            c.add(id=f"commitment:{r['id']}", kind="commitment", date=_iso(item_date), timing="in_period",
                  title=title, detail=text, attribution=f"Owed by {owner}",
                  owed_by=r.get("committed_by"), href=f"/app/reports/{report_id}")
            added += 1
            if added >= MAX_PER_SOURCE:
                break
        c.cover("commitments", "Commitments", "included" if added else "none_found", added,
                note="" if added else "No commitments made, due or completed in this period.")
    except Exception:
        logger.warning("assessment evidence: commitments failed", exc_info=True)
        c.cover("commitments", "Commitments", "failed", note="Could not be read just now.")

    # --- goals + their check-ins --------------------------------------------
    try:
        goals = (
            supabase.table("goals")
            .select("id,title,status,success_metrics,due_date,created_at,measure_label,measure_unit,measure_target,measure_direction")
            .eq("owner_id", user_id)
            .eq("direct_report_id", report_id)
            .execute()
            .data
        )
        goals = [g for g in goals if (_day(g.get("created_at")) or start) <= end]
        checks = []
        if goals:
            checks = (
                supabase.table("check_ins")
                .select("id,goal_id,status,progress,note,measured_value,created_at")
                .in_("goal_id", [g["id"] for g in goals])
                .gte("created_at", start.isoformat())
                .lt("created_at", end_plus)
                .order("created_at", desc=True)
                .limit(200)
                .execute()
                .data
            )
        by_goal = {g["id"]: g for g in goals}
        checked = {ch["goal_id"] for ch in checks}
        kept_goals = 0
        for g in goals:
            if g.get("status") in ("completed", "cancelled") and g["id"] not in checked:
                continue
            bits = [f"Status: {g.get('status')}"]
            if g.get("success_metrics"):
                bits.append(f"Success looks like: {g['success_metrics']}")
            if g.get("measure_label") and g.get("measure_target") is not None:
                bits.append(f"Measure: {g['measure_label']} target {g['measure_target']}{(' ' + g['measure_unit']) if g.get('measure_unit') else ''}")
            if g.get("due_date"):
                bits.append(f"Due {g['due_date']}")
            c.add(id=f"goal:{g['id']}", kind="goal", date=_iso(_day(g.get("created_at"))), timing="context",
                  title=f"Goal: {g['title']}", detail=". ".join(bits), attribution="Their individual goal — the standard, not a result",
                  href=f"/app/goals?goal={g['id']}")
            kept_goals += 1
        for ch in checks[:MAX_PER_SOURCE]:
            g = by_goal.get(ch["goal_id"]) or {}
            bits = [f"Status {ch.get('status')}"]
            if ch.get("progress") is not None:
                bits.append(f"{ch['progress']}% complete (as asserted)")
            if ch.get("measured_value") is not None:
                bits.append(f"Reading: {ch['measured_value']}{(' ' + g['measure_unit']) if g.get('measure_unit') else ''}"
                            + (f" ({g['measure_label']})" if g.get("measure_label") else ""))
            if ch.get("note"):
                bits.append(ch["note"])
            c.add(id=f"goal_check_in:{ch['id']}", kind="goal_check_in", date=_iso(_day(ch.get("created_at"))), timing="in_period",
                  title=f"Goal update: {g.get('title', 'goal')}", detail=". ".join(bits), attribution="Recorded goal check-in",
                  href=f"/app/goals?goal={ch['goal_id']}")
        c.cover("goals", "Individual goals and check-ins",
                "included" if kept_goals or checks else "none_found",
                min(len(checks), MAX_PER_SOURCE), 0,
                "" if checks else ("Goals are on record but none were updated in this period." if kept_goals else "No individual goals on record."))
    except Exception:
        logger.warning("assessment evidence: goals failed", exc_info=True)
        c.cover("goals", "Individual goals and check-ins", "failed", note="Could not be read just now.")

    # --- projects assigned to them + their check-ins ------------------------
    try:
        projects = (
            supabase.table("projects")
            .select("id,title,status,due_date,created_at,description")
            .eq("owner_id", user_id)
            .eq("direct_report_id", report_id)
            .execute()
            .data
        )
        projects = [p for p in projects if (_day(p.get("created_at")) or start) <= end]
        pchecks = []
        if projects:
            pchecks = (
                supabase.table("check_ins")
                .select("id,project_id,status,progress,note,created_at")
                .in_("project_id", [p["id"] for p in projects])
                .gte("created_at", start.isoformat())
                .lt("created_at", end_plus)
                .order("created_at", desc=True)
                .limit(200)
                .execute()
                .data
            )
        by_project = {p["id"]: p for p in projects}
        touched = {ch["project_id"] for ch in pchecks}
        kept = 0
        for p in projects:
            if p.get("status") in ("completed", "cancelled") and p["id"] not in touched:
                continue
            c.add(id=f"project:{p['id']}", kind="project", date=_iso(_day(p.get("created_at"))), timing="context",
                  title=f"Project: {p['title']}", detail=f"Status: {p.get('status')}. {p.get('description') or ''}",
                  attribution=f"Assigned to {name} — who did which part is not recorded", href="/app/projects")
            kept += 1
        for ch in pchecks[:MAX_PER_SOURCE]:
            p = by_project.get(ch["project_id"]) or {}
            bits = [f"Status {ch.get('status')}"]
            if ch.get("progress") is not None:
                bits.append(f"{ch['progress']}% complete (as asserted)")
            if ch.get("note"):
                bits.append(ch["note"])
            c.add(id=f"project_check_in:{ch['id']}", kind="project_check_in", date=_iso(_day(ch.get("created_at"))), timing="in_period",
                  title=f"Project update: {p.get('title', 'project')}", detail=". ".join(bits),
                  attribution=f"Project assigned to {name}; not individually attributed", href="/app/projects")
        c.cover("projects", "Projects assigned to them", "included" if kept or pchecks else "none_found",
                min(len(pchecks), MAX_PER_SOURCE), 0,
                "Assignment is shown, not individual credit." if kept else "No projects assigned to them.")
    except Exception:
        logger.warning("assessment evidence: projects failed", exc_info=True)
        c.cover("projects", "Projects assigned to them", "failed", note="Could not be read just now.")

    # --- metric readings ----------------------------------------------------
    if metric_configs:
        try:
            rows = (
                supabase.table("metric_entries")
                .select("id,metric_config_id,value,period,recorded_at,notes")
                .eq("direct_report_id", report_id)
                .in_("metric_config_id", list(metric_configs))
                .gte("recorded_at", start.isoformat())
                .lt("recorded_at", end_plus)
                .order("recorded_at", desc=True)
                .limit(MAX_PER_SOURCE)
                .execute()
                .data
            )
            for r in rows:
                label = metric_configs.get(r["metric_config_id"], "Metric")
                c.add(id=f"metric_entry:{r['id']}", kind="metric_entry", date=_iso(_day(r.get("recorded_at"))), timing="in_period",
                      title=f"Metric reading: {label}",
                      detail=f"{r.get('value')}" + (f" for {r['period']}" if r.get("period") else "") + (f". {r['notes']}" if r.get("notes") else ""),
                      attribution="Recorded reading", config_id=r["metric_config_id"], value=r.get("value"),
                      reading_period=r.get("period"))
            c.cover("metric_entries", "Metric readings", "included" if rows else "none_found", len(rows),
                    note="" if rows else "No metric readings recorded in this period. Metrics stay empty unless you enter a real value.")
        except Exception:
            logger.warning("assessment evidence: metrics failed", exc_info=True)
            c.cover("metric_entries", "Metric readings", "failed", note="Could not be read just now.")
    else:
        c.cover("metric_entries", "Metric readings", "none_found", note="No metrics configured for this role.")

    # --- development plan (background) ---------------------------------------
    try:
        plans = (
            supabase.table("development_plans")
            .select("id,status,updated_at")
            .eq("manager_id", user_id)
            .eq("direct_report_id", report_id)
            .eq("status", "active")
            .limit(1)
            .execute()
            .data
        )
        dev = 0
        if plans:
            pid = plans[0]["id"]
            asp = supabase.table("dev_plan_aspirations").select("desired_role,timeline,notes").eq("development_plan_id", pid).execute().data
            for a in asp:
                if a.get("desired_role") or a.get("notes"):
                    c.add(id=f"dev_aspiration:{pid}", kind="development", date=None, timing="background",
                          title="Development aspiration",
                          detail=" · ".join(x for x in [a.get("desired_role"), a.get("timeline"), a.get("notes")] if x),
                          attribution="Development context — not performance evidence", href=f"/app/reports/{report_id}")
                    dev += 1
            opps = supabase.table("dev_plan_opportunities").select("id,type,description,created_at").eq("development_plan_id", pid).limit(10).execute().data
            for o in opps:
                c.add(id=f"dev_opportunity:{o['id']}", kind="development", date=_iso(_day(o.get("created_at"))), timing="background",
                      title="Growth area in their plan", detail=o["description"],
                      attribution="Development context — not performance evidence", href=f"/app/reports/{report_id}")
                dev += 1
            training = supabase.table("dev_plan_training").select("id,description,completion_date").eq("development_plan_id", pid).limit(10).execute().data
            for t in training:
                d = _day(t.get("completion_date"))
                c.add(id=f"dev_training:{t['id']}", kind="development", date=_iso(d),
                      timing="in_period" if _in(d, start, end) else "background",
                      title="Training" + (" completed in period" if _in(d, start, end) else " in their plan"),
                      detail=t["description"], attribution="Development plan", href=f"/app/reports/{report_id}")
                dev += 1
        c.cover("development", "Development plan", "included" if dev else "none_found", 0, dev,
                "Background only." if dev else "No active development plan.")
    except Exception:
        logger.warning("assessment evidence: development failed", exc_info=True)
        c.cover("development", "Development plan", "failed", note="Could not be read just now.")

    # --- private material: explicit opt-in only ------------------------------
    if include_private:
        priv = 0
        try:
            for r in one_rows:
                d = _day(meeting_date_of(r))
                if (r.get("notes") or "").strip() and _in(d, start, end):
                    c.add(id=f"private_note:{r['id']}", kind="private_note", date=_iso(d), timing="in_period",
                          title="Your private 1:1 note", detail=r["notes"], private=True,
                          attribution="Private — included because you turned it on for this assessment")
                    priv += 1
            caps = (
                supabase.table("dr_capture_notes")
                .select("id,content,created_at")
                .eq("manager_id", user_id)
                .eq("direct_report_id", report_id)
                .gte("created_at", start.isoformat())
                .lt("created_at", end_plus)
                .limit(MAX_PER_SOURCE)
                .execute()
                .data
            )
            for r in caps:
                c.add(id=f"capture_note:{r['id']}", kind="capture_note", date=_iso(_day(r.get("created_at"))), timing="in_period",
                      title="Your captured note", detail=r["content"], private=True,
                      attribution="Private — included because you turned it on for this assessment")
                priv += 1
            c.cover("private", "Private notes and captures", "included" if priv else "none_found", priv,
                    note="Included by your choice for this assessment only.")
        except Exception:
            logger.warning("assessment evidence: private notes failed", exc_info=True)
            c.cover("private", "Private notes and captures", "failed", note="Could not be read just now.")
        try:
            from routes.beyond import fetch_secondhand_notes

            window = max(1, (today - start).days + 1)
            notes = fetch_secondhand_notes(supabase, user_id, report_id, limit=MAX_PER_SOURCE, window_days=window)
            sh = 0
            for i, n in enumerate(notes):
                d = _day(n.get("meeting_date"))
                if not _in(d, start, end):
                    continue
                who = ", ".join(n.get("people") or []) or "someone outside the team"
                c.add(id=f"secondhand:{report_id}:{i}:{_iso(d)}", kind="secondhand_note", date=_iso(d), timing="in_period",
                      title=f"Secondhand: {n.get('meeting_title') or 'meeting beyond the team'}", detail=n["note"], private=True,
                      attribution=f"Private and secondhand — {who}'s account, not a verified fact")
                sh += 1
            c.cover("secondhand", "Secondhand notes from meetings beyond the team", "included" if sh else "none_found", sh,
                    note="Someone else's account; included by your choice.")
        except Exception:
            logger.warning("assessment evidence: secondhand failed", exc_info=True)
            c.cover("secondhand", "Secondhand notes from meetings beyond the team", "failed", note="Could not be read just now.")
    else:
        c.cover("private", "Private notes and captures", "private_off",
                note="Your private 1:1 notes and captured notes are not read unless you turn them on for this assessment.")
        c.cover("secondhand", "Secondhand notes from meetings beyond the team", "private_off",
                note="Not read unless you turn private material on.")

    for key, label, note in NOT_INSPECTED:
        c.cover(key, label, "not_inspected", note=note)

    # Stable ordering and refs: in-period newest first, then context, then background.
    grouped: dict[str, list[dict]] = {}
    for item in c.items:
        grouped.setdefault(item["timing"], []).append(item)
    ordered: list[dict] = []
    for timing in ("in_period", "context", "background"):
        ordered.extend(sorted(grouped.get(timing, []), key=lambda i: i.get("date") or "", reverse=True))
    for n, item in enumerate(ordered, start=1):
        item["ref"] = f"S{n}"

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        "include_private": include_private,
        "items": ordered,
        "coverage": c.coverage,
    }
