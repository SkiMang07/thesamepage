"""Deterministic Mission Control candidate generation and ranking.

This module is deliberately pure: no FastAPI, Supabase, environment, or AI
calls. Routes normalize RLS-scoped rows, pass an explicit manager-local date,
and serialize the returned dict. That keeps recommendation order reproducible
and makes every eligibility boundary unit-testable.
"""

from __future__ import annotations

import hashlib
import json
from datetime import date, datetime, timedelta, timezone
from typing import Any

from utils import meeting_date_of, meeting_sort_key

STALE_DAYS = 14
COMMITMENT_WINDOW_DAYS = 7
CORE_DOMAINS = ("conversations", "commitments", "goals", "projects")
TERMINAL_DISPOSITIONS = {"addressed", "not_relevant"}


def _date(value: Any) -> date | None:
    if not value:
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def _datetime(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except (TypeError, ValueError):
            return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _days_since(value: Any, today: date) -> int | None:
    observed = _date(value)
    return (today - observed).days if observed else None


def _freshness(value: Any, today: date) -> str:
    days = _days_since(value, today)
    if days is None:
        return "Not recorded"
    if days == 0:
        return "Today"
    if days == 1:
        return "Yesterday"
    if days > 1:
        return f"{days} days ago"
    if days == -1:
        return "Tomorrow"
    return f"In {-days} days"


def _due_label(due: date, today: date) -> str:
    delta = (due - today).days
    if delta < 0:
        return f"Overdue {-delta} day{'s' if delta != -1 else ''}"
    if delta == 0:
        return "Due today"
    return f"Due in {delta} day{'s' if delta != 1 else ''}"


def _urgency_points(delta: int | None, *, never_recorded: bool = False) -> tuple[int, str | None]:
    if never_recorded:
        return 24, "First 1:1 not recorded"
    if delta is None:
        return 0, None
    if delta <= -8:
        return 40, "Overdue 8+ days"
    if delta < 0:
        return 35, "Overdue 1–7 days"
    if delta == 0:
        return 30, "Due today"
    if delta <= 3:
        return 24, "Due in 1–3 days"
    if delta <= 7:
        return 16, "Due in 4–7 days"
    if delta <= 14:
        return 8, "Due in 8–14 days"
    return 0, None


def _fingerprint(facts: dict[str, Any]) -> str:
    payload = json.dumps(facts, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:24]


def _evidence(code: str, label: str, source: str, observed_at: Any, today: date) -> dict[str, Any]:
    return {
        "code": code,
        "label": label,
        "source": source,
        "observed_at": str(observed_at) if observed_at else None,
        "freshness": _freshness(observed_at, today),
    }


def _candidate(
    *,
    candidate_type: str,
    entity_type: str,
    entity_id: str,
    subject_key: str,
    title: str,
    explanation: str,
    action_label: str,
    action_href: str,
    components: list[dict[str, Any]],
    evidence: list[dict[str, Any]],
    facts: dict[str, Any],
    attention_since: Any,
    exact_workflow: bool,
    target_ids: list[str] | None = None,
    boundaries: list[str] | None = None,
) -> dict[str, Any]:
    components = [component for component in components if component["points"] > 0]
    score = sum(component["points"] for component in components)
    key = f"{candidate_type}:{entity_id}"
    return {
        "candidate_key": key,
        "evidence_fingerprint": _fingerprint(facts),
        "candidate_type": candidate_type,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "subject_key": subject_key,
        "title": title,
        "explanation": explanation,
        "action": {"label": action_label, "href": action_href},
        "score": score,
        "rank_basis": components,
        "evidence": evidence[:4],
        "target_ids": target_ids or [],
        "boundaries": boundaries or [],
        "attention_since": str(attention_since) if attention_since else "9999-12-31",
        "strongest_time_points": max(
            (component["points"] for component in components if component["code"] == "urgency"),
            default=0,
        ),
        "exact_workflow": exact_workflow,
    }


def _corroboration_components(reason_count: int) -> list[dict[str, Any]]:
    extra = max(0, min(3, reason_count - 1))
    return (
        [{"code": "corroboration", "label": f"{extra} supporting signal{'s' if extra != 1 else ''}", "points": extra * 5}]
        if extra
        else []
    )


def _latest_by_report(sessions: list[dict[str, Any]]) -> tuple[dict[str, dict], dict[str, dict]]:
    planned: dict[str, dict] = {}
    completed: dict[str, dict] = {}
    # Latest by when the conversation happened, not by when the row was
    # written. See utils.meeting_date_of().
    ordered = sorted(sessions, key=meeting_sort_key, reverse=True)
    for row in ordered:
        report_id = row.get("direct_report_id")
        if not report_id:
            continue
        if row.get("summary"):
            completed.setdefault(report_id, row)
        elif row.get("prep_guide"):
            planned.setdefault(report_id, row)
    return planned, completed


def _latest_check_ins(check_ins: list[dict[str, Any]], parent_key: str) -> dict[str, dict]:
    latest: dict[str, dict] = {}
    for row in sorted(check_ins, key=lambda item: str(item.get("created_at") or ""), reverse=True):
        parent_id = row.get(parent_key)
        if parent_id:
            latest.setdefault(parent_id, row)
    return latest


def _disposition_suppresses(candidate: dict[str, Any], events: list[dict[str, Any]], now: datetime) -> bool:
    matching = [
        event
        for event in events
        if event.get("candidate_key") == candidate["candidate_key"]
        and event.get("evidence_fingerprint") == candidate["evidence_fingerprint"]
        and event.get("event_type") in TERMINAL_DISPOSITIONS | {"snoozed", "setup_dismissed_today"}
    ]
    if not matching:
        return False
    latest = max(matching, key=lambda event: str(event.get("created_at") or ""))
    if latest.get("event_type") in TERMINAL_DISPOSITIONS:
        return True
    until = _datetime(latest.get("snoozed_until"))
    return bool(until and until > now)


def _work_candidate(
    row: dict[str, Any],
    latest: dict[str, Any] | None,
    kind: str,
    today: date,
) -> dict[str, Any] | None:
    status = row.get("status")
    if status not in {"active", "on_track", "at_risk"}:
        return None
    created = _date(row.get("created_at"))
    due = _date(row.get("due_date"))
    last_check = _date((latest or {}).get("created_at"))
    current_age = (today - (last_check or created)).days if (last_check or created) else 0
    conflict = bool(latest and latest.get("status") and latest.get("status") != status)
    stale = current_age > STALE_DAYS
    due_delta = (due - today).days if due else None
    within_window = due_delta is not None and due_delta <= 14
    if not (conflict or status == "at_risk" or stale or within_window):
        return None

    label = kind.capitalize()
    components: list[dict[str, Any]] = []
    evidence: list[dict[str, Any]] = []
    facts = {
        "id": row["id"],
        "status": status,
        "due_date": row.get("due_date"),
        "latest_check_in_id": (latest or {}).get("id"),
        "latest_check_in_status": (latest or {}).get("status"),
        "latest_check_in_at": (latest or {}).get("created_at"),
    }
    if conflict:
        components.append({"code": "integrity", "label": "Current status and latest check-in disagree", "points": 25})
        evidence.append(
            _evidence(
                "status_conflict",
                f"{label} says {str(status).replace('_', ' ')}; latest check-in says {str(latest.get('status')).replace('_', ' ')}",
                f"{label} record + {label.lower()} check-in",
                latest.get("created_at"),
                today,
            )
        )
        candidate_type = f"{kind}_status_integrity"
        title = f"Reconcile the status for {row['title']}."
        explanation = "The current record and its latest check-in do not agree. Review them before relying on either status."
    else:
        candidate_type = f"{kind}_review"
        title = f"Review {row['title']}."
        explanation_parts: list[str] = []
        if status == "at_risk":
            components.append({"code": "explicit_risk", "label": "Explicitly marked at risk", "points": 20})
            evidence.append(_evidence("at_risk", "Marked at risk", f"{label} record", row.get("created_at"), today))
            explanation_parts.append("It is marked at risk")
        if within_window and due:
            points, urgency_label = _urgency_points(due_delta)
            if points:
                components.append({"code": "urgency", "label": urgency_label, "points": points})
            evidence.append(_evidence("due", _due_label(due, today), f"{label} record", due, today))
            explanation_parts.append(_due_label(due, today).lower())
        if stale:
            stale_points = 12 if current_age >= 30 else 8
            components.append({"code": "staleness", "label": f"No check-in in {current_age} days", "points": stale_points})
            if last_check:
                evidence.append(_evidence("stale_check_in", f"Last check-in was {current_age} days ago", f"{label} check-in", last_check, today))
            else:
                evidence.append(_evidence("no_check_in", f"No check-in recorded; created {current_age} days ago", f"{label} record", created, today))
            explanation_parts.append(f"its last recorded update is {current_age} days old")
        explanation = ("; ".join(explanation_parts).capitalize() + ".") if explanation_parts else "Its records need review."

    reason_count = len(evidence)
    components.extend(_corroboration_components(reason_count))
    components.append({"code": "actionability", "label": f"Open the {label}s workspace", "points": 2})
    return _candidate(
        candidate_type=candidate_type,
        entity_type=kind,
        entity_id=row["id"],
        subject_key=f"{kind}:{row['id']}",
        title=title,
        explanation=explanation,
        action_label=f"Review {label.lower()}",
        action_href=f"/app/{'goals' if kind == 'goal' else 'projects'}",
        components=components,
        evidence=evidence,
        facts=facts,
        attention_since=last_check or due or created,
        exact_workflow=False,
        target_ids=[row["id"]],
    )


def _build_candidates(snapshot: dict[str, Any], today: date) -> list[dict[str, Any]]:
    reports = snapshot.get("reports", [])
    sessions = snapshot.get("sessions", [])
    commitments = snapshot.get("commitments", [])
    check_ins = snapshot.get("check_ins", [])
    coverage = snapshot.get("coverage", {})
    capacity = (
        snapshot.get("capacity", {})
        if coverage.get("capacity", "ok") == "ok" and coverage.get("commitments", "ok") == "ok"
        else {}
    )
    report_by_id = {row["id"]: row for row in reports}
    planned, completed = _latest_by_report(sessions)
    due_commitments: dict[str, list[dict]] = {}
    for row in commitments:
        due = _date(row.get("due_date"))
        report_id = row.get("direct_report_id")
        if (
            row.get("status") == "open"
            and due
            and report_id in report_by_id
            and (due - today).days <= COMMITMENT_WINDOW_DAYS
        ):
            due_commitments.setdefault(report_id, []).append(row)

    candidates: list[dict[str, Any]] = []
    for report in reports:
        report_id = report["id"]
        name = report["name"]
        last = completed.get(report_id)
        saved = planned.get(report_id)
        cadence = int(report.get("cadence_days") or 21)
        days_since = _days_since(meeting_date_of(last), today)
        overdue_days = (days_since - cadence) if days_since is not None else None
        is_due = days_since is None or overdue_days > 0

        if saved:
            components = [{"code": "momentum", "label": "Prep already saved", "points": 15}]
            evidence = [_evidence("saved_prep", "Preparation is already saved", "Saved prep", saved.get("created_at"), today)]
            if is_due:
                points, urgency_label = _urgency_points(-overdue_days if overdue_days is not None else None, never_recorded=days_since is None)
                components.append({"code": "urgency", "label": urgency_label, "points": points})
                cadence_source = str(report.get("cadence_source") or "default").replace("_", " ")
                due_label = "No completed 1:1 is recorded" if days_since is None else f"1:1 cadence is overdue by {overdue_days} day{'s' if overdue_days != 1 else ''}"
                evidence.append(_evidence("cadence_due", due_label, f"{cadence_source} cadence", meeting_date_of(last), today))
            compatible = due_commitments.get(report_id, [])
            if compatible:
                soonest = min(_date(row["due_date"]) for row in compatible)
                evidence.append(_evidence("due_commitments", f"{len(compatible)} commitment{'s are' if len(compatible) != 1 else ' is'} due by {soonest.isoformat()}", "Commitment record", soonest, today))
            components.extend(_corroboration_components(len(evidence)))
            components.append({"code": "actionability", "label": "Resume the exact prep", "points": 5})
            candidates.append(
                _candidate(
                    candidate_type="resume_one_on_one_prep",
                    entity_type="direct_report",
                    entity_id=report_id,
                    subject_key=f"person:{report_id}",
                    title=f"Review {name}’s saved 1:1 prep.",
                    explanation=f"Preparation is already saved for {name}." + (" Their 1:1 cadence is due now." if is_due else ""),
                    action_label=f"Resume {name.split()[0]}’s prep",
                    action_href=f"/app/reports/{report_id}/prep?resume={saved['id']}",
                    components=components,
                    evidence=evidence,
                    facts={
                        "planned_session_id": saved["id"],
                        "is_due": is_due,
                        "commitments": sorted(
                            ({"id": row["id"], "due_date": row.get("due_date")} for row in compatible),
                            key=lambda item: item["id"],
                        ),
                    },
                    attention_since=saved.get("created_at"),
                    exact_workflow=True,
                    target_ids=[saved["id"]],
                    boundaries=(
                        ["No scheduled meeting date is recorded; this suggestion is based on saved prep and cadence."]
                        if not saved.get("scheduled_at")
                        else []
                    ) + (
                        ["Cadence uses the current organization setting."]
                        if report.get("cadence_source") == "org"
                        else ["Cadence uses the labeled 21-day product default."]
                        if report.get("cadence_source") == "default"
                        else []
                    ),
                )
            )
        elif is_due:
            points, urgency_label = _urgency_points(-overdue_days if overdue_days is not None else None, never_recorded=days_since is None)
            components = [
                {"code": "urgency", "label": urgency_label, "points": points},
                {"code": "actionability", "label": "Start the exact prep workflow", "points": 5},
            ]
            cadence_source = str(report.get("cadence_source") or "default").replace("_", " ")
            due_label = "No completed 1:1 is recorded" if days_since is None else f"1:1 cadence is overdue by {overdue_days} day{'s' if overdue_days != 1 else ''}"
            evidence = [_evidence("cadence_due", due_label, f"{cadence_source} cadence", meeting_date_of(last), today)]
            candidates.append(
                _candidate(
                    candidate_type="start_due_one_on_one_prep",
                    entity_type="direct_report",
                    entity_id=report_id,
                    subject_key=f"person:{report_id}",
                    title=f"Prepare for your next 1:1 with {name}.",
                    explanation=(
                        "No completed 1:1 is recorded yet. Start with one useful conversation."
                        if days_since is None
                        else f"{name}’s {cadence}-day 1:1 cadence is due now, and no prep is saved."
                    ),
                    action_label=f"Start {name.split()[0]}’s prep",
                    action_href=f"/app/reports/{report_id}/prep",
                    components=components,
                    evidence=evidence,
                    facts={"last_completed_id": (last or {}).get("id"), "cadence_days": cadence, "cadence_source": report.get("cadence_source")},
                    attention_since=meeting_date_of(last) or report.get("created_at"),
                    exact_workflow=True,
                    boundaries=(
                        ["Cadence uses the current organization setting."]
                        if report.get("cadence_source") == "org"
                        else ["Cadence uses the labeled 21-day product default."]
                        if report.get("cadence_source") == "default"
                        else []
                    ),
                )
            )

        due_rows = due_commitments.get(report_id, [])
        if due_rows:
            due_rows.sort(key=lambda row: row["due_date"])
            soonest = _date(due_rows[0]["due_date"])
            delta = (soonest - today).days
            points, urgency_label = _urgency_points(delta)
            all_manager = all(row.get("committed_by") == "manager" for row in due_rows)
            evidence = [
                _evidence(
                    "due_commitments",
                    f"{len(due_rows)} open commitment{'s are' if len(due_rows) != 1 else ' is'} due by {soonest.isoformat()}",
                    "Commitment record",
                    soonest,
                    today,
                )
            ]
            actual_off = float((capacity.get(report_id) or {}).get("actual_time_off_hours") or 0)
            if actual_off > 0:
                evidence.append(_evidence("logged_time_off", f"{actual_off:g} hours of logged time off overlap this week", "Logged time off", today, today))
            components = [{"code": "urgency", "label": urgency_label, "points": points}]
            components.extend(_corroboration_components(len(evidence) + max(0, len(due_rows) - 1)))
            components.append({"code": "actionability", "label": "Open the person workspace", "points": 2})
            title = (
                f"Follow through on your commitment to {name}."
                if all_manager and len(due_rows) == 1
                else f"Review commitments with {name}."
            )
            candidates.append(
                _candidate(
                    candidate_type="commitment_follow_up",
                    entity_type="direct_report",
                    entity_id=report_id,
                    subject_key=f"person:{report_id}",
                    title=title,
                    explanation=f"{len(due_rows)} dated commitment{'s need' if len(due_rows) != 1 else ' needs'} attention by {soonest.strftime('%b %-d')}",
                    action_label=f"Open {name.split()[0]}’s record",
                    action_href=f"/app/reports/{report_id}",
                    components=components,
                    evidence=evidence,
                    facts={"commitment_ids": sorted(row["id"] for row in due_rows), "due_dates": [row["due_date"] for row in due_rows], "actual_time_off_hours": actual_off},
                    attention_since=soonest,
                    exact_workflow=False,
                    target_ids=sorted(row["id"] for row in due_rows),
                    boundaries=(
                        ["Logged time off reflects available hours, not assigned workload."]
                        if actual_off > 0
                        else []
                    ),
                )
            )

    goal_checks = _latest_check_ins(check_ins, "goal_id")
    project_checks = _latest_check_ins(check_ins, "project_id")
    for row in snapshot.get("goals", []):
        item = _work_candidate(row, goal_checks.get(row["id"]), "goal", today)
        if item:
            candidates.append(item)
    for row in snapshot.get("projects", []):
        item = _work_candidate(row, project_checks.get(row["id"]), "project", today)
        if item:
            candidates.append(item)
    return candidates


def _deduplicate(candidates: list[dict[str, Any]], snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    by_subject: dict[str, dict[str, Any]] = {}
    for candidate in candidates:
        current = by_subject.get(candidate["subject_key"])
        if current is None or _sort_key(candidate) < _sort_key(current):
            by_subject[candidate["subject_key"]] = candidate
    deduped = list(by_subject.values())

    # A stale/due goal and its linked project are one review chain, not two
    # independent manager actions. Integrity conflicts remain separate because
    # they ask the manager to reconcile a specific record mismatch.
    by_entity = {(row["candidate_type"], row["entity_id"]): row for row in deduped}
    remove: set[str] = set()
    for project in snapshot.get("projects", []):
        goal_id = project.get("goal_id")
        if not goal_id:
            continue
        goal_candidate = by_entity.get(("goal_review", goal_id))
        project_candidate = by_entity.get(("project_review", project["id"]))
        if not goal_candidate or not project_candidate:
            continue
        keep, drop = sorted([goal_candidate, project_candidate], key=_sort_key)
        linked_kind = "project" if drop["entity_type"] == "project" else "goal"
        keep["evidence"] = [
            *keep["evidence"][:3],
            {
                "code": "linked_work_review",
                "label": f"A linked {linked_kind} also meets the review rules",
                "source": "Goal/project relationship",
                "observed_at": None,
                "freshness": "Current relationship",
            },
        ]
        keep["evidence_fingerprint"] = _fingerprint(
            {"kept": keep["evidence_fingerprint"], "linked": drop["evidence_fingerprint"]}
        )
        keep["target_ids"] = sorted(set([*keep["target_ids"], *drop["target_ids"]]))
        remove.add(drop["candidate_key"])
    return [row for row in deduped if row["candidate_key"] not in remove]


def _sort_key(candidate: dict[str, Any]) -> tuple[Any, ...]:
    return (
        -candidate["score"],
        -candidate["strongest_time_points"],
        -len(candidate["evidence"]),
        -int(candidate["exact_workflow"]),
        candidate["attention_since"],
        candidate["candidate_key"],
    )


def _truth_signal(snapshot: dict[str, Any], today: date, candidates: list[dict[str, Any]], mode: str) -> dict[str, str]:
    week_start = today - timedelta(days=today.weekday())
    # Conversations HELD this week. A meeting from last month, written up
    # today, is not this week's progress.
    sessions = [row for row in snapshot.get("sessions", []) if row.get("summary") and (_date(meeting_date_of(row)) or date.min) >= week_start]
    if sessions:
        count = len(sessions)
        return {"kind": "progress", "title": f"{count} 1:1{'s' if count != 1 else ''} completed this week.", "detail": "Based on conversations recorded in TSP."}
    resolved = [
        row for row in snapshot.get("commitments", [])
        if row.get("status") in {"done", "dropped"} and (_date(row.get("completed_at")) or date.min) >= week_start
    ]
    if resolved:
        count = len(resolved)
        return {"kind": "progress", "title": f"{count} commitment{'s' if count != 1 else ''} resolved this week.", "detail": "Based on commitment records in TSP."}
    checks = [row for row in snapshot.get("check_ins", []) if (_date(row.get("created_at")) or date.min) >= week_start]
    if checks:
        count = len(checks)
        return {"kind": "progress", "title": f"{count} work check-in{'s' if count != 1 else ''} recorded this week.", "detail": "Across goals and projects."}
    planned, completed = _latest_by_report(snapshot.get("sessions", []))
    if planned:
        count = len(planned)
        return {"kind": "progress", "title": f"{count} prep sheet{'s are' if count != 1 else ' is'} saved.", "detail": "Ready to review from the 1:1 workspace."}
    if mode == "all_clear":
        return {"kind": "all_clear", "title": "Nothing currently meets the attention rules.", "detail": "Conversations, commitments, goals, and projects were checked."}
    if mode in {"early_use", "empty"}:
        return {"kind": "limited", "title": "TSP has limited evidence so far.", "detail": "Recommendations become richer as conversations, commitments, and work check-ins are recorded."}
    if mode == "partial":
        return {"kind": "limited", "title": "A complete focus could not be established.", "detail": "Only the sources available right now were considered."}
    reports = snapshot.get("reports", [])
    due_people: set[str] = set()
    for candidate in candidates:
        if candidate["candidate_type"] in {"start_due_one_on_one_prep", "resume_one_on_one_prep"}:
            due_people.add(candidate["entity_id"])
    current = max(0, len(reports) - len(due_people))
    return {"kind": "factual", "title": f"{current} of {len(reports)} 1:1 rhythms are current.", "detail": "Using each person’s recorded cadence or the labeled default."}


def _supporting(snapshot: dict[str, Any], today: date) -> dict[str, list[dict[str, Any]]]:
    planned, completed = _latest_by_report(snapshot.get("sessions", []))
    conversations = []
    for report in snapshot.get("reports", []):
        report_id = report["id"]
        last = completed.get(report_id)
        days = _days_since(meeting_date_of(last), today)
        cadence = int(report.get("cadence_days") or 21)
        if report_id in planned:
            state = "Prep saved"
            href = f"/app/reports/{report_id}/prep?resume={planned[report_id]['id']}"
        elif days is None or days > cadence:
            state = "Due now"
            href = f"/app/reports/{report_id}/prep"
        else:
            state = "On cadence"
            href = f"/app/reports/{report_id}"
        conversations.append({"id": report_id, "title": report["name"], "meta": state, "href": href})
    state_order = {"Prep saved": 0, "Due now": 1, "On cadence": 2}
    conversations.sort(key=lambda item: (state_order[item["meta"]], item["title"]))

    changes: list[dict[str, Any]] = []
    report_names = {row["id"]: row["name"] for row in snapshot.get("reports", [])}
    for row in snapshot.get("sessions", []):
        if row.get("summary"):
            changes.append({"id": f"one_on_one:{row['id']}", "title": "1:1 completed", "meta": report_names.get(row.get("direct_report_id"), "Direct report"), "at": meeting_date_of(row)})
    for row in snapshot.get("commitments", []):
        if row.get("status") in {"done", "dropped"} and row.get("completed_at"):
            changes.append({"id": f"commitment:{row['id']}", "title": "Commitment resolved", "meta": report_names.get(row.get("direct_report_id"), "Direct report"), "at": row.get("completed_at")})
    goals = {row["id"]: row["title"] for row in snapshot.get("goals", [])}
    projects = {row["id"]: row["title"] for row in snapshot.get("projects", [])}
    for row in snapshot.get("check_ins", []):
        parent = goals.get(row.get("goal_id")) or projects.get(row.get("project_id"))
        if parent:
            changes.append({"id": f"check_in:{row['id']}", "title": "Work check-in recorded", "meta": parent, "at": row.get("created_at")})
    changes.sort(key=lambda item: str(item.get("at") or ""), reverse=True)
    for item in changes:
        item["freshness"] = _freshness(item.pop("at", None), today)
    return {"conversations": conversations[:4], "changes": changes[:4]}


def build_brief(
    snapshot: dict[str, Any],
    local_date: date,
    events: list[dict[str, Any]] | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Return the deterministic brief for one normalized manager snapshot."""
    events = events or []
    now = now or datetime.now(timezone.utc)
    reports = snapshot.get("reports", [])
    coverage = snapshot.get("coverage", {})
    partial = any(coverage.get(domain, "ok") != "ok" for domain in CORE_DOMAINS)

    raw = _build_candidates(snapshot, local_date)
    deduped = _deduplicate(raw, snapshot)
    available = [candidate for candidate in deduped if not _disposition_suppresses(candidate, events, now)]
    ranked = sorted(available, key=_sort_key)
    for index, candidate in enumerate(ranked[:3], start=1):
        candidate["rank"] = index

    completed_count = sum(1 for row in snapshot.get("sessions", []) if row.get("summary"))
    check_in_count = len(snapshot.get("check_ins", []))
    resolved_count = sum(1 for row in snapshot.get("commitments", []) if row.get("status") in {"done", "dropped"})
    early = bool(reports) and completed_count == 0 and check_in_count == 0 and resolved_count == 0
    if not reports and coverage.get("conversations", "ok") == "ok":
        mode = "empty"
    elif partial:
        mode = "partial"
    elif early:
        mode = "early_use"
    elif not ranked:
        mode = "all_clear"
    elif len(ranked) > 3:
        mode = "busy"
    else:
        mode = "normal"

    selected = ranked[:3]
    primary = selected[0] if selected else None
    secondary = selected[1:]
    optional_context = None
    if mode == "early_use" and primary and primary.get("entity_type") == "direct_report":
        report = next((row for row in reports if row["id"] == primary["entity_id"]), None)
        if coverage.get("expectations", "ok") == "ok" and report and not report.get("role_has_expectations"):
            context_candidate = {
                "candidate_key": f"early_role_grounding:{report['id']}",
                "evidence_fingerprint": _fingerprint({"report_id": report["id"], "role_level_id": report.get("role_level_id"), "role_has_expectations": False}),
                "title": f"Add {report['name']}’s role to ground future prep in agreed expectations.",
                "detail": "Optional — prep still works without it.",
                "href": "/app/settings",
            }
            if not _disposition_suppresses(context_candidate, events, now):
                optional_context = context_candidate

    return {
        "mode": mode,
        "primary": primary,
        "secondary": secondary,
        "truth_signal": _truth_signal(snapshot, local_date, selected, mode),
        "supporting": _supporting(snapshot, local_date),
        "coverage": coverage,
        "optional_context": optional_context,
        "eligible_count": len(ranked),
    }
