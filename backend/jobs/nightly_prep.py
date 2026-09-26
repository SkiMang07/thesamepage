"""Overnight prep: every 1:1 dated today or tomorrow that has no prep sheet
gets one before the manager opens it.

Two halves, both idempotent, both driven by `ai_jobs`:

- `submit_due()` runs once a night (the worker decides when). It finds the
  unfinished occurrences dated today or tomorrow with no prep_guide, builds
  each prompt with the same assembly POST /prep uses, from the same sources
  the manager's source review includes by default (carry-forwards, the kept
  opening line, captures, open commitments, at-risk goals, the development
  plan), and sends them as one Batch API request at half price.
- `collect()` runs every tick. For each ended batch it saves each sheet onto
  its occurrence, but only if the occurrence still has no sheet and has not
  been logged: a manager who prepared by hand in the meantime always wins.
  Only the captures the prompt actually read are consumed, and only once the
  sheet is saved, exactly as a manual Prepare consumes them.

This is not an AI write into the record. A prep sheet is a working draft the
manager reads before the conversation; it never becomes a summary, a
commitment or a rating. It says it was prepared overnight and what it drew
on, and "Edit prep" rebuilds it from the live sources. See
docs/decisions/next-one-on-one-workspace.md (amended 2026-09-26).

The worker runs with the service-role client. Every query here, and in
assemble_prep_inputs(), carries an explicit manager/owner/org predicate:
without RLS those predicates are the only isolation.
"""
from __future__ import annotations

import logging
import os
from datetime import date, datetime, timedelta, timezone

import ai_core
import context_engine
from config import AI_DEFAULT_MODEL_HEAVY
from routes.one_on_ones import (
    PREP_MAX_TOKENS,
    assemble_prep_inputs,
    build_prep_guide,
    parse_prep_output,
)
from utils import get_org

logger = logging.getLogger("jobs.nightly_prep")

KIND = "overnight_prep"
# Meetings dated today and tomorrow (UTC calendar days; scheduled_at is a
# date encoded at noon UTC). Anything later is prepared on a later night, so
# the sheet reads the freshest record it can.
LOOKAHEAD_DAYS = 2
# An occurrence with a job created this recently is not submitted again,
# unless that job failed.
RESUBMIT_AFTER = timedelta(hours=20)
# A batch that has not ended this long after submission is written off.
# Anthropic's own limit is 24 hours.
BATCH_GIVE_UP_AFTER = timedelta(hours=26)
# Attempts per occurrence per night before it is left for the manager.
MAX_ATTEMPTS = 2
# A job still 'queued' this long after creation was orphaned by a crash
# between queueing and submitting; it is failed so the occurrence frees up.
QUEUED_GIVE_UP_AFTER = timedelta(minutes=30)
MAX_PER_RUN = int(os.environ.get("NIGHTLY_PREP_MAX_PER_RUN", "300"))


# ---------------------------------------------------------------------------
# Selection
# ---------------------------------------------------------------------------

def _entitled(sub: dict | None, now: datetime) -> bool:
    """Mirrors ensure_entitlement()'s read_only rule: active, or trialing
    with time left. No row (never opened the app) or read-only: no AI spend."""
    if not sub:
        return False
    if sub.get("status") == "active":
        return True
    if sub.get("status") == "trialing" and sub.get("trial_ends_at"):
        ends = datetime.fromisoformat(str(sub["trial_ends_at"]).replace("Z", "+00:00"))
        return ends > now
    return False


def due_occurrences(admin, now: datetime) -> list[dict]:
    """Unfinished, unprepared occurrences dated today or tomorrow, for an
    entitled manager and an active direct report of theirs, with no recent
    job. Oldest meeting first, bounded."""
    today = now.date()
    start = f"{today.isoformat()}T00:00:00+00:00"
    end = f"{(today + timedelta(days=LOOKAHEAD_DAYS)).isoformat()}T00:00:00+00:00"
    rows = (
        admin.table("one_on_ones")
        .select("id,manager_id,direct_report_id,scheduled_at,carry_forward_items,opening_line")
        .is_("summary", "null")
        .is_("prep_guide", "null")
        .gte("scheduled_at", start)
        .lt("scheduled_at", end)
        .order("scheduled_at")
        .limit(MAX_PER_RUN)
        .execute()
        .data
    )
    if not rows:
        return []

    ids = [row["id"] for row in rows]
    cutoff = (now - RESUBMIT_AFTER).isoformat()
    # Skip an occurrence with a live or finished job since the cutoff; a
    # failed one gets one more try, not one per tick.
    failures: dict[str, int] = {}
    recent: set[str] = set()
    for job in (
        admin.table("ai_jobs")
        .select("one_on_one_id,status")
        .eq("kind", KIND)
        .in_("one_on_one_id", ids)
        .gte("created_at", cutoff)
        .execute()
        .data
    ):
        if job.get("status") == "failed":
            failures[job["one_on_one_id"]] = failures.get(job["one_on_one_id"], 0) + 1
            if failures[job["one_on_one_id"]] >= MAX_ATTEMPTS:
                recent.add(job["one_on_one_id"])
        else:
            recent.add(job["one_on_one_id"])

    manager_ids = sorted({row["manager_id"] for row in rows})
    subs = {
        sub["user_id"]: sub
        for sub in (
            admin.table("subscriptions")
            .select("user_id,status,trial_ends_at")
            .in_("user_id", manager_ids)
            .execute()
            .data
        )
    }
    reports = {
        report["id"]: report
        for report in (
            admin.table("direct_reports")
            .select("id,manager_id,archived_at")
            .in_("id", sorted({row["direct_report_id"] for row in rows}))
            .execute()
            .data
        )
    }

    due = []
    for row in rows:
        report = reports.get(row["direct_report_id"])
        if row["id"] in recent:
            continue
        if not report or report.get("manager_id") != row["manager_id"] or report.get("archived_at"):
            continue
        if not _entitled(subs.get(row["manager_id"]), now):
            continue
        due.append(row)
    return due


# ---------------------------------------------------------------------------
# Building one request
# ---------------------------------------------------------------------------

def _plural(n: int, one: str, many: str | None = None) -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"


def _snippet(text: str, limit: int = 110) -> str:
    text = text.strip()
    return f"{text[:limit].rstrip()}…" if len(text) > limit else text


def workspace_signals(admin, manager_id: str, direct_report_id: str) -> tuple[list[str], dict]:
    """The live signals the source review would have offered, as the same
    lines frontend/lib/one-on-one-workspace.ts derives: up to three at-risk
    goals, then the development plan's opening. Returns (topics, counts)."""
    goals = (
        admin.table("goals")
        .select("id,title,status,created_at")
        .eq("owner_id", manager_id)
        .eq("direct_report_id", direct_report_id)
        .order("created_at", desc=True)
        .execute()
        .data
    )
    at_risk = [goal for goal in goals if goal.get("status") == "at_risk"][:3]
    topics = [f"{goal['title']} is at risk" for goal in at_risk]
    plans = (
        admin.table("development_plans")
        .select("plan_text")
        .eq("manager_id", manager_id)
        .eq("direct_report_id", direct_report_id)
        .order("created_at")
        .limit(1)
        .execute()
        .data
    )
    plan_text = (plans[0].get("plan_text") or "").strip() if plans else ""
    if plan_text:
        topics.append(f"Development: {_snippet(plan_text)}")
    return topics, {"at_risk_goals": len(at_risk), "development_plan": bool(plan_text)}


def build_request(admin, occurrence: dict) -> dict | None:
    """(prompt, snapshot) for one occurrence, or None if the report is no
    longer this manager's. The snapshot is what the saved sheet records it
    was built from."""
    manager_id = occurrence["manager_id"]
    report_id = occurrence["direct_report_id"]
    org = get_org(manager_id, admin)
    org_id = org["id"] if org else None

    captures = (
        admin.table("dr_capture_notes")
        .select("id,content,created_at")
        .eq("manager_id", manager_id)
        .eq("direct_report_id", report_id)
        .order("created_at")
        .execute()
        .data
    )
    # Oldest first, newline-joined — what the review step prefills.
    raw_notes = "\n".join(c["content"] for c in captures if (c.get("content") or "").strip())
    carry = [item for item in (occurrence.get("carry_forward_items") or []) if isinstance(item, str) and item.strip()]
    opening_line = (occurrence.get("opening_line") or "").strip() or None
    topics, signal_counts = workspace_signals(admin, manager_id, report_id)

    inputs = assemble_prep_inputs(
        admin,
        manager_id,
        report_id,
        org_id,
        raw_notes=raw_notes,
        carry_forward_items=carry,
        suggested_topics=topics,
        opening_line=opening_line,
    )
    if inputs is None:
        return None

    drew_on = []
    if opening_line:
        drew_on.append("the opening line you kept at the last wrap-up")
    if carry:
        drew_on.append(_plural(len(carry), "carried topic"))
    if inputs["open_commitments"]:
        drew_on.append(_plural(len(inputs["open_commitments"]), "open commitment"))
    if captures:
        drew_on.append(_plural(len(captures), "kept thought"))
    if signal_counts["at_risk_goals"]:
        drew_on.append(_plural(signal_counts["at_risk_goals"], "at-risk goal"))
    if signal_counts["development_plan"]:
        drew_on.append("the development plan")
    drew_on.append("recent 1:1 history")
    if inputs["document_ids"]:
        drew_on.append(_plural(len(inputs["document_ids"]), "company document"))

    return {
        "prompt": inputs["prompt"],
        "snapshot": {
            "raw_notes": raw_notes,
            "capture_ids": [c["id"] for c in captures],
            "open_commitments": inputs["open_commitments"],
            "document_ids": inputs["document_ids"],
            "drew_on": drew_on,
        },
    }


# ---------------------------------------------------------------------------
# Submit
# ---------------------------------------------------------------------------

def submit_due(admin, now: datetime | None = None) -> int:
    """Queue and submit tonight's batch. Returns how many were submitted."""
    now = now or datetime.now(timezone.utc)
    occurrences = due_occurrences(admin, now)
    if not occurrences:
        logger.info("nightly_prep", extra={"fields": {"phase": "submit", "due": 0}})
        return 0

    requests: list[tuple[str, object]] = []
    job_ids: list[str] = []
    for occurrence in occurrences:
        try:
            built = build_request(admin, occurrence)
        except Exception as exc:  # one bad record never sinks the batch
            logger.warning("nightly_prep build failed: %s", type(exc).__name__)
            built = None
        if built is None:
            continue
        job = (
            admin.table("ai_jobs")
            .insert({
                "kind": KIND,
                "manager_id": occurrence["manager_id"],
                "one_on_one_id": occurrence["id"],
                "status": "queued",
                "input": built["snapshot"],
            })
            .execute()
            .data[0]
        )
        job_ids.append(job["id"])
        requests.append((job["id"], built["prompt"]))

    if not requests:
        return 0
    try:
        batch_id = ai_core.submit_text_batch(requests, model=AI_DEFAULT_MODEL_HEAVY, max_tokens=PREP_MAX_TOKENS)
    except ai_core.AIBatchError as exc:
        _finish(admin, job_ids, "failed", "submit_failed")
        logger.warning("nightly_prep submit failed: %s", exc)
        return 0

    (
        admin.table("ai_jobs")
        .update({"status": "submitted", "batch_id": batch_id, "submitted_at": now.isoformat()})
        .in_("id", job_ids)
        .eq("status", "queued")
        .execute()
    )
    logger.info("nightly_prep", extra={"fields": {"phase": "submit", "due": len(occurrences), "submitted": len(job_ids)}})
    return len(job_ids)


# ---------------------------------------------------------------------------
# Collect
# ---------------------------------------------------------------------------

def _finish(admin, job_ids: list[str], status: str, outcome: str | None, keep: dict | None = None) -> None:
    """Close jobs out. The input snapshot holds record text (commitments,
    kept thoughts); once a job is finished only the drew_on labels stay."""
    if not job_ids:
        return
    (
        admin.table("ai_jobs")
        .update({
            "status": status,
            "outcome": outcome,
            "finished_at": datetime.now(timezone.utc).isoformat(),
            "input": keep or {},
        })
        .in_("id", job_ids)
        .execute()
    )


def apply_result(admin, job: dict, text: str | None, error: str | None) -> str:
    """Save one sheet, or record why not. Returns the job's final status."""
    snapshot = job.get("input") or {}
    keep = {"drew_on": snapshot.get("drew_on") or []}
    if error or not text:
        _finish(admin, [job["id"]], "failed", error or "no_text", keep)
        return "failed"

    rows = (
        admin.table("one_on_ones")
        .select("id,summary,prep_guide")
        .eq("id", job["one_on_one_id"])
        .eq("manager_id", job["manager_id"])
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        _finish(admin, [job["id"]], "skipped", "occurrence_gone", keep)
        return "skipped"
    if rows[0].get("summary"):
        _finish(admin, [job["id"]], "skipped", "already_logged", keep)
        return "skipped"
    if rows[0].get("prep_guide"):
        _finish(admin, [job["id"]], "skipped", "already_prepared", keep)
        return "skipped"

    situation_summary, agenda = parse_prep_output(text)
    if not agenda:
        # Never leave the "please try again" fallback on a sheet nobody asked
        # for; the manager's own Prepare is still one click away.
        _finish(admin, [job["id"]], "failed", "unparseable", keep)
        return "failed"

    guide = build_prep_guide(
        situation_summary,
        agenda,
        snapshot.get("open_commitments") or [],
        source_notes=snapshot.get("raw_notes") or "",
        prepared_by="overnight",
        drew_on=snapshot.get("drew_on") or [],
    )
    saved = (
        admin.table("one_on_ones")
        .update({"prep_guide": guide})
        .eq("id", job["one_on_one_id"])
        .eq("manager_id", job["manager_id"])
        .is_("summary", "null")
        .is_("prep_guide", "null")
        .execute()
        .data
    )
    if not saved:
        # Prepared or logged between the read above and this write.
        _finish(admin, [job["id"]], "skipped", "already_prepared", keep)
        return "skipped"

    # The sheet now holds these thoughts in its source notes, which is where
    # "Edit prep" reads them back from — the same move a manual Prepare makes.
    # Only the ones this prompt read; anything kept since stays.
    capture_ids = snapshot.get("capture_ids") or []
    if capture_ids:
        try:
            (
                admin.table("dr_capture_notes")
                .delete()
                .in_("id", capture_ids)
                .eq("manager_id", job["manager_id"])
                .execute()
            )
        except Exception as exc:
            logger.warning("nightly_prep capture cleanup failed: %s", type(exc).__name__)
    try:
        context_engine.record_citations(
            admin, job["manager_id"], snapshot.get("document_ids") or [], context="Overnight 1:1 prep"
        )
    except Exception as exc:
        logger.warning("nightly_prep citation write failed: %s", type(exc).__name__)

    _finish(admin, [job["id"]], "applied", None, keep)
    return "applied"


def collect(admin, now: datetime | None = None) -> dict:
    """Apply every ended batch. Returns counts by final status."""
    now = now or datetime.now(timezone.utc)
    counts: dict[str, int] = {}
    orphaned = (
        admin.table("ai_jobs")
        .select("id")
        .eq("kind", KIND)
        .eq("status", "queued")
        .lt("created_at", (now - QUEUED_GIVE_UP_AFTER).isoformat())
        .execute()
        .data
    )
    if orphaned:
        _finish(admin, [job["id"] for job in orphaned], "failed", "never_submitted")
        counts["failed"] = len(orphaned)
    submitted = (
        admin.table("ai_jobs")
        .select("id,manager_id,one_on_one_id,batch_id,input,submitted_at")
        .eq("kind", KIND)
        .eq("status", "submitted")
        .execute()
        .data
    )
    by_batch: dict[str, list[dict]] = {}
    for job in submitted:
        by_batch.setdefault(job["batch_id"], []).append(job)

    for batch_id, jobs in by_batch.items():
        try:
            batch = ai_core.get_batch(batch_id)
        except ai_core.AIBatchError as exc:
            logger.warning("nightly_prep batch lookup failed: %s", exc)
            continue
        if batch.get("processing_status") != "ended":
            oldest = min(
                datetime.fromisoformat(str(job["submitted_at"]).replace("Z", "+00:00"))
                for job in jobs
                if job.get("submitted_at")
            ) if any(job.get("submitted_at") for job in jobs) else now
            if now - oldest > BATCH_GIVE_UP_AFTER:
                _finish(admin, [job["id"] for job in jobs], "failed", "batch_timeout")
                counts["failed"] = counts.get("failed", 0) + len(jobs)
            continue
        try:
            results = {cid: (text, err) for cid, text, err in ai_core.batch_text_results(batch)}
        except ai_core.AIBatchError as exc:
            logger.warning("nightly_prep results fetch failed: %s", exc)
            continue
        for job in jobs:
            text, err = results.get(job["id"], (None, "missing_result"))
            try:
                status = apply_result(admin, job, text, err)
            except Exception as exc:
                logger.warning("nightly_prep apply failed: %s", type(exc).__name__)
                continue  # stays 'submitted'; retried next tick
            counts[status] = counts.get(status, 0) + 1

    if counts:
        logger.info("nightly_prep", extra={"fields": {"phase": "collect", **counts}})
    return counts
