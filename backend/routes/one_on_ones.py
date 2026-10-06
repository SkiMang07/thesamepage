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
import logging
import json
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

import analytics
import context_engine
from ai_core import CachedPrompt, generate_text
from config import AI_DEFAULT_MODEL_HEAVY
from prep_guard import GuardContext, commitment_ref, expectation_ref, guard_item, manager_owed_refs, normalize_refs, unsupported_words
from routes.beyond import fetch_secondhand_notes
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

logger = logging.getLogger(__name__)

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
    # The opener kept at the last wrap-up. Omitted keeps whatever the
    # occurrence carries; "" or null clears it (removed in source review).
    opening_line: str | None = None


class HeldLine(BaseModel):
    line: str
    reason: str
    label: str


class ExpectationUsed(BaseModel):
    ref: str
    line: str


class UnsupportedClaim(BaseModel):
    field: str
    words: list[str]


class AgendaItem(BaseModel):
    title: str
    rationale: str
    suggested_questions: list[str]
    # prep_guard.py: the manager's words this item came from; report-facing
    # lines held for the manager's decision; escalation words the record
    # never used; who may read the item ("manager" until the employee view).
    from_your_notes: str = ""
    held: list[HeldLine] = Field(default_factory=list)
    unsupported: list[UnsupportedClaim] = Field(default_factory=list)
    audience: str = "manager"
    # Prompt refs of the open commitments this item covers (prep_guard).
    commitment_refs: list[str] = Field(default_factory=list)
    # The role expectations this item drew on, resolved to the approved lines
    # (prep_guard). Manager-facing.
    expectation_refs: list[str] = Field(default_factory=list)
    expectations_used: list[ExpectationUsed] = Field(default_factory=list)


class PrepResponse(BaseModel):
    id: str  # the one_on_ones row this prep sheet was saved to (planned session)
    situation_summary: str
    agenda_items: list[AgendaItem]
    open_commitments_to_check: list[dict]
    scheduled_at: str | None = None
    recurrence_weeks: int | None = None
    carry_forward_items: list[str] = Field(default_factory=list)
    opening_line: str | None = None
    prepared_by: str = "manager"
    prepared_at: str | None = None
    drew_on: list[str] | None = None
    built_without: list[str] | None = None
    summary_unsupported: list[str] = Field(default_factory=list)


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
    # The opener for the next 1:1, drafted at wrap-up and kept (possibly
    # edited) by the manager. Saved onto the next occurrence; empty keeps
    # nothing and leaves an existing one alone.
    opening_line: str | None = None


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
    # One sentence the manager could open the next 1:1 with. "" = nothing
    # left open that warrants one.
    opening_line: str = ""


class ScheduleUpdate(BaseModel):
    scheduled_at: str | None = None
    recurrence_weeks: int | None = None
    timezone: str = "UTC"


# ---------------------------------------------------------------------------
# Prompt builder — this is the core product IP
# ---------------------------------------------------------------------------

_EXPECTATION_KINDS = (("metrics", "metric_name"), ("skills", "skill_name"), ("values", "value_name"))


def numbered_expectations(expectations: dict | None) -> list[tuple[str, str, dict]]:
    """(ref, kind, row) for every configured expectation, in the order the
    prompt shows them: metrics, then skills, then values. The refs ("E1"...)
    are what an agenda item's expectation_refs point at."""
    rows = [
        (kind, row)
        for kind, _name_col in _EXPECTATION_KINDS
        for row in (expectations or {}).get(kind) or []
    ]
    return [(expectation_ref(i), kind, row) for i, (kind, row) in enumerate(rows)]


def expectation_line(kind: str, row: dict) -> str:
    """The plain line the sheet shows for one expectation: what the manager
    approved, with the target when one is set."""
    name_col = dict(_EXPECTATION_KINDS)[kind]
    line = str(row.get("expectation") or row.get(name_col) or "").strip()
    if kind == "metrics" and row.get("target_status") == "set" and row.get("target"):
        line += f" (target: {row['target']})"
    return line


def expectation_lines(expectations: dict | None) -> dict[str, str]:
    """{"E1": line, ...}: what prep_guard resolves expectation_refs against."""
    return {
        ref: line
        for ref, kind, row in numbered_expectations(expectations)
        if (line := expectation_line(kind, row))
    }


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

    numbered = numbered_expectations(expectations)

    def _items(kind: str, name_col: str) -> str:
        rows = [(ref, r) for ref, k, r in numbered if k == kind]
        if not rows:
            return ""
        lines = []
        for ref, r in rows:
            parts = [r[name_col]]
            if r.get("expectation"):
                parts.append(f"expectation: {r['expectation']}")
            if r.get("description"):
                parts.append(r["description"])
            if kind == "metrics" and r.get("measurement_period") and r["measurement_period"] != "none":
                parts.append(f"measured per {r['measurement_period']}")
            if kind == "metrics" and r.get("target_status") == "set" and r.get("target"):
                parts.append(f"target: {r['target']}")
            elif kind == "metrics" and r.get("target_status") == "unresolved":
                # Deliberately unset (Roles & expectations): never assume one.
                parts.append("no target set yet — do not assume or suggest a number")
            if r.get("exceeds"):
                parts.append(f"exceeds: {r['exceeds']}")
            lines.append(f"    • {ref} " + " — ".join(parts))
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
When the manager's notes or history touch performance, feedback, growth, level, reviews, or career direction, ground your questions and any SBI phrasing in these specific expectations — name the relevant metric, skill, or value explicitly. Do NOT audit every expectation in one 1:1; pull in only the ones the notes make relevant. If nothing in the notes connects to them, leave them out entirely.
These expectations are the standard the manager approved for this role. When the manager's notes say they are unsure what good looks like, what the bar is, or what to expect at this person's level, answer the manager with these lines in the rationale; do not ask {report_name} to define the standard (rule 4).
List the E-number of every expectation an item draws on in that item's "expectation_refs"; the manager sees those lines under the item as what the item was measured against. Tag an expectation only when the item is about that standard (how the person is doing against it, or what it asks of them), not because the topic touches the same work. Logistics, scheduling, time off and handoffs draw on none. Most items draw on none.
"""


_FIRST_ONE_ON_ONE_PREFIX = """You are a management coach helping a manager prepare the first 1:1 they have recorded with one of their direct reports. The report's name and everything known about the relationship follow in the material below. Nothing else is on record: no earlier 1:1s, commitments, notes or history.

Do not invent history, problems, performance signals or facts about this person. Do not guess at what is going on with them. The agenda is a set of questions that lets the two of them start the record.

---
COVER THESE, in this order, one agenda item each:

1. HOW THEY LIKE TO WORK AND COMMUNICATE
   How they prefer to get feedback, how they like to be updated, what a good week looks like for them.
2. WHAT THEY'RE WORKING ON AND WHERE THEY'RE STUCK
   What is on their plate now, what is going well, where they are blocked or waiting on someone. Use open questions; use GROW-style follow-ups ("What outcome were you going for? What have you tried?") only as follow-ups, not as an assumption that something is wrong.
3. WHAT THEY WANT FROM THE ROLE
   What they want to be doing more of, what they want to learn, where they want to be in a year.
4. HOW THE TWO OF YOU WILL RUN THESE 1:1s
   How often, how long, whose agenda it is, what goes in it, and how they'd like to raise something between meetings.
5. CLOSING QUESTION (always last)
   Always include one final agenda item: a closing check-in. Use a variation of:
   "Is there anything on your mind that we haven't covered?" or
   "What's one thing I could do to make your work easier this week?"
   This is non-negotiable — it is the most important question in any 1:1.

If role expectations or company context appear in the material below, you may use them in items 2 and 3, and list the E-number of each expectation an item draws on in its "expectation_refs". Do not assume anything they don't state.

---
Return ONLY valid JSON. No commentary, no markdown, no code fences.

{
  "situation_summary": "One or two plain sentences. State that this is the first recorded 1:1 with this person and that nothing else is on record. Do not guess, infer or add anything about the person.",
  "agenda_items": [
    {
      "title": "Short label for this item (5 words or fewer)",
      "rationale": "One sentence on why this item belongs in a first 1:1. Do not refer to anything on record; nothing is.",
      "expectation_refs": ["The E-number of each role expectation this item draws on, e.g. \"E2\"; [] if none"],
      "suggested_questions": ["Question 1", "Question 2"]
    }
  ]
}

Generate exactly 5 agenda items, in the order above, ending with the closing check-in."""


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
    secondhand_notes: list[dict] | None = None,
    opening_line: str | None = None,
) -> str:
    # --- Recency context ---
    if days_since_last is None:
        # An empty record is the app's gap, not the relationship's. The manager
        # may have met this person every week; nothing has been entered here.
        recency_note = (
            "No 1:1 with this person has been entered in this app yet. That says nothing about "
            "whether the two of them have met before, how often, or how well it has gone. "
            "Never say or imply that 1:1s have not been happening, have been inconsistent, or "
            "need a reset or restart unless the manager's own notes say so. Do not call this "
            "\"the first logged 1:1\" or \"the first real conversation\" in the output. "
            "Use only what the manager's notes and the record below state about the relationship."
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
        history_block = "  (No 1:1 notes have been entered in this app. This does not mean none happened.)"

    # --- Open commitments (either side can owe one — committed_by) ---
    def _owner_label(c: dict) -> str:
        return report_name if c.get("committed_by") == "direct_report" else "manager"

    if open_commitments:
        commitments_block = "\n".join(
            f"  • {commitment_ref(i)} [{_owner_label(c)} owes] {c['description']} (due: {c.get('due_date') or 'unspecified'})"
            for i, c in enumerate(open_commitments)
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

    opening_block = ""
    if opening_line:
        opening_block = f"""
SUGGESTED OPENING LINE (drafted at the last wrap-up and kept by the manager):
  "{opening_line}"
Unless newer context above clearly resolves it, make this the first suggested question of the first agenda item. The manager kept it, so use it as written.
"""

    suggested_topics_block = ""
    if suggested_topics:
        items = "\n".join(f"  • {item}" for item in suggested_topics)
        suggested_topics_block = f"""
CURRENT SIGNALS SELECTED FOR THIS 1:1:
{items}
These were assembled from the person's current record and kept by the manager during review. Use them as possible agenda inputs, not as facts beyond what each line states.
"""

    # Beyond the team: things other people said about this report in meetings
    # outside the team. Secondhand and private to the manager — the report
    # wasn't in the room, so it shapes what to ask, never what to assert.
    secondhand_block = ""
    if secondhand_notes:
        def _source(n: dict) -> str:
            parts = [n.get("meeting_date"), n.get("meeting_title")]
            label = ", ".join(p for p in parts if p) or "a meeting"
            if n.get("people"):
                label += f" (with {', '.join(n['people'])})"
            return label
        items = "\n".join(f"  • {_source(n)}: {n['note']}" for n in secondhand_notes)
        secondhand_block = f"""
SECONDHAND — SAID ABOUT {report_name.upper()} IN MEETINGS OUTSIDE THE TEAM (private to the manager; {report_name} was not there):
{items}
Treat each line as someone else's account, not established fact. Use it to decide what to ask about and let {report_name} give their own view. Never attribute a line to the person who said it in a suggested question, and never turn it into feedback unless the manager's own notes back it up.
"""

    # A first 1:1 with nothing else on record: no history, commitments,
    # carry-forward, signals, secondhand notes, opening line or notes. The
    # grounded-in-the-record rule can't hold here, so this case gets its own
    # prefix (still name-free, so it caches like the other one).
    first_one_on_one_bare = (
        days_since_last is None
        and not recent_summaries
        and not open_commitments
        and not carry_forward_items
        and not suggested_topics
        and not secondhand_notes
        and not opening_line
        and not (raw_notes or "").strip()
    )

    # The frameworks and output schema never mention the report by name, so
    # the prefix is byte-identical for every prep call in the app and is read
    # from cache after the first one; the body carries this report's record.
    prefix = """You are a management coach helping a manager prepare for a 1:1 with one of their direct reports. The report's name and everything known about the relationship follow in the material below.

Your output must be grounded in the specific details provided. Do not give generic management advice. Every agenda item, question, and talking point must follow from something the manager actually wrote, something in recent history, or an open commitment that needs follow-up.

---
FRAMEWORKS TO APPLY — read carefully before generating output:

1. COMMITMENT REVIEW
   If any open commitments exist, the first agenda item must address them.
   For items the report owes, frame questions to create accountability without defensiveness:
   ✓ "Where did you land on X?" or "What happened with Y?"
   ✗ "Did you do X?" (accusatory) or ignoring them entirely (sends the wrong signal)
   For items the manager owes, prompt the manager to proactively give a status — modeling accountability is how the standard gets set.

2. SITUATIONAL QUESTION LOGIC — scan the manager's notes for these signals:
   - OBSTACLES / BLOCKERS → use GROW coaching questions:
       Goal: "What outcome were you going for?"
       Reality: "What's actually happening now?"
       Options: "What options do you see?" or "What could you try next?"
       Way forward: "What will you commit to by next time?"
   - PERFORMANCE CONCERNS → ask what happened and what is in the way. Write feedback phrasing only when the notes ask for feedback (rule 7).
   - POSITIVE MOMENTUM → reinforce with "What made that work?" — build repeatable behavior, not just celebrate outcomes.
   - ENGAGEMENT / MOTIVATION SIGNALS → surface with "What's energizing you right now?" and "What's feeling like a drag?"
   - CAREER / GROWTH SIGNALS (from the report: something they said, asked for or want) → ask "What would make this role feel like it's moving in the right direction for you?" The manager's own uncertainty about this person's level, bar or what good looks like is not a signal from the report, and neither is a review cycle coming up; both are the manager's context (rule 4).

3. AGENDA PRIORITY
   Order items by urgency. If there are commitments to review AND an urgent issue, open with commitments (quick check, 1–2 mins each) and then pivot to the urgent topic. Do not bury time-sensitive items at the end.

4. RESTATE BY DEFAULT, SCRIPT ON REQUEST
   Every agenda item carries "from_your_notes": what the manager wrote that the item comes from, in their words (a short quote or a close restatement, with their hedge). It is read by the manager only. Leave it "" when the item comes only from the record (a commitment, history).
   "suggested_questions" are questions the report can answer. They are not statements of what the manager thinks, has decided, or has been told.
   The one standing exception: on a commitment the manager owes the report, always give one plain line for the manager to give its status in their own terms ("I owe you the design doc feedback. It's not done yet; here's when you'll have it."). Never leave such an item without a line, and list the commitment's C-number in the item's "commitment_refs". Framework 1 asks for exactly this.
   Otherwise, write a line that TELLS the report something only when the notes say the manager intends to tell them ("need to tell him", "want to let her know", "have to give him feedback") or ask for help saying it ("how do I say", "help me word"). Then write one plain sentence in the manager's own wording, with no preamble ("I want you to know", "I want to be transparent"). Never decide for the manager that something should be shared, and never coach them toward telling ("he should hear it from you").
   Context about HR, the manager's boss or leadership, other people on the team, a decision that isn't made (promotion, pay, a performance plan, a reorg, someone's job), a guess about the person's life outside work, and the manager's own doubts is the manager's own context. Restate it in "from_your_notes" or the summary, in their words. Do not turn it into a suggested question, and do not make it the reason to raise something with the report ("HR wants documentation, so this needs a clear conversation now", "you noted uncertainty about what good looks like, so it's worth surfacing with him directly"). The manager decides what to do with it.
   When the manager's doubt is about what good looks like for this person and ROLE EXPECTATIONS appear below, the doubt is answered for the manager, not handed to the report: in the rationale, name the specific expectations that set the bar in plain words and list their E-numbers in "expectation_refs". If the notes say this person's level is different from the standard (junior, senior), say plainly that the approved expectations are one standard for the role. Do not ask the report what good looks like.

5. CLOSING QUESTION
   Always include one final agenda item: a closing check-in. Use a variation of:
   "Is there anything on your mind that we haven't covered?" or
   "What's one thing I could do to make your work easier this week?"
   This is non-negotiable — it is the most important question in any 1:1.

6. WHOSE LINE IS IT
   The manager's notes mix things about the report with things about the manager's own situation: their time, calendar, workload, habits, or how they feel about the meeting (for example, that this 1:1 keeps getting squeezed). A line about the manager's own situation is not a question for the report. Do not turn it into a suggested question, agenda item or rationale aimed at the report. Use it only when the manager clearly needs to tell the report something; otherwise leave it out.

7. NEVER READ THE PERSON
   Restate what the manager wrote; do not characterize the person. Never name a state of mind, motive or cause the notes do not state: no "disengaged", "overloaded", "burned out", "checked out", "struggling", "lacks confidence", "showing signs of". Report the facts and leave the reading to the manager ("missed two QBRs and two health scores are yellow", not "showing signs of disengagement or overload"). What the notes state plainly, state plainly; do not add "may", "seems" or "appears" to it. Hedge only what the notes themselves hedge, and keep their hedge in their words ("not sure if it's capacity"). A possible cause belongs in a question the report can answer ("What's getting in the way of the QBRs?"), never in the summary or a rationale as a finding.
   Keep the hedge and add no outcome. If the notes say someone "may have" said or done something, the output says "may have", not "told her" or "decided". Never add a result the notes do not state ("hasn't followed up", "never resulted in anything", "wasn't resolved").
   Questions never imply fault or effort: no "What haven't you tried?", "Why haven't you...?", "Didn't you...?". Ask what happened and what is in the way. This matters most when the person used to be the manager's peer.
   Never give the manager a motive or purpose the notes do not state. In particular, never frame an item as building a record, a paper trail, documentation or a case ("part of building the record", "this is the first time it's being put in writing") unless the notes say that is the purpose. A note that something is missing or was not written down is a fact to restate, not a goal to pursue.
   Never weigh what the person said against the record ("'I'm fine' doesn't give much to go on given the numbers") and never ask in a way that doubts their answer ("What's actually going on?", "What's really happening?"). If the notes record what they said, restate it and ask an open question.
   Open causes stay open. If the notes list a cause as undecided ("not sure if it's capacity or something else"), do not introduce it, lean on it or build a question or rationale around it, and do not reach for its near-synonyms (bandwidth, workload, scheduling). Echo the uncertainty in their words or leave it out. Ask what happened and what is in the way, with no cause named.
   When the notes say what the manager did or did not do, keep their words. "I never asked what was said" is "you never asked what was said", not "you haven't followed up on it". Do not compress it into a shorter phrase that sounds like a lapse.
   Never cite the role expectations as a rule: no "per the role expectations", "according to the expectations", "as the role requires". Say the plain thing ("QBRs are Cormac's to run") and list the expectation's E-number in "expectation_refs"; the manager sees the approved line under the item.
   Stay true to what the manager wrote. If the notes mention what HR, their boss or another team wants or may do, restate it in their words with their hedge ("HR wants documentation", "worried HR will ask"). Never turn it into a fact they did not state ("HR has flagged this", "this is now a documented pattern", "HR asked for documentation"), and do not drop it either: the manager decides what goes on the sheet.
   Do not reach for the SBI template (Situation / Behavior / Impact) or any HR-style documentation phrasing unless the manager's notes ask for feedback or a conversation about performance; even then, write one plain suggested sentence in the manager's own wording, and never a labelled script.
   The sheet is read by the manager. Write to them as "you" ("you noted she seemed flat", "you haven't asked yet"), and never call them "the manager".

---
Return ONLY valid JSON. No commentary, no markdown, no code fences.

{
  "situation_summary": "2–3 sentences: where things stand with this person based on history and current notes. Name any patterns, risks, or positive momentum worth calling out explicitly, in terms of what the record shows (rule 7), not what you infer about the person.",
  "agenda_items": [
    {
      "title": "Short label for this item (5 words or fewer)",
      "rationale": "Why this item matters right now — one sentence, grounded in the notes or history",
      "from_your_notes": "What the manager wrote that this item comes from, in their words, or \"\" (rule 4)",
      "commitment_refs": ["The C-number of each open commitment this item covers, e.g. \"C1\"; [] if none"],
      "expectation_refs": ["The E-number of each role expectation this item draws on, e.g. \"E2\"; [] if none"],
      "suggested_questions": ["Question the report can answer", "Another"]
    }
  ]
}

Generate 3–5 agenda items total (including the commitment review if applicable and always the closing). Quality over quantity."""

    if first_one_on_one_bare:
        prefix = _FIRST_ONE_ON_ONE_PREFIX

    body = f"""THIS 1:1 IS WITH {report_name}.

---
RELATIONSHIP CONTEXT
{recency_note}

RECENT 1:1 HISTORY (last 2–3 meetings, newest first):
{history_block}

OPEN COMMITMENTS (unresolved — each is marked with who owes it):
{commitments_block}
{carry_forward_block}{opening_block}{suggested_topics_block}{secondhand_block}{_format_expectations_block(report_name, role_expectations)}{context_engine_block}
MANAGER'S NOTES ON WHAT'S HAPPENING RIGHT NOW:
{raw_notes or '(No additional notes were added.)'}

---
Apply the frameworks and return the JSON described above."""
    return CachedPrompt(prefix, body)


def _build_wrapup_prompt(report_name: str, raw_notes: str, today_iso: str) -> str:
    """Distill raw in-call notes (typed live or pasted from a recorder) into a
    draft summary, commitments from BOTH sides, and possible carry-forward
    topics. The manager reviews and edits everything before it is saved."""
    prefix = """You are helping a manager log a 1:1 they just had with one of their direct reports. Distill the raw call notes into a clean, reviewable record. The manager will edit your draft before saving — be precise, not exhaustive. The report's name, today's date and the notes follow in the material below.

Produce:

1. summary — 2–4 sentences capturing what was actually discussed: decisions made, concerns raised, wins, changes in the situation. Write it so that reading it three weeks from now instantly restores context. State the substance directly — no "we discussed X" padding.

2. commitments — every explicit commitment made by either person. Rules:
   - Include only things someone actually agreed to DO. Topics discussed, open questions, and vague intentions ("we should think about...") are NOT commitments unless clearly accepted as an action.
   - committed_by: "manager" if the manager owes it, "direct_report" if the report owes it.
   - due_date: ISO date (YYYY-MM-DD) only when a deadline was stated or clearly implied — resolve relative dates from today's date. Otherwise null. Never guess a date.
   - Phrase each as one short actionable sentence starting with a verb ("Send intro to the design team").
   - Do NOT invent commitments. An empty list is a valid answer.

3. follow_up_items — unresolved topics or questions the manager may want to revisit in the next 1:1. Rules:
   - These are NOT actions someone agreed to take; those belong in commitments.
   - Include only topics clearly left open, explicitly deferred, or needing a future check-in.
   - Phrase each as a short, concrete reminder that will still make sense weeks from now.
   - Do NOT invent follow-ups. An empty list is a valid answer.

4. opening_line — one sentence the manager could say to open the NEXT 1:1, picking up the single most important thread this call left open (a commitment with a date, or a topic explicitly deferred). Rules:
   - Written as the manager would say it to the report: plain, warm, specific, ending in a question. Name the thing and, if one was stated, the date.
   - Ask where it landed; never check up on the person. No "don't forget", no "you said you'd", no "as you promised".
   - Only from what is in these notes. If nothing was left open that is worth opening with, return "". An empty string is a valid answer.

Return ONLY valid JSON. No commentary, no markdown, no code fences.

{"summary": "...", "commitments": [{"description": "...", "committed_by": "manager", "due_date": "2026-08-07"}], "follow_up_items": ["Revisit how the Acme renewal risk is changing"], "opening_line": "Last time we agreed to revisit the renewal forecast by the 3rd. Where did it land?"}"""

    body = f"""THIS 1:1 WAS WITH {report_name}.

Today's date: {today_iso} (use it to resolve relative deadlines like "by Friday" or "end of month").

RAW CALL NOTES (typed during the call, or pasted from a transcript/recording tool — may be messy, fragmentary, or verbatim):
{raw_notes}

Return the JSON described above."""
    return CachedPrompt(prefix, body)


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


def _clean_opening_line(value: str | None) -> str | None:
    """One trimmed sentence or None. Bounded like a carry-forward topic."""
    line = " ".join((value or "").split())
    return line[:300] or None


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
def get_one_on_ones_overview(auth=Depends(get_authenticated_client)):
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
def get_open_session(direct_report_id: str, auth=Depends(get_authenticated_client)):
    """Return the report's current gathering/scheduled/prepared occurrence."""
    user_id, supabase = auth
    row = _find_open_session(supabase, user_id, direct_report_id)
    return _serialize_session(row) if row else None


def _manager_has_prep_sheet(supabase, user_id: str) -> bool:
    """Whether this manager has any 1:1 with a prep sheet on it (planned or
    completed). One indexed row at most; used only for analytics."""
    rows = (
        supabase.table("one_on_ones")
        .select("id")
        .eq("manager_id", user_id)
        .not_.is_("prep_guide", "null")
        .limit(1)
        .execute()
        .data
    )
    return bool(rows)


# ---------------------------------------------------------------------------
# Prep assembly — shared by POST /prep and the overnight worker
# (backend/jobs/nightly_prep.py). One place decides what a prep prompt is
# built from, so a sheet prepared overnight reads exactly the sources the
# manager's own "Review & prepare" would have included by default.
#
# Every query here names its owner explicitly (manager_id / owner_id / org)
# even though RLS already scopes the request path: the worker runs with the
# service-role client, where these predicates are the only isolation.
# ---------------------------------------------------------------------------

PREP_MAX_TOKENS = 2000


def assemble_prep_inputs(
    supabase,
    user_id: str,
    direct_report_id: str,
    org_id: str | None,
    *,
    raw_notes: str,
    carry_forward_items: list[str],
    suggested_topics: list[str],
    excluded_commitment_ids: set[str] | None = None,
    opening_line: str | None = None,
) -> dict | None:
    """Everything a prep call needs, or None when the direct report is not
    this manager's. Returns {prompt, report_name, open_commitments,
    document_ids, document_titles, history_count, has_role_expectations,
    secondhand_count} — the counts and titles feed prep_drew_on()."""
    report_rows = (
        supabase.table("direct_reports")
        .select("name,role_level_id,org_unit_id,one_on_one_cadence_days")
        .eq("id", direct_report_id)
        .eq("manager_id", user_id)
        .limit(1)
        .execute()
        .data
    )
    if not report_rows:
        return None
    report = report_rows[0]
    # Same org.one_on_one_cadence_days -> 21 fallback resolve_cadence_days()
    # uses everywhere else.
    cadence_days, _cadence_source = resolve_cadence_days(report, get_org(user_id, supabase))

    # Open commitments — owner_id is the same predicate RLS applies.
    excluded = excluded_commitment_ids or set()
    open_commitments = [
        commitment
        for commitment in (
            supabase.table("commitments")
            .select("id,description,due_date,committed_by")
            .eq("owner_id", user_id)
            .eq("direct_report_id", direct_report_id)
            .eq("status", "open")
            .execute()
            .data
        )
        if commitment.get("id") not in excluded
    ]

    # Recent history. Over-fetch and keep COMPLETED meetings only (summary
    # set) — a planned row must not count as the last 1:1, or the recency
    # logic goes stale the moment a sheet is generated. Sorted by when the
    # conversations happened, so summaries reach the prompt in lived order.
    history_rows_raw = (
        supabase.table("one_on_ones")
        .select("summary,scheduled_at,created_at")
        .eq("direct_report_id", direct_report_id)
        .eq("manager_id", user_id)
        .order("created_at", desc=True)
        .limit(10)
        .execute()
        .data
    )
    history_rows_raw.sort(key=meeting_sort_key, reverse=True)
    history_rows = [row for row in history_rows_raw if row.get("summary")][:3]
    # Days since the last 1:1 actually happened — never created_at.
    last_day = meeting_day_of(history_rows[0]) if history_rows else None
    days_since_last = (date.today() - last_day).days if last_day else None
    recent_summaries = [row["summary"] for row in history_rows if row.get("summary")]

    # Role expectations — None when no role assigned; the prompt omits them.
    # org_id scopes the org-wide company values, which have no role to hang
    # a predicate on.
    role_expectations = fetch_role_expectations(supabase, report.get("role_level_id"), org_id=org_id)
    secondhand_notes = fetch_secondhand_notes(supabase, user_id, direct_report_id)

    # Context Engine — org docs scoped to this report's team, cascaded up
    # through department + company-wide. get_relevant_context filters the
    # documents themselves by org_id.
    retrieved_docs = (
        context_engine.get_relevant_context(supabase, org_id, report.get("org_unit_id"), date.today())
        if org_id
        else []
    )

    prompt = _build_prep_prompt(
        report_name=report["name"],
        raw_notes=raw_notes,
        open_commitments=open_commitments,
        recent_summaries=recent_summaries,
        days_since_last=days_since_last,
        cadence_days=cadence_days,
        role_expectations=role_expectations,
        context_engine_block=context_engine.format_context_block(retrieved_docs),
        carry_forward_items=carry_forward_items,
        suggested_topics=suggested_topics,
        secondhand_notes=secondhand_notes,
        opening_line=opening_line,
    )
    # prep_guard: who else is on this manager's roster, and every piece of
    # record text the model was given (not the prompt's rules, whose examples
    # name the very words the guard looks for).
    roster = (
        supabase.table("direct_reports")
        .select("id,name")
        .eq("manager_id", user_id)
        .is_("archived_at", "null")
        .execute()
        .data
    ) or []
    guard_source = "\n".join([
        raw_notes or "",
        *(carry_forward_items or []),
        opening_line or "",
        *(suggested_topics or []),
        *(str(n.get("note") or "") for n in secondhand_notes or []),
        *(str(c.get("description") or "") for c in open_commitments),
        *recent_summaries,
    ])
    return {
        "prompt": prompt,
        "guard": GuardContext(
            report_name=report["name"],
            others=[r["name"] for r in roster if r.get("id") != direct_report_id and r.get("name")],
            source=guard_source,
            manager_owed=manager_owed_refs(open_commitments),
            expectations=expectation_lines(role_expectations),
        ).to_dict(),
        "built_without": prep_built_without(
            has_team=bool(report.get("org_unit_id")),
            has_role_expectations=has_configured_expectations(role_expectations),
            goal_levels=_goal_levels(supabase, user_id),
        ),
        "report_name": report["name"],
        "open_commitments": open_commitments,
        "document_ids": [doc["id"] for doc in retrieved_docs],
        "document_titles": [str(doc.get("title") or "Untitled document") for doc in retrieved_docs],
        "history_count": len(recent_summaries),
        "has_role_expectations": has_configured_expectations(role_expectations),
        "secondhand_count": len(secondhand_notes),
    }


def _goal_levels(supabase, user_id: str) -> set[str]:
    """The levels of the manager's goals that are not cancelled. Names the owner
    explicitly: the overnight worker runs with the service-role client."""
    rows = (
        supabase.table("goals")
        .select("level")
        .eq("owner_id", user_id)
        .neq("status", "cancelled")
        .execute()
        .data
    )
    return {row["level"] for row in rows}


def has_configured_expectations(role_expectations: dict | None) -> bool:
    """True only when the person's role has expectations to draw on. A role with
    no approved metrics, skills or values comes back from fetch_role_expectations()
    as a bare role row, which is context, not expectations."""
    if not role_expectations:
        return False
    return any(role_expectations.get(kind) for kind in ("metrics", "skills", "values"))


def prep_built_without(*, has_team: bool, has_role_expectations: bool, goal_levels: set[str]) -> list[str]:
    """The plain "Built without: ..." list shown beside "Drew on": the setup
    inputs that were missing for THIS person when the sheet was built. Empty
    when nothing was missing, and then no line is shown. Shared by the manual
    POST /prep and the overnight worker, like prep_drew_on()."""
    missing: list[str] = []
    if not has_team:
        missing.append("team and org")
    if not has_role_expectations:
        missing.append("role expectations")
    if not goal_levels & {"company", "department"}:
        missing.append("org goals")
    if "team" not in goal_levels:
        missing.append("team goals")
    return missing


def _plural(n: int, one: str, many: str | None = None) -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"


def prep_drew_on(
    inputs: dict,
    *,
    opening_line: str | None = None,
    carry_forward_items: list[str] | None = None,
    has_notes: bool = False,
    kept_thoughts: int = 0,
    suggested_topics: int = 0,
    at_risk_goals: int = 0,
    development_plan: bool = False,
) -> list[str]:
    """The plain "Drew on: …" list shown under a prep sheet, built from what
    assemble_prep_inputs() actually put in the prompt. Shared by the manual
    POST /prep and the (parked) overnight worker, so the two sheets name
    their sources the same way. Knowledge documents are named by title."""
    labels: list[str] = []
    if opening_line:
        labels.append("the opening line you kept at the last wrap-up")
    if carry_forward_items:
        labels.append(_plural(len(carry_forward_items), "carried topic"))
    if inputs.get("open_commitments"):
        labels.append(_plural(len(inputs["open_commitments"]), "open commitment"))
    if kept_thoughts:
        labels.append(_plural(kept_thoughts, "kept thought"))
    elif has_notes:
        labels.append("your notes")
    if at_risk_goals:
        labels.append(_plural(at_risk_goals, "at-risk goal"))
    if development_plan:
        labels.append("the development plan")
    if suggested_topics:
        labels.append(_plural(suggested_topics, "suggested topic"))
    history = inputs.get("history_count") or 0
    if history == 1:
        labels.append("your last 1:1")
    elif history > 1:
        labels.append(f"your last {history} 1:1s")
    if inputs.get("has_role_expectations"):
        labels.append("role expectations")
    if inputs.get("secondhand_count"):
        labels.append(_plural(inputs["secondhand_count"], "note") + " from meetings beyond your team")
    titles = inputs.get("document_titles") or []
    for title in titles[:3]:
        labels.append(f"{title} (Knowledge)")
    if len(titles) > 3:
        labels.append(_plural(len(titles) - 3, "more Knowledge document"))
    return labels


def drew_on_expectations(drew_on: list[str], agenda_items: list[dict], guard: GuardContext | None) -> list[str]:
    """Sharpen the "role expectations" label once the sheet exists: "2 of 7
    role expectations" when items drew on some, and no label when none
    applied this time. Left as is when the guard has no numbered expectations
    (a job queued before they existed). Shared by /prep and the worker."""
    total = len((guard or GuardContext()).expectations)
    if not total or "role expectations" not in drew_on:
        return drew_on
    used = {u["ref"] for item in agenda_items for u in item.get("expectations_used") or []}
    if not used:
        return [label for label in drew_on if label != "role expectations"]
    label = f"{len(used)} of {_plural(total, 'role expectation')}"
    return [label if lbl == "role expectations" else lbl for lbl in drew_on]


def parse_prep_output(raw: str, guard: GuardContext | None = None) -> tuple[str, list[dict]]:
    """The model's JSON as (situation_summary, agenda_items). A reply that
    won't parse yields the retry message and an empty agenda, never an
    exception — the same fallback /prep has always shown.

    Every item goes through prep_guard.guard_item: a suggested line carrying
    the manager's own context (HR, their boss, another person, a pending
    decision, their own state...) is moved to the item's `held` list, never
    deleted; escalation words the record never used are listed in
    `unsupported`; and the item is stored manager-only (`audience`)."""
    ctx = guard or GuardContext()
    raw_clean = raw.strip()
    # The model sometimes wraps JSON in ```json...``` or adds a remark.
    start = raw_clean.find("{")
    end = raw_clean.rfind("}") + 1
    if start != -1 and end > start:
        raw_clean = raw_clean[start:end]
    try:
        parsed = json.loads(raw_clean)
    except json.JSONDecodeError:
        return "Unable to generate summary — please try again.", []
    if not isinstance(parsed, dict):
        return "Unable to generate summary — please try again.", []
    agenda = []
    for item in parsed.get("agenda_items") or []:
        if not isinstance(item, dict):
            continue
        questions = item.get("suggested_questions") or []
        agenda.append(guard_item({
            "title": str(item.get("title") or ""),
            "rationale": str(item.get("rationale") or ""),
            "from_your_notes": str(item.get("from_your_notes") or ""),
            "suggested_questions": [str(q) for q in questions if isinstance(q, (str, int, float)) and str(q).strip()],
            "commitment_refs": normalize_refs(item.get("commitment_refs")),
            "expectation_refs": item.get("expectation_refs"),
        }, ctx))
    return str(parsed.get("situation_summary") or ""), agenda


def summary_unsupported(situation_summary: str, guard: GuardContext | None) -> list[str]:
    """Escalation words in the summary that the record never used."""
    return unsupported_words(situation_summary, (guard or GuardContext()).source)


def build_prep_guide(
    situation_summary: str,
    agenda_items: list[dict],
    open_commitments: list[dict],
    *,
    source_notes: str,
    prepared_by: str,
    drew_on: list[str] | None = None,
    built_without: list[str] | None = None,
    summary_unsupported: list[str] | None = None,
) -> dict:
    """The stored prep_guide. prepared_by is 'manager' (they pressed
    Prepare) or 'overnight' (the worker prepared it ahead of the meeting);
    drew_on is prep_drew_on()'s plain list of what the sheet was built from,
    shown under the sheet so the manager can see its sources. built_without
    is prep_built_without()'s list of setup inputs that were missing for this
    person; stored only when there is something to say."""
    guide = {
        "situation_summary": situation_summary,
        "agenda_items": agenda_items,
        "open_commitments_to_check": open_commitments,
        # Preserve the source notes so "Edit prep" can reopen the workspace
        # without losing what produced this agenda.
        "source_notes": source_notes,
        "prepared_by": prepared_by,
        "prepared_at": datetime.now(timezone.utc).isoformat(),
    }
    if drew_on is not None:
        guide["drew_on"] = drew_on
    if built_without:
        guide["built_without"] = built_without
    if summary_unsupported:
        guide["summary_unsupported"] = summary_unsupported
    return guide


@router.post("/prep", response_model=PrepResponse)
@limiter.limit("10/minute")
def prep_one_on_one(
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

    org_id = ensure_org(user_id, supabase, get_email_from_token(authorization))
    opening_line = (
        _clean_opening_line(body.opening_line)
        if "opening_line" in fields_set
        else (existing or {}).get("opening_line")
    )
    inputs = assemble_prep_inputs(
        supabase,
        user_id,
        body.direct_report_id,
        org_id,
        raw_notes=body.raw_notes,
        carry_forward_items=carry_forward_items,
        suggested_topics=suggested_topics,
        excluded_commitment_ids=excluded_commitment_ids,
        opening_line=opening_line,
    )
    if inputs is None:
        raise HTTPException(status_code=404, detail="Direct report not found")

    raw = generate_text(inputs["prompt"], model=AI_DEFAULT_MODEL_HEAVY, max_tokens=PREP_MAX_TOKENS)

    # Citations: only after the call that actually used them succeeds, and
    # only for docs that were in fact embedded (not broader candidates
    # ranking dropped).
    context_engine.record_citations(
        supabase,
        user_id,
        inputs["document_ids"],
        context=f"1:1 prep for {inputs['report_name']}",
    )

    guard = GuardContext.from_dict(inputs.get("guard"))
    situation_summary, agenda_dicts = parse_prep_output(raw, guard)
    agenda_items = [AgendaItem(**item) for item in agenda_dicts]
    open_commitments = inputs["open_commitments"]

    # Persist the sheet so it survives the gap between prepping and the
    # actual meeting. The full response — not just the AI JSON — is stored
    # so a resumed session shows exactly what was generated, including the
    # open-commitments snapshot from prep time.
    prep_guide = build_prep_guide(
        situation_summary,
        agenda_dicts,
        open_commitments,
        source_notes=body.raw_notes,
        prepared_by="manager",
        drew_on=drew_on_expectations(
            prep_drew_on(
                inputs,
                opening_line=opening_line,
                carry_forward_items=carry_forward_items,
                has_notes=bool(body.raw_notes.strip()),
                suggested_topics=len(suggested_topics),
            ),
            agenda_dicts,
            guard,
        ),
        built_without=inputs.get("built_without"),
        summary_unsupported=summary_unsupported(situation_summary, guard),
    )
    # Analytics (backend/analytics.py): was there a sheet before this one?
    # Checked before the write so the answer isn't this sheet itself.
    regenerated = bool((existing or {}).get("prep_guide"))
    had_prep_sheet = regenerated or _manager_has_prep_sheet(supabase, user_id)

    if existing:
        workspace_update: dict = {"prep_guide": prep_guide, "carry_forward_items": carry_forward_items}
        if "opening_line" in fields_set:
            workspace_update["opening_line"] = opening_line
        saved = (
            supabase.table("one_on_ones")
            .update(workspace_update)
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

    # The golden-path signal: is_first marks the manager's first saved sheet
    # ever. Flags only; nothing from the sheet or the notes goes with it.
    analytics.capture(
        user_id,
        "prep_sheet_saved",
        {
            "is_first": not had_prep_sheet,
            "regenerated": regenerated,
            # Counts only — never the lines or the reasons' wording.
            "held_lines": sum(len(i.get("held") or []) for i in agenda_dicts),
            "unsupported_claims": sum(len(i.get("unsupported") or []) for i in agenda_dicts)
            + (1 if prep_guide.get("summary_unsupported") else 0),
        },
    )

    return PrepResponse(
        id=saved["id"],
        situation_summary=prep_guide["situation_summary"],
        agenda_items=agenda_items,
        open_commitments_to_check=open_commitments,
        scheduled_at=scheduled_at,
        recurrence_weeks=recurrence_weeks,
        carry_forward_items=carry_forward_items,
        opening_line=opening_line,
        prepared_by=prep_guide["prepared_by"],
        prepared_at=prep_guide["prepared_at"],
        drew_on=prep_guide["drew_on"],
        built_without=prep_guide.get("built_without") or [],
        summary_unsupported=prep_guide.get("summary_unsupported") or [],
    )


@router.post("/wrapup", response_model=WrapUpDraft)
@limiter.limit("10/minute")
def wrap_up_one_on_one(request: Request, body: WrapUpRequest, auth=Depends(get_authenticated_client)):
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
    except Exception as exc:
        # .single() raises when no row matches, which is the normal 404. Logged
        # at info so a real failure (a bad column, Supabase down) is findable.
        logger.info("lookup failed, answering 404: %s", exc)
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
        parsed = {"summary": "", "commitments": [], "follow_up_items": [], "opening_line": ""}

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
    opening_line = parsed.get("opening_line")
    return WrapUpDraft(
        summary=parsed.get("summary", "") or "",
        commitments=commitments,
        follow_up_items=follow_up_items,
        opening_line=_clean_opening_line(opening_line if isinstance(opening_line, str) else None) or "",
    )


@router.post("")
def log_one_on_one(body: LogOneOnOneIn, auth=Depends(get_authenticated_client)):
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
            .select("id,series_id,scheduled_at,summary,notes,logged_at")
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

    # What the completed occurrence looked like before this log touched it,
    # so a failure further down can put it back (see _undo_partial_log).
    prior_session = (
        {key: source_session.get(key) for key in ("notes", "logged_at", "scheduled_at")}
        if source_session
        else None
    )

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

    commitment_rows = [
        {
            "owner_id": user_id,
            "direct_report_id": body.direct_report_id,
            "committed_by": c.committed_by if c.committed_by in ("manager", "direct_report") else "manager",
            "source_type": "one_on_one",
            "source_id": meeting["id"],
            "description": c.description.strip(),
            "due_date": c.due_date or None,
            "status": "open",
        }
        for c in body.new_commitments
        if c.description.strip()
    ]
    created_commitments: list[dict] = []
    try:
        # One statement, so the reviewed commitments land together or not at
        # all — never the first two of five.
        if commitment_rows:
            created_commitments = (
                supabase.table("commitments").insert(commitment_rows).execute().data or []
            )

        carry_forward_items = _clean_follow_up_items(body.carry_forward_items)
        # Only a kept, non-empty opener is written: an empty one leaves an
        # opener the next occurrence already carries alone.
        opening_line = _clean_opening_line(body.opening_line)
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
            if opening_line:
                workspace_updates["opening_line"] = opening_line
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
            next_row = {
                "manager_id": user_id,
                "direct_report_id": body.direct_report_id,
                "series_id": series["id"] if series else None,
                "scheduled_at": next_at,
                "carry_forward_items": carry_forward_items,
            }
            if opening_line:
                next_row["opening_line"] = opening_line
            next_session = (
                supabase.table("one_on_ones")
                .insert(next_row)
                .execute()
                .data[0]
            )
        next_session["one_on_one_series"] = series or {}
        next_session = _serialize_session(next_session)

    except Exception as exc:
        # The meeting is already written. Leaving it half-saved would tell the
        # manager "try again" while a retry either 404s (the prepared
        # occurrence is now complete) or files the conversation twice (an
        # ad-hoc log). Put back what this request changed, then fail.
        logger.error("1:1 log failed after the meeting write; undoing it: %s", type(exc).__name__)
        _undo_partial_log(
            supabase,
            user_id,
            meeting_id=meeting["id"],
            inserted_meeting=prior_session is None,
            prior_session=prior_session,
            commitment_ids=[row["id"] for row in created_commitments if row.get("id")],
        )
        raise HTTPException(
            status_code=500,
            detail="The meeting couldn't be saved, so nothing was recorded. Your review is still here — try again.",
        )

    # Everything the receipt shows comes from what the database returned for
    # this request: the completed meeting, the commitments actually inserted
    # (not every row the client submitted), the confirmed carry-forward
    # topics after cleaning, and the occurrence that now holds them.
    return {
        "meeting": _serialize_session(meeting),
        "next_session": next_session,
        "commitments": created_commitments,
        "carry_forward_items": carry_forward_items,
        "opening_line": opening_line,
    }


def _undo_partial_log(
    supabase,
    user_id: str,
    *,
    meeting_id: str,
    inserted_meeting: bool,
    prior_session: dict | None,
    commitment_ids: list[str],
) -> None:
    """Best-effort compensation for a log that failed after its meeting write.

    Removes the commitments this request inserted, then either deletes the
    occurrence it inserted or returns the occurrence it completed to
    unfinished. Each step is independent so one failure doesn't skip the
    rest; failures are logged without record content."""
    for commitment_id in commitment_ids:
        try:
            supabase.table("commitments").delete().eq("id", commitment_id).eq("owner_id", user_id).execute()
        except Exception as exc:  # pragma: no cover - logged, not raised
            logger.error("could not undo a commitment from a failed 1:1 log: %s", type(exc).__name__)
    try:
        if inserted_meeting:
            supabase.table("one_on_ones").delete().eq("id", meeting_id).eq("manager_id", user_id).execute()
        else:
            supabase.table("one_on_ones").update({
                "summary": None,
                "notes": (prior_session or {}).get("notes"),
                "logged_at": (prior_session or {}).get("logged_at"),
                "scheduled_at": (prior_session or {}).get("scheduled_at"),
            }).eq("id", meeting_id).eq("manager_id", user_id).execute()
    except Exception as exc:  # pragma: no cover - logged, not raised
        logger.error("could not undo a failed 1:1 log's meeting write: %s", type(exc).__name__)


@router.get("/{direct_report_id}/history")
def get_history(direct_report_id: str, auth=Depends(get_authenticated_client)):
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
def get_session(one_on_one_id: str, auth=Depends(get_authenticated_client)):
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
    except Exception as exc:
        # .single() raises when no row matches, which is the normal 404. Logged
        # at info so a real failure (a bad column, Supabase down) is findable.
        logger.info("lookup failed, answering 404: %s", exc)
        raise HTTPException(status_code=404, detail="Session not found")
    if not result.data:
        raise HTTPException(status_code=404, detail="Session not found")
    return _serialize_session(result.data)


@router.patch("/session/{one_on_one_id}/schedule")
def update_session_schedule(
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
def dismiss_session(one_on_one_id: str, auth=Depends(get_authenticated_client)):
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
    except Exception as exc:
        # .single() raises when no row matches, which is the normal 404. Logged
        # at info so a real failure (a bad column, Supabase down) is findable.
        logger.info("lookup failed, answering 404: %s", exc)
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
def list_captures(direct_report_id: str, auth=Depends(get_authenticated_client)):
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
def create_capture(direct_report_id: str, body: CaptureNoteIn, auth=Depends(get_authenticated_client)):
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
def delete_capture(capture_id: str, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    supabase.table("dr_capture_notes").delete().eq("id", capture_id).eq("manager_id", user_id).execute()
    return {"deleted": True}
