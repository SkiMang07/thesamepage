"""
Development plans — Session 47 (2026-08-20). See docs/SESSION_HISTORY.md and
the development_scoping project memory note for the scoping conversation.

v1 scope (scoped with Andrew via AskUserQuestion):
- Individual only, plus a lightweight team-level "training focus" note (see
  team.py's GET/PUT /dev-focus, new team_dev_focus table — mirrors
  team_callouts, not built here).
- Activates the dormant development_plans/dev_plan_* tables from the
  original schema scaffold — same "dormant table, just needs activating"
  pattern as Goals/Assessments/Capacity. One development_plans row per
  direct report, bootstrapped on first access (_get_or_create_plan) rather
  than relying on a DB constraint, same on-demand-bootstrap idea as
  assessment_levels' auto-seed.
- Placement: a section on the direct report detail page only — no dedicated
  top-level page like Assessments/Goals got. Every route here is read/write
  against that one section, not a separate CRUD surface.
- AI-assisted draft (opportunities + a manager note), manager reviews
  before anything saves — same draft-then-review rule as one_on_ones.py's
  wrap-up flow and assessments.py's scorecard draft. Scoped narrower than
  assessments' draft: aspirations (a career conversation, not evidence to
  infer) and training (a logistics/budget decision) are NOT drafted — only
  opportunities and a synthesis note, where evidence-grounding actually
  makes sense.
- Opportunities connect to assessment scores (Andrew's scoping decision):
  dev_plan_opportunities gained source_kind/source_config_id (migration
  2026-08-20_development_plans_and_team_focus.sql) so an opportunity can
  trace back to the skill/value assessment item that prompted it.
  _fetch_low_scoring_items() below is the shared "what's evidence for a
  development opportunity" helper — used both to surface suggestions in
  GET /{direct_report_id} and to ground the AI draft prompt.

Follow-up (same session, 2026-08-20): Andrew dogfooded this immediately and
caught a real gap — /{id}/draft is evidence-gated by design (it won't
fabricate a note/opportunities with nothing to go on), but the frontend had
NO other way to write a manager note. A report with no assessment history
yet (the common case for a brand-new plan) hit a dead end. Manual entry was
never actually missing for opportunities/training/aspiration (those always
had their own forms, independent of /draft) — only the manager note flow
was AI-gated. Fixed by making manual entry for the note the default (the
textarea was already there; POST /{id}/notes never depended on AI) and
adding POST /{id}/notes/revise: an AI-assist that takes text the manager
already wrote and improves/expands it, grounded in whatever evidence exists
but not blocked by its absence — revising given text is a fundamentally
different, always-answerable task from drafting from nothing. _fetch_
evidence() below factors out the 1:1/commitment lookups both /draft and
/notes/revise need.
"""
import json
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel

from ai_core import generate_text
from config import AI_DEFAULT_MODEL_HEAVY
from routes.direct_reports import fetch_role_expectations
from utils import get_authenticated_client, limiter

router = APIRouter()

# A skill/value counts as "low scoring" — i.e. worth surfacing as a
# candidate development opportunity — at or below the midpoint of that
# item's own configured scale. Mirrors assessments.py's per-item scale_min/
# scale_max convention (default 1-4) rather than a hardcoded threshold, so
# an org with a different scale (e.g. 1-5) gets a sensible midpoint too.


def _get_or_create_plan(user_id: str, supabase, direct_report_id: str) -> tuple[dict, dict]:
    """Returns (direct_report row, development_plan row), creating the plan
    on first access. Raises 404 if the report doesn't belong to this
    manager."""
    reports = (
        supabase.table("direct_reports")
        .select("id,name,role_level_id")
        .eq("id", direct_report_id)
        .eq("manager_id", user_id)
        .execute()
        .data
    )
    if not reports:
        raise HTTPException(status_code=404, detail="Direct report not found")
    report = reports[0]

    plans = (
        supabase.table("development_plans")
        .select("*")
        .eq("direct_report_id", direct_report_id)
        .eq("manager_id", user_id)
        .order("created_at")
        .limit(1)
        .execute()
        .data
    )
    if plans:
        return report, plans[0]

    created = (
        supabase.table("development_plans")
        .insert({"direct_report_id": direct_report_id, "manager_id": user_id})
        .execute()
        .data[0]
    )
    return report, created


def _fetch_low_scoring_items(supabase, direct_report_id: str, role_level_id: str | None) -> list[dict]:
    """Skills/values from this report's role expectations whose latest
    recorded score sits at or below the midpoint of that item's own scale —
    the evidence base for both the "suggested from assessment" prompts in
    GET /{direct_report_id} and the AI draft below. Unscored items are
    excluded entirely (no evidence, not "low" — just unknown)."""
    expectations = fetch_role_expectations(supabase, role_level_id)
    if not expectations:
        return []

    out: list[dict] = []
    for kind, table, fk_col, name_col in (
        ("skill", "skill_assessments", "skill_config_id", "skill_name"),
        ("value", "value_assessments", "value_config_id", "value_name"),
    ):
        configs = expectations.get(f"{kind}s", [])
        if not configs:
            continue
        config_ids = [c["id"] for c in configs]
        rows = (
            supabase.table(table)
            .select(f"{fk_col},evaluation_point")
            .eq("direct_report_id", direct_report_id)
            .in_(fk_col, config_ids)
            .order("assessed_at", desc=True)
            .execute()
            .data
        )
        latest_by_config: dict = {}
        for row in rows:
            latest_by_config.setdefault(row[fk_col], row["evaluation_point"])

        for c in configs:
            point = latest_by_config.get(c["id"])
            if point is None:
                continue
            scale_min = c.get("evaluation_scale_min") or 1
            scale_max = c.get("evaluation_scale_max") or 4
            if point <= (scale_min + scale_max) / 2:
                out.append({
                    "kind": kind,
                    "config_id": c["id"],
                    "name": c.get(name_col),
                    "description": c.get("description"),
                    "evaluation_point": point,
                    "scale_min": scale_min,
                    "scale_max": scale_max,
                })
    return out


def _fetch_evidence(user_id: str, supabase, direct_report_id: str) -> tuple[list[str], list[dict]]:
    """Recent 1:1 summaries + open commitments — the non-assessment half of
    the evidence base, shared by /draft and /notes/revise so both ground
    themselves in identical context."""
    history_rows = (
        supabase.table("one_on_ones")
        .select("summary,created_at")
        .eq("direct_report_id", direct_report_id)
        .eq("manager_id", user_id)
        .not_.is_("summary", "null")
        .order("created_at", desc=True)
        .limit(5)
        .execute()
        .data
    )
    recent_summaries = [r["summary"] for r in history_rows if r.get("summary")]

    commitments = (
        supabase.table("commitments")
        .select("description,due_date,status")
        .eq("direct_report_id", direct_report_id)
        .eq("owner_id", user_id)
        .eq("status", "open")
        .order("created_at", desc=True)
        .limit(20)
        .execute()
        .data
    )
    return recent_summaries, commitments


def _role_label(role: dict | None) -> str | None:
    role_level = (role or {}).get("role_level")
    if not role_level:
        return None
    label = f"{role_level['job_role']}, level {role_level['job_level']}"
    if role_level.get("functional_team"):
        label += f" ({role_level['functional_team']})"
    return label


def _fetch_bundle(user_id: str, supabase, direct_report_id: str) -> dict:
    report, plan = _get_or_create_plan(user_id, supabase, direct_report_id)

    aspirations = (
        supabase.table("dev_plan_aspirations")
        .select("*")
        .eq("development_plan_id", plan["id"])
        .limit(1)
        .execute()
        .data
    )
    opportunities = (
        supabase.table("dev_plan_opportunities")
        .select("*")
        .eq("development_plan_id", plan["id"])
        .order("created_at", desc=True)
        .execute()
        .data
    )
    training = (
        supabase.table("dev_plan_training")
        .select("*")
        .eq("development_plan_id", plan["id"])
        .order("created_at", desc=True)
        .execute()
        .data
    )
    manager_notes = (
        supabase.table("dev_plan_manager_notes")
        .select("*")
        .eq("development_plan_id", plan["id"])
        .order("created_at", desc=True)
        .execute()
        .data
    )

    return {
        "development_plan": plan,
        "aspiration": aspirations[0] if aspirations else None,
        "opportunities": opportunities,
        "training": training,
        "manager_notes": manager_notes,
        "low_scoring_items": _fetch_low_scoring_items(supabase, direct_report_id, report.get("role_level_id")),
    }


# ---------------------------------------------------------------------------
# Draft prompt — same restraint rule as assessments.py's draft: only draft
# what the evidence actually supports. Aspirations and training are
# deliberately NOT drafted (see this module's docstring).
# ---------------------------------------------------------------------------

def _build_draft_prompt(
    report_name: str,
    role_label: str | None,
    low_scoring_items: list[dict],
    recent_summaries: list[str],
    open_commitments: list[dict],
    existing_opportunity_descriptions: list[str],
    today_iso: str,
) -> str:
    def _low_score_lines() -> str:
        if not low_scoring_items:
            return "  (no low-scoring skills/values on record — either everything scores well, or nothing's been assessed yet)"
        lines = []
        for it in low_scoring_items:
            header = f"  [{it['config_id']}] ({it['kind']}) {it['name']} — scored {it['evaluation_point']}/{it['scale_max']}"
            if it.get("description"):
                header += f" — {it['description']}"
            lines.append(header)
        return "\n".join(lines)

    history_block = "\n".join(f"  • {s}" for s in recent_summaries) or "  (no completed 1:1s on record yet)"
    commitments_block = "\n".join(
        f"  • {c['description']} (due: {c.get('due_date') or 'unspecified'})" for c in open_commitments
    ) or "  (none)"
    existing_block = "\n".join(f"  • {d}" for d in existing_opportunity_descriptions) or "  (none yet)"

    return f"""You are helping a manager draft development/growth opportunities for {report_name}. Today's date: {today_iso}.

Your ONLY source of truth is the evidence below. Do not invent gaps or strengths you have no evidence for. If there isn't enough signal, leave a section empty — an incomplete, honest draft beats a fabricated complete one. The manager reviews and edits everything before anything saves.

---
ROLE: {role_label or "No role assigned"}

LOW-SCORING SKILLS/VALUES FROM RECENT ASSESSMENTS (primary evidence for opportunities):
{_low_score_lines()}

---
ADDITIONAL EVIDENCE

Recent 1:1 history (last few meetings, newest first):
{history_block}

Open commitments:
{commitments_block}

Opportunities already on this person's development plan (don't duplicate these):
{existing_block}

---
Return ONLY valid JSON. No commentary, no markdown, no code fences.

{{
  "opportunities": [
    {{"type": "skill", "description": "1-2 sentences on the specific gap and how to close it", "source_kind": "skill", "source_config_id": "..."}}
  ],
  "manager_note": "1-3 sentences synthesizing this person's overall growth focus right now, or null if there isn't enough evidence yet"
}}

"type" is "skill" or "knowledge". Prefer grounding each opportunity in one of the low-scoring items above (set source_kind/source_config_id to match); you may also propose a knowledge-gap opportunity from 1:1 history alone with source_kind/source_config_id set to null if there's real evidence for it in the notes. Do not force coverage of every low-scoring item — only include what the evidence actually supports acting on right now. Empty opportunities and a null manager_note are valid, honest answers."""


# ---------------------------------------------------------------------------
# Revise prompt — the always-answerable counterpart to the draft prompt
# above. Draft starts from nothing and is allowed to come back empty when
# there's no evidence; revise starts from the manager's own text, which is
# itself the primary input, so it should reliably return something even
# when assessment/1:1 evidence is thin.
# ---------------------------------------------------------------------------

def _build_revise_prompt(
    report_name: str,
    role_label: str | None,
    existing_text: str,
    low_scoring_items: list[dict],
    recent_summaries: list[str],
    open_commitments: list[dict],
    today_iso: str,
) -> str:
    def _low_score_lines() -> str:
        if not low_scoring_items:
            return "  (none on record)"
        lines = []
        for it in low_scoring_items:
            line = f"  {it['name']} — scored {it['evaluation_point']}/{it['scale_max']}"
            if it.get("description"):
                line += f" — {it['description']}"
            lines.append(line)
        return "\n".join(lines)

    history_block = "\n".join(f"  • {s}" for s in recent_summaries) or "  (none on record)"
    commitments_block = "\n".join(
        f"  • {c['description']} (due: {c.get('due_date') or 'unspecified'})" for c in open_commitments
    ) or "  (none)"

    return f"""You are helping a manager refine a development note they've already started writing about {report_name}. Today's date: {today_iso}.

THE MANAGER'S DRAFT (your starting point — this is the primary source, not the evidence below; preserve their intent, meaning, and voice):
---
{existing_text}
---

Tighten the language and improve clarity. Where the evidence below genuinely supports it, you may add a specific, concrete grounding detail (an example from a 1:1, a commitment, an assessment score) — but do not invent evidence that isn't listed, and do not pad the note with generic advice just to make it longer. If the draft is already clear and well-grounded, light editing is a valid, honest output. Do not change the manager's overall assessment or add claims they didn't make.

---
ROLE: {role_label or "No role assigned"}

LOW-SCORING SKILLS/VALUES FROM RECENT ASSESSMENTS:
{_low_score_lines()}

Recent 1:1 history (last few meetings, newest first):
{history_block}

Open commitments:
{commitments_block}

---
Return ONLY the revised note text — no commentary, no markdown headers, no code fences, no quotation marks around it. Just the note itself, ready to save as-is."""


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class AspirationIn(BaseModel):
    desired_role: str | None = None
    timeline: str | None = None
    notes: str | None = None


class OpportunityIn(BaseModel):
    type: str  # 'skill' | 'knowledge'
    description: str
    source_kind: str | None = None  # 'skill' | 'value'
    source_config_id: str | None = None


class TrainingIn(BaseModel):
    description: str
    completion_date: str | None = None
    projected_cost: float | None = None


class TrainingUpdateIn(BaseModel):
    description: str | None = None
    completion_date: str | None = None
    projected_cost: float | None = None


class ManagerNoteIn(BaseModel):
    content: str


class DraftOpportunity(BaseModel):
    type: str
    description: str
    source_kind: str | None = None
    source_config_id: str | None = None


class DevelopmentDraft(BaseModel):
    """AI-drafted opportunities + a synthesis note for the manager to
    review — nothing is saved until the manager POSTs what they keep."""
    opportunities: list[DraftOpportunity] = []
    manager_note: str | None = None


class ReviseNoteIn(BaseModel):
    text: str


class ReviseNoteOut(BaseModel):
    note: str


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/{direct_report_id}")
async def get_development_plan(direct_report_id: str, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    return _fetch_bundle(user_id, supabase, direct_report_id)


@router.put("/{direct_report_id}/aspiration")
async def upsert_aspiration(direct_report_id: str, body: AspirationIn, auth=Depends(get_authenticated_client)):
    """Upserts the single aspiration row for this plan (see
    dev_plan_aspirations_plan_uq in schema.sql). Manual look-up-then-write,
    same pattern team.py's update_team_callout uses, since the aspiration
    row may not exist yet on first save."""
    user_id, supabase = auth
    _, plan = _get_or_create_plan(user_id, supabase, direct_report_id)

    existing = (
        supabase.table("dev_plan_aspirations")
        .select("id")
        .eq("development_plan_id", plan["id"])
        .execute()
        .data
    )
    payload = {
        "development_plan_id": plan["id"],
        "desired_role": (body.desired_role or "").strip() or None,
        "timeline": (body.timeline or "").strip() or None,
        "notes": (body.notes or "").strip() or None,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if existing:
        result = (
            supabase.table("dev_plan_aspirations")
            .update(payload)
            .eq("id", existing[0]["id"])
            .execute()
        )
    else:
        result = supabase.table("dev_plan_aspirations").insert(payload).execute()
    return result.data[0]


@router.post("/{direct_report_id}/opportunities")
async def create_opportunity(direct_report_id: str, body: OpportunityIn, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    if body.type not in ("skill", "knowledge"):
        raise HTTPException(status_code=422, detail="type must be 'skill' or 'knowledge'")
    description = body.description.strip()
    if not description:
        raise HTTPException(status_code=422, detail="Description cannot be empty")
    _, plan = _get_or_create_plan(user_id, supabase, direct_report_id)
    result = (
        supabase.table("dev_plan_opportunities")
        .insert({
            "development_plan_id": plan["id"],
            "type": body.type,
            "description": description,
            "source_kind": body.source_kind,
            "source_config_id": body.source_config_id,
        })
        .execute()
    )
    return result.data[0]


@router.delete("/opportunities/{opportunity_id}")
async def delete_opportunity(opportunity_id: str, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    own_plan_ids = [
        p["id"]
        for p in supabase.table("development_plans").select("id").eq("manager_id", user_id).execute().data
    ]
    result = (
        supabase.table("dev_plan_opportunities")
        .delete()
        .eq("id", opportunity_id)
        .in_("development_plan_id", own_plan_ids)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Opportunity not found")
    return {"deleted": True}


@router.post("/{direct_report_id}/training")
async def create_training(direct_report_id: str, body: TrainingIn, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    description = body.description.strip()
    if not description:
        raise HTTPException(status_code=422, detail="Description cannot be empty")
    _, plan = _get_or_create_plan(user_id, supabase, direct_report_id)
    result = (
        supabase.table("dev_plan_training")
        .insert({
            "development_plan_id": plan["id"],
            "description": description,
            "completion_date": body.completion_date,
            "projected_cost": body.projected_cost,
        })
        .execute()
    )
    return result.data[0]


@router.patch("/training/{training_id}")
async def update_training(training_id: str, body: TrainingUpdateIn, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    own_plan_ids = [
        p["id"]
        for p in supabase.table("development_plans").select("id").eq("manager_id", user_id).execute().data
    ]
    update = {k: v for k, v in body.model_dump(exclude_unset=True).items()}
    if "description" in update:
        desc = (update["description"] or "").strip()
        if not desc:
            raise HTTPException(status_code=422, detail="Description cannot be empty")
        update["description"] = desc
    result = (
        supabase.table("dev_plan_training")
        .update(update)
        .eq("id", training_id)
        .in_("development_plan_id", own_plan_ids)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Training item not found")
    return result.data[0]


@router.delete("/training/{training_id}")
async def delete_training(training_id: str, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    own_plan_ids = [
        p["id"]
        for p in supabase.table("development_plans").select("id").eq("manager_id", user_id).execute().data
    ]
    result = (
        supabase.table("dev_plan_training")
        .delete()
        .eq("id", training_id)
        .in_("development_plan_id", own_plan_ids)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Training item not found")
    return {"deleted": True}


@router.post("/{direct_report_id}/notes")
async def create_manager_note(direct_report_id: str, body: ManagerNoteIn, auth=Depends(get_authenticated_client)):
    """Append-only, private-to-manager log — no edit/delete in v1, same
    minimal posture team_meeting_notes shipped with."""
    user_id, supabase = auth
    content = body.content.strip()
    if not content:
        raise HTTPException(status_code=422, detail="Note cannot be empty")
    _, plan = _get_or_create_plan(user_id, supabase, direct_report_id)
    result = (
        supabase.table("dev_plan_manager_notes")
        .insert({"development_plan_id": plan["id"], "content": content})
        .execute()
    )
    return result.data[0]


@router.post("/{direct_report_id}/draft", response_model=DevelopmentDraft)
@limiter.limit("10/minute")
async def draft_development(
    request: Request,
    direct_report_id: str,
    auth=Depends(get_authenticated_client),
    authorization: str = Header(None),
):
    """Pure AI-call route — nothing is saved. Manager reviews the draft
    (checks which opportunities to keep, edits the note), then the frontend
    calls create_opportunity/create_manager_note for whatever survives
    review."""
    user_id, supabase = auth
    report, plan = _get_or_create_plan(user_id, supabase, direct_report_id)

    role = fetch_role_expectations(supabase, report.get("role_level_id"))
    role_label = _role_label(role)

    low_scoring_items = _fetch_low_scoring_items(supabase, direct_report_id, report.get("role_level_id"))
    known_config_ids = {it["config_id"] for it in low_scoring_items}

    recent_summaries, commitments = _fetch_evidence(user_id, supabase, direct_report_id)

    existing_opportunities = (
        supabase.table("dev_plan_opportunities")
        .select("description")
        .eq("development_plan_id", plan["id"])
        .execute()
        .data
    )

    prompt = _build_draft_prompt(
        report_name=report["name"],
        role_label=role_label,
        low_scoring_items=low_scoring_items,
        recent_summaries=recent_summaries,
        open_commitments=commitments,
        existing_opportunity_descriptions=[o["description"] for o in existing_opportunities],
        today_iso=date.today().isoformat(),
    )

    raw = generate_text(prompt, model=AI_DEFAULT_MODEL_HEAVY, max_tokens=1200)
    raw_clean = raw.strip()
    if raw_clean.startswith("```"):
        start = raw_clean.find("{")
        end = raw_clean.rfind("}") + 1
        raw_clean = raw_clean[start:end] if start != -1 else raw_clean

    try:
        parsed = json.loads(raw_clean)
    except json.JSONDecodeError:
        parsed = {}

    opportunities: list[DraftOpportunity] = []
    for r in parsed.get("opportunities") or []:
        o_type = r.get("type")
        description = (r.get("description") or "").strip()
        if o_type not in ("skill", "knowledge") or not description:
            continue
        source_kind = r.get("source_kind")
        source_config_id = r.get("source_config_id")
        # Only trust a source link the model could actually have seen —
        # anything else is dropped (opportunity text is kept, just
        # unlinked) rather than letting a hallucinated id reach save.
        if source_kind not in ("skill", "value") or source_config_id not in known_config_ids:
            source_kind = None
            source_config_id = None
        opportunities.append(DraftOpportunity(
            type=o_type, description=description, source_kind=source_kind, source_config_id=source_config_id,
        ))

    manager_note = parsed.get("manager_note")
    manager_note = manager_note.strip() if isinstance(manager_note, str) and manager_note.strip() else None

    return DevelopmentDraft(opportunities=opportunities, manager_note=manager_note)


@router.post("/{direct_report_id}/notes/revise", response_model=ReviseNoteOut)
@limiter.limit("10/minute")
async def revise_note(
    request: Request,
    direct_report_id: str,
    body: ReviseNoteIn,
    auth=Depends(get_authenticated_client),
):
    """The always-answerable counterpart to /draft (see this module's
    docstring follow-up note). Takes text the manager already wrote in the
    manager-note composer and returns an improved/expanded version, grounded
    in whatever evidence exists — unlike /draft, this never comes back empty
    on a thin-evidence report, because the manager's own text is the primary
    input, not something to be inferred from scratch."""
    user_id, supabase = auth
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="Write a draft first — there's nothing to revise yet")

    report, _ = _get_or_create_plan(user_id, supabase, direct_report_id)
    role = fetch_role_expectations(supabase, report.get("role_level_id"))
    role_label = _role_label(role)
    low_scoring_items = _fetch_low_scoring_items(supabase, direct_report_id, report.get("role_level_id"))
    recent_summaries, commitments = _fetch_evidence(user_id, supabase, direct_report_id)

    prompt = _build_revise_prompt(
        report_name=report["name"],
        role_label=role_label,
        existing_text=text,
        low_scoring_items=low_scoring_items,
        recent_summaries=recent_summaries,
        open_commitments=commitments,
        today_iso=date.today().isoformat(),
    )

    raw = generate_text(prompt, model=AI_DEFAULT_MODEL_HEAVY, max_tokens=600)
    revised = raw.strip()
    if revised.startswith("```"):
        revised = revised.strip("`").strip()
    # Strip a wrapping pair of quotes the model sometimes adds despite the
    # prompt's instruction not to.
    if len(revised) >= 2 and revised[0] == revised[-1] and revised[0] in ('"', "'"):
        revised = revised[1:-1].strip()

    return ReviseNoteOut(note=revised or text)
