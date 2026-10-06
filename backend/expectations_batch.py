"""
Batch expectations intake, background drafting (Build 3a;
docs/EXPECTATIONS_BATCH_INTAKE_SCOPING.md, "Background drafting"). Not a route:
routes/notes_dump.py queues drafts on apply, routes/role_expectations.py
retries one and presents the state.

A queued draft is an ordinary open role_expectation_drafts row (no schema
change) whose analysis carries the state:

    {"status": "drafting", "source": "batch", "run": <id>, "started_at": <iso>,
     "context": <that person's slice>, "statement": <what the manager expects>}

  drafting -> composed   the drafter wrote items and questions
  drafting -> failed     the model call failed, or came back unreadable
  drafting (stale)       started_at + STALE_AFTER passed with no write: read
                         as failed (presentation only), so Retry is offered.
                         Per row, never one deadline for the whole batch.

Everything a run needs is on the row. The per-request client's JWT is baked
into its headers with no refresh (utils.py), so a run that outlives the token
401s on its final write; Retry then re-runs from the row alone.

The slice is the only context the drafter sees and the only context_text
sanitize_composed gets, so the allowed numbers and the quote provenance are
that one person's (scoping 2c). Never pass the whole input here. Within the
slice, the manager's own side (what they owe the person, their 1:1 rhythm) is
held back from the drafter too (intake_slices.for_drafting).

Hard rules: the authenticated client throughout (1); AI only via ai_core,
through role_expectations._call_model (2); the output is an unapproved draft
the manager reviews (6).
"""
from __future__ import annotations

import logging
import re
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

import analytics
from intake_slices import for_drafting, norm

logger = logging.getLogger(__name__)

MAX_ROLES = 5
WORKERS = 3
STALE_AFTER = timedelta(minutes=5)
BACKOFF_SECONDS = (5.0, 15.0)
SOURCE_LABEL = "Your description"
HELD_BACK_NOTE = "Left out as yours, not theirs (what you owe them, or your 1:1 rhythm): "
PROMISES_NOTE = "Left out because they are promises, tracked as commitments: "
FAILED_MESSAGE = "The draft couldn't be written just now. What you said is kept — try again."
THIN_MESSAGE = "That wasn't enough to draft from. Add what the role owns and how you'd tell it's going well, or start without a draft."


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse(ts) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def drafting_analysis(context: str, statement: str | None, now: datetime | None = None,
                      promises: list[str] | None = None) -> dict:
    """The analysis a queued (or re-queued) draft starts with. `promises` are
    sentences of the slice a commitment cites: the drafter never reads them."""
    return {
        "status": "drafting",
        "source": "batch",
        "run": uuid.uuid4().hex[:12],
        "started_at": (now or _now()).isoformat(),
        "context": context,
        **({"statement": statement} if statement else {}),
        **({"promises": promises[:20]} if promises else {}),
    }


def is_stale(analysis: dict | None, now: datetime | None = None) -> bool:
    """A drafting row whose own run has had STALE_AFTER without a write."""
    a = analysis or {}
    if a.get("status") != "drafting":
        return False
    started = _parse(a.get("started_at"))
    return started is None or (now or _now()) - started > STALE_AFTER


def presented_analysis(analysis: dict | None, now: datetime | None = None) -> dict:
    """What readers see: a stale drafting row reads as failed. Nothing is written."""
    a = dict(analysis or {})
    if is_stale(a, now):
        a.update({"status": "failed", "error": FAILED_MESSAGE, "stale": True})
    return a


def is_drafting(analysis: dict | None, now: datetime | None = None) -> bool:
    return (analysis or {}).get("status") == "drafting" and not is_stale(analysis, now)


def can_retry(draft: dict, now: datetime | None = None) -> bool:
    a = draft.get("analysis") or {}
    return (
        draft.get("status") == "open"
        and a.get("source") == "batch"
        and bool(a.get("context"))
        and not draft.get("items")
        and presented_analysis(a, now).get("status") == "failed"
    )


_RATE_LIMITED = re.compile(r"\b(429|529)\b")


def _rate_limited(exc: Exception) -> bool:
    """ai_core turns an Anthropic 429 into a 502 whose detail carries the status."""
    return isinstance(exc, HTTPException) and bool(_RATE_LIMITED.search(str(exc.detail)))


def call_with_backoff(call, prompt: str, *, sleep=time.sleep) -> dict:
    """Nothing rate-limits the fan-out (in-process calls skip slowapi), so a 429
    waits and tries again, twice, before the run fails."""
    for attempt in range(len(BACKOFF_SECONDS) + 1):
        try:
            return call(prompt)
        except Exception as exc:
            if attempt < len(BACKOFF_SECONDS) and _rate_limited(exc):
                sleep(BACKOFF_SECONDS[attempt])
                continue
            raise
    raise RuntimeError("unreachable")  # pragma: no cover


def _write_if_unchanged(supabase, draft: dict, patch: dict) -> dict | None:
    """Land only if nothing touched the row since this run read it: a Retry,
    a discard or the manager's own save wins over a late run. -> the new row."""
    from routes.role_expectations import _now_iso
    rows = (
        supabase.table("role_expectation_drafts")
        .update({**patch, "version": draft["version"] + 1, "updated_at": _now_iso()})
        .eq("id", draft["id"]).eq("version", draft["version"]).eq("status", "open")
        .execute().data
    )
    return rows[0] if rows else None


def drop_manager_side(parsed: dict, reads: str, held_back: list[str]) -> dict:
    """The drafter never sees a held-back sentence, so this should never fire.
    If an item still quotes one (as its source or its target), it is the
    manager's side restated as the report's: drop it rather than trust the
    model. Item indexes shift, so questions pointing past it lose their link."""
    if not held_back or not isinstance(parsed.get("items"), list):
        return parsed
    from routes.role_expectations import _squash
    held_sq = [_squash(s) for s in held_back]
    reads_sq = _squash(reads)

    def quotes_held(raw) -> bool:
        if not isinstance(raw, dict):
            return False
        target = raw.get("target") if isinstance(raw.get("target"), dict) else {}
        for q in (raw.get("source_quote"), target.get("quote"), target.get("text")):
            qs = _squash(q) if isinstance(q, str) else ""
            if qs and qs not in reads_sq and any(qs in h for h in held_sq):
                return True
        return False

    keep = [i for i, raw in enumerate(parsed["items"]) if not quotes_held(raw)]
    if len(keep) == len(parsed["items"]):
        return parsed
    remap = {old: new for new, old in enumerate(keep)}
    questions = []
    for q in parsed.get("questions") or []:
        if isinstance(q, dict) and isinstance(q.get("item_index"), int):
            if q["item_index"] not in remap:
                continue
            q = {**q, "item_index": remap[q["item_index"]]}
        questions.append(q)
    return {**parsed, "items": [parsed["items"][i] for i in keep], "questions": questions}


def compose_for_row(supabase, draft: dict, *, call=None, sleep=time.sleep) -> dict:
    """One drafter call for one queued row. Returns the patch to write."""
    from routes import role_expectations as rex

    analysis = draft.get("analysis") or {}
    # The stored slice stays the manager's words. The drafter reads it without
    # the sentences that are the manager's own side (what they owe the person,
    # their 1:1 rhythm), so those can't become an expectation of the report,
    # and their numbers can't become a target (intake_slices.for_drafting).
    promises = [p for p in (analysis.get("promises") or []) if isinstance(p, str)]
    context, held_all = for_drafting(analysis.get("context") or "", extra=promises)
    promised_sq = {norm(p) for p in promises}
    held_back = [s for s in held_all if norm(s) not in promised_sq]
    promised = [s for s in held_all if norm(s) in promised_sq]
    role = rex._fetch_role(supabase, draft["role_level_id"])
    title = rex._role_title(role)
    org_values = rex._org_values(supabase)
    prompt = rex._compose_prompt(
        jd_text=None,
        role_hint=f"{title}, level {role['job_level']}",
        ladders_block=None,
        org_values=org_values,
        sibling_block=rex._sibling_block(supabase, role),
        include_identity=False,
        context=context,
        description_only=True,
    )
    parsed = call_with_backoff(call or (lambda p: rex._call_model(p)), prompt, sleep=sleep)
    if not parsed:
        raise ValueError("unreadable response")
    parsed = drop_manager_side(parsed, context, held_all)
    # Only this person's slice is context_text: allowed numbers and quote
    # provenance are theirs alone. The role name and level ride in the corpus
    # the same way POST /import puts them there.
    items, questions, notes = rex.sanitize_composed(
        parsed,
        corpus_text=f"\n{title} level {role['job_level']}",
        source_available=False,
        org_value_names=[v["name"] for v in org_values],
        context_text=context,
        mode="description",
        ask_level=not rex.ladder_has_levels(supabase, role),
    )
    # Kept within the first five notes the analysis stores.
    if promised:
        notes.insert(0, (PROMISES_NOTE + " ".join(f"“{s}”" for s in promised))[:600])
    if held_back:
        notes.insert(0, (HELD_BACK_NOTE + " ".join(f"“{s}”" for s in held_back))[:600])
    if not items:
        notes.insert(0, THIN_MESSAGE)
    typical = [i for i in items if i.get("origin") == "typical"]
    items = [i for i in items if i.get("origin") != "typical"]
    suggestions = [
        {"id": f"s-{uuid.uuid4().hex[:12]}", "type": "add", "item": i,
         "why": "Typical for this role, not from you.", "status": "pending"}
        for i in typical
    ]
    questions = rex.merge_open_decisions(items, questions, rex._open_decisions(supabase, draft["role_level_id"]))
    return {
        "items": items,
        "questions": questions,
        "suggestions": suggestions,
        "analysis": {
            **{k: v for k, v in analysis.items() if k not in ("error",)},
            "status": "composed",
            "composed_at": rex._now_iso(),
            "notes": notes[:5],
        },
    }


def run_one(supabase, draft_id: str, *, call=None, sleep=time.sleep, user_id: str | None = None) -> str:
    """drafting -> composed | failed, for one row. Returns what happened."""
    from routes.role_expectations import _load_draft, _now_iso

    try:
        draft = _load_draft(supabase, draft_id)
    except Exception as exc:
        logger.warning("batch draft %s: couldn't load: %s", draft_id, exc)
        return "missing"
    analysis = draft.get("analysis") or {}
    if draft.get("status") != "open" or analysis.get("status") != "drafting":
        return "skipped"
    # Claim the row: the clock starts when the run does, not when it was
    # queued (rows 4 and 5 wait for a worker), and a second run that read the
    # same version (a Retry racing a slow first run) loses here instead of
    # paying for a model call.
    try:
        draft = _write_if_unchanged(supabase, draft, {"analysis": {**analysis, "started_at": _now().isoformat()}})
    except Exception as exc:
        logger.warning("batch draft %s: couldn't claim: %s", draft_id, exc)
        return "unwritten"
    if draft is None:
        return "superseded"
    analysis = draft.get("analysis") or {}
    try:
        patch = compose_for_row(supabase, draft, call=call, sleep=sleep)
        outcome = "composed"
    except Exception as exc:
        logger.warning("batch draft %s failed: %s", draft_id, exc)
        patch = {"analysis": {**analysis, "status": "failed", "failed_at": _now_iso(), "error": FAILED_MESSAGE}}
        outcome = "failed"
    try:
        landed = _write_if_unchanged(supabase, draft, patch)
    except Exception as exc:
        # Typically the request's token expired mid-run. The row stays
        # drafting, turns stale after STALE_AFTER, and Retry recovers it.
        logger.warning("batch draft %s: final write failed: %s", draft_id, exc)
        return "unwritten"
    if not landed:
        return "superseded"
    if user_id:
        analytics.capture(user_id, "role_draft_composed", {
            "source": "batch",
            "outcome": outcome,
            "items": len(patch.get("items") or []),
            "typical": len(patch.get("suggestions") or []),
        })
    return outcome


def draft_in_background(supabase, draft_ids: list[str], user_id: str | None = None, *, call=None,
                        sleep=time.sleep, workers: int = WORKERS) -> dict:
    """The one BackgroundTask. BackgroundTasks runs tasks one after another,
    so concurrency lives here: a small bounded pool, capped at MAX_ROLES rows."""
    ids = list(dict.fromkeys(draft_ids))[:MAX_ROLES]
    if not ids:
        return {}
    with ThreadPoolExecutor(max_workers=min(workers, len(ids))) as pool:
        results = list(pool.map(lambda d: run_one(supabase, d, call=call, sleep=sleep, user_id=user_id), ids))
    return dict(zip(ids, results))
