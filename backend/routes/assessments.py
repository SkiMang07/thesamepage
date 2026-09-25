"""
Assessments — levels, the team list and the per-person scorecard: the
latest confirmed rating per expectation item plus the latest overall rating.
These reads are what the person page, Mission Control, Scribe context and
development suggestions consume.

Ratings are written ONLY by completing a period assessment
(routes/assessment_reviews.py → complete_performance_review()), which
inserts into the same tables (assessments with source_type
'performance_review', skill/value_assessments and metric_entries with
performance_review_id). Earlier rows written by the retired rolling
scorecard stay as history and still count as the latest rating until a
completed assessment supersedes them. See docs/systems/assessments.md.
"""
import logging

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from routes.direct_reports import fetch_role_expectations
from utils import ensure_org, get_authenticated_client, get_email_from_token

logger = logging.getLogger(__name__)

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
    except Exception as exc:
        # .single() raises when no row matches, which is the normal 404. Logged
        # at info so a real failure (a bad column, Supabase down) is findable.
        logger.info("lookup failed, answering 404: %s", exc)
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
# Request / response models
# ---------------------------------------------------------------------------

class LevelLabelIn(BaseModel):
    label: str


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/levels")
def get_levels(auth=Depends(get_authenticated_client), authorization: str = Header(None)):
    user_id, supabase = auth
    return _ensure_levels(user_id, supabase, authorization)


@router.put("/levels/{ordinal}")
def rename_level(
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
def list_team_assessments(auth=Depends(get_authenticated_client), authorization: str = Header(None)):
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
        .select("direct_report_id,level_ordinal,created_at,source_type")
        .eq("manager_id", user_id)
        .order("created_at", desc=True)
        .execute()
        .data
    )
    latest_by_report = _latest_by_config(latest_rows, "direct_report_id")
    reviews = _review_status_by_report(supabase, user_id)

    return [
        {
            **r,
            "latest_level_ordinal": latest_by_report.get(r["id"], {}).get("level_ordinal"),
            "latest_level_label": label_by_ordinal.get(latest_by_report.get(r["id"], {}).get("level_ordinal")),
            "assessed_at": latest_by_report.get(r["id"], {}).get("created_at"),
            # True when the latest overall came from a completed period
            # assessment; false for a legacy rolling rating.
            "latest_from_review": latest_by_report.get(r["id"], {}).get("source_type") == "performance_review",
            "last_review": reviews.get(r["id"], {}).get("completed"),
            "open_review": reviews.get(r["id"], {}).get("draft"),
        }
        for r in reports
    ]


def _review_status_by_report(supabase, user_id: str, report_id: str | None = None) -> dict:
    """report_id -> {"completed": latest completed assessment, "draft": the
    open draft}. Fails soft to {} so latest-rating readers keep working if
    the period-assessment migration hasn't run yet."""
    try:
        query = (
            supabase.table("performance_reviews")
            .select("id,direct_report_id,status,stage,review_period,period_start,period_end,cadence,rating_ordinal,completed_at,updated_at")
            .eq("manager_id", user_id)
        )
        if report_id:
            query = query.eq("direct_report_id", report_id)
        rows = query.order("created_at", desc=True).execute().data
    except Exception:
        logger.warning("assessments: could not read performance_reviews", exc_info=True)
        return {}
    out: dict = {}
    for row in rows:
        slot = out.setdefault(row["direct_report_id"], {})
        if row.get("status") == "draft":
            slot.setdefault("draft", row)
        elif row.get("status") == "completed" and row.get("completed_at"):
            current = slot.get("completed")
            if not current or row["completed_at"] > current["completed_at"]:
                slot["completed"] = row
    return out


@router.get("/{direct_report_id}")
def get_scorecard(
    direct_report_id: str,
    auth=Depends(get_authenticated_client),
    authorization: str = Header(None),
):
    user_id, supabase = auth
    scorecard = _fetch_scorecard(user_id, supabase, direct_report_id, authorization)
    reviews = _review_status_by_report(supabase, user_id, direct_report_id).get(direct_report_id, {})
    scorecard["last_review"] = reviews.get("completed")
    scorecard["open_review"] = reviews.get("draft")
    return scorecard
