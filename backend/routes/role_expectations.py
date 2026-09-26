"""
Roles & expectations — the working flow in front of the approved expectations
(2026-09-26, docs/systems/expectations.md; design:
docs/design-proposals/2026-09-26-role-expectations/BUILD_BRIEF.md).

Approved expectations stay where every consumer already reads them —
metric_configs / skill_configs / value_configs via fetch_role_expectations().
This module owns the layer in front of them:

  - role_expectation_drafts: one working draft (a new role) or working
    revision (an approved role being refined) per role level. Saving it never
    touches the active expectations.
  - role_expectation_decisions: details the manager chose to come back to,
    with a follow-up date. They survive approval and keep the role in Needs
    review until an approved revision resolves them.
  - approve_role_expectation_draft() (SQL): the only publication path, one
    transaction.

The plain-language role document maps onto the existing model without asking
the manager to classify anything:

    Responsibility with a number  -> metric_configs (target + target_status)
    Responsibility judged by eye  -> skill_configs, area = 'responsibility'
    Skill / observable behavior   -> skill_configs, area = 'skill'
    Role-specific value           -> value_configs (company values stay
                                     org-wide: role_level_id IS NULL)

Numbers are never invented. Every number in AI-proposed text must already be
in the job description, the manager's notes, the manager's own wording or the
manager's answers;
anything else is removed before it reaches the draft, and a target the source
does not state stays unresolved — never zero, never a benchmark.

AI writes are draft-then-review: composition and reanalysis only produce draft
items (for a brand-new draft), questions and separately reviewable
suggestions. Nothing AI-written reaches the active record without the manager
approving the whole role definition.

The manager's notes ("context") sit beside the job description: how the role
has changed since the description was written, what they expect now. They are
kept on the draft (analysis.context — no schema change) so every reanalysis
sees them. Where the notes and the description disagree, the notes win, and a
target the manager states in them is a stated target (source 'manager').
"""
from __future__ import annotations

import base64
import json
import logging
import re
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Request, UploadFile
from postgrest.exceptions import APIError
from pydantic import BaseModel

import analytics
from ai_core import generate_text, generate_text_from_document
from config import AI_DEFAULT_MODEL_HEAVY
from routes.documents import _MAX_UPLOAD_BYTES
from routes.expectations_ai import _compute_coverage
from routes.roles_import import (
    ImportedRole,
    ImportMatch,
    _build_ladders_block,
    _extract_docx_text,
    _infer_import_type,
    _parse_json_object,
    _shortlist_families,
    _validate_match,
    _validate_role,
)
from utils import ensure_org, get_authenticated_client, get_email_from_token, limiter

logger = logging.getLogger(__name__)

router = APIRouter()

_RPC_ERRORS = {"P0002": 404, "40001": 409, "22023": 422, "28000": 401}

SECTIONS = ("responsibility", "skill", "value")
_ORDER_TYPES = {"primary", "secondary", "tertiary"}
_PERIODS = {"week", "month", "quarter", "annual", "none"}
_TOPICS = {"target", "measure", "scope", "wording", "other"}
_FIELDS = {"title", "responsibility", "meets", "exceeds"}
_MAX_AI_QUESTIONS = 3
_MAX_SUGGESTIONS = 5
_MAX_ITEMS = 40
_MAX_TEXT = 2000
_MAX_SOURCE = 60_000
_MAX_CONTEXT = 20_000
_NO_ID = "00000000-0000-0000-0000-000000000000"


# ---------------------------------------------------------------------------
# Numbers: the guard that keeps invented targets out
# ---------------------------------------------------------------------------

_NUM_RE = re.compile(r"(?<![A-Za-z])\d+(?:[.,]\d+)*")
# "1:1" is a meeting, not a number; "24/7" is a phrase.
_NUMBER_PHRASES = re.compile(r"\b1\s*:\s*1s?\b|\b24\s*/\s*7\b", re.IGNORECASE)


def _norm_number(raw: str) -> str:
    s = raw.replace(",", "")
    try:
        f = float(s)
    except ValueError:
        return s
    return str(int(f)) if f == int(f) else repr(f)


def numbers_in(text: str | None) -> set[str]:
    cleaned = _NUMBER_PHRASES.sub(" ", text or "")
    return {_norm_number(m.group(0)) for m in _NUM_RE.finditer(cleaned)}


def unsupported_numbers(text: str | None, allowed: set[str]) -> set[str]:
    return numbers_in(text) - allowed


def strip_unsupported(text: str | None, allowed: set[str]) -> tuple[str, bool]:
    """Drop every sentence that carries a number the corpus doesn't contain.
    Returns (text, changed)."""
    if not text:
        return "", False
    if not unsupported_numbers(text, allowed):
        return text.strip(), False
    parts = re.split(r"(?<=[.!?;])\s+", text.strip())
    kept = [p for p in parts if not unsupported_numbers(p, allowed)]
    return " ".join(kept).strip(), True


def _squash(s: str | None) -> str:
    return re.sub(r"\s+", " ", (s or "")).strip().lower()


# ---------------------------------------------------------------------------
# Items: shape, sanitizing, mapping to and from the config tables
# ---------------------------------------------------------------------------

def _clean_text(v, limit: int = _MAX_TEXT) -> str:
    return v.strip()[:limit] if isinstance(v, str) else ""


_KEY_RE = re.compile(r"n-[0-9a-f]{12}")


def _new_key() -> str:
    return f"n-{uuid.uuid4().hex[:12]}"


def normalize_item(raw: dict, *, default_origin: str = "manager") -> dict | None:
    """Coerce one item into the canonical draft shape. Unknown fields drop;
    invalid enums fall back. Returns None for an item with nothing in it."""
    if not isinstance(raw, dict):
        return None
    section = raw.get("section") if raw.get("section") in SECTIONS else "responsibility"
    title = _clean_text(raw.get("title"), 200)
    responsibility = _clean_text(raw.get("responsibility"))
    meets = _clean_text(raw.get("meets"))
    exceeds = _clean_text(raw.get("exceeds"))
    if not (title or responsibility or meets):
        return None
    measure = raw.get("measure") if raw.get("measure") in ("numeric", "judged") else "judged"
    if section != "responsibility":
        measure = "judged"
    period = raw.get("measurement_period") if raw.get("measurement_period") in _PERIODS else None
    target = None
    if section == "responsibility" and measure == "numeric":
        t = raw.get("target") if isinstance(raw.get("target"), dict) else None
        if t is None:
            # A numeric responsibility the manager never gave a target to.
            # Legacy approved rows carry target: null and keep it (their
            # target, if any, lives in their wording).
            target = None if raw.get("legacy_target") else {"status": "unresolved"}
        else:
            text = _clean_text(t.get("text"), 300)
            if t.get("status") == "set" and text:
                target = {
                    "status": "set",
                    "text": text,
                    "source": t.get("source") if t.get("source") in ("source", "manager") else "manager",
                    "quote": _clean_text(t.get("quote"), 600) or None,
                }
            else:
                target = {"status": "unresolved"}
    key = raw.get("key") if isinstance(raw.get("key"), str) and raw.get("key") else _new_key()
    config_kind = raw.get("config_kind") if raw.get("config_kind") in ("metrics", "skills", "values") else None
    config_id = raw.get("config_id") if isinstance(raw.get("config_id"), str) and raw.get("config_id") else None
    return {
        "key": key[:80],
        "config_id": config_id,
        "config_kind": config_kind if config_id else None,
        "section": section,
        "measure": measure,
        "title": title,
        "responsibility": responsibility,
        "meets": meets,
        "exceeds": exceeds,
        "measurement_period": period if measure == "numeric" else None,
        "order_type": raw.get("order_type") if raw.get("order_type") in _ORDER_TYPES else None,
        "value_type": raw.get("value_type") if raw.get("value_type") in ("team", "department") else None,
        "target": target,
        "legacy_target": bool(raw.get("legacy_target")) and target is None,
        "origin": raw.get("origin") if raw.get("origin") in ("source", "suggestion", "approved", "copied", "manager") else default_origin,
        "edited": bool(raw.get("edited")),
        "source_quote": _clean_text(raw.get("source_quote"), 600) or None,
    }


def item_kind(item: dict) -> str:
    if item["section"] == "responsibility" and item.get("measure") == "numeric":
        return "metrics"
    if item["section"] in ("responsibility", "skill"):
        return "skills"
    return "values"


def items_from_configs(expectations: dict) -> list[dict]:
    """Approved config rows -> draft items (a working revision's start).
    Org-wide values are not role items; they are shown alongside."""
    items: list[dict] = []
    for row in expectations.get("metrics") or []:
        status = row.get("target_status")
        target = None
        if status == "set" and row.get("target"):
            target = {"status": "set", "text": row["target"], "source": row.get("target_source") or "manager",
                      "quote": row.get("target_quote")}
        elif status == "unresolved":
            target = {"status": "unresolved"}
        items.append(normalize_item({
            "key": row["id"], "config_id": row["id"], "config_kind": "metrics",
            "section": "responsibility", "measure": "numeric",
            "title": row.get("metric_name"), "responsibility": row.get("description"),
            "meets": row.get("expectation"), "exceeds": row.get("exceeds"),
            "measurement_period": row.get("measurement_period"), "order_type": row.get("order_type"),
            "target": target, "legacy_target": status is None, "origin": "approved",
        }, default_origin="approved"))
    for row in expectations.get("skills") or []:
        items.append(normalize_item({
            "key": row["id"], "config_id": row["id"], "config_kind": "skills",
            "section": "responsibility" if row.get("area") == "responsibility" else "skill",
            "measure": "judged",
            "title": row.get("skill_name"), "responsibility": row.get("description"),
            "meets": row.get("expectation"), "exceeds": row.get("exceeds"),
            "order_type": row.get("order_type"), "origin": "approved",
        }, default_origin="approved"))
    for row in expectations.get("values") or []:
        if row.get("role_level_id") is None:
            continue
        items.append(normalize_item({
            "key": row["id"], "config_id": row["id"], "config_kind": "values",
            "section": "value", "title": row.get("value_name"),
            "meets": row.get("description"), "exceeds": row.get("exceeds"),
            "order_type": row.get("order_type"), "value_type": row.get("value_type"),
            "origin": "approved",
        }, default_origin="approved"))
    return [i for i in items if i]


# ---------------------------------------------------------------------------
# Questions
# ---------------------------------------------------------------------------

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_question(raw: dict) -> dict | None:
    if not isinstance(raw, dict):
        return None
    text = _clean_text(raw.get("question"), 400)
    if not text:
        return None
    status = raw.get("status") if raw.get("status") in ("open", "answered", "deferred", "dismissed") else "open"
    field = raw.get("field") if raw.get("field") in _FIELDS | {"target"} else None
    return {
        "id": raw.get("id") if isinstance(raw.get("id"), str) and raw.get("id") else f"q-{uuid.uuid4().hex[:12]}",
        "item_key": raw.get("item_key") if isinstance(raw.get("item_key"), str) and raw.get("item_key") else None,
        "topic": raw.get("topic") if raw.get("topic") in _TOPICS else "other",
        "question": text,
        "why": _clean_text(raw.get("why"), 400) or None,
        "answer_mode": "field" if raw.get("answer_mode") == "field" and field else "answer",
        "field": field,
        "status": status,
        "answer": _clean_text(raw.get("answer"), _MAX_TEXT) or None,
        "decision_id": raw.get("decision_id") if isinstance(raw.get("decision_id"), str) else None,
        "follow_up_on": raw.get("follow_up_on") if isinstance(raw.get("follow_up_on"), str) else None,
        "origin": raw.get("origin") if raw.get("origin") in ("system", "ai", "decision") else "ai",
        "created_at": raw.get("created_at") or _now_iso(),
    }


def target_question_id(item_key: str) -> str:
    return f"target:{item_key}"


def reconcile_questions(items: list[dict], questions: list[dict]) -> list[dict]:
    """System questions follow the draft: a numeric responsibility without a
    target always carries one explicit question (so the gap never depends on
    the AI noticing it), and it closes itself once a target is written.
    Questions about items that no longer exist drop unless they carry a
    decision (the approval then drops the decision too)."""
    by_key = {i["key"]: i for i in items}
    out: list[dict] = []
    seen_ids: set[str] = set()
    for q in questions:
        if q["item_key"] and q["item_key"] not in by_key and not q.get("decision_id"):
            continue
        if q["origin"] == "system" and q["topic"] == "target":
            item = by_key.get(q["item_key"] or "")
            if not item or item_kind(item) != "metrics" or not item.get("target"):
                if q.get("decision_id"):
                    q = {**q, "status": "dismissed"}
                else:
                    continue
            elif item["target"]["status"] == "set":
                if q.get("decision_id"):
                    q = {**q, "status": "answered", "answer": item["target"]["text"]}
                else:
                    continue
            elif q["status"] == "answered":
                # The target was cleared again: the question is open again.
                q = {**q, "status": "deferred" if q.get("decision_id") else "open", "answer": None}
        out.append(q)
        seen_ids.add(q["id"])
    for item in items:
        if item_kind(item) != "metrics" or not item.get("target") or item["target"]["status"] != "unresolved":
            continue
        qid = target_question_id(item["key"])
        if qid in seen_ids:
            continue
        name = item["title"] or "this responsibility"
        out.append(normalize_question({
            "id": qid,
            "item_key": item["key"],
            "topic": "target",
            "question": f"Is there an agreed target for “{name}”?",
            "why": "It's measured by a number, but no target has been set. Without one, results can be discussed "
                   "but not judged against a number — no target is treated as a standard.",
            "answer_mode": "field",
            "field": "target",
            "origin": "system",
        }))
    return out


def merge_client_questions(stored: list[dict], incoming: list[dict] | None) -> list[dict]:
    """Only the manager-owned parts of a question change through a save:
    the answer and open/answered/dismissed. Deferral goes through the
    decisions endpoint so it always has a persisted return path."""
    if incoming is None:
        return stored
    patch = {q.get("id"): q for q in incoming if isinstance(q, dict)}
    out = []
    for q in stored:
        p = patch.get(q["id"])
        if p:
            answer = _clean_text(p.get("answer"), _MAX_TEXT) or None
            status = p.get("status")
            # A missing target is closed by writing the target (or by making
            # the item unmeasured), never by dismissing its question.
            if q["topic"] == "target" and status in ("answered", "dismissed"):
                status = None
            if status in ("open", "answered", "dismissed") and not (q["status"] == "deferred" and status == "open"):
                if status == "answered" and not answer and q["answer_mode"] == "answer":
                    status = q["status"]
                q = {**q, "status": status}
            q = {**q, "answer": answer}
        out.append(q)
    return out


# ---------------------------------------------------------------------------
# Row presentation
# ---------------------------------------------------------------------------

def _role_title(role: dict) -> str:
    fam = role.get("role_families") or {}
    return role.get("job_role") or fam.get("name") or "Role"


def _fetch_role(supabase, role_level_id: str) -> dict:
    rows = (
        supabase.table("role_levels")
        .select("id,org_id,job_role,job_level,functional_team,job_responsibilities,role_family_id,role_families(id,name)")
        .eq("id", role_level_id)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Role not found")
    return rows[0]


def _approved_configs(supabase, role_level_id: str) -> dict:
    out = {}
    for kind, table, name_col in (("metrics", "metric_configs", "metric_name"),
                                  ("skills", "skill_configs", "skill_name"),
                                  ("values", "value_configs", "value_name")):
        out[kind] = (
            supabase.table(table).select("*").eq("role_level_id", role_level_id)
            .is_("retired_at", "null").order(name_col).execute().data
        )
    return out


def _org_values(supabase) -> list[dict]:
    rows = (
        supabase.table("value_configs").select("id,value_name,description,order_type")
        .is_("role_level_id", "null").is_("retired_at", "null").order("value_name").execute().data
    )
    return [{"id": r["id"], "name": r["value_name"], "description": r.get("description")} for r in rows]


def _people_for(supabase, role_level_id: str | None = None) -> list[dict]:
    q = supabase.table("direct_reports").select("id,name,role_level_id").is_("archived_at", "null")
    if role_level_id:
        q = q.eq("role_level_id", role_level_id)
    return q.order("name").execute().data


def _open_decisions(supabase, role_level_id: str | None = None) -> list[dict]:
    q = supabase.table("role_expectation_decisions").select("*").eq("status", "deferred")
    if role_level_id:
        q = q.eq("role_level_id", role_level_id)
    return q.order("follow_up_on").execute().data


def _load_draft(supabase, draft_id: str) -> dict:
    rows = supabase.table("role_expectation_drafts").select("*").eq("id", draft_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Draft not found")
    return rows[0]


def _require_open(draft: dict) -> None:
    if draft["status"] != "open":
        raise HTTPException(status_code=409, detail="This draft is no longer open — reload to see the current expectations.")


def _check_version(draft: dict, version: int | None) -> None:
    if version is not None and version != draft["version"]:
        raise HTTPException(status_code=409, detail="This draft changed in another tab. Reload to continue from the latest version.")


def _write_draft(supabase, draft: dict, patch: dict) -> dict:
    """Optimistic write: only lands if nobody else wrote since `draft` was read."""
    patch = {**patch, "version": draft["version"] + 1, "updated_at": _now_iso()}
    rows = (
        supabase.table("role_expectation_drafts").update(patch)
        .eq("id", draft["id"]).eq("version", draft["version"]).eq("status", "open")
        .execute().data
    )
    if not rows:
        raise HTTPException(status_code=409, detail="This draft changed in another tab. Reload to continue from the latest version.")
    return rows[0]


def _present_draft(supabase, draft: dict) -> dict:
    role = _fetch_role(supabase, draft["role_level_id"])
    approved = _approved_configs(supabase, draft["role_level_id"])
    approved_items = items_from_configs(approved)
    decisions = _open_decisions(supabase, draft["role_level_id"])
    return {
        "draft": draft,
        "role": {
            "id": role["id"],
            "title": _role_title(role),
            "job_level": role["job_level"],
            "family": role.get("role_families"),
            "job_responsibilities": role.get("job_responsibilities"),
        },
        "people": [{"id": p["id"], "name": p["name"]} for p in _people_for(supabase, draft["role_level_id"])],
        "org_values": _org_values(supabase),
        "approved_items": approved_items,
        "open_decisions": decisions,
    }


# ---------------------------------------------------------------------------
# Overview
# ---------------------------------------------------------------------------

def _is_due(follow_up_on: str | None, today: date) -> bool:
    try:
        return date.fromisoformat((follow_up_on or "")[:10]) <= today
    except ValueError:
        return True


@router.get("/overview")
def get_overview(auth=Depends(get_authenticated_client)):
    """Roles grouped by ladder, what's actionable (Needs review) and what is
    parked until a date (Coming back). Healthy roles are plain rows."""
    _, supabase = auth
    today = date.today()
    families = supabase.table("role_families").select("id,name").order("name").execute().data
    roles = (
        supabase.table("role_levels").select("id,job_role,job_level,role_family_id,job_responsibilities")
        .order("job_role").order("job_level").execute().data
    )
    people = _people_for(supabase)
    drafts = (
        supabase.table("role_expectation_drafts").select("id,role_level_id,kind,status,questions,items,updated_at,approved_at,analysis")
        .in_("status", ["open", "approved"]).execute().data
    )
    decisions = _open_decisions(supabase)

    counts: dict = {}
    for kind, table in (("metrics", "metric_configs"), ("skills", "skill_configs"), ("values", "value_configs")):
        cols = "id,role_level_id,area" if kind == "skills" else "id,role_level_id"
        for row in supabase.table(table).select(cols).is_("retired_at", "null").execute().data:
            rl = row.get("role_level_id")
            if not rl:
                continue
            bucket = counts.setdefault(rl, {"responsibilities": 0, "skills": 0, "values": 0})
            if kind == "metrics" or (kind == "skills" and row.get("area") == "responsibility"):
                bucket["responsibilities"] += 1
            elif kind == "skills":
                bucket["skills"] += 1
            else:
                bucket["values"] += 1

    open_by_role = {d["role_level_id"]: d for d in drafts if d["status"] == "open"}
    approved_at: dict = {}
    for d in drafts:
        if d["status"] == "approved" and d.get("approved_at"):
            if d["approved_at"] > approved_at.get(d["role_level_id"], ""):
                approved_at[d["role_level_id"]] = d["approved_at"]
    people_by_role: dict = {}
    for p in people:
        if p.get("role_level_id"):
            people_by_role.setdefault(p["role_level_id"], []).append({"id": p["id"], "name": p["name"]})
    decisions_by_role: dict = {}
    for dec in decisions:
        decisions_by_role.setdefault(dec["role_level_id"], []).append(dec)

    family_names = {f["id"]: f["name"] for f in families}

    def label(role: dict) -> str:
        fam = family_names.get(role.get("role_family_id") or "")
        return f"{role['job_role']} · Level {role['job_level']}" if role["job_role"] else f"{fam} · Level {role['job_level']}"

    levels_out = []
    needs_review = []
    coming_back = []
    for role in roles:
        c = counts.get(role["id"], {"responsibilities": 0, "skills": 0, "values": 0})
        has_approved = sum(c.values()) > 0
        draft = open_by_role.get(role["id"])
        role_decisions = decisions_by_role.get(role["id"], [])
        if draft:
            status = "revision" if draft["kind"] == "revision" and has_approved else "draft"
        elif has_approved:
            status = "approved"
        else:
            status = "none"

        draft_summary = None
        if draft:
            qs = draft.get("questions") or []
            open_qs = [q for q in qs if q.get("status") == "open"]
            deferred_qs = [q for q in qs if q.get("status") == "deferred"]
            first = (open_qs or deferred_qs or [None])[0]
            items = draft.get("items") or []
            first_open = first.get("question") if first else None
            draft_summary = {
                "id": draft["id"],
                "kind": draft["kind"],
                "updated_at": draft["updated_at"],
                "open_questions": len(open_qs),
                "deferred": len(deferred_qs),
                "items": len(items),
                "first_question": first_open,
                "focus": first.get("id") if first else None,
                "analysis_failed": (draft.get("analysis") or {}).get("status") == "failed",
            }
            detail_parts = []
            if draft["kind"] == "revision" and has_approved:
                kind_label = "Revision awaiting approval"
                detail_parts.append("Approved expectations stay in use until you approve this revision")
            else:
                kind_label = "Draft not yet approved"
            if first_open:
                detail_parts.insert(0, first_open)
            needs_review.append({
                "type": "revision" if status == "revision" else "draft",
                "role_level_id": role["id"],
                "label": label(role),
                "kind_label": kind_label,
                "detail": " · ".join(detail_parts) if detail_parts else "Ready to review",
                "focus": draft_summary["focus"],
                "updated_at": draft["updated_at"],
            })

        role_dec_out = []
        for dec in role_decisions:
            due = _is_due(dec.get("follow_up_on"), today)
            entry = {
                "id": dec["id"],
                "question": dec["question"],
                "topic": dec["topic"],
                "follow_up_on": dec["follow_up_on"],
                "due": due,
                "approved": dec.get("config_id") is not None,
                "item_key": dec.get("item_key"),
            }
            role_dec_out.append(entry)
            # A decision inside an open draft is part of that draft's entry.
            if draft or not entry["approved"]:
                continue
            item = {
                "type": "decision",
                "role_level_id": role["id"],
                "decision_id": dec["id"],
                "label": label(role),
                "kind_label": "Approved · one detail open",
                "detail": dec["question"],
                "follow_up_on": dec["follow_up_on"],
                "due": due,
                "focus": f"decision:{dec['id']}",
            }
            (needs_review if due else coming_back).append(item)

        levels_out.append({
            "role_level_id": role["id"],
            "role_family_id": role.get("role_family_id"),
            "job_role": role["job_role"],
            "job_level": role["job_level"],
            "has_source": bool((role.get("job_responsibilities") or "").strip()),
            "people": people_by_role.get(role["id"], []),
            "status": status,
            "counts": c,
            "approved_at": approved_at.get(role["id"]),
            "draft": draft_summary,
            "open_decisions": role_dec_out,
        })

    needs_review.sort(key=lambda x: (x["type"] == "decision", x.get("follow_up_on") or "", x["label"]))
    coming_back.sort(key=lambda x: x.get("follow_up_on") or "")
    return {
        "families": families,
        "levels": levels_out,
        "needs_review": needs_review,
        "coming_back": coming_back,
        "org_values": _org_values(supabase),
        "today": today.isoformat(),
    }


# ---------------------------------------------------------------------------
# AI: compose a first draft from a job description
# ---------------------------------------------------------------------------

_DOCUMENT_RULES = """How the role document is organised (the manager never has to classify anything — you do):
- "responsibility": what the role owns and the results it's accountable for. Set "measure" to "numeric" ONLY when the result is naturally tracked as a number (retention, revenue, response time, NPS, volume). Otherwise "judged".
- "skill": a capability or observable behavior the role needs, judged by observation.
- "value": ONLY a role-specific behavioral bar the job description clearly implies beyond the company values listed. Company values already apply to every role — never copy them into a role. Usually this list is empty.

For every item write:
- "title": 2-6 words, plain language.
- "responsibility": one sentence on what the role owns (for values, leave empty).
- "meets": what meeting expectations looks like, observable, one or two sentences.
- "exceeds": OPTIONAL. Only when there is a meaningful, observable step beyond meeting. Empty string is a good answer.
- "source_quote": the shortest exact phrase from the job description this item comes from, or "" if it comes from the manager's notes or is your proposal.

THE NUMBER RULE (non-negotiable): never write a number, percentage, count, time limit or target that is not written in the job description or the manager's notes. No benchmarks, no "typical" figures, no placeholders, no zero. If a numeric responsibility has no target in either, set "target" to null — the manager will be asked. If one of them states a target, copy it into "target": {"text": "...", "quote": "exact words from the job description or the manager's notes"}."""


_CONTEXT_RULES = """THE MANAGER'S NOTES are the current truth about this role; the job description is the starting point. The description may be out of date (written before a promotion or a change of scope) or generic. So:
- Where the notes and the job description disagree — title, scope, level, what the role owns, a target — follow the notes.
- Add what the notes add, even when the job description never mentions it.
- Drop or narrow job-description content the notes say no longer applies. Keep the rest.
- A target or number the manager states in the notes is a real, stated target."""


def _context_block(context: str | None) -> str:
    if not context:
        return ""
    return f"\nTHE MANAGER'S NOTES (typed or dictated alongside the job description):\n{context}\n\n{_CONTEXT_RULES}\n"


def _compose_prompt(*, jd_text: str | None, role_hint: str | None, ladders_block: str | None,
                    org_values: list[dict], sibling_block: str, include_identity: bool,
                    context: str | None = None) -> str:
    values_line = ", ".join(v["name"] for v in org_values) if org_values else "(none defined yet)"
    identity = ""
    if include_identity:
        identity = f"""
FIRST, identify the role and where it belongs among the company's existing ladders:

{ladders_block}

Include in your JSON:
  "is_job_description": true/false (false for anything that is not a job description — then return nothing else but "reason"),
  "reason": one sentence, only when false,
  "other_roles_note": one sentence when the document describes more than one role (draft the primary one only), else null,
  "role": {{"job_role": "clean title without seniority noise the level captures — the role as it is NOW (the manager's notes win over the job description's title)", "job_level": 1-10 inferred from seniority (default 1), "functional_team": null or the team named}},
  "match": {{"suggested_action": "attach" | "create_new" | "exists", "role_family_id": id or null, "existing_role_level_id": id or null, "confidence": "high" | "medium", "rationale": "one sentence"}},
"""
    jd = f"JOB DESCRIPTION (as supplied by the manager):\n{jd_text}" if jd_text else "The job description is attached as a document."
    return f"""You are helping a manager write down what good looks like for one role, so they can coach and assess against it. Produce a useful FIRST DRAFT from the job description{" and the manager's notes" if context else ""}, then at most {_MAX_AI_QUESTIONS} focused questions about real gaps or ambiguity in that draft. The manager edits everything before anything is used.
{f"ROLE: {role_hint}" if role_hint else ""}
{identity}
{jd}
{_context_block(context)}
Company values that already apply to every role: {values_line}
{sibling_block}
{_DOCUMENT_RULES}

QUESTIONS: ask only what the manager must decide and the job description and notes leave open — ambiguous scope, wording that can't be observed, a measure that's unclear. Do NOT ask about missing numeric targets (the app asks those itself). Refer to items by their index in your items array. Zero questions is fine.

Return ONLY valid JSON, no commentary:
{{
  {'"is_job_description": true, "reason": null, "other_roles_note": null, "role": {...}, "match": {...},' if include_identity else ''}
  "items": [{{"section": "responsibility", "measure": "numeric", "title": "...", "responsibility": "...", "meets": "...", "exceeds": "", "measurement_period": "quarter", "target": null, "source_quote": "...", "order_type": "primary"}}],
  "questions": [{{"item_index": 0, "topic": "scope" | "wording" | "measure" | "other", "question": "...", "why": "one short sentence on why it matters"}}]
}}

measurement_period is one of week, month, quarter, annual, none (numeric items only). order_type is primary (the 2-4 things that matter most), secondary or tertiary. Keep the draft honest and compact: 3-8 responsibilities, 2-5 skills."""


def sanitize_composed(parsed: dict, *, corpus_text: str, source_available: bool,
                      org_value_names: list[str] | None = None,
                      context_text: str | None = None) -> tuple[list[dict], list[dict], list[str]]:
    """Validate the model's items/questions. Returns (items, questions, notes).
    context_text is the manager's notes: its numbers are stated, and a target
    quoted from it is kept with source 'manager'."""
    context_sq = _squash(context_text)
    allowed = numbers_in(corpus_text) | numbers_in(context_text)
    stated_where = "job description or your notes" if context_sq else "job description"
    company_values = {_squash(n) for n in org_value_names or []}
    source_sq = _squash(corpus_text)
    notes: list[str] = []
    items: list[dict] = []
    index_to_key: dict[int, str] = {}
    seen_keys: set[str] = set()
    raw_items = parsed.get("items") if isinstance(parsed.get("items"), list) else []
    for idx, raw in enumerate(raw_items[:_MAX_ITEMS]):
        if not isinstance(raw, dict):
            continue
        raw = dict(raw)
        for field in ("title", "responsibility", "meets", "exceeds"):
            cleaned, changed = strip_unsupported(raw.get(field) if isinstance(raw.get(field), str) else "", allowed)
            if changed:
                notes.append(f"Removed a number that isn't in the {stated_where} from “{_clean_text(raw.get('title'), 80)}”.")
            raw[field] = cleaned
        target = raw.get("target")
        if raw.get("section") == "responsibility" and raw.get("measure") == "numeric":
            ok = False
            if isinstance(target, dict) and target.get("text"):
                quote = _clean_text(target.get("quote"), 600)
                text = _clean_text(target.get("text"), 300)
                traced = numbers_in(text) and numbers_in(text) <= numbers_in(quote)
                if traced and quote and context_sq and _squash(quote) in context_sq:
                    raw["target"] = {"status": "set", "text": text, "source": "manager", "quote": quote}
                    ok = True
                elif traced and source_available and quote and _squash(quote) in source_sq:
                    raw["target"] = {"status": "set", "text": text, "source": "source", "quote": quote}
                    ok = True
            if not ok:
                if isinstance(target, dict) and target.get("text"):
                    notes.append(f"A target for “{_clean_text(raw.get('title'), 80)}” wasn't in the {stated_where}, so it was left for you to set.")
                raw["target"] = {"status": "unresolved"}
        else:
            raw["target"] = None
        quote = _clean_text(raw.get("source_quote"), 600)
        raw["source_quote"] = quote if (quote and source_available and _squash(quote) in source_sq) else None
        # Keys we minted earlier (a composed draft coming back to be stored)
        # survive, so question links hold; anything else gets a fresh key.
        key = raw.get("key")
        raw["key"] = key if isinstance(key, str) and _KEY_RE.fullmatch(key) and key not in seen_keys else _new_key()
        seen_keys.add(raw["key"])
        raw["origin"] = "source"
        raw["edited"] = False
        raw.pop("config_id", None)
        item = normalize_item(raw, default_origin="source")
        if item and item["section"] == "value" and _squash(item["title"]) in company_values:
            notes.append(f"“{item['title']}” is already a company value, so it applies to this role without a copy.")
            continue
        if item and item["title"]:
            index_to_key[idx] = item["key"]
            items.append(item)

    questions: list[dict] = []
    for raw in (parsed.get("questions") if isinstance(parsed.get("questions"), list) else [])[:8]:
        if len(questions) >= _MAX_AI_QUESTIONS:
            break
        if not isinstance(raw, dict) or raw.get("topic") == "target":
            continue
        key = index_to_key.get(raw.get("item_index")) if isinstance(raw.get("item_index"), int) else None
        q = normalize_question({
            "item_key": key, "topic": raw.get("topic"), "question": raw.get("question"),
            "why": raw.get("why"), "answer_mode": "answer", "origin": "ai",
        })
        if q and not unsupported_numbers(q["question"], allowed):
            questions.append(q)
    return items, reconcile_questions(items, questions), notes


def _sibling_block(supabase, role: dict | None) -> str:
    """Calibration against other levels of the same ladder (approved content
    only). Scope and tone, never wording to copy."""
    if not role or not role.get("role_family_id"):
        return ""
    siblings = (
        supabase.table("role_levels").select("id,job_role,job_level")
        .eq("role_family_id", role["role_family_id"]).neq("id", role["id"]).execute().data
    )
    if not siblings:
        return ""
    lines = []
    for sib in siblings[:4]:
        exp = _approved_configs(supabase, sib["id"])
        names = [r.get("metric_name") for r in exp["metrics"]] + [r.get("skill_name") for r in exp["skills"]]
        if names:
            lines.append(f"  Level {sib['job_level']} ({sib['job_role']}): " + "; ".join(n for n in names if n))
    if not lines:
        return ""
    return ("\nOther levels of this ladder already have approved expectations — use them only to calibrate scope "
            "(a higher level means more ownership, not just more), never copy them:\n" + "\n".join(lines) + "\n")


def _call_model(prompt: str, pdf_bytes: bytes | None = None, max_tokens: int = 4000) -> dict:
    if pdf_bytes is not None:
        raw = generate_text_from_document(prompt, base64.b64encode(pdf_bytes).decode("ascii"),
                                          media_type="application/pdf", model=AI_DEFAULT_MODEL_HEAVY,
                                          max_tokens=max_tokens)
    else:
        raw = generate_text(prompt, model=AI_DEFAULT_MODEL_HEAVY, max_tokens=max_tokens)
    return _parse_json_object(raw)


def _extract_pdf_text(raw_bytes: bytes) -> str:
    """Text layer of a PDF, so the source pane and the number guard see the
    real words. Empty when the PDF is a scan or unreadable."""
    try:
        from pypdf import PdfReader
        reader = PdfReader(__import__("io").BytesIO(raw_bytes))
        return "\n".join((page.extract_text() or "") for page in reader.pages).strip()
    except Exception as exc:  # pragma: no cover - library/format failures
        logger.info("pdf text extraction failed: %s", exc)
        return ""


def _read_context(context: str | None) -> str | None:
    """The manager's notes beside the job description. Optional."""
    cleaned = (context or "").strip()
    if len(cleaned) > _MAX_CONTEXT:
        raise HTTPException(status_code=413, detail="Your notes are longer than we can read at once — trim them to the parts that matter for this role.")
    return cleaned or None


def _draft_context(draft: dict) -> str | None:
    return (draft.get("analysis") or {}).get("context") or None


def _read_source(file: UploadFile | None, text: str | None) -> tuple[str | None, bytes | None, str]:
    pasted = (text or "").strip()
    has_file = file is not None and bool(file.filename)
    if has_file and pasted:
        raise HTTPException(status_code=422, detail="Send either a file or pasted text, not both")
    if not has_file and not pasted:
        raise HTTPException(status_code=422, detail="Paste a job description or attach a file")
    if not has_file:
        if len(pasted) > _MAX_SOURCE:
            raise HTTPException(status_code=413, detail="That's longer than a job description — paste just the role.")
        return pasted, None, "Pasted job description"
    name = Path(file.filename or "upload").name
    kind = _infer_import_type(name, file.content_type)
    raw = file.file.read()
    if not raw:
        raise HTTPException(status_code=422, detail="That file is empty")
    if len(raw) > _MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large — 25MB limit")
    if kind == "text":
        return raw.decode("utf-8", errors="replace").strip(), None, name
    if kind == "docx":
        extracted = _extract_docx_text(raw)
        if not extracted.strip():
            raise HTTPException(status_code=422, detail="Couldn't find any text in that .docx — paste the job description instead")
        return extracted.strip(), None, name
    extracted = _extract_pdf_text(raw)
    if len(extracted) >= 200:
        return extracted, None, name
    return None, raw, name


class ComposeOut(BaseModel):
    is_job_description: bool = True
    reason: str | None = None
    other_roles_note: str | None = None
    role: ImportedRole | None = None
    match: ImportMatch | None = None
    source_text: str | None = None
    source_label: str | None = None
    context: str | None = None
    items: list[dict] = []
    questions: list[dict] = []
    notes: list[str] = []


@router.post("/import", response_model=ComposeOut)
@limiter.limit("10/minute")
def compose_from_job_description(
    request: Request,
    file: UploadFile | None = File(None),
    text: str | None = Form(None),
    role_level_id: str | None = Form(None),
    context: str | None = Form(None),
    auth=Depends(get_authenticated_client),
):
    """Define a role: one AI call reads the job description, proposes where
    the role belongs (attach / new ladder / existing level) and a first draft
    with focused questions. Nothing is saved here — the manager confirms the
    placement, then POST /drafts stores the draft."""
    _, supabase = auth
    jd_text, pdf_bytes, label = _read_source(file, text)
    notes_text = _read_context(context)

    target_role = _fetch_role(supabase, role_level_id) if role_level_id else None
    families = supabase.table("role_families").select("id,name").order("name").execute().data
    role_levels = (
        supabase.table("role_levels").select("id,job_role,job_level,role_family_id")
        .order("job_role").order("job_level").execute().data
    )
    coverage_by_id = {r["role_level_id"]: r for r in _compute_coverage(supabase)["roles"]}
    org_values = _org_values(supabase)
    ladders_block = _build_ladders_block(families, role_levels, coverage_by_id)
    if target_role:
        sibling = _sibling_block(supabase, target_role)
    else:
        shortlist = _shortlist_families(" ".join(filter(None, [notes_text, jd_text or label])), families)
        sibling = _sibling_block(supabase, {"id": _NO_ID, "role_family_id": shortlist[0]["id"]}) if shortlist else ""

    prompt = _compose_prompt(
        jd_text=jd_text,
        role_hint=f"{_role_title(target_role)}, level {target_role['job_level']}" if target_role else None,
        ladders_block=ladders_block,
        org_values=org_values,
        sibling_block=sibling,
        include_identity=target_role is None,
        context=notes_text,
    )
    try:
        parsed = _call_model(prompt, pdf_bytes=pdf_bytes)
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("compose failed: %s", exc)
        raise HTTPException(status_code=502, detail="The draft couldn't be written just now. Your job description is still here — try again, or start without a draft.")

    if not parsed:
        raise HTTPException(status_code=502, detail="The draft came back unreadable. Try again, or start without a draft.")

    if target_role is None:
        if parsed.get("is_job_description") is False:
            reason = parsed.get("reason")
            return ComposeOut(is_job_description=False,
                              reason=reason.strip() if isinstance(reason, str) and reason.strip() else "That doesn't look like a job description.")
        role = _validate_role(parsed.get("role") or {})
        if role is None:
            return ComposeOut(is_job_description=False, reason="Couldn't find a job title in that — check it's the full job description.")
        match = _validate_match(parsed.get("match") or {}, families, role_levels, role.job_level)
    else:
        role, match = None, None

    corpus = jd_text or ""
    if pdf_bytes is not None:
        # Scanned PDF: no text layer to check numbers against, so no number
        # from the model survives. Targets stay unresolved.
        corpus = ""
    title = (role.job_role if role else _role_title(target_role)) or ""
    level = role.job_level if role else target_role["job_level"]
    corpus += f"\n{title} level {level}"
    items, questions, notes = sanitize_composed(parsed, corpus_text=corpus, source_available=jd_text is not None,
                                                org_value_names=[v["name"] for v in org_values],
                                                context_text=notes_text)
    note = parsed.get("other_roles_note") if target_role is None else None
    if pdf_bytes is not None:
        notes.insert(0, "This PDF has no readable text layer, so the source can't be shown and no numbers were taken from it"
                        + (" — only from your notes." if notes_text else "."))
    return ComposeOut(
        is_job_description=True,
        other_roles_note=note.strip() if isinstance(note, str) and note.strip() else None,
        role=role,
        match=match,
        source_text=jd_text,
        source_label=label,
        context=notes_text,
        items=items,
        questions=questions,
        notes=notes,
    )


# ---------------------------------------------------------------------------
# Drafts: create / read / save / discard
# ---------------------------------------------------------------------------

class DraftCreateIn(BaseModel):
    role_level_id: str
    source_text: str | None = None
    source_label: str | None = None
    # The manager's notes beside the job description (see module docstring).
    context: str | None = None
    # A composed draft from POST /import. Re-validated here: the client is
    # not trusted to carry AI output faithfully.
    items: list[dict] | None = None
    questions: list[dict] | None = None
    notes: list[str] | None = None


@router.post("/drafts")
def create_draft(body: DraftCreateIn, auth=Depends(get_authenticated_client), authorization: str = Header(None)):
    """Open (or resume) the working draft for a role level. A role with
    approved expectations gets a working revision seeded from them; a
    composed draft from a job description becomes suggestions there, never a
    silent replacement."""
    user_id, supabase = auth
    org_id = ensure_org(user_id, supabase, get_email_from_token(authorization))
    role = _fetch_role(supabase, body.role_level_id)

    existing = (
        supabase.table("role_expectation_drafts").select("*")
        .eq("role_level_id", body.role_level_id).eq("status", "open").execute().data
    )
    if existing:
        out = _present_draft(supabase, existing[0])
        out["resumed"] = True
        return out

    approved = _approved_configs(supabase, body.role_level_id)
    approved_items = items_from_configs(approved)
    source_text = _clean_text(body.source_text, _MAX_SOURCE) or (role.get("job_responsibilities") or None)
    source_label = _clean_text(body.source_label, 200) or ("Saved job description" if source_text else None)
    context = _clean_text(body.context, _MAX_CONTEXT) or None
    corpus = (source_text or "") + " " + _role_title(role)

    composed_items: list[dict] = []
    composed_questions: list[dict] = []
    if body.items:
        composed_items, composed_questions, _ = sanitize_composed(
            {"items": body.items, "questions": []}, corpus_text=corpus, source_available=bool(source_text),
            org_value_names=[v["name"] for v in _org_values(supabase)], context_text=context)
        # Questions composed earlier reference items by key; keep those that still match.
        keys = {i["key"] for i in composed_items}
        for q in body.questions or []:
            nq = normalize_question({**q, "origin": "ai"} if isinstance(q, dict) else {})
            if not nq or nq["topic"] == "target" or unsupported_numbers(nq["question"], numbers_in(corpus) | numbers_in(context)):
                continue
            nq["status"], nq["answer"], nq["decision_id"] = "open", None, None
            if nq["item_key"] is None or nq["item_key"] in keys:
                composed_questions.append(nq)

    decisions = _open_decisions(supabase, body.role_level_id)
    if approved_items:
        kind = "revision"
        items = approved_items
        suggestions = [
            {"id": f"s-{uuid.uuid4().hex[:12]}", "type": "add", "item": ci,
             "why": ("From the job description and notes you supplied" if context else "From the job description you supplied")
                    + " — not in the approved expectations.", "status": "pending"}
            for ci in composed_items
            if _squash(ci["title"]) not in {_squash(a["title"]) for a in approved_items}
        ][:_MAX_SUGGESTIONS * 2]
        questions = [q for q in composed_questions if q["item_key"] is None]
    else:
        kind = "new"
        items = composed_items
        suggestions = []
        questions = composed_questions

    # Every open decision on this role comes along, still deferred, so the
    # revision is where it gets resolved.
    for dec in decisions:
        questions.append(normalize_question({
            "id": f"decision:{dec['id']}",
            "item_key": dec.get("item_key"),
            "topic": dec["topic"],
            "question": dec["question"],
            "why": dec.get("context"),
            "answer_mode": "field" if dec["topic"] == "target" else "answer",
            "field": "target" if dec["topic"] == "target" else None,
            "status": "deferred",
            "decision_id": dec["id"],
            "follow_up_on": dec["follow_up_on"],
            "origin": "system" if dec["topic"] == "target" else "decision",
        }))
    # A deferred target decision replaces the generic target question.
    covered = {q["item_key"] for q in questions if q["topic"] == "target" and q.get("decision_id")}
    questions = [q for q in questions if not (q["origin"] == "system" and q["topic"] == "target"
                                               and not q.get("decision_id") and q["item_key"] in covered)]
    for q in questions:
        if q.get("decision_id") and q["topic"] == "target" and q["item_key"]:
            q["id"] = target_question_id(q["item_key"])
    questions = reconcile_questions(items, questions)

    analysis = {"status": "composed" if body.items else "idle", "notes": (body.notes or [])[:5]}
    if context:
        analysis["context"] = context
    row = {
        "org_id": org_id,
        "role_level_id": body.role_level_id,
        "created_by": user_id,
        "kind": kind,
        "status": "open",
        "source_text": source_text,
        "source_label": source_label,
        "items": items,
        "questions": questions,
        "suggestions": suggestions,
        "analysis": analysis,
    }
    try:
        created = supabase.table("role_expectation_drafts").insert(row).execute().data[0]
    except APIError as err:
        if getattr(err, "code", None) == "23505":
            again = (
                supabase.table("role_expectation_drafts").select("*")
                .eq("role_level_id", body.role_level_id).eq("status", "open").execute().data
            )
            if again:
                out = _present_draft(supabase, again[0])
                out["resumed"] = True
                return out
        raise
    out = _present_draft(supabase, created)
    out["resumed"] = False
    return out


@router.get("/roles/{role_level_id}")
def get_role(role_level_id: str, auth=Depends(get_authenticated_client)):
    """Everything the role page needs: the open draft (if any), the approved
    expectations, org values, people and open decisions."""
    _, supabase = auth
    role = _fetch_role(supabase, role_level_id)
    drafts = (
        supabase.table("role_expectation_drafts").select("*")
        .eq("role_level_id", role_level_id).eq("status", "open").execute().data
    )
    if drafts:
        return _present_draft(supabase, drafts[0])
    last = (
        supabase.table("role_expectation_drafts").select("approved_at")
        .eq("role_level_id", role_level_id).eq("status", "approved")
        .order("approved_at", desc=True).limit(1).execute().data
    )
    return {
        "draft": None,
        "role": {
            "id": role["id"],
            "title": _role_title(role),
            "job_level": role["job_level"],
            "family": role.get("role_families"),
            "job_responsibilities": role.get("job_responsibilities"),
        },
        "people": [{"id": p["id"], "name": p["name"]} for p in _people_for(supabase, role_level_id)],
        "org_values": _org_values(supabase),
        "approved_items": items_from_configs(_approved_configs(supabase, role_level_id)),
        "approved_at": last[0]["approved_at"] if last else None,
        "open_decisions": _open_decisions(supabase, role_level_id),
    }


class DraftSaveIn(BaseModel):
    version: int
    items: list[dict]
    questions: list[dict] | None = None
    source_text: str | None = None


def _apply_save(supabase, draft: dict, body: DraftSaveIn) -> dict:
    _require_open(draft)
    _check_version(draft, body.version)
    items = [i for i in (normalize_item(r) for r in body.items[:_MAX_ITEMS]) if i]
    keys = [i["key"] for i in items]
    if len(set(keys)) != len(keys):
        raise HTTPException(status_code=422, detail="Two expectations share an id — reload and try again.")
    stored_qs = [q for q in (normalize_question(q) for q in draft.get("questions") or []) if q]
    questions = reconcile_questions(items, merge_client_questions(stored_qs, body.questions))
    patch = {"items": items, "questions": questions}
    if body.source_text is not None:
        patch["source_text"] = _clean_text(body.source_text, _MAX_SOURCE) or None
    return _write_draft(supabase, draft, patch)


@router.put("/drafts/{draft_id}")
def save_draft(draft_id: str, body: DraftSaveIn, auth=Depends(get_authenticated_client)):
    """Save & finish later. Persists the manager's wording exactly as written;
    the active expectations are untouched."""
    _, supabase = auth
    saved = _apply_save(supabase, _load_draft(supabase, draft_id), body)
    return _present_draft(supabase, saved)


@router.post("/drafts/{draft_id}/discard")
def discard_draft(draft_id: str, auth=Depends(get_authenticated_client)):
    """Throw away a working draft. Approved expectations are untouched.
    Decisions created inside this draft that never reached an approved role
    go with it; decisions on approved items stay open."""
    _, supabase = auth
    draft = _load_draft(supabase, draft_id)
    _require_open(draft)
    supabase.table("role_expectation_drafts").update({"status": "discarded", "updated_at": _now_iso()}).eq("id", draft_id).execute()
    supabase.table("role_expectation_decisions").update({"status": "dropped", "resolved_at": _now_iso()}) \
        .eq("draft_id", draft_id).eq("status", "deferred").is_("config_id", "null").execute()
    return {"discarded": True}


# ---------------------------------------------------------------------------
# Save & reanalyze
# ---------------------------------------------------------------------------

def _review_prompt(*, role: dict, draft: dict, org_values: list[dict]) -> str:
    items_lines = []
    for i in draft["items"]:
        tgt = ""
        if item_kind(i) == "metrics":
            t = i.get("target")
            tgt = f" | target: {t['text']}" if t and t.get("status") == "set" else (" | target: NOT SET" if t else "")
        items_lines.append(
            f"- key={i['key']} [{i['section']}{'/numeric' if i['measure'] == 'numeric' else ''}] {i['title']}"
            f" | owns: {i['responsibility'] or '-'} | meets: {i['meets'] or '-'} | exceeds: {i['exceeds'] or '-'}{tgt}"
        )
    answered = [q for q in draft["questions"] if q.get("answer")]
    qa = "\n".join(f"- Q ({q['topic']}, item {q['item_key'] or 'general'}): {q['question']}\n  A: {q['answer']}" for q in answered) or "(none yet)"
    parked = "\n".join(f"- {q['question']} (parked until {q.get('follow_up_on')})" for q in draft["questions"] if q["status"] == "deferred") or "(none)"
    dismissed = "\n".join(f"- {s.get('text') or (s.get('item') or {}).get('title')}" for s in draft.get("suggestions") or [] if s.get("status") == "dismissed") or "(none)"
    values_line = ", ".join(v["name"] for v in org_values) or "(none)"
    return f"""You are a thought partner helping a manager finish the expectations for one role: {_role_title(role)}, level {role['job_level']}. The manager has edited the draft below; their wording is theirs. Your job is to (1) ask at most {_MAX_AI_QUESTIONS} focused questions about real gaps or ambiguity that remain, and (2) offer a few separate suggestions they can accept or ignore. You never change the draft yourself.

JOB DESCRIPTION (source):
{draft.get('source_text') or '(none supplied)'}
{_context_block(_draft_context(draft))}
CURRENT DRAFT:
{chr(10).join(items_lines) or '(empty)'}

Company values that already apply to every role: {values_line}

The manager's answers so far:
{qa}

Parked for later (do not ask again):
{parked}

Suggestions the manager already dismissed (do not repeat):
{dismissed}

RULES:
- Use the manager's answers. If an answer supplies wording or a target, turn it into a suggestion for the relevant item.
- Never ask again about something answered or parked. Never ask about a missing numeric target — the app tracks those itself — unless an answer supplied one (then suggest it as type "target").
- THE NUMBER RULE: never write a number that is not in the job description, the manager's notes, the current draft or the manager's answers. No benchmarks, no typical figures, no zero.
- A "rewrite" suggestion must be a genuine improvement (observable, specific to this role), not a paraphrase. Do not rewrite an item's wording merely to restyle it.
- Values: company values already apply; suggest a role-specific value only if clearly justified.
- Zero questions and zero suggestions are valid when the draft is ready.

Return ONLY valid JSON:
{{
  "summary": "one sentence on where the draft stands",
  "questions": [{{"item_key": "key or null", "topic": "scope" | "wording" | "measure" | "other", "question": "...", "why": "..."}}],
  "suggestions": [
    {{"type": "rewrite", "item_key": "...", "field": "meets" | "exceeds" | "responsibility" | "title", "text": "...", "why": "..."}},
    {{"type": "target", "item_key": "...", "text": "the target exactly as the manager or source stated it", "why": "..."}},
    {{"type": "add", "section": "responsibility" | "skill" | "value", "measure": "judged" | "numeric", "title": "...", "responsibility": "...", "meets": "...", "exceeds": "", "why": "..."}}
  ]
}}"""


def sanitize_review(parsed: dict, draft: dict) -> tuple[list[dict], list[dict], str | None]:
    """Validate a reanalysis. Suggestions whose numbers can't be traced to
    the source, the draft or the manager's answers are dropped outright."""
    items_by_key = {i["key"]: i for i in draft["items"]}
    answers_text = " ".join(q.get("answer") or "" for q in draft["questions"])
    draft_text = " ".join(" ".join([i["title"], i["responsibility"], i["meets"], i["exceeds"],
                                    ((i.get("target") or {}).get("text") or "")]) for i in draft["items"])
    context_text = _draft_context(draft) or ""
    allowed = numbers_in((draft.get("source_text") or "") + " " + context_text + " " + draft_text + " " + answers_text)
    answer_numbers = numbers_in(answers_text + " " + context_text)

    questions = []
    asked = {_squash(q["question"]) for q in draft["questions"] if q["status"] != "open"}
    for raw in (parsed.get("questions") if isinstance(parsed.get("questions"), list) else [])[:8]:
        if len(questions) >= _MAX_AI_QUESTIONS:
            break
        if not isinstance(raw, dict) or raw.get("topic") == "target":
            continue
        key = raw.get("item_key") if raw.get("item_key") in items_by_key else None
        q = normalize_question({"item_key": key, "topic": raw.get("topic"), "question": raw.get("question"),
                                "why": raw.get("why"), "answer_mode": "answer", "origin": "ai"})
        if not q or _squash(q["question"]) in asked or unsupported_numbers(q["question"], allowed):
            continue
        questions.append(q)

    suggestions = []
    for raw in (parsed.get("suggestions") if isinstance(parsed.get("suggestions"), list) else [])[:12]:
        if len(suggestions) >= _MAX_SUGGESTIONS:
            break
        if not isinstance(raw, dict):
            continue
        why = _clean_text(raw.get("why"), 300) or None
        sid = f"s-{uuid.uuid4().hex[:12]}"
        stype = raw.get("type")
        if stype == "rewrite":
            item = items_by_key.get(raw.get("item_key"))
            field = raw.get("field")
            text = _clean_text(raw.get("text"))
            if not item or field not in _FIELDS or not text or unsupported_numbers(text, allowed):
                continue
            if _squash(text) == _squash(item.get(field)):
                continue
            suggestions.append({"id": sid, "type": "rewrite", "item_key": item["key"], "field": field,
                                "text": text, "why": why, "status": "pending", "created_at": _now_iso()})
        elif stype == "target":
            item = items_by_key.get(raw.get("item_key"))
            text = _clean_text(raw.get("text"), 300)
            nums = numbers_in(text)
            if not item or item_kind(item) != "metrics" or not text or not nums or not nums <= allowed:
                continue
            if (item.get("target") or {}).get("status") == "set" and _squash(item["target"]["text"]) == _squash(text):
                continue
            source = "manager" if nums <= answer_numbers else "source"
            suggestions.append({"id": sid, "type": "target", "item_key": item["key"], "text": text,
                                "source": source, "why": why, "status": "pending", "created_at": _now_iso()})
        elif stype == "add":
            candidate = {k: raw.get(k) for k in ("section", "measure", "title", "responsibility", "meets", "exceeds")}
            if any(unsupported_numbers(candidate.get(f) if isinstance(candidate.get(f), str) else "", allowed)
                   for f in ("title", "responsibility", "meets", "exceeds")):
                continue
            candidate["origin"] = "suggestion"
            item = normalize_item(candidate, default_origin="suggestion")
            if not item or not item["title"] or _squash(item["title"]) in {_squash(i["title"]) for i in draft["items"]}:
                continue
            suggestions.append({"id": sid, "type": "add", "item": item, "why": why, "status": "pending", "created_at": _now_iso()})
    summary = _clean_text(parsed.get("summary"), 300) or None
    if summary and unsupported_numbers(summary, allowed):
        summary = None
    return questions, suggestions, summary


@router.post("/drafts/{draft_id}/analyze")
@limiter.limit("10/minute")
def save_and_reanalyze(request: Request, draft_id: str, body: DraftSaveIn, auth=Depends(get_authenticated_client)):
    """Save first — the manager's edits are persisted before any AI call —
    then reanalyze the latest text and answers. The result only adds
    questions and separately reviewable suggestions; it never edits an item.
    A failed analysis leaves the saved draft and records the failure for
    retry."""
    _, supabase = auth
    saved = _apply_save(supabase, _load_draft(supabase, draft_id), body)
    role = _fetch_role(supabase, saved["role_level_id"])
    try:
        parsed = _call_model(_review_prompt(role=role, draft=saved, org_values=_org_values(supabase)), max_tokens=2500)
        if not parsed:
            raise ValueError("unreadable response")
    except Exception as exc:
        logger.warning("reanalysis failed: %s", exc)
        failed = _write_draft(supabase, saved, {"analysis": {
            **(saved.get("analysis") or {}), "status": "failed", "failed_at": _now_iso(),
            "error": "Your draft is saved. The analysis couldn't run just now — try again.",
        }})
        out = _present_draft(supabase, failed)
        out["analysis_failed"] = True
        return out

    # Merge onto the latest row: the AI call took time.
    latest = _load_draft(supabase, draft_id)
    _require_open(latest)
    questions, suggestions, summary = sanitize_review(parsed, latest)
    kept = [q for q in (normalize_question(q) for q in latest.get("questions") or []) if q]
    kept = [q for q in kept if not (q["origin"] == "ai" and q["status"] == "open" and not q.get("answer"))]
    merged_qs = reconcile_questions(latest["items"], kept + questions)
    old_sugs = [s for s in latest.get("suggestions") or [] if s.get("status") == "dismissed"][-10:]
    updated = _write_draft(supabase, latest, {
        "questions": merged_qs,
        "suggestions": old_sugs + suggestions,
        "analysis": {"status": "ok", "analyzed_at": _now_iso(), "summary": summary,
                     "new_questions": len(questions), "new_suggestions": len(suggestions),
                     **({"context": _draft_context(latest)} if _draft_context(latest) else {})},
    })
    return _present_draft(supabase, updated)


# ---------------------------------------------------------------------------
# Suggestions and decisions
# ---------------------------------------------------------------------------

class SuggestionActionIn(BaseModel):
    version: int
    action: str  # accept | dismiss


@router.post("/drafts/{draft_id}/suggestions/{suggestion_id}")
def act_on_suggestion(draft_id: str, suggestion_id: str, body: SuggestionActionIn, auth=Depends(get_authenticated_client)):
    """Accept or dismiss one AI suggestion. Accepting changes only the one
    field (or adds the one item) it names."""
    user_id, supabase = auth
    draft = _load_draft(supabase, draft_id)
    _require_open(draft)
    _check_version(draft, body.version)
    if body.action not in ("accept", "dismiss"):
        raise HTTPException(status_code=422, detail="Unknown action")
    suggestions = list(draft.get("suggestions") or [])
    sug = next((s for s in suggestions if s.get("id") == suggestion_id), None)
    if not sug or sug.get("status") != "pending":
        raise HTTPException(status_code=404, detail="That suggestion is no longer available")
    items = list(draft["items"])
    if body.action == "accept":
        if sug["type"] == "add":
            if len(items) >= _MAX_ITEMS:
                raise HTTPException(status_code=422, detail="This role already has as many expectations as it can hold")
            items.append({**sug["item"], "key": _new_key(), "origin": "suggestion", "edited": False})
        else:
            idx = next((n for n, i in enumerate(items) if i["key"] == sug.get("item_key")), None)
            if idx is None:
                raise HTTPException(status_code=409, detail="The expectation this suggestion was for has been removed")
            item = dict(items[idx])
            if sug["type"] == "rewrite":
                item[sug["field"]] = sug["text"]
            else:
                item["target"] = {"status": "set", "text": sug["text"], "source": sug.get("source") or "manager", "quote": None}
            item["edited"] = True
            items[idx] = item
    sug = {**sug, "status": "accepted" if body.action == "accept" else "dismissed"}
    suggestions = [sug if s.get("id") == suggestion_id else s for s in suggestions]
    stored_qs = [q for q in (normalize_question(q) for q in draft.get("questions") or []) if q]
    updated = _write_draft(supabase, draft, {
        "items": items, "suggestions": suggestions, "questions": reconcile_questions(items, stored_qs),
    })
    # Accepting applies the suggestion as written; there is no edit step.
    analytics.ai_draft_resolved(
        user_id, surface="role_suggestion",
        outcome="accepted" if body.action == "accept" else "discarded",
        seconds_to_confirm=analytics.seconds_since(sug.get("created_at")),
    )
    return _present_draft(supabase, updated)


class DeferIn(BaseModel):
    version: int
    question_id: str
    follow_up_on: str


@router.post("/drafts/{draft_id}/defer")
def defer_question(draft_id: str, body: DeferIn, auth=Depends(get_authenticated_client)):
    """Come back to this later: persists a decision with its role/level, the
    item it belongs to and the date it returns. Only a date — the one trigger
    the app can actually honor."""
    user_id, supabase = auth
    draft = _load_draft(supabase, draft_id)
    _require_open(draft)
    _check_version(draft, body.version)
    try:
        when = date.fromisoformat(body.follow_up_on[:10])
    except ValueError:
        raise HTTPException(status_code=422, detail="Choose a date to come back to this")
    # One day of slack: the manager's "today" can be the server's yesterday.
    if when < date.today() - timedelta(days=1) or when > date.today() + timedelta(days=366):
        raise HTTPException(status_code=422, detail="Choose a date within the next year")
    questions = [q for q in (normalize_question(q) for q in draft.get("questions") or []) if q]
    q = next((x for x in questions if x["id"] == body.question_id), None)
    if not q:
        raise HTTPException(status_code=404, detail="That question is no longer part of this draft")
    if q.get("decision_id"):
        supabase.table("role_expectation_decisions").update({"follow_up_on": when.isoformat()}) \
            .eq("id", q["decision_id"]).eq("status", "deferred").execute()
        decision_id = q["decision_id"]
    else:
        item = next((i for i in draft["items"] if i["key"] == q["item_key"]), None) if q["item_key"] else None
        row = supabase.table("role_expectation_decisions").insert({
            "org_id": draft["org_id"],
            "role_level_id": draft["role_level_id"],
            "draft_id": draft["id"],
            "item_key": item["config_id"] if item and item.get("config_id") and item.get("config_kind") == item_kind(item) else q["item_key"],
            "config_kind": item_kind(item) if item and item.get("config_id") else None,
            "config_id": item["config_id"] if item and item.get("config_id") and item.get("config_kind") == item_kind(item) else None,
            "topic": q["topic"],
            "question": q["question"],
            "context": q.get("why"),
            "status": "deferred",
            "follow_up_on": when.isoformat(),
            "created_by": user_id,
        }).execute().data[0]
        decision_id = row["id"]
    questions = [{**x, "status": "deferred", "decision_id": decision_id, "follow_up_on": when.isoformat()}
                 if x["id"] == q["id"] else x for x in questions]
    updated = _write_draft(supabase, draft, {"questions": reconcile_questions(draft["items"], questions)})
    return _present_draft(supabase, updated)


# ---------------------------------------------------------------------------
# Reuse another role's approved expectations
# ---------------------------------------------------------------------------

class CopyIn(BaseModel):
    version: int
    from_role_level_id: str


@router.post("/drafts/{draft_id}/copy")
def copy_from_role(draft_id: str, body: CopyIn, auth=Depends(get_authenticated_client)):
    """Add another role's approved expectations to this draft as editable
    copies. Titles already in the draft are skipped; targets come across only
    as they were approved."""
    _, supabase = auth
    draft = _load_draft(supabase, draft_id)
    _require_open(draft)
    _check_version(draft, body.version)
    if body.from_role_level_id == draft["role_level_id"]:
        raise HTTPException(status_code=422, detail="Choose a different role to copy from")
    _fetch_role(supabase, body.from_role_level_id)
    source_items = items_from_configs(_approved_configs(supabase, body.from_role_level_id))
    have = {_squash(i["title"]) for i in draft["items"]}
    items = list(draft["items"])
    added = 0
    for si in source_items:
        if _squash(si["title"]) in have or len(items) >= _MAX_ITEMS:
            continue
        copy = {**si, "key": _new_key(), "config_id": None, "config_kind": None, "origin": "copied", "edited": False}
        if copy.get("legacy_target"):
            copy["legacy_target"] = False
            copy["target"] = {"status": "unresolved"}
        items.append(copy)
        added += 1
    stored_qs = [q for q in (normalize_question(q) for q in draft.get("questions") or []) if q]
    updated = _write_draft(supabase, draft, {"items": items, "questions": reconcile_questions(items, stored_qs)})
    out = _present_draft(supabase, updated)
    out["copied"] = added
    return out


# ---------------------------------------------------------------------------
# Approval
# ---------------------------------------------------------------------------

class ApproveIn(BaseModel):
    version: int


def approval_problems(draft: dict) -> list[str]:
    """What blocks approval, in the manager's words. The SQL function
    re-checks the essentials inside the transaction."""
    problems = []
    if not draft["items"]:
        problems.append("Add at least one expectation before approving.")
    for i in draft["items"]:
        if not i["title"].strip():
            problems.append("Every expectation needs a name.")
            break
    for q in draft["questions"]:
        if q["status"] == "open":
            item = next((i for i in draft["items"] if i["key"] == q.get("item_key")), None)
            where = f" (“{item['title']}”)" if item else ""
            if q["topic"] == "target":
                problems.append(f"Set the target{where} or choose when to come back to it.")
            else:
                problems.append(f"Answer, park or dismiss: {q['question']}")
    return problems


@router.post("/drafts/{draft_id}/approve")
def approve_draft(draft_id: str, body: ApproveIn, auth=Depends(get_authenticated_client)):
    """Approve the reviewed role definition as a whole. Pending AI
    suggestions are not part of it. One transaction; a retry after success
    returns the approved result."""
    _, supabase = auth
    draft = _load_draft(supabase, draft_id)
    if draft["status"] == "open":
        _check_version(draft, body.version)
        draft = {**draft, "questions": [q for q in (normalize_question(q) for q in draft.get("questions") or []) if q]}
        problems = approval_problems(draft)
        if problems:
            raise HTTPException(status_code=422, detail={"message": "A few things need a decision first.", "problems": problems})
    try:
        rows = supabase.rpc("approve_role_expectation_draft", {
            "p_draft_id": draft_id, "p_expected_version": body.version,
        }).execute().data
    except APIError as err:
        status = _RPC_ERRORS.get(getattr(err, "code", None) or "")
        if status is None:
            raise
        raise HTTPException(status_code=status, detail=getattr(err, "message", None) or "Couldn't approve these expectations")
    approved = rows[0] if isinstance(rows, list) and rows else rows
    out = get_role(approved["role_level_id"], auth=auth)
    out["approved_draft"] = {"id": approved["id"], "approved_at": approved.get("approved_at")}
    return out
