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

Status is derived, not stored: an undated unfinished next workspace is
"gathering", scheduled_at-only is "scheduled", prep_guide without summary is
"planned", and summary is "completed". Every logged call creates the next
occurrence; a recurring series supplies its next date while an ad-hoc loop leaves
the workspace undated.

scheduled_at is THE MEETING DATE, not just a plan. Both log paths send a
manager-confirmed `meeting_date` and it lands there, which is what makes
logging a conversation from last week file it under last week. Status still
derives from summary alone, so a past date never makes a row look upcoming.
Never read created_at as a meeting date -- utils.meeting_date_of() is the
one resolver, and this module's own history/overview/prep readers all go
through it.

Context Engine integration (Session IV, 2026-08-12): /prep is the pilot call
site for backend/context_engine.py's retrieval helper — see that module's
docstring for the two-tier design. Wiring the other generate_text() call
sites in this app (wrapup, assessments, dashboard insights) is future work,
not done this session.

Capture notes (Session 50, 2026-08-21): a small between-sessions source
(dr_capture_notes) assembled into the next workspace before /prep synthesis,
not a status on this table — see the "Capture notes" section near the bottom.
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
    meeting_date_of,
    meeting_day_of,
    meeting_sort_key,
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
    # The next-meeting workspace assembles these sources before synthesis.
    # The manager may remove an item in that review without deleting the
    # underlying commitment or historical record.
    carry_forward_items: list[str] | None = None
    suggested_topics: list[str] = Field(default_factory=list)
    excluded_commitment_ids: list[str] = Field(default_factory=list)


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
    # Set when this meeting was opened from its workspace. When omitted, the
    # backend still completes this person's current unfinished occurrence if
    # one exists; every logged 1:1 leaves exactly one next workspace behind.
    one_on_one_id: str | None = None
    # The day the conversation actually happened, confirmed by the manager on
    # the review screen. A plain YYYY-MM-DD is encoded at noon UTC onto
    # scheduled_at, which IS the meeting date. Omitted leaves whatever date
    # the occurrence already carried, so an older client keeps working.
    meeting_date: str | None = None
    # "This was a different conversation from the one I have prep saved for."
    # Set by the Log a 1:1 page when the manager picks that option, and the
    # only way to log without consuming the open workspace. Ignored when
    # one_on_one_id names a specific occurrence.
    separate_occurrence: bool = False


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
    suggested_topics: list[str] | None = None,
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

    suggested_topics_block = ""
    if suggested_topics:
        items = "\n".join(f"  • {item}" for item in suggested_topics)
        suggested_topics_block = f"""
CURRENT SIGNALS SELECTED FOR THIS 1:1:
{items}
These were assembled from the person's current record and kept by the manager during review. Use them as possible agenda inputs, not as facts beyond what each line states.
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
{carry_forward_block}{suggested_topics_block}{_format_expectations_block(report_name, role_expectations)}{context_engine_block}
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
# gathering: no date or prep yet; sources accumulate on the next occurrence
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
    elif not row.get("scheduled_at"):
        status = "gathering"
    else:
        status = "scheduled"
    return {
        **row,
        "status": status,
        # One canonical date for the frontend, so no surface has to decide
        # between scheduled_at and created_at for itself again.
        "meeting_date": meeting_date_of(row),
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


def _encode_meeting_date(value: str | None) -> str | None:
    """A YYYY-MM-DD from a date input, encoded at noon UTC.

    Same encoding team.py uses, and the same reason: the manager schedules
    and logs a calendar day, not a clock time, and noon keeps that day stable
    in every timezone the app is used in. An ISO timestamp is accepted and
    passed through so a caller that already has one does not have to
    downgrade it.
    """
    if not value:
        return None
    try:
        if len(value) == 10:
            parsed = datetime.fromisoformat(value).replace(
                hour=12, minute=0, second=0, microsecond=0, tzinfo=timezone.utc
            )
        else:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
    except (ValueError, AttributeError):
        raise HTTPException(status_code=422, detail="meeting_date must be a date or ISO timestamp")
    return parsed.astimezone(timezone.utc).isoformat()


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
            "carry_forward_items,created_at,logged_at,one_on_one_series(interval_weeks,timezone,active)"
        )
        .eq("manager_id", user_id)
        .execute()
        .data
    )
    # Newest MEETING first, not newest row. Ordering by created_at used to put
    # a conversation logged today but held last month ahead of one held this
    # week, so "the latest completed 1:1" could name the wrong meeting and the
    # due badge below inherited its date.
    sessions.sort(key=meeting_sort_key, reverse=True)

    planned_by_report: dict[str, dict] = {}
    completed_by_report: dict[str, dict] = {}
    for row in sessions:
        rid = row["direct_report_id"]
        if row.get("summary"):
            completed_by_report.setdefault(rid, row)
        else:
            # Every completed conversation leaves one unfinished next-meeting
            # workspace, even when it is still undated and has no carry-forward
            # topics. It remains the single place where later context gathers.
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
        last_at = meeting_date_of(completed)
        last_day = meeting_day_of(completed)
        days_since_last = (today - last_day).days if last_day else None

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
                    "date": meeting_date_of(completed),
                    "commitment_count": commitment_counts.get(completed["id"], 0),
                }
                if completed
                else None
            ),
        })
    return result


@router.get("/open/{direct_report_id}")
async def get_open_session(direct_report_id: str, auth=Depends(get_authenticated_client)):
    """Return the report's current gathering/scheduled/prepared occurrence."""
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
    carry_forward_items = _clean_follow_up_items(
        body.carry_forward_items
        if "carry_forward_items" in fields_set and body.carry_forward_items is not None
        else (existing or {}).get("carry_forward_items") or []
    )
    suggested_topics = _clean_follow_up_items(body.suggested_topics)
    excluded_commitment_ids = set(body.excluded_commitment_ids[:100])

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
        .select("id,description,due_date,committed_by")
        .eq("direct_report_id", body.direct_report_id)
        .eq("status", "open")
        .execute()
        .data
    )
    open_commitments = [
        commitment
        for commitment in open_commitments
        if commitment.get("id") not in excluded_commitment_ids
    ]

    # Fetch recent 1:1 history. Over-fetch and filter to COMPLETED meetings
    # only (summary set) — a "planned" row (prep_guide only, meeting hasn't
    # happened yet) must not count as the last 1:1, or the recency logic and
    # /api/one-on-ones/overview's is_due badge would both go stale the
    # moment a prep sheet is generated. See resolve_cadence_days() in
    # utils.py: every cadence-aware call site shares that one resolver.
    history_rows_raw = (
        supabase.table("one_on_ones")
        .select("summary,scheduled_at,created_at")
        .eq("direct_report_id", body.direct_report_id)
        .eq("manager_id", user_id)
        .order("created_at", desc=True)
        .limit(10)
        .execute()
        .data
    )
    # Sorted by when the conversations HAPPENED before taking the most recent
    # three, so the summaries reach the prompt in the order they were lived.
    history_rows_raw.sort(key=meeting_sort_key, reverse=True)
    history_rows = [row for row in history_rows_raw if row.get("summary")][:3]

    # Days since the last 1:1 actually happened. Reading created_at here made
    # the sheet open with a recency claim about row creation: log a meeting
    # held last week into a workspace opened a month ago and the next prep
    # announced a month-long gap that never existed.
    last_day = meeting_day_of(history_rows[0]) if history_rows else None
    days_since_last = (date.today() - last_day).days if last_day else None

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
        suggested_topics=suggested_topics,
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
        # Preserve the manager-reviewed source notes so "Edit prep" can
        # reopen the workspace without losing what produced this agenda.
        "source_notes": body.raw_notes,
    }
    if existing:
        saved = (
            supabase.table("one_on_ones")
            .update({"prep_guide": prep_guide, "carry_forward_items": carry_forward_items})
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
                "carry_forward_items": carry_forward_items,
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
    # The day the conversation happened, as confirmed on the review screen.
    # None means "leave whatever date this occurrence already carried".
    meeting_at = _encode_meeting_date(body.meeting_date)
    logged_at = datetime.now(timezone.utc).isoformat()
    source_session = None
    # True only when this log completed the person's existing next-meeting
    # workspace. A separate ad-hoc occurrence leaves that workspace alone,
    # and must not inherit or overwrite its series and date below.
    completed_workspace = False

    if body.one_on_one_id:
        # This meeting already has a workspace — complete that occurrence
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
        completed_workspace = True
    elif not body.separate_occurrence:
        # "Log a 1:1" still completes the current next-meeting workspace.
        # Without this, an ad-hoc log would leave the old workspace stranded
        # and create a second source of truth for the same conversation.
        #
        # Unless that workspace has a prep sheet on it. Then the manager has
        # already done work against a specific upcoming conversation, and
        # quietly marking it completed with unrelated notes destroys the prep
        # and files the meeting under the wrong date. The Log a 1:1 page asks
        # which conversation this was and answers explicitly — one_on_one_id
        # for "the one I prepped", separate_occurrence for "a different one".
        # This branch only sees a caller that could not ask, so it takes the
        # non-destructive half of that choice.
        candidate = _find_open_session(supabase, user_id, body.direct_report_id)
        if candidate and not candidate.get("prep_guide"):
            source_session = candidate
            completed_workspace = True

    if source_session:
        updates = {
            "summary": body.summary,
            "notes": body.notes,
            "logged_at": logged_at,
        }
        if meeting_at:
            updates["scheduled_at"] = meeting_at
        result = (
            supabase.table("one_on_ones")
            .update(updates)
            .eq("id", source_session["id"])
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
                # Its own occurrence, deliberately not on the series: an
                # ad-hoc conversation is not one of the recurring slots.
                "scheduled_at": meeting_at,
                "logged_at": logged_at,
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
    if completed_workspace and source_session.get("series_id"):
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
        # Roll forward from the date the manager confirmed, not the date the
        # occurrence was originally planned for and not when they got round to
        # logging it. _next_occurrence_at() skips occurrences already in the
        # past, so backfilling a meeting from last week still lands the next
        # one in the future instead of creating a stale shell.
        current_at = meeting_at or source_session.get("scheduled_at") or series["anchor_at"]
        next_at = _next_occurrence_at(current_at, series["interval_weeks"])
    else:
        next_at = None

    # One unfinished occurrence is the persistent workspace for the next
    # conversation. A recurring series gives it a date; an ad-hoc cadence
    # leaves it undated but still real, so carry-forwards no longer masquerade
    # as manually captured notes.
    open_rows_query = (
        supabase.table("one_on_ones")
        .select("*")
        .eq("manager_id", user_id)
        .eq("direct_report_id", body.direct_report_id)
        .is_("summary", "null")
    )
    open_rows = open_rows_query.limit(1).execute().data
    if open_rows:
        merged = _clean_follow_up_items(
            [*(open_rows[0].get("carry_forward_items") or []), *carry_forward_items]
        )
        workspace_updates: dict = {"carry_forward_items": merged}
        if completed_workspace:
            # This log consumed the person's next-meeting slot, so the row we
            # are about to touch is its replacement and inherits the series
            # and the rolled-forward date.
            workspace_updates["series_id"] = series["id"] if series else None
            workspace_updates["scheduled_at"] = next_at
        # Otherwise the open row is an untouched workspace that already has
        # its own schedule — very likely the prepped occurrence this ad-hoc
        # conversation was deliberately logged apart from. It collects the
        # carry-forwards and keeps its series and date.
        next_session = (
            supabase.table("one_on_ones")
            .update(workspace_updates)
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
                "series_id": series["id"] if series else None,
                "scheduled_at": next_at,
                "carry_forward_items": carry_forward_items,
            })
            .execute()
            .data[0]
        )
    next_session["one_on_one_series"] = series or {}
    next_session = _serialize_session(next_session)

    return {"meeting": _serialize_session(meeting), "next_session": next_session}


@router.get("/{direct_report_id}/history")
async def get_history(direct_report_id: str, auth=Depends(get_authenticated_client)):
    """Combined completed and unfinished occurrences for the person page."""
    user_id, supabase = auth
    result = (
        supabase.table("one_on_ones")
        .select("*,one_on_one_series(interval_weeks,timezone,active)")
        .eq("direct_report_id", direct_report_id)
        .eq("manager_id", user_id)
        .execute()
    )
    # The list renders the meeting date, so it sorts by the meeting date.
    # Ordering by created_at while displaying something else is what buried a
    # freshly logged conversation halfway down the person's history.
    rows = sorted(result.data, key=meeting_sort_key, reverse=True)
    return [_serialize_session(row) for row in rows]


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
