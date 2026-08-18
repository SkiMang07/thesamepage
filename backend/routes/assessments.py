"""
Assessments — the ratings/status layer PRODUCT_VISION.md calls the
load-bearing piece of "Mission Control": scoring a direct report against
their role's configured expectations (Settings > Expectations —
metric/skill/value_configs, Session 6), not just having them on record.

v1 scope (scoped with Andrew via AskUserQuestion, 2026-08-04):
- Rolling assessment (assessments + skill_assessments + value_assessments),
  not performance_reviews (formal periodic) — that table stays dormant.
- All three expectation types: metrics (metric_entries), skills
  (skill_assessments), values (value_assessments) — plus an overall
  level_ordinal snapshot (assessments, scored against assessment_levels).
- AI-assisted draft, manager reviews before anything saves — same
  draft-then-review rule as one_on_ones.py's wrapup flow (Session 8). The AI
  only scores items the evidence actually supports; it does not force-cover
  every configured expectation, same restraint as the 1:1 prep prompt.
- Own top-level page (/app/assessments) + a summary section on DR detail.

All 6 base tables (assessment_levels, assessments, skill_assessments,
value_assessments, metric_entries, performance_reviews) and their RLS
policies were already present in database/schema.sql from the original
project scaffold — same "activate a dormant table" pattern as Goals/Org/
Projects/Capacity. No new migration for table structure; assessment_levels
just needs its 5 default rows seeded per org on first use (see
_ensure_levels below), same idea as ensure_org(). performance_reviews stays
untouched this pass.
"""
import json
from datetime import date

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel

from ai_core import generate_text
from config import AI_DEFAULT_MODEL_HEAVY
from routes.direct_reports import fetch_role_expectations
from utils import ensure_org, get_authenticated_client, get_email_from_token, limiter

router = APIRouter()

_DEFAULT_LEVELS = [
    (1, "Needs Improvement"),
    (2, "Developing"),
    (3, "Meets Expectations"),
    (4, "Exceeds Expectations"),
    (5, "Outstanding"),
]

# kind -> (config table, scale-definition table, scale FK column, name column)
_ITEM_CONFIG = {
    "skills": ("skill_scale_definitions", "skill_config_id", "skill_name"),
    "values": ("value_scale_definitions", "value_config_id", "value_name"),
    "metrics": ("metric_scale_definitions", "metric_config_id", "metric_name"),
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _ensure_levels(user_id: str, supabase, authorization: str | None) -> list[dict]:
    """Org's assessment_levels, seeding 5 sensible defaults the first time an
    org has none — same on-demand-bootstrap idea as ensure_org(). Labels are
    editable afterward via PUT /levels/{ordinal}."""
    org_id = ensure_org(user_id, supabase, get_email_from_token(authorization))
    rows = (
        supabase.table("assessment_levels")
        .select("*")
        .eq("org_id", org_id)
        .order("ordinal")
        .execute()
        .data
    )
    if rows:
        return rows
    supabase.table("assessment_levels").insert(
        [{"org_id": org_id, "ordinal": o, "label": label} for o, label in _DEFAULT_LEVELS]
    ).execute()
    return (
        supabase.table("assessment_levels")
        .select("*")
        .eq("org_id", org_id)
        .order("ordinal")
        .execute()
        .data
    )


def _fetch_scale_definitions(supabase, table: str, fk_col: str, config_ids: list[str]) -> dict:
    """config_id -> [scale definition rows], ordered by evaluation_point."""
    if not config_ids:
        return {}
    rows = (
        supabase.table(table)
        .select("*")
        .in_(fk_col, config_ids)
        .order("evaluation_point")
        .execute()
        .data
    )
    out: dict = {}
    for row in rows:
        out.setdefault(row[fk_col], []).append(row)
    return out


def _latest_by_config(rows: list[dict], config_col: str) -> dict:
    """First occurrence per config_id wins — caller must have ordered newest
    first. Same pattern as one_on_ones.py's last-1:1 lookup."""
    out: dict = {}
    for row in rows:
        out.setdefault(row[config_col], row)
    return out


def _shape_items(configs: list[dict], name_key: str, scales_by_config: dict, latest_by_config: dict) -> list[dict]:
    out = []
    for c in configs:
        out.append({
            "config_id": c["id"],
            "name": c.get(name_key),
            "order_type": c.get("order_type"),
            "description": c.get("description"),
            "expectation": c.get("expectation"),
            "measurement_period": c.get("measurement_period"),
            "value_type": c.get("value_type"),
            "scale_min": c.get("evaluation_scale_min"),
            "scale_max": c.get("evaluation_scale_max"),
            "scale_definitions": scales_by_config.get(c["id"], []),
            "latest": latest_by_config.get(c["id"]),
        })
    return out


def _fetch_scorecard(user_id: str, supabase, direct_report_id: str, authorization: str | None) -> dict:
    """The full assessable picture for one direct report: role expectations
    (metrics/skills/values + their scale definitions) each paired with the
    latest recorded score, plus the latest overall rating. Shared by
    GET /{id} and the AI draft endpoint below."""
    try:
        report = (
            supabase.table("direct_reports")
            .select("id,name,role_title,role_level_id")
            .eq("id", direct_report_id)
            .eq("manager_id", user_id)
            .single()
            .execute()
            .data
        )
    except Exception:
        raise HTTPException(status_code=404, detail="Direct report not found")
    if not report:
        raise HTTPException(status_code=404, detail="Direct report not found")

    expectations = fetch_role_expectations(supabase, report.get("role_level_id"))
    skills_cfg = (expectations or {}).get("skills", [])
    values_cfg = (expectations or {}).get("values", [])
    metrics_cfg = (expectations or {}).get("metrics", [])

    skill_ids = [c["id"] for c in skills_cfg]
    value_ids = [c["id"] for c in values_cfg]
    metric_ids = [c["id"] for c in metrics_cfg]

    skill_scales = _fetch_scale_definitions(supabase, "skill_scale_definitions", "skill_config_id", skill_ids)
    value_scales = _fetch_scale_definitions(supabase, "value_scale_definitions", "value_config_id", value_ids)
    metric_scales = _fetch_scale_definitions(supabase, "metric_scale_definitions", "metric_config_id", metric_ids)

    latest_skills = _latest_by_config(
        supabase.table("skill_assessments").select("*").eq("direct_report_id", direct_report_id)
        .in_("skill_config_id", skill_ids).order("assessed_at", desc=True).execute().data if skill_ids else [],
        "skill_config_id",
    )
    latest_values = _latest_by_config(
        supabase.table("value_assessments").select("*").eq("direct_report_id", direct_report_id)
        .in_("value_config_id", value_ids).order("assessed_at", desc=True).execute().data if value_ids else [],
        "value_config_id",
    )
    latest_metrics = _latest_by_config(
        supabase.table("metric_entries").select("*").eq("direct_report_id", direct_report_id)
        .in_("metric_config_id", metric_ids).order("recorded_at", desc=True).execute().data if metric_ids else [],
        "metric_config_id",
    )

    overall_rows = (
        supabase.table("assessments")
        .select("*")
        .eq("direct_report_id", direct_report_id)
        .eq("manager_id", user_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
        .data
    )

    return {
        "direct_report": report,
        "role": (expectations or {}).get("role_level"),
        "skills": _shape_items(skills_cfg, "skill_name", skill_scales, latest_skills),
        "values": _shape_items(values_cfg, "value_name", value_scales, latest_values),
        "metrics": _shape_items(metrics_cfg, "metric_name", metric_scales, latest_metrics),
        "overall": overall_rows[0] if overall_rows else None,
        "levels": _ensure_levels(user_id, supabase, authorization),
    }


# ---------------------------------------------------------------------------
# Draft prompt — mirrors the restraint rule already proven in
# one_on_ones.py's expectations block: only speak to what the evidence
# supports, never force coverage of every configured item.
# ---------------------------------------------------------------------------

def _format_items_block(items: list[dict]) -> str:
    if not items:
        return "  (none configured for this role)"
    lines = []
    for it in items:
        header = f"  [{it['config_id']}] {it['name']}"
        if it.get("expectation"):
            header += f" — expectation: {it['expectation']}"
        elif it.get("description"):
            header += f" — {it['description']}"
        lines.append(header)
        defs = it.get("scale_definitions") or []
        if defs:
            for sd in defs:
                desc = sd.get("qualitative_output") or sd.get("quantitative_output") or sd.get("description") or ""
                lines.append(f"      {sd.get('evaluation_point')}: {desc}")
        else:
            lines.append(f"      (scale {it.get('scale_min') or 1}-{it.get('scale_max') or 4}, no point definitions configured)")
    return "\n".join(lines)


def _build_draft_prompt(
    report_name: str,
    role_label: str | None,
    levels: list[dict],
    skills: list[dict],
    values: list[dict],
    metrics: list[dict],
    recent_summaries: list[str],
    open_commitments: list[dict],
    done_commitments: list[dict],
    goals: list[dict],
    today_iso: str,
) -> str:
    levels_block = "\n".join(f"  {lv['ordinal']}: {lv['label']}" for lv in levels)
    history_block = "\n".join(f"  • {s}" for s in recent_summaries) or "  (no completed 1:1s on record yet)"

    def _commitment_lines(rows: list[dict]) -> str:
        return "\n".join(
            f"  • {c['description']} (due: {c.get('due_date') or 'unspecified'})" for c in rows
        ) or "  (none)"

    goals_block = "\n".join(
        f"  • {g['title']} — status: {g['status']}"
        + (f" — measured by: {g['success_metrics']}" if g.get("success_metrics") else "")
        for g in goals
    ) or "  (no individual goals on record)"

    return f"""You are helping a manager assess {report_name}'s performance against their role's configured expectations. Today's date: {today_iso}.

Your ONLY source of truth is the evidence below. Do not invent performance you have no evidence for. If there isn't enough signal to judge something, leave it out entirely — an incomplete, honest draft beats a fabricated complete one. The manager reviews and edits everything before it saves.

---
ROLE: {role_label or "No role assigned"}

OVERALL RATING SCALE:
{levels_block}

SKILLS (score against each skill's own scale):
{_format_items_block(skills)}

VALUES (score against each value's own scale):
{_format_items_block(values)}

METRICS (log a value + period only where the notes give a real number):
{_format_items_block(metrics)}

---
EVIDENCE

Recent 1:1 history (last few meetings, newest first):
{history_block}

Open commitments:
{_commitment_lines(open_commitments)}

Recently completed commitments (delivered work — strong signal):
{_commitment_lines(done_commitments)}

Individual goals:
{goals_block}

---
Return ONLY valid JSON. No commentary, no markdown, no code fences.

{{
  "overall": {{"level_ordinal": 3, "notes": "1-3 sentences justifying this rating, grounded in the evidence above"}},
  "skills": [{{"config_id": "...", "evaluation_point": 3, "notes": "why, grounded in evidence"}}],
  "values": [{{"config_id": "...", "evaluation_point": 3, "notes": "why, grounded in evidence"}}],
  "metrics": [{{"config_id": "...", "value": 42, "period": "e.g. Q3 2026 or a specific month", "notes": "where this number came from"}}]
}}

Set "overall" to null if there truly isn't enough evidence yet. Only include a skill/value/metric entry when the evidence actually supports a specific judgment or number — do not force coverage of every configured item. Empty arrays and a null overall are valid, honest answers when there simply isn't enough to go on."""


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class LevelLabelIn(BaseModel):
    label: str


class DraftOverall(BaseModel):
    level_ordinal: int
    notes: str = ""


class DraftSkillValue(BaseModel):
    config_id: str
    evaluation_point: int
    notes: str = ""


class DraftMetric(BaseModel):
    config_id: str
    value: float
    period: str | None = None
    notes: str = ""


class AssessmentDraft(BaseModel):
    """AI-drafted scores for the manager to review — nothing is saved until
    POST /{direct_report_id}."""
    overall: DraftOverall | None = None
    skills: list[DraftSkillValue] = []
    values: list[DraftSkillValue] = []
    metrics: list[DraftMetric] = []


class SaveOverallIn(BaseModel):
    level_ordinal: int
    notes: str | None = None


class SaveSkillValueIn(BaseModel):
    config_id: str
    evaluation_point: int
    notes: str | None = None


class SaveMetricIn(BaseModel):
    config_id: str
    value: float
    period: str | None = None


class SaveAssessmentIn(BaseModel):
    overall: SaveOverallIn | None = None
    skills: list[SaveSkillValueIn] = []
    values: list[SaveSkillValueIn] = []
    metrics: list[SaveMetricIn] = []


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/levels")
async def get_levels(auth=Depends(get_authenticated_client), authorization: str = Header(None)):
    user_id, supabase = auth
    return _ensure_levels(user_id, supabase, authorization)


@router.put("/levels/{ordinal}")
async def rename_level(
    ordinal: int,
    body: LevelLabelIn,
    auth=Depends(get_authenticated_client),
    authorization: str = Header(None),
):
    user_id, supabase = auth
    org_id = ensure_org(user_id, supabase, get_email_from_token(authorization))
    _ensure_levels(user_id, supabase, authorization)  # make sure defaults exist first
    result = (
        supabase.table("assessment_levels")
        .update({"label": body.label.strip()})
        .eq("org_id", org_id)
        .eq("ordinal", ordinal)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Level not found")
    return result.data[0]


# NOTE: declared before /{direct_report_id} so FastAPI doesn't match "" as an id.
@router.get("")
async def list_team_assessments(auth=Depends(get_authenticated_client), authorization: str = Header(None)):
    """Every direct report + their latest overall rating, for the
    /app/assessments list page. A few queries + a Python merge, same shape
    as direct_reports.py's /overview."""
    user_id, supabase = auth
    levels = _ensure_levels(user_id, supabase, authorization)
    label_by_ordinal = {lv["ordinal"]: lv["label"] for lv in levels}

    # Archived people (Session 43) drop off the assessments list — see
    # docs/TEAM_SETUP_UX_REVIEW.md §7.3, finding P1.
    reports = (
        supabase.table("direct_reports")
        .select("id,name,role_title")
        .eq("manager_id", user_id)
        .is_("archived_at", "null")
        .order("name")
        .execute()
        .data
    )
    latest_rows = (
        supabase.table("assessments")
        .select("direct_report_id,level_ordinal,created_at")
        .eq("manager_id", user_id)
        .order("created_at", desc=True)
        .execute()
        .data
    )
    latest_by_report = _latest_by_config(latest_rows, "direct_report_id")

    return [
        {
            **r,
            "latest_level_ordinal": latest_by_report.get(r["id"], {}).get("level_ordinal"),
            "latest_level_label": label_by_ordinal.get(latest_by_report.get(r["id"], {}).get("level_ordinal")),
            "assessed_at": latest_by_report.get(r["id"], {}).get("created_at"),
        }
        for r in reports
    ]


@router.get("/{direct_report_id}")
async def get_scorecard(
    direct_report_id: str,
    auth=Depends(get_authenticated_client),
    authorization: str = Header(None),
):
    user_id, supabase = auth
    return _fetch_scorecard(user_id, supabase, direct_report_id, authorization)


@router.post("/{direct_report_id}/draft", response_model=AssessmentDraft)
@limiter.limit("10/minute")
async def draft_assessment(
    request: Request,
    direct_report_id: str,
    auth=Depends(get_authenticated_client),
    authorization: str = Header(None),
):
    """Pure AI-call route — nothing is saved. Manager reviews the draft, then
    POST /{direct_report_id} writes whatever they keep/edit."""
    user_id, supabase = auth
    scorecard = _fetch_scorecard(user_id, supabase, direct_report_id, authorization)
    report = scorecard["direct_report"]
    role = scorecard["role"]
    role_label = None
    if role:
        role_label = f"{role['job_role']}, level {role['job_level']}"
        if role.get("functional_team"):
            role_label += f" ({role['functional_team']})"

    known_skill_ids = {s["config_id"] for s in scorecard["skills"]}
    known_value_ids = {v["config_id"] for v in scorecard["values"]}
    known_metric_ids = {m["config_id"] for m in scorecard["metrics"]}

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
        .order("created_at", desc=True)
        .limit(20)
        .execute()
        .data
    )
    open_commitments = [c for c in commitments if c["status"] == "open"]
    done_commitments = [c for c in commitments if c["status"] == "done"][:5]

    goals = (
        supabase.table("goals")
        .select("title,status,success_metrics")
        .eq("direct_report_id", direct_report_id)
        .eq("owner_id", user_id)
        .execute()
        .data
    )

    prompt = _build_draft_prompt(
        report_name=report["name"],
        role_label=role_label,
        levels=scorecard["levels"],
        skills=scorecard["skills"],
        values=scorecard["values"],
        metrics=scorecard["metrics"],
        recent_summaries=recent_summaries,
        open_commitments=open_commitments,
        done_commitments=done_commitments,
        goals=goals,
        today_iso=date.today().isoformat(),
    )

    raw = generate_text(prompt, model=AI_DEFAULT_MODEL_HEAVY, max_tokens=2000)
    raw_clean = raw.strip()
    if raw_clean.startswith("```"):
        start = raw_clean.find("{")
        end = raw_clean.rfind("}") + 1
        raw_clean = raw_clean[start:end] if start != -1 else raw_clean

    try:
        parsed = json.loads(raw_clean)
    except json.JSONDecodeError:
        parsed = {}

    valid_ordinals = {lv["ordinal"] for lv in scorecard["levels"]}
    overall = None
    overall_raw = parsed.get("overall")
    if isinstance(overall_raw, dict) and overall_raw.get("level_ordinal") in valid_ordinals:
        overall = DraftOverall(level_ordinal=overall_raw["level_ordinal"], notes=overall_raw.get("notes", "") or "")

    def _filter_skill_values(rows, known_ids) -> list[DraftSkillValue]:
        out = []
        for r in rows or []:
            cid = r.get("config_id")
            point = r.get("evaluation_point")
            if cid in known_ids and isinstance(point, int):
                out.append(DraftSkillValue(config_id=cid, evaluation_point=point, notes=r.get("notes", "") or ""))
        return out

    skills = _filter_skill_values(parsed.get("skills"), known_skill_ids)
    values = _filter_skill_values(parsed.get("values"), known_value_ids)

    metrics = []
    for r in parsed.get("metrics") or []:
        cid = r.get("config_id")
        val = r.get("value")
        if cid in known_metric_ids and isinstance(val, (int, float)):
            metrics.append(DraftMetric(config_id=cid, value=val, period=r.get("period"), notes=r.get("notes", "") or ""))

    return AssessmentDraft(overall=overall, skills=skills, values=values, metrics=metrics)


@router.post("/{direct_report_id}")
async def save_assessment(
    direct_report_id: str,
    body: SaveAssessmentIn,
    auth=Depends(get_authenticated_client),
):
    user_id, supabase = auth
    try:
        report = (
            supabase.table("direct_reports")
            .select("id")
            .eq("id", direct_report_id)
            .eq("manager_id", user_id)
            .single()
            .execute()
            .data
        )
    except Exception:
        raise HTTPException(status_code=404, detail="Direct report not found")
    if not report:
        raise HTTPException(status_code=404, detail="Direct report not found")

    saved: dict = {"overall": None, "skills": [], "values": [], "metrics": []}

    if body.overall:
        saved["overall"] = (
            supabase.table("assessments")
            .insert({
                "manager_id": user_id,
                "direct_report_id": direct_report_id,
                "level_ordinal": body.overall.level_ordinal,
                "notes": body.overall.notes,
                "source_type": "manual",
            })
            .execute()
            .data[0]
        )

    for s in body.skills:
        saved["skills"].append(
            supabase.table("skill_assessments")
            .insert({
                "direct_report_id": direct_report_id,
                "skill_config_id": s.config_id,
                "evaluation_point": s.evaluation_point,
                "notes": s.notes,
                "assessed_by": user_id,
            })
            .execute()
            .data[0]
        )

    for v in body.values:
        saved["values"].append(
            supabase.table("value_assessments")
            .insert({
                "direct_report_id": direct_report_id,
                "value_config_id": v.config_id,
                "evaluation_point": v.evaluation_point,
                "notes": v.notes,
                "assessed_by": user_id,
            })
            .execute()
            .data[0]
        )

    for m in body.metrics:
        saved["metrics"].append(
            supabase.table("metric_entries")
            .insert({
                "direct_report_id": direct_report_id,
                "metric_config_id": m.config_id,
                "value": m.value,
                "period": m.period,
                "recorded_by": user_id,
            })
            .execute()
            .data[0]
        )

    return saved
