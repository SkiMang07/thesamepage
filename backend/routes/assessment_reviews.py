"""
Period assessments — the AI-led, manager-owned assessment flow
(docs/systems/assessments.md). One performance_reviews row per assessment of
one direct report over an explicit period (quarterly, biannual, off-cycle).

The flow has three stages and one completed view:

1. Check the picture. The server gathers the report's authorized,
   person-linked records for the period (assessment_evidence.py), then AI
   writes a short, source-cited account of contributions, outcomes and gaps.
   The manager adds context or says there is nothing to add. Confirming the
   context approves the INPUTS to drafting, never a rating.
2. Draft and discuss. AI proposes judgments against each configured item's
   own scale plus a separate overall judgment, with reasons, cited sources
   and limitations, and leaves items empty when evidence doesn't support
   them. The manager edits directly or discusses with AI; AI revisions are
   stored as visible proposals and never overwrite a manager's decision.
3. Review and complete. The manager sees every included judgment, the
   summary and the acknowledged gaps together and completes explicitly.
   complete_performance_review() (SQL) writes the confirmed rows and the
   frozen snapshot in one transaction; retries never duplicate.

Draft state lives on the row (draft / conversation / picture / evidence) and
every manager write carries the version it was based on (optimistic lock), so
a draft survives navigation and reload and two tabs can't silently overwrite
each other. AI results are merged onto the latest row instead of failing.

Manual assessment is the same flow with mode = 'manual': no AI proposals,
same review and completion semantics.

Nothing here shares an assessment with the report, schedules anything or
writes to goals, notes, commitments, agendas or development plans.
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
import re
from datetime import date, datetime, timezone
from typing import Callable, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from postgrest.exceptions import APIError
from pydantic import BaseModel

import analytics
from ai_core import CachedPrompt, generate_text
from assessment_evidence import gather_evidence
from config import AI_DEFAULT_MODEL_HEAVY
from routes.assessments import _fetch_scorecard
from utils import get_authenticated_client, get_org, limiter

logger = logging.getLogger(__name__)

router = APIRouter()

_RPC_ERRORS = {"P0002": 404, "40001": 409, "22023": 422, "28000": 401}
MANAGER_CONTEXT_ID = "manager_context"
MAX_CONVERSATION = 60


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _fingerprint(value) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()[:16]


def _parse_json(raw: str) -> dict:
    """The JSON object in a model reply. Prefers a fenced ```json block;
    otherwise the first '{' from which a complete object decodes, so a
    stray brace in a preamble or a remark after the object doesn't fail
    the call (Sonnet 5 does both occasionally)."""
    text = (raw or "").strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.S)
    if fenced:
        text = fenced.group(1)
    elif text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*", "", text).rstrip("`").strip()
    decoder = json.JSONDecoder()
    start = text.find("{")
    while start != -1:
        try:
            obj, _ = decoder.raw_decode(text[start:])
            if isinstance(obj, dict):
                return obj
        except ValueError:
            pass
        start = text.find("{", start + 1)
    raise ValueError("no JSON object in model output")


def _period_label(cadence: str | None, start: date, end: date) -> str:
    def fmt(d: date, year: bool) -> str:
        return f"{d.strftime('%b')} {d.day}" + (f", {d.year}" if year else "")

    span = f"{fmt(start, start.year != end.year)} – {fmt(end, True)}"
    quarter_starts = {1: 1, 4: 2, 7: 3, 10: 4}
    if cadence == "quarterly" and start.day == 1 and start.month in quarter_starts:
        q_end_month = start.month + 2
        if end.year == start.year and end.month == q_end_month and (end.replace(day=28).toordinal() <= end.toordinal()):
            return f"Q{quarter_starts[start.month]} {start.year} · {span}"
    if cadence == "biannual" and start.day == 1 and start.month in (1, 7) and end.year == start.year and end.month == start.month + 5 and end.day >= 28:
        return f"H{1 if start.month == 1 else 2} {start.year} · {span}"
    prefix = {"quarterly": "Quarterly", "biannual": "Biannual", "off_cycle": "Off-cycle"}.get(cadence or "", "Assessment")
    return f"{prefix} · {span}"


def _meaning(defn: dict) -> str:
    return (
        defn.get("qualitative_output")
        or defn.get("quantitative_output")
        or defn.get("evaluation_name")
        or defn.get("description")
        or ""
    )


def _catalog(scorecard: dict) -> list[dict]:
    """Every assessable item for this report in display order, each with its
    own scale (point + meaning) and the latest prior judgment as context."""
    out: list[dict] = []
    levels = scorecard.get("levels") or []
    overall = scorecard.get("overall")
    out.append({
        "key": "overall",
        "kind": "overall",
        "config_id": None,
        "name": "Overall judgment",
        "expectation": "Your overall view of their performance this period. Chosen on its own — never an average of the items below.",
        "scale": [{"point": lv["ordinal"], "meaning": lv["label"]} for lv in levels],
        "measurement_period": None,
        "order_type": None,
        "prior": (
            {"point": overall["level_ordinal"], "reason": overall.get("notes"), "date": str(overall.get("created_at") or "")[:10]}
            if overall else None
        ),
    })
    for kind, bucket in (("skill", "skills"), ("value", "values"), ("metric", "metrics")):
        for it in scorecard.get(bucket) or []:
            defs = it.get("scale_definitions") or []
            if defs:
                scale = [{"point": d["evaluation_point"], "meaning": _meaning(d)} for d in defs]
            else:
                lo, hi = it.get("scale_min") or 1, it.get("scale_max") or 4
                scale = [{"point": p, "meaning": ""} for p in range(lo, hi + 1)]
            latest = it.get("latest")
            prior = None
            if latest and kind in ("skill", "value") and latest.get("evaluation_point") is not None:
                prior = {"point": latest["evaluation_point"], "reason": latest.get("notes"), "date": str(latest.get("assessed_at") or "")[:10]}
            elif latest and kind == "metric" and latest.get("value") is not None:
                prior = {"value": latest["value"], "period": latest.get("period"), "reason": latest.get("notes"),
                         "date": str(latest.get("recorded_at") or "")[:10]}
            out.append({
                "key": f"{kind}:{it['config_id']}",
                "kind": kind,
                "config_id": it["config_id"],
                "name": it.get("name"),
                "expectation": it.get("expectation") or it.get("description"),
                "scale": scale,
                "measurement_period": it.get("measurement_period"),
                "order_type": it.get("order_type"),
                "target": it.get("target"),
                "target_status": it.get("target_status"),
                "prior": prior,
            })
    return out


def _role_label(scorecard: dict) -> str | None:
    role = scorecard.get("role")
    if not role:
        return None
    label = f"{role['job_role']}, level {role['job_level']}"
    if role.get("functional_team"):
        label += f" ({role['functional_team']})"
    return label


def _default_item(entry: dict) -> dict:
    return {
        "key": entry["key"],
        "kind": entry["kind"],
        "config_id": entry["config_id"],
        "proposal": None,
        "unassessed_reason": None,
        "decision": {"state": "unassessed", "origin": "default"},
        "revision": None,
        "changed_by_redraft": False,
    }


def _ensure_items(draft: dict, catalog: list[dict]) -> dict:
    items = dict(draft.get("items") or {})
    for entry in catalog:
        items.setdefault(entry["key"], _default_item(entry))
    draft = dict(draft)
    draft["items"] = items
    return draft


def _decision_values(decision: dict) -> dict:
    return {k: decision.get(k) for k in ("state", "point", "value", "period")}


def _summary_fingerprint(draft: dict) -> str:
    items = draft.get("items") or {}
    return _fingerprint({k: _decision_values(v.get("decision") or {}) for k, v in sorted(items.items())})


def _context_fingerprint(row: dict) -> str:
    return _fingerprint({
        "context": (row.get("manager_context") or "").strip(),
        "excluded": sorted(row.get("excluded_evidence") or []),
        "private": bool(row.get("include_private")),
        "evidence": (row.get("evidence") or {}).get("generated_at"),
    })


def _same_judgment(kind: str, a: dict | None, b: dict | None) -> bool:
    if not a or not b:
        return False
    if kind == "metric":
        return a.get("value") == b.get("value") and (a.get("period") or "") == (b.get("period") or "")
    return a.get("point") == b.get("point")


def _describe(kind: str, entry: dict, j: dict | None) -> str:
    if not j:
        return "—"
    if kind == "metric":
        return f"{j.get('value')}" + (f" ({j['period']})" if j.get("period") else "")
    meaning = next((s["meaning"] for s in entry["scale"] if s["point"] == j.get("point")), "")
    return f"{j.get('point')}" + (f" — {meaning}" if meaning else "")


def _readable_day(iso: str | None) -> str:
    try:
        d = date.fromisoformat((iso or "")[:10])
        return f"{d.strftime('%b')} {d.day}, {d.year}"
    except ValueError:
        return "undated"


def _attention(entry: dict, item: dict) -> list[str]:
    """Why this judgment is worth the manager's attention. Derived from the
    proposal's own stated limits and from facts (differs from prior, rests
    only on added context, changed by a redraft) — never a confidence score
    and never rating severity."""
    reasons: list[str] = []
    decision = item.get("decision") or {}
    if item.get("revision"):
        reasons.append("A revised judgment from your discussion is waiting for you.")
    if decision.get("origin") != "ai":
        return reasons
    proposal = item.get("proposal")
    if not proposal:
        return reasons
    for note in proposal.get("attention") or []:
        if note:
            reasons.append(note)
    prior = entry.get("prior")
    if prior and not _same_judgment(entry["kind"], proposal, prior):
        label = "latest reading" if entry["kind"] == "metric" else "prior judgment"
        reasons.append(f"Differs from the {label} ({_describe(entry['kind'], entry, prior)}, {_readable_day(prior.get('date'))}).")
    sources = proposal.get("sources") or []
    if sources and all(s == MANAGER_CONTEXT_ID or s.startswith("message:") for s in sources):
        reasons.append("Rests only on context you added — no recorded source.")
    if item.get("changed_by_redraft"):
        reasons.append("Changed after you updated the context.")
    return reasons


# ---------------------------------------------------------------------------
# Loading, saving, presenting
# ---------------------------------------------------------------------------

def _load(supabase, user_id: str, review_id: str) -> dict:
    rows = (
        supabase.table("performance_reviews")
        .select("*")
        .eq("id", review_id)
        .eq("manager_id", user_id)
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Assessment not found")
    return rows[0]


def _write(supabase, user_id: str, row: dict, changes: dict) -> dict:
    changes = dict(changes)
    changes["version"] = row["version"] + 1
    changes["updated_at"] = _now()
    result = (
        supabase.table("performance_reviews")
        .update(changes)
        .eq("id", row["id"])
        .eq("manager_id", user_id)
        .eq("version", row["version"])
        .eq("status", "draft")
        .execute()
        .data
    )
    if not result:
        raise HTTPException(status_code=409, detail="This assessment changed in another window. Reload to see the latest.")
    return result[0]


def _mutate(supabase, user_id: str, review_id: str, fn: Callable[[dict], dict], expected_version: int | None) -> dict:
    """Apply fn(row) -> changes to the latest draft. A manager write passes
    the version it saw and is refused (409) if anything changed since; an AI
    result passes None and is merged onto the latest row (one retry)."""
    attempts = 1 if expected_version is not None else 3
    for attempt in range(attempts):
        row = _load(supabase, user_id, review_id)
        if row["status"] != "draft":
            raise HTTPException(status_code=409, detail="This assessment is already completed.")
        if expected_version is not None and row["version"] != expected_version:
            raise HTTPException(status_code=409, detail="This assessment changed in another window. Reload to see the latest.")
        changes = fn(row)
        try:
            return _write(supabase, user_id, row, changes)
        except HTTPException:
            if attempt == attempts - 1:
                raise
    raise HTTPException(status_code=409, detail="Couldn't save — try again.")


def _present(row: dict, scorecard: dict | None) -> dict:
    """The review as the client needs it: the row, the item catalog with
    each item's state and attention reasons, and derived flags."""
    out = {k: v for k, v in row.items()}
    if row["status"] == "completed":
        out["catalog"] = []
        out["flags"] = {}
        return out
    catalog = _catalog(scorecard) if scorecard else []
    draft = _ensure_items(row.get("draft") or {}, catalog)
    known = {e["key"] for e in catalog}
    items_out = []
    for entry in catalog:
        item = draft["items"][entry["key"]]
        items_out.append({**entry, "state": item, "attention": _attention(entry, item)})
    orphaned = [k for k in (draft.get("items") or {}) if k not in known]
    evidence = row.get("evidence") or {}
    picture = row.get("picture") or {}
    summary = draft.get("summary")
    out["draft"] = draft
    out["catalog"] = items_out
    out["flags"] = {
        "context_changed": bool(draft.get("generated_at")) and draft.get("context_fingerprint") != _context_fingerprint(row),
        "picture_stale": bool(picture.get("generated_at")) and picture.get("evidence_generated_at") != evidence.get("generated_at"),
        "summary_stale": bool(summary) and summary.get("fingerprint") != _summary_fingerprint(draft),
        "orphaned_items": orphaned,
    }
    out["person"] = scorecard["direct_report"] if scorecard else None
    out["role_label"] = _role_label(scorecard) if scorecard else None
    out["levels"] = scorecard.get("levels") if scorecard else []
    return out


def _scorecard_for(user_id, supabase, row, authorization) -> dict:
    return _fetch_scorecard(user_id, supabase, row["direct_report_id"], authorization)


def _respond(user_id, supabase, row, authorization) -> dict:
    sc = None if row["status"] == "completed" else _scorecard_for(user_id, supabase, row, authorization)
    return _present(row, sc)


def _regather(supabase, user_id: str, row: dict, scorecard: dict, start: date, end: date, include_private: bool) -> dict:
    metric_names = {m["config_id"]: m["name"] for m in scorecard.get("metrics") or []}
    return gather_evidence(supabase, user_id, scorecard["direct_report"], start, end, metric_names, include_private)


# ---------------------------------------------------------------------------
# Evidence formatting for prompts
# ---------------------------------------------------------------------------

def _usable_evidence(row: dict) -> list[dict]:
    excluded = set(row.get("excluded_evidence") or [])
    return [i for i in (row.get("evidence") or {}).get("items") or [] if i["id"] not in excluded]


def _evidence_block(items: list[dict]) -> str:
    if not items:
        return "  (no records)"
    labels = {"in_period": "in period", "context": "context", "background": "BACKGROUND, before the period"}
    lines = []
    for i in items:
        lines.append(
            f"  [{i['ref']}] {i.get('date') or 'undated'} · {i['title']} ({labels.get(i['timing'], i['timing'])}; {i.get('attribution') or ''})\n"
            f"      {i.get('detail') or ''}"
        )
    return "\n".join(lines)


def _context_block(row: dict) -> str:
    text = (row.get("manager_context") or "").strip()
    return f"  [M] {text}" if text else "  (the manager added nothing)"


def _ref_map(items: list[dict]) -> dict[str, str]:
    m = {i["ref"]: i["id"] for i in items}
    m["M"] = MANAGER_CONTEXT_ID
    return m


def _to_ids(refs, ref_map: dict[str, str], extra: dict[str, str] | None = None) -> list[str]:
    out: list[str] = []
    lookup = {**ref_map, **(extra or {})}
    for r in refs or []:
        rid = lookup.get(str(r).strip().strip("[]"))
        if rid and rid not in out:
            out.append(rid)
    return out


_RULES = """RULES (these are not negotiable):
- Use ONLY the records and manager context below. Never invent work, outcomes, numbers or quotes.
- Activity is not proof of impact. A completed checklist or task is a contribution; say what outcome it is evidence for only if a record shows that outcome.
- Missing evidence is not poor performance. When records are thin, say the evidence is limited — never read silence as a problem.
- BACKGROUND items happened before the period. They may explain context but must never be described as this period's results.
- Items marked "context" (goals, assigned projects, development plan) are standards or assignments, not results. Assignment to a project is not proof of who produced its results.
- [M] is the manager's own added context: attribute it ("you added…"); it is not independently verified.
- Private or secondhand items are labelled; treat secondhand notes as someone's account, not fact.
- Cite sources by their [ref]. Generated prose is not evidence.
- Plain, specific, calm language. No praise inflation, no HR jargon, no hype."""


# ---------------------------------------------------------------------------
# AI: picture, draft, discussion, summary
# ---------------------------------------------------------------------------

def _picture_prompt(row: dict, scorecard: dict, items: list[dict]) -> CachedPrompt:
    name = scorecard["direct_report"]["name"]
    prefix = f"""You are helping a manager check the picture before assessing {name} ({_role_label(scorecard) or 'no role assigned'}) for {row['review_period']}.
Write a short account of what the records show about their work, effort, outcomes and impact in this period, BEFORE any rating is discussed. The manager will then say what is missing.

{_RULES}"""
    body = f"""RECORDS
{_evidence_block(items)}

Return ONLY JSON, no commentary:
{{
  "headline": "a plain headline of at most 10 words naming what they actually did (not a verdict)",
  "summary": "2-3 sentences: the most meaningful contributions and what they are evidence of",
  "contributions": [{{"text": "one concrete contribution or outcome", "sources": ["S1"]}}],
  "impact": {{"title": "short heading", "text": "where the outcome or impact is less clear than the activity, or null if not applicable"}},
  "gaps": ["what the records do not show that would matter for an assessment"],
  "questions": ["at most 2 consequential questions the manager could answer, only if genuinely useful"]
}}
Every contribution needs at least one source ref. Keep contributions to the 2-5 most meaningful. "impact" may be null."""
    return CachedPrompt(prefix, body)


def _clean_picture(parsed: dict, ref_map: dict[str, str]) -> dict:
    contributions = []
    for c in parsed.get("contributions") or []:
        if not isinstance(c, dict) or not (c.get("text") or "").strip():
            continue
        ids = _to_ids(c.get("sources"), ref_map)
        ids = [i for i in ids if i != MANAGER_CONTEXT_ID]
        if not ids:
            continue  # an uncited contribution is not shown as fact
        contributions.append({"text": c["text"].strip(), "sources": ids})
    impact = parsed.get("impact")
    if not isinstance(impact, dict) or not (impact.get("text") or "").strip():
        impact = None
    return {
        "headline": (parsed.get("headline") or "").strip()[:140],
        "summary": (parsed.get("summary") or "").strip(),
        "contributions": contributions[:6],
        "impact": {"title": (impact.get("title") or "").strip()[:120], "text": impact["text"].strip()} if impact else None,
        "gaps": [g.strip() for g in parsed.get("gaps") or [] if isinstance(g, str) and g.strip()][:5],
        "questions": [q.strip() for q in parsed.get("questions") or [] if isinstance(q, str) and q.strip()][:2],
    }


def _item_block(catalog: list[dict], keys: dict[str, str], include_prior: bool = True) -> str:
    lines = []
    for entry in catalog:
        k = keys[entry["key"]]
        head = f"  [{k}] {entry['kind'].upper()}: {entry['name']}"
        if entry.get("expectation"):
            head += f" — standard: {entry['expectation']}"
        lines.append(head)
        if entry["kind"] == "metric":
            lines.append(f"      numeric metric measured per {entry.get('measurement_period') or 'unspecified period'}; scale points below rate a reading")
            if entry.get("target_status") == "set" and entry.get("target"):
                lines.append(f"      approved target: {entry['target']}")
            elif entry.get("target_status") == "unresolved":
                lines.append("      NO TARGET SET: the manager has not defined one. Record a reading if one exists, but never judge it against a number or imply one.")
        for s in entry["scale"]:
            lines.append(f"      {s['point']}: {s['meaning'] or '(no description configured)'}")
        if include_prior and entry.get("prior"):
            p = entry["prior"]
            lines.append(f"      PRIOR judgment ({p.get('date') or 'undated'}, context only): {_describe(entry['kind'], entry, p)}"
                         + (f" — {p['reason']}" if p.get("reason") else ""))
    return "\n".join(lines)


def _draft_prompt(row: dict, scorecard: dict, catalog: list[dict], keys: dict[str, str], items: list[dict]) -> CachedPrompt:
    name = scorecard["direct_report"]["name"]
    # Everything the draft reasons over — rules, the scales, the records, the
    # manager's context — is the prefix; a redraft of the same review within
    # the cache window reads it back. Only the output schema is the body.
    prefix = f"""You are drafting {name}'s assessment for {row['review_period']} against their role's configured expectations ({_role_label(scorecard) or 'no role assigned'}). The manager reviews and decides every judgment; nothing you write is saved as a rating.

{_RULES}
- Judge each item ONLY against its own scale and standard. Scales differ between items; never convert between them.
- Propose a judgment only where the records support one. Otherwise list the item under "unassessed" with a short reason. An honest partial draft beats a complete invented one.
- Metrics: propose a value ONLY by copying a recorded metric reading from the records or a number the manager stated in [M]. Never infer a number from activity. Include the measurement period.
- The overall judgment (key [K1]) is your separate holistic view on the overall scale — never an average of the items.
- Prior judgments are context only; do not copy them forward unless the records for THIS period support the same level.
- "needs_attention": say briefly why the manager should look closely (evidence conflicts, one example only, depends on unverified context, a change from the prior level) — or null. Never give a confidence percentage.

ITEMS
{_item_block(catalog, keys)}

RECORDS
{_evidence_block(items)}

MANAGER CONTEXT
{_context_block(row)}"""
    body = """Return ONLY JSON:
{
  "narrative": {"headline": "at most 10 words", "overview": "2-4 sentences describing the period's contribution and where evidence is limited"},
  "judgments": [{"key": "K1", "point": 3, "value": null, "period": null, "reason": "1-2 sentences grounded in cited records", "sources": ["S2", "M"], "limitations": "what the evidence does not establish, or null", "needs_attention": null}],
  "unassessed": [{"key": "K4", "why": "short reason"}]
}
Use "point" for overall/skill/value items and "value"+"period" for metrics."""
    return CachedPrompt(prefix, body)


def _clean_proposal(entry: dict, j: dict, ref_map: dict[str, str], evidence_by_id: dict[str, dict],
                    stated: dict[str, str]) -> tuple[dict | None, str | None]:
    """Validate one drafted judgment against the item's own scale and the
    evidence rules. `stated` maps manager-provided source ids (added context,
    a discussion message) to their text. Returns (proposal, None) or
    (None, why-unassessed)."""
    sources = _to_ids(j.get("sources"), ref_map)
    reason = (j.get("reason") or "").strip()
    limitations = (j.get("limitations") or "").strip() or None
    attention = [(j.get("needs_attention") or "").strip()] if (j.get("needs_attention") or "").strip() else []
    base = {"reason": reason, "sources": sources, "limitations": limitations, "attention": attention, "generated_at": _now()}
    if entry["kind"] == "metric":
        value = j.get("value")
        if isinstance(value, str):
            try:
                value = float(value.strip().replace(",", ""))   # "4.8" from the model is still 4.8
            except ValueError:
                pass
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            return None, "No recorded reading for this period."
        readings = [evidence_by_id[s] for s in sources if s in evidence_by_id and evidence_by_id[s]["kind"] == "metric_entry"
                    and evidence_by_id[s].get("config_id") == entry["config_id"]]
        from_reading = any(_num_eq(r.get("value"), value) for r in readings)
        from_manager = any(s in stated and _number_in_text(value, stated[s]) for s in sources)
        if not (from_reading or from_manager):
            return None, "No recorded reading for this period."
        period = (j.get("period") or "").strip()
        if not period and from_reading:
            period = next((r.get("reading_period") or "" for r in readings if _num_eq(r.get("value"), value)), "")
        return {**base, "value": value, "period": period or None}, None
    point = j.get("point")
    points = {s["point"] for s in entry["scale"]}
    if isinstance(point, bool) or not isinstance(point, int) or point not in points:
        return None, "The draft didn't produce a judgment on this item's scale."
    if not sources:
        return None, "Not enough cited evidence to judge this item."
    return {**base, "point": point}, None


def _num_eq(a, b) -> bool:
    try:
        return a is not None and abs(float(a) - float(b)) < 1e-9
    except (TypeError, ValueError):
        return False


def _number_in_text(value: float, text: str) -> bool:
    if not text:
        return False
    for token in re.findall(r"-?\d+(?:[.,]\d+)?", text):
        try:
            if abs(float(token.replace(",", "")) - float(value)) < 1e-9:
                return True
        except ValueError:
            continue
    return False


def _merge_draft(draft: dict, catalog: list[dict], proposals: dict[str, dict], unassessed: dict[str, str], narrative: dict | None) -> dict:
    """Fold a fresh AI draft into the working draft without overwriting the
    manager. Untouched AI decisions take the new proposal (flagged if it
    changed); anything the manager decided keeps their decision and gets the
    new proposal as a visible revision when it differs."""
    draft = _ensure_items(draft, catalog)
    items = {}
    touched_origins = {"manager", "ai_revision", "reaffirmed", "ai_confirmed"}
    for entry in catalog:
        key = entry["key"]
        item = dict(draft["items"][key])
        new = proposals.get(key)
        old_decision = item.get("decision") or {}
        had_ai_before = item.get("proposal") is not None or old_decision.get("origin") == "ai"
        item["proposal"] = new
        item["unassessed_reason"] = None if new else unassessed.get(key) or "Not enough evidence to judge this item."
        if old_decision.get("origin") in touched_origins:
            if new and not _same_judgment(entry["kind"], new, old_decision if old_decision.get("state") == "include" else None):
                item["revision"] = {**{k: new.get(k) for k in ("point", "value", "period", "reason", "sources")},
                                    "source": "redraft", "created_at": _now()}
            item["changed_by_redraft"] = False
        else:
            new_decision = (
                {"state": "include", "origin": "ai", "point": new.get("point"), "value": new.get("value"),
                 "period": new.get("period"), "reason": new.get("reason"), "sources": new.get("sources") or [],
                 "updated_at": _now()}
                if new else {"state": "unassessed", "origin": "ai"}
            )
            changed = had_ai_before and _decision_values(old_decision) != _decision_values(new_decision)
            item["decision"] = new_decision
            item["changed_by_redraft"] = bool(changed)
        items[key] = item
    for key, item in (draft.get("items") or {}).items():
        items.setdefault(key, item)
    out = dict(draft)
    out["items"] = items
    if narrative and (out.get("narrative") or {}).get("origin") != "manager":
        out["narrative"] = {**narrative, "origin": "ai"}
    return out


def _discuss_prompt(row: dict, scorecard: dict, catalog: list[dict], keys: dict[str, str], items: list[dict],
                    draft: dict, conversation: list[dict], message: str, focus_key: str | None) -> CachedPrompt:
    name = scorecard["direct_report"]["name"]
    focus = next((e for e in catalog if e["key"] == focus_key), None)
    current = []
    for entry in catalog:
        if focus and entry["key"] != focus["key"]:
            continue
        item = draft["items"][entry["key"]]
        d = item.get("decision") or {}
        cur = _describe(entry["kind"], entry, d) if d.get("state") == "include" else "left unassessed"
        current.append(f"  [{keys[entry['key']]}] {entry['name']}: current draft = {cur}" + (f" — reason: {d.get('reason')}" if d.get("reason") else ""))
    history = "\n".join(
        f"  {'MANAGER' if m['role'] == 'manager' else 'YOU'}: {m['text']}" for m in conversation[-10:]
        if (not focus_key or m.get("item_key") in (None, focus_key))
    ) or "  (no earlier discussion)"
    scope = f"the judgment on [{keys[focus['key']]}] {focus['name']}" if focus else "the whole assessment"
    # A discussion is a loop over the same records: the rules, the items in
    # scope, the records and the manager's context are the prefix and stay
    # cached from one message to the next; the draft as it stands, the
    # conversation and the new message are the body.
    prefix = f"""You are discussing {name}'s draft assessment for {row['review_period']} with their manager.
You can explain a judgment, challenge it, or propose a revision. The manager owns the judgment.

{_RULES}
- Do not simply agree. If the manager wants a different level, check it against the item's scale and the records. Revise only when the records or the manager's stated facts support it; otherwise explain what the records do and don't support.
- If the manager states a new fact in their message, you may use it and cite it as [U]; it is the manager's account, not a verified record.
- Concrete new claims need a source ref or [U]/[M] attribution.
- A revision changes one judgment and its reason only. Metrics: only a recorded reading or a number the manager stated.

ITEMS
{_item_block([e for e in catalog if not focus or e['key'] == focus['key']], keys)}

RECORDS
{_evidence_block(items)}

MANAGER CONTEXT
{_context_block(row)}"""
    body = f"""The topic is {scope}.

CURRENT DRAFT
{chr(10).join(current)}

DISCUSSION SO FAR
{history}

MANAGER'S MESSAGE [U]
  {message}

Return ONLY JSON:
{{
  "reply": "your answer to the manager, 1-5 sentences, plain and direct",
  "revisions": [{{"key": "K2", "point": 3, "value": null, "period": null, "reason": "the revised reason", "sources": ["S3", "U"]}}]
}}
"revisions" may be empty. Only propose a revision when you are actually suggesting a different level or wording."""
    return CachedPrompt(prefix, body)


def _summary_prompt(row: dict, scorecard: dict, catalog: list[dict], keys: dict[str, str], items: list[dict], draft: dict) -> CachedPrompt:
    name = scorecard["direct_report"]["name"]
    included, unassessed = [], []
    for entry in catalog:
        d = draft["items"][entry["key"]].get("decision") or {}
        if d.get("state") == "include":
            included.append(f"  [{keys[entry['key']]}] {entry['name']}: {_describe(entry['kind'], entry, d)}"
                            + (f" — {d['reason']}" if d.get("reason") else ""))
        else:
            unassessed.append(f"  [{keys[entry['key']]}] {entry['name']}"
                              + (f" (prior: {_describe(entry['kind'], entry, entry['prior'])}, {entry['prior'].get('date')}; not reassessed)" if entry.get("prior") else ""))
    # The summary is rewritten whenever the manager changes a judgment; the
    # rules and records (prefix) hold still, the judgments (body) are what moved.
    prefix = f"""Write the finished assessment summary for {name}, {row['review_period']}, from the manager's reviewed judgments given below. It will help the manager explain their view and start a useful conversation. It is not shared with {name} automatically.

{_RULES}
- The summary must agree exactly with the judgments listed. Do not add, raise or lower any judgment.
- Do not invent positive impact to make the summary feel complete. If evidence is thin, say so.
- Unassessed items are gaps or prior context, not findings for this period.

RECORDS
{_evidence_block(items)}

MANAGER CONTEXT
{_context_block(row)}"""
    body = f"""JUDGMENTS THE MANAGER IS CONFIRMING
{chr(10).join(included) or '  (none)'}

LEFT UNASSESSED
{chr(10).join(unassessed) or '  (none)'}

Return ONLY JSON:
{{
  "headline": "at most 10 words",
  "overview": "2-4 sentences in the manager's voice ('she', 'they'), consistent with the overall judgment if one is listed",
  "contributions": [{{"text": "a contribution to recognize", "sources": ["S1", "M"]}}],
  "strengths": [{{"text": "a strength the judgments and records support", "keys": ["K3"]}}],
  "attention": [{{"text": "an area needing attention or more observation", "keys": ["K2"]}}],
  "gaps": ["an acknowledged limit of the evidence"],
  "discussion": "one open question or opening line for the conversation with {name}, or null"
}}"""
    return CachedPrompt(prefix, body)


def _clean_summary(parsed: dict, ref_map: dict[str, str], key_back: dict[str, str]) -> dict:
    def listing(rows, field):
        out = []
        for r in rows or []:
            if isinstance(r, dict) and (r.get("text") or "").strip():
                if field == "sources":
                    out.append({"text": r["text"].strip(), "sources": _to_ids(r.get("sources"), ref_map)})
                else:
                    out.append({"text": r["text"].strip(), "keys": [key_back[k] for k in r.get("keys") or [] if k in key_back]})
        return out[:6]

    return {
        "headline": (parsed.get("headline") or "").strip()[:140],
        "overview": (parsed.get("overview") or "").strip(),
        "contributions": listing(parsed.get("contributions"), "sources"),
        "strengths": listing(parsed.get("strengths"), "keys"),
        "attention": listing(parsed.get("attention"), "keys"),
        "gaps": [g.strip() for g in parsed.get("gaps") or [] if isinstance(g, str) and g.strip()][:6],
        "discussion": (parsed.get("discussion") or "").strip() or None,
    }


def _keys_for(catalog: list[dict]) -> tuple[dict[str, str], dict[str, str]]:
    keys = {e["key"]: f"K{n}" for n, e in enumerate(catalog, start=1)}
    return keys, {v: k for k, v in keys.items()}


def _ai_json(prompt, max_tokens: int) -> dict:
    raw = generate_text(prompt, model=AI_DEFAULT_MODEL_HEAVY, max_tokens=max_tokens)
    return _parse_json(raw)


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class CreateReviewIn(BaseModel):
    direct_report_id: str
    cadence: Literal["quarterly", "biannual", "off_cycle"]
    period_start: date
    period_end: date
    mode: Literal["ai", "manual"] = "ai"


class UpdateReviewIn(BaseModel):
    version: int
    period_start: date | None = None
    period_end: date | None = None
    cadence: Literal["quarterly", "biannual", "off_cycle"] | None = None
    manager_context: str | None = None
    excluded_evidence: list[str] | None = None
    include_private: bool | None = None
    stage: Literal["picture", "draft", "review"] | None = None
    mode: Literal["ai", "manual"] | None = None
    acknowledge_context_change: bool = False
    narrative_overview: str | None = None


class DraftIn(BaseModel):
    version: int


class ItemActionIn(BaseModel):
    version: int
    action: Literal["set", "unassessed", "accept_proposal", "keep_proposal", "reaffirm_prior", "apply_revision", "dismiss_revision"]
    point: int | None = None
    value: float | None = None
    period: str | None = None
    reason: str | None = None


class DiscussIn(BaseModel):
    version: int
    message: str
    item_key: str | None = None


class SummaryEditIn(BaseModel):
    version: int
    headline: str | None = None
    overview: str | None = None
    discussion: str | None = None
    gaps: list[str] | None = None


class CompleteIn(BaseModel):
    version: int
    client_request_id: str | None = None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

def _report_or_404(supabase, user_id: str, report_id: str) -> dict:
    rows = (
        supabase.table("direct_reports").select("id,name").eq("id", report_id).eq("manager_id", user_id).limit(1).execute().data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Direct report not found")
    return rows[0]


def _check_period(start: date, end: date) -> None:
    if end < start:
        raise HTTPException(status_code=422, detail="The period must end on or after it starts.")
    if (end - start).days > 400:
        raise HTTPException(status_code=422, detail="An assessment period can be at most about a year.")


@router.get("")
def list_reviews(direct_report_id: str, auth=Depends(get_authenticated_client)):
    """Every assessment for one report, newest first: the open draft (if
    any) and completed assessments (without draft internals)."""
    user_id, supabase = auth
    _report_or_404(supabase, user_id, direct_report_id)
    rows = (
        supabase.table("performance_reviews")
        .select("id,status,stage,mode,cadence,period_start,period_end,review_period,rating_ordinal,summary,completed_at,updated_at,created_at")
        .eq("manager_id", user_id)
        .eq("direct_report_id", direct_report_id)
        .order("created_at", desc=True)
        .execute()
        .data
    )
    return rows


@router.post("")
def create_review(body: CreateReviewIn, auth=Depends(get_authenticated_client), authorization: str = Header(None)):
    """Start an assessment for an explicit period and gather its evidence.
    If a draft is already open for this person it is returned instead (with
    resumed = true) — never a second draft and never an overwrite."""
    user_id, supabase = auth
    _check_period(body.period_start, body.period_end)
    _report_or_404(supabase, user_id, body.direct_report_id)
    existing = (
        supabase.table("performance_reviews").select("*").eq("manager_id", user_id)
        .eq("direct_report_id", body.direct_report_id).eq("status", "draft").limit(1).execute().data
    )
    if existing:
        out = _respond(user_id, supabase, existing[0], authorization)
        out["resumed"] = True
        return out
    scorecard = _fetch_scorecard(user_id, supabase, body.direct_report_id, authorization)
    org = get_org(user_id, supabase)
    evidence = _regather(supabase, user_id, {}, scorecard, body.period_start, body.period_end, False)
    draft = _ensure_items({}, _catalog(scorecard))
    try:
        row = (
            supabase.table("performance_reviews")
            .insert({
                "manager_id": user_id,
                "direct_report_id": body.direct_report_id,
                "org_id": org["id"] if org else None,
                "review_period": _period_label(body.cadence, body.period_start, body.period_end),
                "cadence": body.cadence,
                "period_start": body.period_start.isoformat(),
                "period_end": body.period_end.isoformat(),
                "status": "draft",
                "stage": "picture" if body.mode == "ai" else "draft",
                "mode": body.mode,
                "evidence": evidence,
                "draft": draft,
            })
            .execute()
            .data[0]
        )
    except APIError as err:
        # Lost a race with another tab creating the same draft.
        if getattr(err, "code", None) == "23505":
            existing = (
                supabase.table("performance_reviews").select("*").eq("manager_id", user_id)
                .eq("direct_report_id", body.direct_report_id).eq("status", "draft").limit(1).execute().data
            )
            if existing:
                out = _respond(user_id, supabase, existing[0], authorization)
                out["resumed"] = True
                return out
        raise
    out = _present(row, scorecard)
    out["resumed"] = False
    return out


@router.get("/{review_id}")
def get_review(review_id: str, auth=Depends(get_authenticated_client), authorization: str = Header(None)):
    user_id, supabase = auth
    return _respond(user_id, supabase, _load(supabase, user_id, review_id), authorization)


@router.delete("/{review_id}")
def discard_review(review_id: str, auth=Depends(get_authenticated_client)):
    """Discard an open draft. A completed assessment can't be deleted here."""
    user_id, supabase = auth
    row = _load(supabase, user_id, review_id)
    if row["status"] != "draft":
        raise HTTPException(status_code=409, detail="A completed assessment can't be discarded.")
    supabase.table("performance_reviews").delete().eq("id", review_id).eq("manager_id", user_id).eq("status", "draft").execute()
    return {"ok": True}


@router.patch("/{review_id}")
def update_review(review_id: str, body: UpdateReviewIn, auth=Depends(get_authenticated_client), authorization: str = Header(None)):
    """Manager edits to the draft's inputs: period, context, exclusions,
    the private-material opt-in, stage, and the draft narrative. A period or
    private change re-gathers the evidence set (the picture is then marked
    out of date, never silently rewritten)."""
    user_id, supabase = auth
    holder: dict = {}

    def change(row: dict) -> dict:
        changes: dict = {}
        start = body.period_start or date.fromisoformat(row["period_start"])
        end = body.period_end or date.fromisoformat(row["period_end"])
        cadence = body.cadence or row.get("cadence")
        period_changed = (start.isoformat() != row["period_start"] or end.isoformat() != row["period_end"])
        private_changed = body.include_private is not None and body.include_private != row.get("include_private")
        if period_changed:
            _check_period(start, end)
            changes.update(period_start=start.isoformat(), period_end=end.isoformat())
        if period_changed or (body.cadence and body.cadence != row.get("cadence")):
            changes.update(cadence=cadence, review_period=_period_label(cadence, start, end))
        if body.include_private is not None:
            changes["include_private"] = body.include_private
        if period_changed or private_changed:
            sc = _scorecard_for(user_id, supabase, row, authorization)
            holder["scorecard"] = sc
            changes["evidence"] = _regather(supabase, user_id, row, sc, start, end,
                                            body.include_private if body.include_private is not None else bool(row.get("include_private")))
        if body.manager_context is not None:
            changes["manager_context"] = body.manager_context.strip()[:8000] or None
        if body.excluded_evidence is not None:
            changes["excluded_evidence"] = sorted(set(body.excluded_evidence))
        if body.stage is not None:
            changes["stage"] = body.stage
        if body.mode is not None:
            changes["mode"] = body.mode
        draft = dict(row.get("draft") or {})
        draft_changed = False
        if body.narrative_overview is not None:
            narrative = dict(draft.get("narrative") or {})
            narrative.update(overview=body.narrative_overview.strip(), origin="manager")
            draft["narrative"] = narrative
            draft_changed = True
        if body.acknowledge_context_change:
            draft["context_fingerprint"] = _context_fingerprint({**row, **changes})
            draft_changed = True
        if draft_changed:
            changes["draft"] = draft
        return changes

    row = _mutate(supabase, user_id, review_id, change, body.version)
    return _present(row, holder.get("scorecard") or _scorecard_for(user_id, supabase, row, authorization))


@router.post("/{review_id}/gather")
def regather(review_id: str, body: DraftIn, auth=Depends(get_authenticated_client), authorization: str = Header(None)):
    """Re-read the records for the current period (e.g. after a retrieval
    failure or new records)."""
    user_id, supabase = auth
    holder: dict = {}

    def change(row: dict) -> dict:
        sc = _scorecard_for(user_id, supabase, row, authorization)
        holder["scorecard"] = sc
        return {"evidence": _regather(supabase, user_id, row, sc, date.fromisoformat(row["period_start"]),
                                      date.fromisoformat(row["period_end"]), bool(row.get("include_private")))}

    row = _mutate(supabase, user_id, review_id, change, body.version)
    return _present(row, holder["scorecard"])


@router.post("/{review_id}/picture")
@limiter.limit("10/minute")
def build_picture(request: Request, review_id: str, auth=Depends(get_authenticated_client), authorization: str = Header(None)):
    """AI account of the period from the gathered records. Sparse records get
    an honest 'little on record' state without an AI call; a failure is
    stored and recoverable, and never blocks drafting or manual assessment."""
    user_id, supabase = auth
    row = _load(supabase, user_id, review_id)
    if row["status"] != "draft":
        raise HTTPException(status_code=409, detail="This assessment is already completed.")
    scorecard = _scorecard_for(user_id, supabase, row, authorization)
    items = _usable_evidence(row)
    evidence_at = (row.get("evidence") or {}).get("generated_at")
    in_period = [i for i in items if i["timing"] == "in_period"]
    if not in_period:
        picture = {"sparse": True, "generated_at": _now(), "evidence_generated_at": evidence_at}
    else:
        try:
            parsed = _ai_json(_picture_prompt(row, scorecard, items), 1400)
            picture = {**_clean_picture(parsed, _ref_map(items)), "generated_at": _now(), "evidence_generated_at": evidence_at}
        except Exception:
            logger.warning("assessment picture generation failed", exc_info=True)
            picture = {"error": "The summary couldn't be written just now. Your records are gathered below — try again, draft anyway, or assess manually.",
                       "generated_at": None, "evidence_generated_at": evidence_at}
    row = _mutate(supabase, user_id, review_id, lambda r: {"picture": picture}, None)
    return _present(row, scorecard)


@router.post("/{review_id}/draft")
@limiter.limit("10/minute")
def draft_judgments(request: Request, review_id: str, body: DraftIn, auth=Depends(get_authenticated_client), authorization: str = Header(None)):
    """Confirm the context and draft judgments. The confirmation approves the
    inputs only. Proposals are validated against each item's own scale and
    the evidence rules, then merged without overwriting the manager."""
    user_id, supabase = auth
    row = _load(supabase, user_id, review_id)
    if row["status"] != "draft":
        raise HTTPException(status_code=409, detail="This assessment is already completed.")
    if row["version"] != body.version:
        raise HTTPException(status_code=409, detail="This assessment changed in another window. Reload to see the latest.")
    scorecard = _scorecard_for(user_id, supabase, row, authorization)
    catalog = _catalog(scorecard)
    items = _usable_evidence(row)
    keys, key_back = _keys_for(catalog)
    ref_map = _ref_map(items)
    evidence_by_id = {i["id"]: i for i in items}
    context_fp = _context_fingerprint(row)
    try:
        parsed = _ai_json(_draft_prompt(row, scorecard, catalog, keys, items), 3500)
    except Exception:
        logger.warning("assessment draft generation failed", exc_info=True)

        def failed(r: dict) -> dict:
            d = dict(r.get("draft") or {})
            d["last_error"] = "The draft couldn't be generated just now. Nothing you entered was lost — try again or continue manually."
            return {"draft": d, "stage": "draft"}

        row = _mutate(supabase, user_id, review_id, failed, None)
        return _present(row, scorecard)

    by_key = {e["key"]: e for e in catalog}
    proposals: dict[str, dict] = {}
    unassessed: dict[str, str] = {}
    for j in parsed.get("judgments") or []:
        if not isinstance(j, dict):
            continue
        key = key_back.get(str(j.get("key")))
        if not key or key in proposals:
            continue
        proposal, why = _clean_proposal(by_key[key], j, ref_map, evidence_by_id, {MANAGER_CONTEXT_ID: row.get("manager_context") or ""})
        if proposal:
            proposals[key] = proposal
        else:
            unassessed[key] = why
    for u in parsed.get("unassessed") or []:
        if isinstance(u, dict):
            key = key_back.get(str(u.get("key")))
            if key and key not in proposals:
                unassessed.setdefault(key, (u.get("why") or "").strip() or "Not enough evidence to judge this item.")
    narrative = parsed.get("narrative") if isinstance(parsed.get("narrative"), dict) else None
    if narrative:
        narrative = {"headline": (narrative.get("headline") or "").strip()[:140], "overview": (narrative.get("overview") or "").strip()}

    def merge(r: dict) -> dict:
        d = _merge_draft(r.get("draft") or {}, catalog, proposals, unassessed, narrative)
        d["generated_at"] = _now()
        d["context_fingerprint"] = context_fp
        d["last_error"] = None
        return {"draft": d, "stage": "draft", "mode": "ai"}

    row = _mutate(supabase, user_id, review_id, merge, None)
    return _present(row, scorecard)


def _judgment_text(d: dict | None) -> str:
    d = d or {}
    parts = [str(d[k]) for k in ("point", "value", "period") if d.get(k) is not None]
    return " ".join(parts + [d.get("reason") or ""])


def _draft_resolution(action: str, item: dict, decision: dict) -> dict | None:
    """What one item action says about the AI's draft, for ai_draft_resolved
    (E7). Fires once per proposal: the first manager action on an untouched
    AI judgment, or the apply/dismiss of a redraft revision. None otherwise."""
    if action in ("apply_revision", "dismiss_revision"):
        return {
            "outcome": "accepted" if action == "apply_revision" else "discarded",
            "edit_bucket": "none",
            "seconds_to_confirm": analytics.seconds_since((item.get("revision") or {}).get("created_at")),
        }
    old = item.get("decision") or {}
    if old.get("origin") != "ai" or not item.get("proposal"):
        return None
    secs = analytics.seconds_since(old.get("updated_at"))
    if action in ("accept_proposal", "keep_proposal"):
        return {"outcome": "accepted", "edit_bucket": "none", "seconds_to_confirm": secs}
    if action == "set":
        bucket = analytics.edit_bucket(_judgment_text(item["proposal"]), _judgment_text(decision))
        return {"outcome": "accepted", "edit_bucket": bucket, "seconds_to_confirm": secs}
    # unassessed, or the manager's own prior judgment over the AI's
    return {"outcome": "discarded", "edit_bucket": "none", "seconds_to_confirm": secs}


@router.post("/{review_id}/items/{item_key}")
def item_action(review_id: str, item_key: str, body: ItemActionIn, auth=Depends(get_authenticated_client), authorization: str = Header(None)):
    """One manager decision on one item. Only that item changes."""
    user_id, supabase = auth
    holder: dict = {}

    def change(row: dict) -> dict:
        sc = _scorecard_for(user_id, supabase, row, authorization)
        holder["scorecard"] = sc
        catalog = _catalog(sc)
        entry = next((e for e in catalog if e["key"] == item_key), None)
        if not entry:
            raise HTTPException(status_code=404, detail="That expectation isn't configured for this person any more.")
        draft = _ensure_items(row.get("draft") or {}, catalog)
        item = dict(draft["items"][item_key])
        before = dict(item)
        decision = dict(item.get("decision") or {})
        now = _now()
        points = {s["point"] for s in entry["scale"]}

        def judged(src: dict, origin: str) -> dict:
            return {"state": "include", "origin": origin, "point": src.get("point"), "value": src.get("value"),
                    "period": src.get("period"), "reason": src.get("reason"), "sources": src.get("sources") or [],
                    "updated_at": now}

        if body.action == "set":
            new = {**decision, "state": "include", "origin": "manager", "updated_at": now}
            if entry["kind"] == "metric":
                if body.value is not None:
                    if not math.isfinite(body.value):
                        raise HTTPException(status_code=422, detail="A metric reading must be a finite number.")
                    new["value"] = body.value
                if body.period is not None:
                    new["period"] = body.period.strip() or None
                new["point"] = None
            elif body.point is not None:
                if body.point not in points:
                    raise HTTPException(status_code=422, detail="That point isn't on this item's scale.")
                new["point"] = body.point
            if body.reason is not None:
                new["reason"] = body.reason.strip() or None
            decision = new
        elif body.action == "unassessed":
            decision = {"state": "unassessed", "origin": "manager", "updated_at": now}
        elif body.action in ("accept_proposal", "keep_proposal"):
            if not item.get("proposal"):
                raise HTTPException(status_code=409, detail="There is no proposal for this item.")
            decision = judged(item["proposal"], "ai_confirmed")
        elif body.action == "reaffirm_prior":
            prior = entry.get("prior")
            if not prior:
                raise HTTPException(status_code=409, detail="There is no prior judgment to reaffirm.")
            if entry["kind"] == "metric":
                # An earlier reading is not this period's reading.
                raise HTTPException(status_code=409, detail="A metric needs this period's own reading — enter it or leave it unassessed.")
            decision = judged({**prior, "reason": body.reason if body.reason is not None else prior.get("reason")}, "reaffirmed")
        elif body.action == "apply_revision":
            if not item.get("revision"):
                raise HTTPException(status_code=409, detail="There is no revision waiting for this item.")
            decision = judged(item["revision"], "ai_revision")
            item["revision"] = None
        elif body.action == "dismiss_revision":
            item["revision"] = None
        item["decision"] = decision
        item["changed_by_redraft"] = False
        draft["items"] = {**draft["items"], item_key: item}
        holder["resolution"] = _draft_resolution(body.action, before, decision)
        return {"draft": draft}

    row = _mutate(supabase, user_id, review_id, change, body.version)
    if holder.get("resolution"):
        analytics.ai_draft_resolved(user_id, surface="assessment_item", **holder["resolution"])
    return _present(row, holder["scorecard"])


@router.post("/{review_id}/discuss")
@limiter.limit("20/minute")
def discuss(request: Request, review_id: str, body: DiscussIn, auth=Depends(get_authenticated_client), authorization: str = Header(None)):
    """One turn of assessment-specific conversation. The reply and any
    revision are stored; a revision is a visible proposal the manager applies
    or keeps — it never changes a decision by itself."""
    user_id, supabase = auth
    message = body.message.strip()
    if not message:
        raise HTTPException(status_code=422, detail="Write a message first.")
    row = _load(supabase, user_id, review_id)
    if row["status"] != "draft":
        raise HTTPException(status_code=409, detail="This assessment is already completed.")
    if row["version"] != body.version:
        raise HTTPException(status_code=409, detail="This assessment changed in another window. Reload to see the latest.")
    scorecard = _scorecard_for(user_id, supabase, row, authorization)
    catalog = _catalog(scorecard)
    if body.item_key and body.item_key not in {e["key"] for e in catalog}:
        raise HTTPException(status_code=404, detail="That expectation isn't configured for this person any more.")
    keys, key_back = _keys_for(catalog)
    items = _usable_evidence(row)
    draft = _ensure_items(row.get("draft") or {}, catalog)
    conversation = list(row.get("conversation") or [])
    manager_msg = {"id": f"m{len(conversation) + 1}-{int(datetime.now().timestamp())}", "role": "manager", "text": message[:4000],
                   "item_key": body.item_key, "created_at": _now()}
    reply_msg: dict
    revisions: dict[str, dict] = {}
    try:
        parsed = _ai_json(_discuss_prompt(row, scorecard, catalog, keys, items, draft, conversation, message, body.item_key), 1500)
        message_id = f"message:{manager_msg['id']}"
        ref_map = {**_ref_map(items), "U": message_id}
        evidence_by_id = {i["id"]: i for i in items}
        stated = {MANAGER_CONTEXT_ID: row.get("manager_context") or "", message_id: message}
        for rv in parsed.get("revisions") or []:
            if not isinstance(rv, dict):
                continue
            key = key_back.get(str(rv.get("key")))
            if not key or (body.item_key and key != body.item_key):
                continue
            entry = next(e for e in catalog if e["key"] == key)
            proposal, _why = _clean_proposal(entry, rv, ref_map, evidence_by_id, stated)
            if proposal:
                revisions[key] = proposal
        reply_msg = {"id": f"a{len(conversation) + 2}-{int(datetime.now().timestamp())}", "role": "assistant",
                     "text": (parsed.get("reply") or "").strip() or "I don't have more to add from the records.",
                     "item_key": body.item_key, "revision_keys": list(revisions), "created_at": _now()}
    except Exception:
        logger.warning("assessment discussion failed", exc_info=True)
        reply_msg = {"id": f"a{len(conversation) + 2}-{int(datetime.now().timestamp())}", "role": "assistant", "error": True,
                     "text": "I couldn't answer just now. Your message is kept — try again, or edit the judgment directly.",
                     "item_key": body.item_key, "revision_keys": [], "created_at": _now()}

    def merge(r: dict) -> dict:
        d = _ensure_items(r.get("draft") or {}, catalog)
        for key, prop in revisions.items():
            item = dict(d["items"][key])
            item["revision"] = {**{k: prop.get(k) for k in ("point", "value", "period", "reason", "sources")},
                                "source": "discussion", "message_id": reply_msg["id"], "created_at": _now()}
            d["items"] = {**d["items"], key: item}
        conv = list(r.get("conversation") or []) + [manager_msg, reply_msg]
        return {"draft": d, "conversation": conv[-MAX_CONVERSATION:]}

    row = _mutate(supabase, user_id, review_id, merge, None)
    return _present(row, scorecard)


@router.post("/{review_id}/summary")
@limiter.limit("10/minute")
def write_summary(request: Request, review_id: str, body: DraftIn, auth=Depends(get_authenticated_client), authorization: str = Header(None)):
    """AI summary of the judgments the manager is about to confirm, for the
    final review. Tied to those judgments: any later change marks it out of
    date and completion waits for a refresh or the manager's own edit."""
    user_id, supabase = auth
    row = _load(supabase, user_id, review_id)
    if row["status"] != "draft":
        raise HTTPException(status_code=409, detail="This assessment is already completed.")
    if row["version"] != body.version:
        raise HTTPException(status_code=409, detail="This assessment changed in another window. Reload to see the latest.")
    scorecard = _scorecard_for(user_id, supabase, row, authorization)
    catalog = _catalog(scorecard)
    keys, key_back = _keys_for(catalog)
    items = _usable_evidence(row)
    draft = _ensure_items(row.get("draft") or {}, catalog)
    fp = _summary_fingerprint(draft)
    try:
        parsed = _ai_json(_summary_prompt(row, scorecard, catalog, keys, items, draft), 1800)
        summary = {**_clean_summary(parsed, _ref_map(items), key_back), "origin": "ai", "generated_at": _now(), "fingerprint": fp}
        error = None
    except Exception:
        logger.warning("assessment summary generation failed", exc_info=True)
        summary, error = None, "The summary couldn't be written just now. You can try again, write your own, or complete without one."

    def merge(r: dict) -> dict:
        d = _ensure_items(r.get("draft") or {}, catalog)
        if summary is not None:
            if _summary_fingerprint(d) != fp:
                d["summary_error"] = "Your judgments changed while the summary was being written — refresh it."
            else:
                d["summary"] = summary
                d["summary_error"] = None
        else:
            d["summary_error"] = error
        return {"draft": d, "stage": "review"}

    row = _mutate(supabase, user_id, review_id, merge, None)
    return _present(row, scorecard)


@router.put("/{review_id}/summary")
def edit_summary(review_id: str, body: SummaryEditIn, auth=Depends(get_authenticated_client), authorization: str = Header(None)):
    """The manager's own edit of the summary. Their wording is what gets
    confirmed; editing it with the current judgments on screen brings it up
    to date."""
    user_id, supabase = auth
    holder: dict = {}

    def change(row: dict) -> dict:
        sc = _scorecard_for(user_id, supabase, row, authorization)
        holder["scorecard"] = sc
        d = _ensure_items(row.get("draft") or {}, _catalog(sc))
        s = dict(d.get("summary") or {"contributions": [], "strengths": [], "attention": [], "gaps": []})
        for field in ("headline", "overview", "discussion"):
            val = getattr(body, field)
            if val is not None:
                s[field] = val.strip() or None
        if body.gaps is not None:
            s["gaps"] = [g.strip() for g in body.gaps if g.strip()]
        s.update(origin="manager", fingerprint=_summary_fingerprint(d), edited_at=_now())
        d["summary"] = s
        d["summary_error"] = None
        return {"draft": d}

    row = _mutate(supabase, user_id, review_id, change, body.version)
    return _present(row, holder["scorecard"])


def _build_completion(row: dict, scorecard: dict) -> tuple[dict, list[str]]:
    """The exact payload complete_performance_review() writes, plus the
    frozen snapshot. Returns (payload, problems); problems block completion."""
    catalog = _catalog(scorecard)
    draft = _ensure_items(row.get("draft") or {}, catalog)
    evidence = {i["id"]: i for i in (row.get("evidence") or {}).get("items") or []}
    conversation = {m["id"]: m for m in row.get("conversation") or []}
    problems: list[str] = []
    payload: dict = {"overall": None, "skills": [], "values": [], "metrics": []}
    snap_items, unassessed = [], []

    def source_snapshot(ids: list[str]) -> list[dict]:
        out = []
        for sid in ids or []:
            if sid == MANAGER_CONTEXT_ID:
                out.append({"id": sid, "kind": "manager_context", "title": "Context you added", "detail": row.get("manager_context") or "",
                            "attribution": "Manager-provided context"})
            elif sid.startswith("message:"):
                m = conversation.get(sid.split(":", 1)[1])
                out.append({"id": sid, "kind": "manager_message", "title": "What you said in the discussion",
                            "detail": (m or {}).get("text", ""), "attribution": "Manager-provided context"})
            elif sid in evidence:
                e = evidence[sid]
                out.append({k: e.get(k) for k in ("id", "kind", "date", "title", "detail", "attribution", "timing", "private")})
        return out

    for entry in catalog:
        item = draft["items"][entry["key"]]
        d = item.get("decision") or {}
        base = {"key": entry["key"], "kind": entry["kind"], "name": entry["name"], "expectation": entry.get("expectation"),
                "scale": entry["scale"], "prior": entry.get("prior")}
        if entry["kind"] == "metric" and entry.get("target_status"):
            # Frozen with the rest of the standard: a later approved target
            # never rewrites what this assessment was judged against.
            base["target"] = entry.get("target")
            base["target_status"] = entry.get("target_status")
        if d.get("state") != "include":
            unassessed.append({**base, "why": item.get("unassessed_reason")})
            continue
        if item.get("revision"):
            problems.append(f"{entry['name']}: a revised judgment is still waiting — apply it or keep the current one.")
        reason = (d.get("reason") or "").strip() or None
        # Sources travel with the decision that cited them (AI proposal, applied
        # revision). A manager's own judgment carries no generated citation.
        sources = d.get("sources") or []
        snap = {**base, "origin": d.get("origin"), "reason": reason, "sources": source_snapshot(sources)}
        if entry["kind"] == "metric":
            value, period = d.get("value"), (d.get("period") or "").strip()
            if value is None or not isinstance(value, (int, float)) or not math.isfinite(value):
                problems.append(f"{entry['name']}: enter the reading or leave it unassessed.")
                continue
            if not period:
                problems.append(f"{entry['name']}: add the measurement period for this reading.")
                continue
            # Confirming a reading that is already on record for this period
            # must not log it a second time.
            existing = next((e for e in evidence.values() if e["kind"] == "metric_entry" and e.get("config_id") == entry["config_id"]
                             and _num_eq(e.get("value"), value) and (e.get("reading_period") or "").strip() == period), None)
            if existing:
                snap.update(value=value, period=period, existing_reading=existing["id"])
            else:
                payload["metrics"].append({"config_id": entry["config_id"], "value": value, "period": period, "notes": reason})
                snap.update(value=value, period=period)
        else:
            point = d.get("point")
            if point not in {s["point"] for s in entry["scale"]}:
                problems.append(f"{entry['name']}: choose a point on its scale or leave it unassessed.")
                continue
            snap.update(point=point, meaning=next((s["meaning"] for s in entry["scale"] if s["point"] == point), ""))
            if entry["kind"] == "overall":
                payload["overall"] = {"level_ordinal": point, "notes": reason}
            else:
                payload["skills" if entry["kind"] == "skill" else "values"].append(
                    {"config_id": entry["config_id"], "evaluation_point": point, "notes": reason})
        snap_items.append(snap)

    if not snap_items:
        problems.append("Include at least one judgment — or discard this assessment.")
    summary = draft.get("summary")
    if summary and summary.get("fingerprint") != _summary_fingerprint(draft):
        problems.append("The summary was written before your latest changes — refresh it or edit it.")
    if draft.get("generated_at") and draft.get("context_fingerprint") != _context_fingerprint(row):
        problems.append("Your context or sources changed after the draft — redraft, or keep the draft as it is.")

    evidence_meta = row.get("evidence") or {}
    payload["summary"] = " ".join(x for x in [(summary or {}).get("headline"), (summary or {}).get("overview")] if x) or None
    payload["snapshot"] = {
        "period": {"label": row["review_period"], "start": row["period_start"], "end": row["period_end"], "cadence": row.get("cadence")},
        "person": {"id": scorecard["direct_report"]["id"], "name": scorecard["direct_report"]["name"], "role": _role_label(scorecard)},
        "mode": row.get("mode"),
        "items": snap_items,
        "unassessed": unassessed,
        "summary": {k: v for k, v in (summary or {}).items() if k != "fingerprint"} or None,
        "narrative": draft.get("narrative"),
        "manager_context": row.get("manager_context"),
        "picture": {k: (row.get("picture") or {}).get(k) for k in ("headline", "summary", "contributions", "impact", "gaps")}
        if (row.get("picture") or {}).get("generated_at") else None,
        "evidence": [i for i in evidence_meta.get("items") or [] if i["id"] not in set(row.get("excluded_evidence") or [])],
        "excluded_count": len(row.get("excluded_evidence") or []),
        "coverage": evidence_meta.get("coverage") or [],
        "include_private": bool(row.get("include_private")),
        "evidence_generated_at": evidence_meta.get("generated_at"),
        "levels": [{"point": lv["ordinal"], "meaning": lv["label"]} for lv in scorecard.get("levels") or []],
        "shared_with_report": False,
    }
    return payload, problems


@router.post("/{review_id}/complete")
def complete_review(review_id: str, body: CompleteIn, auth=Depends(get_authenticated_client), authorization: str = Header(None)):
    """Record the reviewed assessment. The client sends the version the
    manager reviewed; anything changed since is refused. One transaction;
    a retry returns the completed assessment without writing again."""
    user_id, supabase = auth
    row = _load(supabase, user_id, review_id)
    if row["status"] == "completed":
        out = _present(row, None)
        out["already_completed"] = True
        return out
    if row["version"] != body.version:
        raise HTTPException(status_code=409, detail="This assessment changed after you reviewed it. Review it again before completing.")
    scorecard = _scorecard_for(user_id, supabase, row, authorization)
    payload, problems = _build_completion(row, scorecard)
    if problems:
        raise HTTPException(status_code=422, detail={"message": "A few things need your attention before completing.", "problems": problems})
    try:
        rows = supabase.rpc("complete_performance_review", {
            "p_review_id": review_id,
            "p_expected_version": body.version,
            "p_payload": payload,
            "p_client_request_id": body.client_request_id,
        }).execute().data
    except APIError as err:
        status = _RPC_ERRORS.get(getattr(err, "code", None) or "")
        if status is None:
            raise
        raise HTTPException(status_code=status, detail=getattr(err, "message", None) or "Couldn't complete the assessment")
    done = rows[0] if isinstance(rows, list) and rows else rows
    if not done or done.get("status") != "completed":
        raise HTTPException(status_code=500, detail="The assessment wasn't confirmed as completed. Nothing was recorded — try again.")
    out = _present(done, None)
    out["already_completed"] = False
    return out
