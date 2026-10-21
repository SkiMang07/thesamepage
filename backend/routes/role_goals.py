"""
From their role — a person's role expectations as their starting goals.

docs/GOAL_ATTRIBUTION_SCOPING.md Part B (Andrew, 2026-10-20) and
docs/systems/goals.md -> From their role. Expectations belong to the role, so
this reads them live from the person's current approved role through
fetch_role_expectations(): nothing is copied per person, a revision shows up
at once, and a retired item drops off. A goal record exists only when the
manager makes one specific to this person (routes/goals.py, with
source_metric_config_id / source_skill_config_id).

Readings for a measured expectation are metric_entries, the same rows a
completed assessment writes: one number track, entered by the manager, never
derived from notes. A personalised goal linked to a measured expectation reads
these rows too (decision D7); it has no readings of its own.

No AI anywhere in this module.
"""
import math

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from expectation_bar import parse_bar, verdict
from routes.direct_reports import fetch_role_expectations
from utils import get_authenticated_client

router = APIRouter()

READINGS_LIMIT = 200
_PERIOD_MAX = 40
_NOTE_MAX = 1000
_LIVE_GOAL = ("active", "on_track", "at_risk")


class ReadingIn(BaseModel):
    metric_config_id: str
    value: float
    period: str
    notes: str | None = None


def _report(supabase, user_id: str, report_id: str) -> dict:
    rows = (
        supabase.table("direct_reports")
        .select("id,name,role_level_id")
        .eq("id", report_id)
        .eq("manager_id", user_id)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Direct report not found")
    return rows[0]


def _reading(row: dict) -> dict:
    value = row.get("value")
    if value is not None and not isinstance(value, (int, float)):
        value = float(value)
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return {
        "id": row["id"],
        "metric_config_id": row.get("metric_config_id"),
        "value": value,
        "period": row.get("period"),
        "recorded_at": row.get("recorded_at"),
        "notes": row.get("notes"),
        # Written by a completed assessment: part of that record, so it can't
        # be removed from here.
        "from_assessment": bool(row.get("performance_review_id")),
    }


def readings_by_config(supabase, report_id: str, config_ids: list[str], limit: int = READINGS_LIMIT) -> dict[str, list[dict]]:
    """config_id -> readings, newest first. RLS limits rows to the caller's."""
    if not config_ids:
        return {}
    rows = (
        supabase.table("metric_entries")
        .select("id,metric_config_id,value,period,recorded_at,notes,performance_review_id")
        .eq("direct_report_id", report_id)
        .in_("metric_config_id", config_ids)
        .order("recorded_at", desc=True)
        .limit(limit)
        .execute()
        .data
    )
    out: dict[str, list[dict]] = {}
    for r in rows:
        out.setdefault(r["metric_config_id"], []).append(_reading(r))
    return out


def _goal_link(g: dict) -> dict:
    return {"id": g["id"], "title": g.get("title"), "status": g.get("status"), "due_date": g.get("due_date")}


def shape_role_goals(report: dict, expectations: dict | None, readings: dict[str, list[dict]], goals: list[dict],
                     source_names: dict[str, dict]) -> dict:
    """The live view: what the role expects, each measured item with its
    latest reading, and the person's own goals that started from an item.
    Pure, so the tests exercise it without a database."""
    linked: dict[str, list[dict]] = {}
    for g in goals:
        key = g.get("source_metric_config_id") or g.get("source_skill_config_id")
        if key:
            linked.setdefault(key, []).append(g)

    role = (expectations or {}).get("role_level")
    out = {
        "report": {"id": report["id"], "name": report.get("name")},
        "role": {"id": role["id"], "job_role": role.get("job_role"), "job_level": role.get("job_level")} if role else None,
        "measured": [],
        "responsibilities": [],
        "skills": [],
        "values": [],
        "unlinked_goals": [],
    }
    shown: set[str] = set()
    for m in (expectations or {}).get("metrics") or []:
        target = m.get("target") if m.get("target_status") in ("set", None) else None
        bar = parse_bar(target, m.get("expectation"))
        rows = readings.get(m["id"], [])
        latest = rows[0] if rows else None
        shown.add(m["id"])
        out["measured"].append({
            "kind": "metric",
            "id": m["id"],
            "name": m.get("metric_name"),
            "expectation": m.get("expectation"),
            "exceeds": m.get("exceeds"),
            "target": target,
            "target_status": m.get("target_status"),
            "measurement_period": m.get("measurement_period"),
            "data_source": m.get("data_source"),
            "latest": latest,
            "reading_count": len(rows),
            "bar": bar,
            "verdict": verdict(latest["value"] if latest else None, bar),
            "goals": [_goal_link(g) for g in linked.get(m["id"], [])],
        })
    for s in (expectations or {}).get("skills") or []:
        shown.add(s["id"])
        bucket = "responsibilities" if s.get("area") == "responsibility" else "skills"
        out[bucket].append({
            "kind": "responsibility" if bucket == "responsibilities" else "skill",
            "id": s["id"],
            "name": s.get("skill_name"),
            "expectation": s.get("expectation"),
            "exceeds": s.get("exceeds"),
            "goals": [_goal_link(g) for g in linked.get(s["id"], [])],
        })
    for v in (expectations or {}).get("values") or []:
        out["values"].append({
            "kind": "value",
            "id": v["id"],
            "name": v.get("value_name"),
            "expectation": v.get("description"),
            "company_wide": v.get("role_level_id") is None,
        })
    # Personalised goals whose expectation is no longer in the role: retired by
    # a revision, or from a role the person no longer holds. The goal stays.
    for key, gs in linked.items():
        if key in shown:
            continue
        src = source_names.get(key) or {}
        for g in gs:
            out["unlinked_goals"].append({
                **_goal_link(g),
                "source_name": src.get("name"),
                "reason": "retired" if src.get("retired") else "other_role",
            })
    return out


def source_names(supabase, metric_ids: list[str], skill_ids: list[str]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    if metric_ids:
        for r in supabase.table("metric_configs").select("id,metric_name,retired_at,role_level_id").in_("id", metric_ids).execute().data:
            out[r["id"]] = {"kind": "metric", "name": r.get("metric_name"), "retired": bool(r.get("retired_at")),
                            "role_level_id": r.get("role_level_id")}
    if skill_ids:
        for r in supabase.table("skill_configs").select("id,skill_name,retired_at,area,role_level_id").in_("id", skill_ids).execute().data:
            out[r["id"]] = {"kind": "responsibility" if r.get("area") == "responsibility" else "skill",
                            "name": r.get("skill_name"), "retired": bool(r.get("retired_at")),
                            "role_level_id": r.get("role_level_id")}
    return out


@router.get("/{report_id}")
def get_role_goals(report_id: str, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    report = _report(supabase, user_id, report_id)
    expectations = fetch_role_expectations(supabase, report.get("role_level_id"))
    metric_ids = [m["id"] for m in (expectations or {}).get("metrics") or []]
    readings = readings_by_config(supabase, report_id, metric_ids)
    goals = [
        g for g in (
            supabase.table("goals")
            .select("id,title,status,due_date,source_metric_config_id,source_skill_config_id")
            .eq("owner_id", user_id)
            .eq("direct_report_id", report_id)
            .execute()
            .data
        )
        if (g.get("source_metric_config_id") or g.get("source_skill_config_id")) and g.get("status") != "cancelled"
    ]
    current = set(metric_ids) | {s["id"] for s in (expectations or {}).get("skills") or []}
    missing_m = sorted({g["source_metric_config_id"] for g in goals if g.get("source_metric_config_id") and g["source_metric_config_id"] not in current})
    missing_s = sorted({g["source_skill_config_id"] for g in goals if g.get("source_skill_config_id") and g["source_skill_config_id"] not in current})
    return shape_role_goals(report, expectations, readings, goals, source_names(supabase, missing_m, missing_s))


def _current_metric(supabase, report: dict, metric_config_id: str) -> dict:
    expectations = fetch_role_expectations(supabase, report.get("role_level_id"))
    for m in (expectations or {}).get("metrics") or []:
        if m["id"] == metric_config_id:
            return m
    raise HTTPException(status_code=422, detail="That isn't one of the measured expectations in their current role")


@router.get("/{report_id}/readings")
def list_readings(report_id: str, metric_config_id: str, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    _report(supabase, user_id, report_id)
    return readings_by_config(supabase, report_id, [metric_config_id]).get(metric_config_id, [])


@router.post("/{report_id}/readings")
def add_reading(report_id: str, body: ReadingIn, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    report = _report(supabase, user_id, report_id)
    _current_metric(supabase, report, body.metric_config_id)
    if not math.isfinite(body.value):
        raise HTTPException(status_code=422, detail="A reading must be a finite number")
    period = body.period.strip()
    if not period:
        raise HTTPException(status_code=422, detail="Say which period the reading is for")
    if len(period) > _PERIOD_MAX:
        raise HTTPException(status_code=422, detail=f"Keep the period under {_PERIOD_MAX} characters")
    notes = (body.notes or "").strip() or None
    if notes and len(notes) > _NOTE_MAX:
        raise HTTPException(status_code=422, detail=f"Keep the note under {_NOTE_MAX} characters")
    row = (
        supabase.table("metric_entries")
        .insert({
            "direct_report_id": report_id,
            "metric_config_id": body.metric_config_id,
            "value": body.value,
            "period": period,
            "notes": notes,
            "recorded_by": user_id,
        })
        .execute()
        .data[0]
    )
    return _reading(row)


@router.delete("/{report_id}/readings/{entry_id}")
def delete_reading(report_id: str, entry_id: str, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    _report(supabase, user_id, report_id)
    rows = (
        supabase.table("metric_entries")
        .select("id,performance_review_id")
        .eq("id", entry_id)
        .eq("direct_report_id", report_id)
        .eq("recorded_by", user_id)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Reading not found")
    if rows[0].get("performance_review_id"):
        raise HTTPException(status_code=409, detail="This reading is part of a completed assessment, so it stays")
    supabase.table("metric_entries").delete().eq("id", entry_id).eq("recorded_by", user_id).execute()
    return {"deleted": entry_id}
