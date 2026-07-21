"""
The core feature: 1:1 prep + logging.

POST /prep generates a structured prep sheet for an upcoming 1:1 using the
manager's raw notes plus that direct report's open commitments (the
"remembers what you told them" hook). It is a pure AI-call route — no DB
write. The manager reviews/edits, then POST / actually logs the 1:1 and
any new commitments made during it.
"""
import json
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ai_core import generate_text
from config import AI_DEFAULT_MODEL_HEAVY
from utils import get_authenticated_client

router = APIRouter()


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class PrepRequest(BaseModel):
    direct_report_id: str
    raw_notes: str  # manager's quick freeform input: what's going on, what's on their mind


class AgendaItem(BaseModel):
    title: str
    rationale: str
    suggested_questions: list[str]


class PrepResponse(BaseModel):
    situation_summary: str
    agenda_items: list[AgendaItem]
    open_commitments_to_check: list[dict]


class LogOneOnOneIn(BaseModel):
    direct_report_id: str
    summary: str
    new_commitments: list[str] = []  # freeform strings; parsed into commitments rows


# ---------------------------------------------------------------------------
# Prompt builder — this is the core product IP
# ---------------------------------------------------------------------------

def _build_prep_prompt(
    report_name: str,
    raw_notes: str,
    open_commitments: list[dict],
    recent_summaries: list[str],
    days_since_last: int | None,
) -> str:
    # --- Recency context ---
    if days_since_last is None:
        recency_note = (
            "This is the first logged 1:1 with this person. "
            "Treat it as a foundation-setting conversation: establish communication style, "
            "understand their goals and current challenges, and set expectations for how "
            "you'll work together."
        )
    elif days_since_last > 21:
        recency_note = (
            f"It has been {days_since_last} days since the last 1:1 — longer than a healthy cadence. "
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

    # --- Open commitments ---
    if open_commitments:
        commitments_block = "\n".join(
            f"  • {c['description']} (due: {c.get('due_date', 'unspecified')})"
            for c in open_commitments
        )
    else:
        commitments_block = "  (None on record.)"

    return f"""You are a management coach helping a manager prepare for a 1:1 with {report_name}.

Your output must be grounded in the specific details provided. Do not give generic management advice. Every agenda item, question, and talking point must follow from something the manager actually wrote, something in recent history, or an open commitment that needs follow-up.

---
RELATIONSHIP CONTEXT
{recency_note}

RECENT 1:1 HISTORY (last 2–3 meetings, newest first):
{history_block}

OPEN COMMITMENTS (things the manager promised to follow up on, still unresolved):
{commitments_block}

MANAGER'S NOTES ON WHAT'S HAPPENING RIGHT NOW:
{raw_notes}

---
FRAMEWORKS TO APPLY — read carefully before generating output:

1. COMMITMENT REVIEW
   If any open commitments exist, the first agenda item must address them.
   Frame questions to create accountability without defensiveness:
   ✓ "Where did you land on X?" or "What happened with Y?"
   ✗ "Did you do X?" (accusatory) or ignoring them entirely (sends the wrong signal)

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


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/prep", response_model=PrepResponse)
async def prep_one_on_one(body: PrepRequest, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth

    # Fetch direct report name
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
    report = report_result.data

    # Fetch open commitments for this report
    open_commitments = (
        supabase.table("commitments")
        .select("description,due_date")
        .eq("direct_report_id", body.direct_report_id)
        .eq("status", "open")
        .execute()
        .data
    )

    # Fetch recent 1:1 history (last 3 meetings, newest first)
    history_rows = (
        supabase.table("one_on_ones")
        .select("summary,created_at")
        .eq("direct_report_id", body.direct_report_id)
        .eq("manager_id", user_id)
        .order("created_at", desc=True)
        .limit(3)
        .execute()
        .data
    )

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

    prompt = _build_prep_prompt(
        report_name=report["name"],
        raw_notes=body.raw_notes,
        open_commitments=open_commitments,
        recent_summaries=recent_summaries,
        days_since_last=days_since_last,
    )

    raw = generate_text(prompt, model=AI_DEFAULT_MODEL_HEAVY, max_tokens=2000)

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        parsed = {
            "situation_summary": "Unable to generate summary — please try again.",
            "agenda_items": [],
        }

    return PrepResponse(
        situation_summary=parsed.get("situation_summary", ""),
        agenda_items=[
            AgendaItem(
                title=item.get("title", ""),
                rationale=item.get("rationale", ""),
                suggested_questions=item.get("suggested_questions", []),
            )
            for item in parsed.get("agenda_items", [])
        ],
        open_commitments_to_check=open_commitments,
    )


@router.post("")
async def log_one_on_one(body: LogOneOnOneIn, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth

    meeting = (
        supabase.table("one_on_ones")
        .insert({
            "manager_id": user_id,
            "direct_report_id": body.direct_report_id,
            "summary": body.summary,
        })
        .execute()
        .data[0]
    )

    for description in body.new_commitments:
        supabase.table("commitments").insert({
            "owner_id": user_id,
            "direct_report_id": body.direct_report_id,
            "source_type": "one_on_one",
            "source_id": meeting["id"],
            "description": description,
            "status": "open",
        }).execute()

    return meeting


@router.get("/{direct_report_id}/history")
async def get_history(direct_report_id: str, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    result = (
        supabase.table("one_on_ones")
        .select("*")
        .eq("direct_report_id", direct_report_id)
        .eq("manager_id", user_id)
        .order("created_at", desc=True)
        .execute()
    )
    return result.data
