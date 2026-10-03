"""Capture by person (docs/design-proposals/2026-10-02-capture-by-person/).

The manager writes or says what they know about ONE person, on that person's
page. Because the text arrives attached to a person, nothing is guessed about
who it is about. This route only drafts: it reads that text and returns what
the manager owes the person, what the person owes the manager, and short
things worth keeping. Nothing is written here (Hard Rule 6). The manager
reviews, and the page saves through the routes that already exist:
POST /api/commitments (committed_by says which side) and
POST /api/one-on-ones/{id}/captures. No 1:1 is created: notes about someone
are not a conversation.

Three guards keep wrong data out, in order of how little they trust the model:
1. A sentence that names ANOTHER person on the roster is never read. It is
   returned as `mentions` so the manager can move it to that person.
2. Every drafted row carries a `quote` that must appear in what the manager
   wrote, or the row is dropped.
3. Direction is `manager`, `direct_report`, or null when the text does not say.
   Null is never defaulted: the page makes the manager pick before saving.
"""
import json
import re
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

import analytics
from ai_core import CachedPrompt, generate_text
from config import AI_DEFAULT_MODEL_HEAVY
from utils import get_authenticated_client, limiter

router = APIRouter()

MAX_TEXT = 6000
MAX_COMMITMENTS = 12
MAX_THOUGHTS = 8


class IntakeDraftIn(BaseModel):
    text: str = Field(min_length=1)


# ── guard 1: who a sentence is about is decided by the page, not the model ──

def split_sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?])\s+|\n+", text.strip())
    return [p.strip() for p in parts if p and p.strip()]


def _first(name: str) -> str:
    return (name.strip().split() or [""])[0]


def _names_in(sentence: str, name: str) -> bool:
    return bool(name) and re.search(rf"(?<!\w){re.escape(name)}(?!\w)", sentence, re.IGNORECASE) is not None


def mentioned_other(sentence: str, this: dict, others: list[dict]) -> dict | None:
    """The other roster person this sentence names, if any. A first name shared
    with this person (or with a third) counts only as a full-name match."""
    this_first = _first(this["name"]).casefold()
    firsts = [_first(o["name"]).casefold() for o in others] + [this_first]
    for o in others:
        full, first = o["name"].strip(), _first(o["name"])
        shared = first.casefold() == this_first or firsts.count(first.casefold()) > 1
        if _names_in(sentence, full) or (not shared and _names_in(sentence, first)):
            return o
    return None


def separate(text: str, this: dict, others: list[dict]) -> tuple[str, list[dict]]:
    """-> (the text the model may read, sentences held back with who they name)."""
    keep, held = [], []
    for s in split_sentences(text):
        other = mentioned_other(s, this, others)
        if other:
            held.append({"sentence": s, "person_id": other["id"], "person_name": other["name"]})
        else:
            keep.append(s)
    return " ".join(keep), held


# ── the one AI call ─────────────────────────────────────────────────────────

def build_prompt(name: str, text: str, today_iso: str) -> CachedPrompt:
    prefix = """You are helping a manager record what they already know about ONE direct report. Everything the manager wrote is about that one person; you are never deciding who a sentence is about. Return only what the text states. The manager reviews and edits everything before anything is saved.

Produce:

1. commitments: specific things one side has to DO for the other, that are still open.
   - committed_by "manager": the manager owes it ("I owe her feedback", "I haven't written his growth plan", "I need to talk with her about X").
   - committed_by "direct_report": the person owes the manager ("she is going to confirm priorities", "he said he'd send the plan", "I asked for a weekly status").
   - committed_by null: an action is clearly owed but the text does not say by whom. Never guess a side.
   - A standing ask that has lapsed ("I asked for a weekly written status; he did it twice, then stopped") is a direct_report commitment ("Send a weekly written status"). Put the lapse itself in kept_thoughts.
   - A commitment is only ever between the manager and THIS person. Something owed to or by anyone else is NOT a commitment: a deliverable the manager owes their boss or HR ("Gwen needs a written summary on him for HR"), a request from another team, a promise that depends on a third party. Put it in kept_thoughts instead, in the manager's words, so it is not filed as owed to this person.
   - Not commitments: things already done, what the person's job is, general hopes, feelings, vague intentions ("we should think about...").
   - description: one short actionable sentence starting with a verb, from the manager's point of view of the action ("Send written feedback on her design doc").
   - due_date: ISO date only if the text states or clearly implies one, resolved from today's date. Otherwise null.
   - quote: the shortest exact phrase copied from the text that supports the row. It must appear in the text word for word.

2. kept_thoughts: things the manager would want in front of them before the next 1:1 that are not actions (a worry, a question the person asked, context, a lapse). Short, in the manager's own words where possible. Each needs a quote too.
   - A kept thought must add something a commitment row does not say. Never restate a commitment as a thought ("the transfer is unclear", "the status update has not arrived" when the commitment is already "Send the status update"). If the only point of a sentence is the open action, it is a commitment and not a thought.

Never invent. An empty list is a valid answer. Return ONLY valid JSON, no commentary, no code fences:

{"commitments": [{"description": "...", "committed_by": "manager", "due_date": null, "quote": "..."}], "kept_thoughts": [{"text": "...", "quote": "..."}]}"""
    body = f"""THE PERSON: {name}

Today's date: {today_iso}

WHAT THE MANAGER WROTE ABOUT {name}:
{text}

Return the JSON described above."""
    return CachedPrompt(prefix, body)


def _norm(s: str) -> str:
    return " ".join(re.sub(r"[^\w\s]", " ", (s or "").casefold()).split())


def _clean(value, limit: int) -> str | None:
    v = " ".join(str(value or "").split())
    return v[:limit] if v else None


def _iso(value) -> str | None:
    try:
        return date.fromisoformat(str(value)).isoformat() if value else None
    except ValueError:
        return None


_FILLER = frozenset(
    "a an the and or but of to in on at for with by from as is are was were be been being it its this that these those "
    "has have had not no yet still just has hasnt hasn't have haven't i me my we our you your he she him her his hers "
    "they them their will would should could can may might do does did done about into over up out so than then there "
    "here also very".split()
)


def _words(s: str) -> set[str]:
    """Content words, lightly stemmed so "account" matches "accounts"."""
    return {w[:-1] if w.endswith("s") and len(w) > 3 else w for w in _norm(s).split() if w not in _FILLER and len(w) > 2}


def _sentence_of(quote: str, sentences: list[str]) -> int | None:
    q = _norm(quote)
    for i, s in enumerate(sentences):
        if q and q in _norm(s):
            return i
    return None


def restates_commitment(thought: dict, commitments: list[dict], sentences: list[str]) -> bool:
    """True when a kept thought only repeats a drafted commitment: its quote sits inside
    that commitment's quote (or the reverse), or it comes from the same sentence and
    most of its content words already appear in the commitment. A lapse that shares a
    sentence with a standing ask adds new words ("did it twice, then stopped"), so it stays."""
    tq = _norm(thought["quote"])
    tw = _words(thought["text"]) | _words(thought["quote"])
    t_at = _sentence_of(thought["quote"], sentences)
    for c in commitments:
        cq = _norm(c["quote"])
        if tq in cq or cq in tq:
            return True
        if t_at is not None and t_at == _sentence_of(c["quote"], sentences) and tw:
            covered = tw & (_words(c["description"]) | _words(c["quote"]))
            if len(covered) / len(tw) >= 0.5:
                return True
    return False


def validate(parsed: dict, text: str, open_rows: list[dict]) -> dict:
    """Keep only rows the manager's own words support (guard 2) and that are not
    already open for this person on the same side."""
    haystack = _norm(text)
    existing = {(r.get("committed_by") or "manager", _norm(r.get("description"))) for r in open_rows}
    commitments, thoughts, already, dropped = [], [], 0, 0
    for item in (parsed.get("commitments") or [])[: MAX_COMMITMENTS * 2]:
        if not isinstance(item, dict):
            continue
        desc, quote = _clean(item.get("description"), 240), _clean(item.get("quote"), 300)
        if not desc or not quote or _norm(quote) not in haystack:
            dropped += 1  # not tied to the manager's words: not shown, but counted so the page can say so
            continue
        side = item.get("committed_by")
        side = side if side in ("manager", "direct_report") else None
        if side and (side, _norm(desc)) in existing:
            already += 1
            continue
        commitments.append({"description": desc, "committed_by": side, "due_date": _iso(item.get("due_date")), "quote": quote})
    for item in (parsed.get("kept_thoughts") or [])[: MAX_THOUGHTS * 2]:
        if not isinstance(item, dict):
            continue
        t, quote = _clean(item.get("text"), 400), _clean(item.get("quote"), 300)
        if t and quote and _norm(quote) in haystack:
            thoughts.append({"text": t, "quote": quote})
        else:
            dropped += 1
    commitments = commitments[:MAX_COMMITMENTS]
    sentences = split_sentences(text)
    thoughts = [t for t in thoughts if not restates_commitment(t, commitments, sentences)][:MAX_THOUGHTS]
    return {
        "commitments": [{"key": f"c{i}", **c} for i, c in enumerate(commitments)],
        "thoughts": [{"key": f"t{i}", **t} for i, t in enumerate(thoughts)],
        "already_there": already,
        "dropped": dropped,
    }


def _parse_json(raw: str) -> dict:
    raw = (raw or "").strip()
    if raw.startswith("```"):
        start, end = raw.find("{"), raw.rfind("}") + 1
        raw = raw[start:end] if start != -1 else raw
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        return {}


def _size_bucket(chars: int) -> str:
    return "under_1k" if chars < 1000 else "1k_5k" if chars < 5000 else "over_5k"


@router.post("/{report_id}/draft")
@limiter.limit("20/minute")
def draft_person_intake(request: Request, report_id: str, body: IntakeDraftIn, auth=Depends(get_authenticated_client)):
    """Draft what the text says about this one person. Writes nothing."""
    user_id, supabase = auth
    roster = (
        supabase.table("direct_reports").select("id,name")
        .eq("manager_id", user_id).is_("archived_at", "null").execute().data
    )
    this = next((r for r in roster if r["id"] == report_id), None)
    if not this:
        raise HTTPException(status_code=404, detail="Direct report not found")

    text = body.text.strip()
    truncated = len(text) > MAX_TEXT
    text = text[:MAX_TEXT]
    readable, held = separate(text, this, [r for r in roster if r["id"] != report_id])

    result = {"commitments": [], "thoughts": [], "already_there": 0, "dropped": 0}
    if readable.strip():
        raw = generate_text(
            build_prompt(this["name"], readable, date.today().isoformat()),
            model=AI_DEFAULT_MODEL_HEAVY, max_tokens=1500,
        )
        open_rows = (
            supabase.table("commitments").select("description,committed_by")
            .eq("owner_id", user_id).eq("direct_report_id", report_id).eq("status", "open").execute().data
        )
        result = validate(_parse_json(raw), readable, open_rows)

    analytics.capture(user_id, "person_intake_drafted", {
        "input_size": _size_bucket(len(text)),
        "commitments": len(result["commitments"]),
        "thoughts": len(result["thoughts"]),
        "side_unclear": sum(1 for c in result["commitments"] if c["committed_by"] is None),
        "held_back": len(held),
        "already_there": result["already_there"],
        "dropped": result["dropped"],
        "truncated": truncated,
    })
    return {**result, "mentions": held, "truncated": truncated}
