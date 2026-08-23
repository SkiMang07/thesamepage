"""
The core feature: 1:1 prep + logging.

POST /prep generates a structured prep sheet for an upcoming 1:1 using the
manager's raw notes plus that direct report's open commitments (the
"remembers what you told them" hook). It persists a "planned" one_on_ones
row (prep_guide set, summary null), attaching it to an existing scheduled
occurrence when present. The manager
reviews/edits, then POST / logs the meeting: if it was prepped, this fills
in summary/notes on that SAME row (planned -> completed) instead of
inserting a second row.

Status is derived, not stored: scheduled_at-only is "scheduled", prep_guide
without summary is "planned", and summary is "completed". A recurring series
creates the next scheduled occurrence only after the current call is logged.

Context Engine integration (Session IV, 2026-08-12): /prep is the pilot call
site for backend/context_engine.py's retrieval helper — see that module's
docstring for the two-tier design. Wiring the other generate_text() call
sites in this app (wrapup, assessments, dashboard insights) is future work,
not done this session.

Capture notes (Session 50, 2026-08-21): a small between-sessions inbox
(dr_capture_notes) feeding /prep, not a status on this table — see the
"Capture notes" section near the bottom of this file.
"""
import json
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

import context_engine
from ai_core import generate_text
from config import AI_DEFAULT_MODEL_HEAVY
from routes.direct_reports import fetch_role_expectations
from utils import (
    ensure_org,
    get_authenticated_client,
    get_email_from_token,
    get_org,
    limiter,
    resolve_cadence_days,
)

router = APIRouter()


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class PrepRequest(BaseModel):
    direct_report_id: str
    raw_notes: str  # manager's quick freeform input: what's going on, what's on their mind
    one_on_one_id: str | None = None
    scheduled_at: str | None = None
    recurrence_weeks: int | None = None
    timezone: str = "UTC"


class AgendaItem(BaseModel):
    title: str
    rationale: str
    suggested_questions: list[str]


class PrepResponse(BaseModel):
    id: str  # the one_on_ones row this prep sheet was saved to (planned session)
    situation_summary: str
    agenda_items: list[AgendaItem]
    open_commitments_to_check: list[dict]
    scheduled_at: str | None = None
    recurrence_weeks: int | None = None
    carry_forward_items: list[str] = Field(default_factory=list)


class NewCommitmentIn(BaseModel):
    description: str
    committed_by: str = "manager"  # 'manager' | 'direct_report'
    due_date: str | None = None  # ISO date or None


class LogOneOnOneIn(BaseModel):
    direct_report_id: str
    summary: str
    # Raw in-call notes (typed live or pasted from a recorder like Granola).
    # Stored on one_on_ones.notes — private to the writing manager (RLS).
    notes: str | None = None
    new_commitments: list[NewCommitmentIn] = Field(default_factory=list)
    carry_forward_items: list[str] = Field(default_factory=list)
    # Set when this meeting was scheduled/prepped: the open one_on_ones row.
    # Logging then UPDATEs that row (scheduled/planned ->
    # completed) instead of inserting a second one. Omitted for ad-hoc logs
    # (the standalone /log flow, which never went through /prep).
    one_on_one_id: str | None = None


class WrapUpRequest(BaseModel):
    direct_report_id: str
    raw_notes: str  # what actually happened on the call — typed live or pasted


class WrapUpCommitment(BaseModel):
    description: str
    committed_by: str  # 'manager' | 'direct_report'
    due_date: str | None = None


class WrapUpDraft(BaseModel):
    """AI-drafted log for the manager to review — nothing is saved yet."""
    summary: str
    commitments: list[WrapUpCommitment]
    follow_up_items: list[str]


class ScheduleUpdate(BaseModel):
    scheduled_at: str | None = None
    recurrence_weeks: int | None = None
    timezone: str = "UTC"


# ---------------------------------------------------------------------------
# Prompt builder — this is the core product IP
# ---------------------------------------------------------------------------

def _format_expectations_block(report_name: str, expectations: dict | None) -> str:
    """Optional prompt section: the role's configured expectations (Settings >
    Expectations). Empty string when the DR has no role assigned — the prompt
    must read naturally without it."""
    if not expectations:
        return ""

    role = expectations["role_level"]
    role_label = f"{role['job_role']}, level {role['job_level']}"
    if role.get("functional_team"):
        role_label += f" ({role['functional_team']})"

    def _items(kind: str, name_col: str) -> str:
        rows = expectations.get(kind) or []
        if not rows:
            return ""
        lines = []
        for r in rows:
            parts = [r[name_col]]
            if r.get("expectation"):
                parts.append(f"expectation: {r['expectation']}")
            if r.get("description"):
                parts.append(r["description"])
            if kind == "metrics" and r.get("measurement_period") and r["measurement_period"] != "none":
                parts.append(f"measured per {r['measurement_period']}")
            lines.append("    • " + " — ".join(parts))
        label = {"metrics": "Metrics", "skills": "Skills", "values": "Values"}[kind]
        return f"  {label}:\n" + "\n".join(lines)

    groups = [
        block
        for block in (
            _items("metrics", "metric_name"),
            _items("skills", "skill_name"),
            _items("values", "value_name"),
        )
        if block
    ]
    responsibilities = ""
    if role.get("job_responsibilities"):
        responsibilities = f"\n  Role responsibilities: {role['job_responsibilities']}"

    if not groups:
        # Role assigned but nothing configured — give the role context without
        # an instruction that has nothing to point at.
        return f"""
ROLE CONTEXT — {report_name}'s role: {role_label}.{responsibilities}
(No performance expectations are configured for this role yet.)
"""

    body = "\n".join(groups)
    return f"""
ROLE EXPECTATIONS — what good looks like for {report_name}'s role ({role_label}):{responsibilities}
{body}
When the manager's notes or history touch performance, feedback, growth, or career direction, ground your questions and any SBI phrasing in these specific expectations — name the relevant metric, skill, or value explicitly. Do NOT audit every expectation in one 1:1; pull in only the ones the notes make relevant. If nothing in the notes connects to them, leave them out entirely.
"""


def _build_prep_prompt(
    report_name: str,
    raw_notes: str,
    open_commitments: list[dict],
    recent_summaries: list[str],
    days_since_last: int | None,
    cadence_days: int,
    role_expectations: dict | None = None,
    context_engine_block: str = "",
    carry_forward_items: list[str] | None = None,
) -> str:
    # --- Recency context ---
    if days_since_last is None:
        recency_note = (
            "This is the first logged 1:1 with this person. "
            "Treat it as a foundation-setting conversation: establish communication style, "
            "understand their goals and current challenges, and set expectations for how "
            "you'll work together."
        )
    elif days_since_last > cadence_days:
        recency_note = (
            f"It has been {days_since_last} days since the last 1:1 — longer than this person's "
            f"usual {cadence_days}-day cadence. "
            "Prioritize reconnection and checking what has shifted since you last spoke. "
            "Do not assume the context from the last meeting still holds."
        )
    else:
        recency_note = f"Last 1:1 was {days_since_last} days ago — normal cadence."

    # --- Recent history ---
    if recent_summaries:
        history_block = "\n".join(f"  • {s}" for s in recent_summaries)
    else:
        history_block = "  (No prior 1:1 notes on record.)"

    # --- Open commitments (either side can owe one — committed_by) ---
    def _owner_label(c: dict) -> str:
        return report_name if c.get("committed_by") == "direct_report" else "manager"

    if open_commitments:
        commitments_block = "\n".join(
            f"  • [{_owner_label(c)} owes] {c['description']} (due: {c.get('due_date') or 'unspecified'})"
            for c in open_commitments
        )
    else:
        commitments_block = "  (None on record.)"

    carry_forward_block = ""
    if carry_forward_items:
        items = "\n".join(f"  • {item}" for item in carry_forward_items)
        carry_forward_block = f"""
CONFIRMED FOLLOW-UPS FROM THE LAST 1:1:
{items}
These were explicitly carried forward by the manager. Address each one in the agenda unless newer context clearly resolves it.
"""

    return f"""You are a management coach helping a manager prepare for a 1:1 with {report_name}.

Your output must be grounded in the specific details provided. Do not give generic management advice. Every agenda item, question, and talking point must follow from something the manager actually wrote, something in recent history, or an open commitment that needs follow-up.

---
RELATIONSHIP CONTEXT
{recency_note}

RECENT 1:1 HISTORY (last 2–3 meetings, newest first):
{history_block}

OPEN COMMITMENTS (unresolved — each is marked with who owes it):
{commitments_block}
{carry_forward_block}{_format_expectations_block(report_name, role_expectations)}{context_engine_block}
MANAGER'S NOTES ON WHAT'S HAPPENING RIGHT NOW:
{raw_notes or '(No additional notes were added.)'}

---
FRAMEWORKS TO APPLY — read carefully before generating output:

1. COMMITMENT REVIEW
   If any open commitments exist, the first agenda item must address them.
   For items {report_name} owes, frame questions to create accountability without defensiveness:
   ✓ "Where did you land on X?" or "What happened with Y?"
   ✗ "Did you do X?" (accusatory) or ignoring them entirely (sends the wrong signal)
   For items the manager owes, prompt the manager to proactively give a status — modeling accountability is how the standard gets set.

2. SITUATIONAL QUESTION LOGIC — scan the manager's notes for these signals:
   - OBSTACLES / BLOCKERS → use GROW coaching questions:
       Goal: "What outcome were you going for?"
       Reality: "What's actually happening now?"
       Options: "What approaches haven't you tried yet?"
       Way forward: "What will you commit to by next time?"
   - PERFORMANCE CONCERNS → prepare SBI framing the manager can use:
       Situation: when and where the behavior was observed
       Behavior: the specific, observable action (not an interpretation)
       Impact: what it caused for the team, project, or manager
       Write suggested phrasing, not just labels.
   - POSITIVE MOMENTUM → reinforce with "What made that work?" — build repeatable behavior, not just celebrate outcomes.
   - ENGAGEMENT / MOTIVATION SIGNALS → surface with "What's energizing you right now?" and "What's feeling like a drag?"
   - CAREER / GROWTH SIGNALS → ask "What would make this role feel like it's moving in the right direction for you?"

3. AGENDA PRIORITY
   Order items by urgency. If there are commitments to review AND an urgent issue, open with commitments (quick check, 1–2 mins each) and then pivot to the urgent topic. Do not bury time-sensitive items at the end.

4. MANAGER TALKING POINTS
   If the notes suggest the manager needs to proactively share something (a decision, context, feedback), include it as an agenda item with a suggested opening line. For feedback, pre-write the SBI framing.

5. CLOSING QUESTION
   Always include one final agenda item: a closing check-in. Use a variation of:
   "Is there anything on your mind that we haven't covered?" or
   "What's one thing I could do to make your work easier this week?"
   This is non-negotiable — it is the most important question in any 1:1.

---
Return ONLY valid JSON. No commentary, no markdown, no code fences.

{{
  "situation_summary": "2–3 sentences: where things stand with this person based on history and current notes. Name any patterns, risks, or positive momentum worth calling out explicitly.",
  "agenda_items": [
    {{
      "title": "Short label for this item (5 words or fewer)",
      "rationale": "Why this item matters right now — one sentence, grounded in the notes or history",
      "suggested_questions": ["Question 1", "Question 2"]
    }}
  ]
}}

Generate 3–5 agenda items total (including the commitment review if applicable and always the closing). Quality over quantity."""


def _build_wrapup_prompt(report_name: str, raw_notes: str, today_iso: str) -> str:
    """Distill raw in-call notes (typed live or pasted from a recorder) into a
    draft summary, commitments from BOTH sides, and possible carry-forward
    topics. The manager reviews and edits everything before it is saved."""
    return f"""You are helping a manager log a 1:1 they just had with {report_name}. Distill the raw call notes below into a clean, reviewable record. The manager will edit your draft before saving — be precise, not exhaustive.

Today's date: {today_iso} (use it to resolve relative deadlines like "by Friday" or "end of month").

RAW CALL NOTES (typed during the call, or pasted from a transcript/recording tool — may be messy, fragmentary, or verbatim):
{raw_notes}

Produce:

1. summary — 2–4 sentences capturing what was actually discussed: decisions made, concerns raised, wins, changes in the situation. Write it so that reading it three weeks from now instantly restores context. State the substance directly — no "we discussed X" padding.

2. commitments — every explicit commitment made by either person. Rules:
   - Include only things someone actually agreed to DO. Topics discussed, open questions, and vague intentions ("we should think about...") are NOT commitments unless clearly accepted as an action.
   - committed_by: "manager" if the manager owes it, "direct_report" if {report_name} owes it.
   - due_date: ISO date (YYYY-MM-DD) only when a deadline was stated or clearly implied — resolve relative dates from today's date. Otherwise null. Never guess a date.
   - Phrase each as one short actionable sentence starting with a verb ("Send intro to the design team").
   - Do NOT invent commitments. An empty list is a valid answer.

3. follow_up_items — unresolved topics or questions the manager may want to revisit in the next 1:1. Rules:
   - These are NOT actions someone agreed to take; those belong in commitments.
   - Include only topics clearly left open, explicitly deferred, or needing a future check-in.
   - Phrase each as a short, concrete reminder that will still make sense weeks from now.
   - Do NOT invent follow-ups. An empty list is a valid answer.

Return ONLY valid JSON. No commentary, no markdown, no code fences.

{{"summary": "...", "commitments": [{{"description": "...", "committed_by": "manager", "due_date": "2026-08-07"}}], "follow_up_items": ["Revisit how the Acme renewal risk is changing"]}}"""


# ---------------------------------------------------------------------------
# Session status — derived from which columns are filled, never stored.
# scheduled: scheduled_at set, prep_guide/summary null
# planned:   prep_guide set, summary null (prepped, meeting hasn't happened)
# completed: summary set (logged, whether or not it was prepped first)
# ---------------------------------------------------------------------------

def _serialize_session(row: dict) -> dict:
    """Adds derived display fields for the frontend's combined history."""
    is_completed = bool(row.get("summary"))
    prep_guide = row.get("prep_guide") or {}
    series = row.get("one_on_one_series") or {}
    if isinstance(series, list):
        series = series[0] if series else {}
    is_recurring = bool(series and series.get("active"))
    if is_completed:
        status = "completed"
    elif prep_guide:
        status = "planned"
    else:
        status = "scheduled"
    return {
        **row,
        "status": status,
        "display_summary": (
            row.get("summary", "")
            if is_completed
            else prep_guide.get("situation_summary", "")
            or ((row.get("carry_forward_items") or [""])[0])
        ),
        "recurrence_weeks": series.get("interval_weeks") if is_recurring else None,
        "recurrence_timezone": series.get("timezone") if is_recurring else None,
    }


def _find_open_session(supabase, user_id: str, direct_report_id: str) -> dict | None:
    """The current unfinished occurrence, scheduled or already prepped."""
    rows = (
        supabase.table("one_on_ones")
        .select("*,one_on_one_series(interval_weeks,timezone,active)")
        .eq("manager_id", user_id)
        .eq("direct_report_id", direct_report_id)
        .is_("summary", "null")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
        .data
    )
    return rows[0] if rows else None


def _clean_follow_up_items(items: list[str]) -> list[str]:
    """Trim, de-duplicate, and bound manager-confirmed carry-forward topics."""
    cleaned: list[str] = []
    seen: set[str] = set()
    for raw in items:
        item = raw.strip()
        key = item.casefold()
        if not item or key in seen:
            continue
        cleaned.append(item[:500])
        seen.add(key)
        if len(cleaned) == 10:
            break
    return cleaned


def _normalize_scheduled_at(value: str | None) -> str | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        raise HTTPException(status_code=422, detail="scheduled_at must be an ISO timestamp")
    if parsed.tzinfo is None:
        raise HTTPException(status_code=422, detail="scheduled_at must include a timezone")
    return parsed.astimezone(timezone.utc).isoformat()


def _validate_recurrence(recurrence_weeks: int | None, scheduled_at: str | None) -> None:
    if recurrence_weeks is not None and recurrence_weeks not in (1, 2, 3, 4):
        raise HTTPException(status_code=422, detail="recurrence_weeks must be between 1 and 4")
    if recurrence_weeks is not None and not scheduled_at:
        raise HTTPException(status_code=422, detail="A recurring 1:1 needs a meeting date")


def _next_occurrence_at(scheduled_at: str, interval_weeks: int, now: datetime | None = None) -> str:
    """Advance from the scheduled occurrence, preserving the series rhythm.

    If an old meeting is logged late, skip already-past occurrences instead of
    creating a new scheduled shell in the past.
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


def _upsert_series_for_session(
    supabase,
    user_id: str,
    direct_report_id: str,
    session: dict,
    scheduled_at: str | None,
    recurrence_weeks: int | None,
    recurrence_timezone: str,
) -> dict:
    """Persist schedule fields and return the updated occurrence."""
    _validate_recurrence(recurrence_weeks, scheduled_at)
    series_id = session.get("series_id")

    if recurrence_weeks is not None:
        series = None
        if series_id:
            rows = (
                supabase.table("one_on_one_series")
                .select("id")
                .eq("id", series_id)
                .eq("manager_id", user_id)
                .limit(1)
                .execute()
                .data
            )
            series = rows[0] if rows else None
        if not series:
            rows = (
                supabase.table("one_on_one_series")
                .select("id")
                .eq("manager_id", user_id)
                .eq("direct_report_id", direct_report_id)
                .eq("active", True)
                .limit(1)
                .execute()
                .data
            )
            series = rows[0] if rows else None

        values = {
            "manager_id": user_id,
            "direct_report_id": direct_report_id,
            "interval_weeks": recurrence_weeks,
            "anchor_at": scheduled_at,
            "timezone": (recurrence_timezone or "UTC")[:100],
            "active": True,
        }
        if series:
            series_id = series["id"]
            supabase.table("one_on_one_series").update(values).eq("id", series_id).eq("manager_id", user_id).execute()
        else:
            series_id = supabase.table("one_on_one_series").insert(values).execute().data[0]["id"]
    elif series_id:
        supabase.table("one_on_one_series").update({"active": False}).eq("id", series_id).eq("manager_id", user_id).execute()
        series_id = None

    saved = (
        supabase.table("one_on_ones")
        .update({"scheduled_at": scheduled_at, "series_id": series_id})
        .eq("id", session["id"])
        .eq("manager_id", user_id)
        .eq("direct_report_id", direct_report_id)
        .execute()
        .data
    )
    if not saved:
        raise HTTPException(status_code=404, detail="1:1 session not found")
    updated = saved[0]
    updated["recurrence_weeks"] = recurrence_weeks
    updated["recurrence_timezone"] = recurrence_timezone if recurrence_weeks else None
    return updated


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

# NOTE: declared before /{direct_report_id}/history and /session/{id} would
# only matter if "overview" could be mistaken for a path segment on those —
# it can't (both are two-segment paths) — but kept first for the same
# ordering-hygiene reason direct_reports.py flags on its /overview.
@router.get("/overview")
async def get_one_on_ones_overview(auth=Depends(get_authenticated_client)):
    """Front door for the 1:1 loop (/app/1-1s, nav rework pass 2 — see
    docs/ONE_ON_ONES_PAGE_SPEC.md section 5). Every direct report with a
    resolved cadence, whether they're due, any in-flight planned session,
    and their last completed session. This is the single canonical
    computation of "who's due" — the zone map's 1:1s door count and Mission
    Control's Individual Performance card both read is_due from here rather
    than recomputing cadence math a fourth time (see resolve_cadence_days()
    in utils.py).
    """
    user_id, supabase = auth

    # Archived people (Session 43) drop off the 1:1s overview — see
    # docs/TEAM_SETUP_UX_REVIEW.md §7.3, finding P1.
    reports = (
        supabase.table("direct_reports")
        .select("id,name,role_title,one_on_one_cadence_days,org_units(name)")
        .eq("manager_id", user_id)
        .is_("archived_at", "null")
        .order("name")
        .execute()
        .data
    )
    if not reports:
        return []

    # Read-only — a page load shouldn't bootstrap an organization row.
    org = get_org(user_id, supabase)

    # Every session for these reports, newest first — one query, split in
    # Python into "planned" (prep_guide set, summary null) and "completed"
    # (summary set) per the standing no-status-column rule (see
    # _serialize_session's docstring above). setdefault + newest-first order
    # means the first hit per report is the latest of each kind.
    sessions = (
        supabase.table("one_on_ones")
        .select(
            "id,direct_report_id,series_id,scheduled_at,summary,notes,prep_guide,"
            "carry_forward_items,created_at,one_on_one_series(interval_weeks,timezone,active)"
        )
        .eq("manager_id", user_id)
        .order("created_at", desc=True)
        .execute()
        .data
    )

    planned_by_report: dict[str, dict] = {}
    completed_by_report: dict[str, dict] = {}
    for row in sessions:
        rid = row["direct_report_id"]
        if row.get("summary"):
            completed_by_report.setdefault(rid, row)
        elif row.get("prep_guide") or row.get("scheduled_at") or row.get("carry_forward_items"):
            planned_by_report.setdefault(rid, row)

    # Commitments logged against each report's last completed session —
    # total count regardless of current status (open/done/dropped), since
    # this is "how much came out of this 1:1," not a live open-items count
    # (that's what the DR detail page's Open commitments section is for).
    completed_ids = [row["id"] for row in completed_by_report.values()]
    commitment_counts: dict[str, int] = {}
    if completed_ids:
        commitment_rows = (
            supabase.table("commitments")
            .select("source_id")
            .eq("owner_id", user_id)
            .eq("source_type", "one_on_one")
            .in_("source_id", completed_ids)
            .execute()
            .data
        )
        for row in commitment_rows:
            sid = row["source_id"]
            commitment_counts[sid] = commitment_counts.get(sid, 0) + 1

    today = date.today()
    result = []
    for r in reports:
        rid = r["id"]
        completed = completed_by_report.get(rid)
        last_at = completed["created_at"] if completed else None
        days_since_last: int | None = None
        if last_at:
            try:
                last_date = datetime.fromisoformat(last_at.replace("Z", "+00:00")).date()
                days_since_last = (today - last_date).days
            except (ValueError, AttributeError):
                pass

        cadence_days, cadence_source = resolve_cadence_days(r, org)
        # Never met counts as due — same rule needsOneOnOne() used to apply
        # client-side; now the only place this is decided.
        is_due = days_since_last is None or days_since_last > cadence_days

        planned = planned_by_report.get(rid)
        org_unit = r.get("org_units") or {}

        result.append({
            "direct_report_id": rid,
            "name": r["name"],
            "role_title": r.get("role_title"),
            "org_unit": org_unit.get("name"),
            "last_one_on_one_at": last_at,
            "days_since_last": days_since_last,
            "cadence_days": cadence_days,
            "cadence_source": cadence_source,
            "is_due": is_due,
            "planned_session": _serialize_session(planned) if planned else None,
            "last_completed": (
                {
                    "id": completed["id"],
                    "date": completed["created_at"],
                    "commitment_count": commitment_counts.get(completed["id"], 0),
                }
                if completed
                else None
            ),
        })
    return result


@router.get("/open/{direct_report_id}")
async def get_open_session(direct_report_id: str, auth=Depends(get_authenticated_client)):
    """Return the report's current scheduled/prepped occurrence, if one exists."""
    user_id, supabase = auth
    row = _find_open_session(supabase, user_id, direct_report_id)
    return _serialize_session(row) if row else None


@router.post("/prep", response_model=PrepResponse)
@limiter.limit("10/minute")
async def prep_one_on_one(
    request: Request,
    body: PrepRequest,
    auth=Depends(get_authenticated_client),
    authorization: str = Header(None),
):
    user_id, supabase = auth

    existing = None
    if body.one_on_one_id:
        rows = (
            supabase.table("one_on_ones")
            .select("*,one_on_one_series(interval_weeks,timezone,active)")
            .eq("id", body.one_on_one_id)
            .eq("manager_id", user_id)
            .eq("direct_report_id", body.direct_report_id)
            .is_("summary", "null")
            .limit(1)
            .execute()
            .data
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Open 1:1 session not found")
        existing = rows[0]
    else:
        existing = _find_open_session(supabase, user_id, body.direct_report_id)

    fields_set = body.model_fields_set
    scheduled_at = (
        _normalize_scheduled_at(body.scheduled_at)
        if "scheduled_at" in fields_set
        else existing.get("scheduled_at") if existing else None
    )
    existing_series = (existing or {}).get("one_on_one_series") or {}
    if isinstance(existing_series, list):
        existing_series = existing_series[0] if existing_series else {}
    recurrence_weeks = (
        body.recurrence_weeks
        if "recurrence_weeks" in fields_set
        else existing_series.get("interval_weeks") if existing_series.get("active") else None
    )
    recurrence_timezone = (
        body.timezone
        if "timezone" in fields_set
        else existing_series.get("timezone") or "UTC"
    )
    _validate_recurrence(recurrence_weeks, scheduled_at)
    carry_forward_items = _clean_follow_up_items((existing or {}).get("carry_forward_items") or [])

    # Fetch direct report name (+ org_unit_id, for the Context Engine's
    # scope cascade below)
    try:
        report_result = (
            supabase.table("direct_reports")
            .select("name,role_level_id,org_unit_id,one_on_one_cadence_days")
            .eq("id", body.direct_report_id)
            .eq("manager_id", user_id)
            .single()
            .execute()
        )
    except Exception:
        raise HTTPException(status_code=404, detail="Direct report not found")
    if not report_result.data:
        raise HTTPException(status_code=404, detail="Direct report not found")
    report = report_result.data
    # Read-only — same org.one_on_one_cadence_days -> 21 fallback resolve_
    # cadence_days() uses everywhere else (dashboard insight, /overview).
    # A missing org here resolves to the same "default" (21) that ensure_org()
    # below would produce a moment later anyway, so this doesn't need to wait
    # for the bootstrap.
    cadence_days, _cadence_source = resolve_cadence_days(report, get_org(user_id, supabase))

    # Fetch open commitments for this report
    open_commitments = (
        supabase.table("commitments")
        .select("description,due_date,committed_by")
        .eq("direct_report_id", body.direct_report_id)
        .eq("status", "open")
        .execute()
        .data
    )

    # Fetch recent 1:1 history. Over-fetch and filter to COMPLETED meetings
    # only (summary set) — a "planned" row (prep_guide only, meeting hasn't
    # happened yet) must not count as the last 1:1, or the recency logic and
    # /api/one-on-ones/overview's is_due badge would both go stale the
    # moment a prep sheet is generated. See resolve_cadence_days() in
    # utils.py: every cadence-aware call site shares that one resolver.
    history_rows_raw = (
        supabase.table("one_on_ones")
        .select("summary,created_at")
        .eq("direct_report_id", body.direct_report_id)
        .eq("manager_id", user_id)
        .order("created_at", desc=True)
        .limit(10)
        .execute()
        .data
    )
    history_rows = [row for row in history_rows_raw if row.get("summary")][:3]

    # Compute days since last 1:1
    days_since_last: int | None = None
    if history_rows:
        last_ts = history_rows[0].get("created_at", "")
        try:
            last_date = datetime.fromisoformat(last_ts.replace("Z", "+00:00")).date()
            days_since_last = (date.today() - last_date).days
        except (ValueError, AttributeError):
            pass

    recent_summaries = [row["summary"] for row in history_rows if row.get("summary")]

    # Role expectations (Settings backbone payoff) — None when no role assigned,
    # and the prompt simply omits the section.
    role_expectations = fetch_role_expectations(supabase, report.get("role_level_id"))

    # Context Engine (Session IV pilot) — org docs scoped to this report's
    # team, cascaded up through department + company-wide. org_id comes from
    # ensure_org() (idempotent) rather than a stored column, matching the
    # pattern documents.py already uses for the same reason: direct_reports
    # /users' org_id can still be null for older MVP rows.
    org_id = ensure_org(user_id, supabase, get_email_from_token(authorization))
    retrieved_docs = context_engine.get_relevant_context(
        supabase, org_id, report.get("org_unit_id"), date.today()
    )
    context_engine_block = context_engine.format_context_block(retrieved_docs)

    prompt = _build_prep_prompt(
        report_name=report["name"],
        raw_notes=body.raw_notes,
        open_commitments=open_commitments,
        recent_summaries=recent_summaries,
        days_since_last=days_since_last,
        cadence_days=cadence_days,
        role_expectations=role_expectations,
        context_engine_block=context_engine_block,
        carry_forward_items=carry_forward_items,
    )

    raw = generate_text(prompt, model=AI_DEFAULT_MODEL_HEAVY, max_tokens=2000)

    # Citations: only after the call that actually used them succeeds, and
    # only for docs that were in fact embedded above (not broader candidates
    # ranking dropped) — per build-plan Session IV's "write to
    # document_citations whenever a doc is actually used in an answer".
    context_engine.record_citations(
        supabase,
        user_id,
        [doc["id"] for doc in retrieved_docs],
        context=f"1:1 prep for {report['name']}",
    )

    # Strip markdown code fences — model sometimes wraps JSON in ```json...```
    raw_clean = raw.strip()
    if raw_clean.startswith("```"):
        start = raw_clean.find("{")
        end = raw_clean.rfind("}") + 1
        raw_clean = raw_clean[start:end] if start != -1 else raw_clean

    try:
        parsed = json.loads(raw_clean)
    except json.JSONDecodeError:
        parsed = {
            "situation_summary": "Unable to generate summary — please try again.",
            "agenda_items": [],
        }

    agenda_items = [
        AgendaItem(
            title=item.get("title", ""),
            rationale=item.get("rationale", ""),
            suggested_questions=item.get("suggested_questions", []),
        )
        for item in parsed.get("agenda_items", [])
    ]

    # Persist the sheet so it survives the gap between prepping and the
    # actual meeting (Andrew's pain point: prep a day or two out, lose the
    # sheet, have to regenerate). The full response — not just the AI JSON —
    # is stored so a resumed session shows exactly what was generated,
    # including the open-commitments snapshot from prep time.
    prep_guide = {
        "situation_summary": parsed.get("situation_summary", ""),
        "agenda_items": [item.model_dump() for item in agenda_items],
        "open_commitments_to_check": open_commitments,
    }
    if existing:
        saved = (
            supabase.table("one_on_ones")
            .update({"prep_guide": prep_guide})
            .eq("id", existing["id"])
            .execute()
            .data[0]
        )
    else:
        saved = (
            supabase.table("one_on_ones")
            .insert({
                "manager_id": user_id,
                "direct_report_id": body.direct_report_id,
                "prep_guide": prep_guide,
                "scheduled_at": scheduled_at,
            })
            .execute()
            .data[0]
        )

    saved = _upsert_series_for_session(
        supabase,
        user_id,
        body.direct_report_id,
        {**saved, "series_id": (existing or {}).get("series_id") or saved.get("series_id")},
        scheduled_at,
        recurrence_weeks,
        recurrence_timezone,
    )

    return PrepResponse(
        id=saved["id"],
        situation_summary=prep_guide["situation_summary"],
        agenda_items=agenda_items,
        open_commitments_to_check=open_commitments,
        scheduled_at=scheduled_at,
        recurrence_weeks=recurrence_weeks,
        carry_forward_items=carry_forward_items,
    )


@router.post("/wrapup", response_model=WrapUpDraft)
@limiter.limit("10/minute")
async def wrap_up_one_on_one(request: Request, body: WrapUpRequest, auth=Depends(get_authenticated_client)):
    """Distill raw in-call notes into a DRAFT summary + commitments (both
    sides). Pure AI-call route — nothing is saved; the manager reviews the
    draft and then POST / logs it."""
    user_id, supabase = auth

    try:
        report_result = (
            supabase.table("direct_reports")
            .select("name")
            .eq("id", body.direct_report_id)
            .eq("manager_id", user_id)
            .single()
            .execute()
        )
    except Exception:
        raise HTTPException(status_code=404, detail="Direct report not found")
    if not report_result.data:
        raise HTTPException(status_code=404, detail="Direct report not found")

    prompt = _build_wrapup_prompt(
        report_name=report_result.data["name"],
        raw_notes=body.raw_notes,
        today_iso=date.today().isoformat(),
    )
    raw = generate_text(prompt, model=AI_DEFAULT_MODEL_HEAVY, max_tokens=1500)

    # Strip markdown code fences — model sometimes wraps JSON in ```json...```
    raw_clean = raw.strip()
    if raw_clean.startswith("```"):
        start = raw_clean.find("{")
        end = raw_clean.rfind("}") + 1
        raw_clean = raw_clean[start:end] if start != -1 else raw_clean

    try:
        parsed = json.loads(raw_clean)
    except json.JSONDecodeError:
        # Empty draft — the review screen requires a summary before saving,
        # so the manager writes one by hand instead of getting an error.
        parsed = {"summary": "", "commitments": [], "follow_up_items": []}

    commitments: list[WrapUpCommitment] = []
    for item in parsed.get("commitments", []):
        description = (item.get("description") or "").strip()
        if not description:
            continue
        committed_by = item.get("committed_by")
        if committed_by not in ("manager", "direct_report"):
            committed_by = "manager"
        due_date = item.get("due_date") or None
        if due_date:
            try:
                date.fromisoformat(due_date)
            except ValueError:
                due_date = None
        commitments.append(
            WrapUpCommitment(description=description, committed_by=committed_by, due_date=due_date)
        )

    follow_up_items = _clean_follow_up_items(parsed.get("follow_up_items") or [])
    return WrapUpDraft(
        summary=parsed.get("summary", "") or "",
        commitments=commitments,
        follow_up_items=follow_up_items,
    )


@router.post("")
async def log_one_on_one(body: LogOneOnOneIn, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    source_session = None

    if body.one_on_one_id:
        # This meeting was scheduled/prepped — complete the existing occurrence
        # rather than inserting a second one.
        # Scoped by manager_id + direct_report_id so a stale/foreign id
        # can't be used to overwrite someone else's row.
        source_rows = (
            supabase.table("one_on_ones")
            .select("id,series_id,scheduled_at,summary")
            .eq("id", body.one_on_one_id)
            .eq("manager_id", user_id)
            .eq("direct_report_id", body.direct_report_id)
            .is_("summary", "null")
            .limit(1)
            .execute()
            .data
        )
        if not source_rows:
            raise HTTPException(status_code=404, detail="Planned session not found")
        source_session = source_rows[0]
        result = (
            supabase.table("one_on_ones")
            .update({
                "summary": body.summary,
                "notes": body.notes,
            })
            .eq("id", body.one_on_one_id)
            .eq("manager_id", user_id)
            .eq("direct_report_id", body.direct_report_id)
            .is_("summary", "null")
            .execute()
        )
        if not result.data:
            raise HTTPException(status_code=404, detail="Planned session not found")
        meeting = result.data[0]
    else:
        meeting = (
            supabase.table("one_on_ones")
            .insert({
                "manager_id": user_id,
                "direct_report_id": body.direct_report_id,
                "summary": body.summary,
                # Raw call notes — private to the writing manager (RLS).
                "notes": body.notes,
            })
            .execute()
            .data[0]
        )
        source_session = meeting

    for c in body.new_commitments:
        description = c.description.strip()
        if not description:
            continue
        supabase.table("commitments").insert({
            "owner_id": user_id,
            "direct_report_id": body.direct_report_id,
            "committed_by": c.committed_by if c.committed_by in ("manager", "direct_report") else "manager",
            "source_type": "one_on_one",
            "source_id": meeting["id"],
            "description": description,
            "due_date": c.due_date or None,
            "status": "open",
        }).execute()

    carry_forward_items = _clean_follow_up_items(body.carry_forward_items)
    next_session = None
    series = None
    if source_session and source_session.get("series_id"):
        rows = (
            supabase.table("one_on_one_series")
            .select("id,interval_weeks,timezone,active,anchor_at")
            .eq("id", source_session["series_id"])
            .eq("manager_id", user_id)
            .eq("active", True)
            .limit(1)
            .execute()
            .data
        )
        series = rows[0] if rows else None

    if series:
        current_at = source_session.get("scheduled_at") or series["anchor_at"]
        next_at = _next_occurrence_at(current_at, series["interval_weeks"])
        open_rows = (
            supabase.table("one_on_ones")
            .select("*")
            .eq("manager_id", user_id)
            .eq("direct_report_id", body.direct_report_id)
            .eq("series_id", series["id"])
            .is_("summary", "null")
            .limit(1)
            .execute()
            .data
        )
        if open_rows:
            merged = _clean_follow_up_items(
                [*(open_rows[0].get("carry_forward_items") or []), *carry_forward_items]
            )
            next_session = (
                supabase.table("one_on_ones")
                .update({"scheduled_at": next_at, "carry_forward_items": merged})
                .eq("id", open_rows[0]["id"])
                .eq("manager_id", user_id)
                .execute()
                .data[0]
            )
        else:
            next_session = (
                supabase.table("one_on_ones")
                .insert({
                    "manager_id": user_id,
                    "direct_report_id": body.direct_report_id,
                    "series_id": series["id"],
                    "scheduled_at": next_at,
                    "carry_forward_items": carry_forward_items,
                })
                .execute()
                .data[0]
            )
        next_session["one_on_one_series"] = series
        next_session = _serialize_session(next_session)
    elif carry_forward_items:
        # An ad-hoc/non-recurring call still carries confirmed follow-ups into
        # the existing capture inbox so they seed the next prep.
        for item in carry_forward_items:
            supabase.table("dr_capture_notes").insert({
                "manager_id": user_id,
                "direct_report_id": body.direct_report_id,
                "content": item,
            }).execute()

    return {"meeting": _serialize_session(meeting), "next_session": next_session}


@router.get("/{direct_report_id}/history")
async def get_history(direct_report_id: str, auth=Depends(get_authenticated_client)):
    """Combined completed + scheduled/prepped occurrences for the person page."""
    user_id, supabase = auth
    result = (
        supabase.table("one_on_ones")
        .select("*,one_on_one_series(interval_weeks,timezone,active)")
        .eq("direct_report_id", direct_report_id)
        .eq("manager_id", user_id)
        .order("created_at", desc=True)
        .execute()
    )
    return [_serialize_session(row) for row in result.data]


@router.get("/session/{one_on_one_id}")
async def get_session(one_on_one_id: str, auth=Depends(get_authenticated_client)):
    """A single session by id — used to resume a planned prep sheet without
    regenerating it (frontend: prep/page.tsx?resume={id})."""
    user_id, supabase = auth
    try:
        result = (
            supabase.table("one_on_ones")
            .select("*,one_on_one_series(interval_weeks,timezone,active)")
            .eq("id", one_on_one_id)
            .eq("manager_id", user_id)
            .single()
            .execute()
        )
    except Exception:
        raise HTTPException(status_code=404, detail="Session not found")
    if not result.data:
        raise HTTPException(status_code=404, detail="Session not found")
    return _serialize_session(result.data)


@router.patch("/session/{one_on_one_id}/schedule")
async def update_session_schedule(
    one_on_one_id: str,
    body: ScheduleUpdate,
    auth=Depends(get_authenticated_client),
):
    """Edit the date/repeat rule for an unfinished occurrence."""
    user_id, supabase = auth
    rows = (
        supabase.table("one_on_ones")
        .select("*,one_on_one_series(interval_weeks,timezone,active)")
        .eq("id", one_on_one_id)
        .eq("manager_id", user_id)
        .is_("summary", "null")
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Open 1:1 session not found")
    session = rows[0]
    scheduled_at = _normalize_scheduled_at(body.scheduled_at)
    saved = _upsert_series_for_session(
        supabase,
        user_id,
        session["direct_report_id"],
        session,
        scheduled_at,
        body.recurrence_weeks,
        body.timezone,
    )
    saved["one_on_one_series"] = {
        "interval_weeks": body.recurrence_weeks,
        "timezone": body.timezone,
        "active": body.recurrence_weeks is not None,
    }
    return _serialize_session(saved)


@router.delete("/session/{one_on_one_id}")
async def dismiss_session(one_on_one_id: str, auth=Depends(get_authenticated_client)):
    """Dismiss an unfinished occurrence and stop its series, if attached.
    Completed history is never deletable through this route."""
    user_id, supabase = auth
    try:
        result = (
            supabase.table("one_on_ones")
            .select("id,summary,series_id")
            .eq("id", one_on_one_id)
            .eq("manager_id", user_id)
            .single()
            .execute()
        )
    except Exception:
        raise HTTPException(status_code=404, detail="Session not found")
    if not result.data:
        raise HTTPException(status_code=404, detail="Session not found")
    if result.data.get("summary"):
        raise HTTPException(status_code=400, detail="Cannot dismiss a completed 1:1")

    if result.data.get("series_id"):
        supabase.table("one_on_one_series").update({"active": False}).eq("id", result.data["series_id"]).eq("manager_id", user_id).execute()
    supabase.table("one_on_ones").delete().eq("id", one_on_one_id).eq("manager_id", user_id).execute()
    return {"deleted": True}


# ---------------------------------------------------------------------------
# Capture notes (Session 50, 2026-08-21) — the Person Page cockpit's
# between-sessions capture box. A quick-jot inbox, independent of whether a
# planned session exists for this report yet: /prep's frontend (prep/
# page.tsx) prefills step 1's raw-notes box from whatever's unconsumed here,
# then deletes those rows once a sheet is generated (their content is folded
# into that sheet at that point — see database/migrations/
# 2026-08-21_dr_capture_notes.sql for why this isn't a column on one_on_ones
# instead).
# ---------------------------------------------------------------------------

class CaptureNoteIn(BaseModel):
    content: str


@router.get("/{direct_report_id}/captures")
async def list_captures(direct_report_id: str, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    rows = (
        supabase.table("dr_capture_notes")
        .select("id,direct_report_id,content,created_at")
        .eq("manager_id", user_id)
        .eq("direct_report_id", direct_report_id)
        .order("created_at", desc=True)
        .execute()
        .data
    )
    return rows


@router.post("/{direct_report_id}/captures")
async def create_capture(direct_report_id: str, body: CaptureNoteIn, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    content = body.content.strip()
    if not content:
        raise HTTPException(status_code=422, detail="Capture note can't be empty")
    saved = (
        supabase.table("dr_capture_notes")
        .insert({"manager_id": user_id, "direct_report_id": direct_report_id, "content": content})
        .execute()
        .data[0]
    )
    return saved


@router.delete("/captures/{capture_id}")
async def delete_capture(capture_id: str, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    supabase.table("dr_capture_notes").delete().eq("id", capture_id).eq("manager_id", user_id).execute()
    return {"deleted": True}
