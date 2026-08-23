"""
Mission Control's AI insight banner (Session 19 grid redesign — see
docs/SESSION_HISTORY.md and the mission_control_grid project memory note).

GET /insight scans the same signals Mission Control's grid already surfaces
client-side (1:1 cadence, open/overdue commitments, at-risk goals) and asks
the model to name the SINGLE most pressing thing, or nothing at all. Same
restraint rule as the assessments AI draft (Session 16, "leave it unscored
rather than force coverage") and the 1:1 prep prompt's expectations block
(Session 7): an insight that isn't actually earned is worse than no
insight — a hollow banner erodes trust in every other AI-generated thing in
this app. A null insight most days is the expected, correct behavior, not a
failure mode.

Uses AI_DEFAULT_MODEL_LIGHT, not HEAVY — this is one sentence of triage, not
a structured prep sheet, and (unlike prep/wrap-up, which fire on an explicit
user action) this is the one AI call that potentially fires on every
dashboard load.

Fails quiet: any AI or parsing failure returns an empty DashboardInsight
rather than a 500 — this endpoint should never be the reason a dashboard
load breaks. See the try/except around the generate_text call below.

Caching (added Session 20 — flagged in Session 19 as the natural next step,
see foundation_weaknesses project memory note): a manager refreshing Mission
Control repeatedly in one sitting was re-running the full query set AND a
real Anthropic call every load, for a near-identical answer each time. Cache
is a plain in-memory dict keyed by user_id, same shape as utils.py's
_token_cache, with a flat TTL (not tied to any specific write path — see
note on _INSIGHT_CACHE_TTL_SECONDS below for the tradeoff this accepts).
"""
import json
import time
import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from ai_core import generate_text
from config import AI_DEFAULT_MODEL_LIGHT, settings
from mission_control_engine import build_brief
from routes.capacity import _time_off_hours
from routes.expectations_ai import _compute_coverage
from utils import get_authenticated_client, get_org, limiter, resolve_cadence_days

router = APIRouter()

# user_id -> (DashboardInsight, cached_until_epoch_seconds). Unbounded like
# utils.py's _token_cache — same accepted tradeoff (see foundation_weaknesses
# memory note item #3): fine at today's single-instance, single-digit-user
# scale, flag before horizontal scaling or real user growth.
_insight_cache: dict[str, tuple["DashboardInsight", float]] = {}
_INSIGHT_CACHE_TTL_SECONDS = 20 * 60

# Deliberately NOT invalidated on writes (new 1:1 logged, commitment
# resolved, etc.) — that would mean threading cache invalidation into every
# route that touches these signals. A flat TTL means a stale insight can
# persist up to 20 minutes after a manager acts on it; acceptable for a
# once-a-day-ish dashboard glance, revisit if that staleness ever surprises
# someone in practice.


class DashboardInsight(BaseModel):
    insight: str | None = None
    cta_label: str | None = None
    cta_direct_report_id: str | None = None


def _build_insight_prompt(team_summary: list[dict], at_risk_goals: list[dict]) -> str:
    if team_summary:
        team_block = "\n".join(
            f"  • {t['name']} (id: {t['id']}): {t['days_since_last']} days since last 1:1 "
            f"(their cadence is every {t['cadence_days']} days), "
            f"{t['open_commitments']} open commitment(s), {t['overdue_commitments']} overdue"
            for t in team_summary
        )
    else:
        team_block = "  (No direct reports yet.)"

    if at_risk_goals:
        goals_block = "\n".join(f"  • [{g['level']}] {g['title']}" for g in at_risk_goals)
    else:
        goals_block = "  (No goals currently marked at risk.)"

    return f"""You are scanning a manager's team status for ONE thing worth flagging the moment they open their dashboard.

TEAM STATUS (each person has their own cadence — org default or a per-person
override, see the parenthetical after each — beyond that, a 1:1 is overdue):
{team_block}

AT-RISK GOALS:
{goals_block}

Rules:
- Pick at most ONE thing — the single most pressing item. Do not summarize everything; that defeats the point of a one-line flag.
- Only flag something that clears a real bar: significantly overdue relative to THEIR OWN cadence (well past it, not merely past it), multiple overdue commitments stacking up on one person, or a goal at risk with nothing else mitigating it. A person merely due soon, or with one recent open commitment, is NOT noteworthy.
- If nothing clears that bar, say so — do not invent urgency. A null insight is a valid, expected, common answer.
- Write the insight as ONE tight sentence, plain language, no hedging ("might want to consider..."). Name the person or goal directly.
- cta_label is a short 2-3 word action ("Prep now", "Review goal") — only when there's a specific direct report to act on, otherwise null.
- cta_direct_report_id must be copied EXACTLY from the "(id: ...)" value next to the matching person above — never invented, null if not applicable.

Return ONLY valid JSON. No commentary, no markdown, no code fences.

{{"insight": "...", "cta_label": "...", "cta_direct_report_id": "..."}}

Or, when nothing is noteworthy:

{{"insight": null, "cta_label": null, "cta_direct_report_id": null}}"""


@router.get("/insight", response_model=DashboardInsight)
@limiter.limit("10/minute")
async def get_dashboard_insight(request: Request, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth

    now = time.time()
    cached = _insight_cache.get(user_id)
    if cached and cached[1] > now:
        return cached[0]

    # Archived people (Session 43) shouldn't drive a dashboard nudge — see
    # docs/TEAM_SETUP_UX_REVIEW.md §7.3, finding P1.
    reports = (
        supabase.table("direct_reports")
        .select("id,name,one_on_one_cadence_days")
        .eq("manager_id", user_id)
        .is_("archived_at", "null")
        .execute()
        .data
    )
    if not reports:
        return DashboardInsight()

    # Read-only — a dashboard load shouldn't bootstrap an organization row.
    org = get_org(user_id, supabase)

    # Same "completed only" rule as direct_reports.py's /overview — a
    # planned (prepped, not-yet-happened) session must not reset the
    # cadence clock.
    one_on_ones = (
        supabase.table("one_on_ones")
        .select("direct_report_id,created_at,summary")
        .eq("manager_id", user_id)
        .not_.is_("summary", "null")
        .order("created_at", desc=True)
        .execute()
        .data
    )
    last_one_on_one: dict = {}
    for row in one_on_ones:
        last_one_on_one.setdefault(row["direct_report_id"], row["created_at"])

    open_commitments = (
        supabase.table("commitments")
        .select("direct_report_id,due_date")
        .eq("owner_id", user_id)
        .eq("status", "open")
        .execute()
        .data
    )
    today = date.today()
    today_iso = today.isoformat()
    open_counts: dict = {}
    overdue_counts: dict = {}
    for row in open_commitments:
        rid = row["direct_report_id"]
        open_counts[rid] = open_counts.get(rid, 0) + 1
        if row.get("due_date") and row["due_date"] < today_iso:
            overdue_counts[rid] = overdue_counts.get(rid, 0) + 1

    team_summary = []
    for r in reports:
        last_at = last_one_on_one.get(r["id"])
        days_since: int | str
        if last_at:
            try:
                last_date = datetime.fromisoformat(last_at.replace("Z", "+00:00")).date()
                days_since = (today - last_date).days
            except (ValueError, AttributeError):
                days_since = "unknown"
        else:
            days_since = "never met"
        cadence_days, _cadence_source = resolve_cadence_days(r, org)
        team_summary.append({
            "id": r["id"],
            "name": r["name"],
            "days_since_last": days_since,
            "cadence_days": cadence_days,
            "open_commitments": open_counts.get(r["id"], 0),
            "overdue_commitments": overdue_counts.get(r["id"], 0),
        })

    at_risk_goals = (
        supabase.table("goals")
        .select("title,level")
        .eq("owner_id", user_id)
        .eq("status", "at_risk")
        .neq("level", "individual")
        .execute()
        .data
    )

    prompt = _build_insight_prompt(team_summary, at_risk_goals)

    try:
        raw = generate_text(prompt, model=AI_DEFAULT_MODEL_LIGHT, max_tokens=300)
    except Exception:
        # AI/network failure — the dashboard should still load with no
        # banner rather than surface a 502 for a nice-to-have.
        return DashboardInsight()

    raw_clean = raw.strip()
    if raw_clean.startswith("```"):
        start = raw_clean.find("{")
        end = raw_clean.rfind("}") + 1
        raw_clean = raw_clean[start:end] if start != -1 else raw_clean

    try:
        parsed = json.loads(raw_clean)
    except json.JSONDecodeError:
        return DashboardInsight()

    # Only attach a report id if it actually matches one we sent — never
    # trust the model's id echo blindly.
    valid_report_ids = {t["id"] for t in team_summary}
    cta_id = parsed.get("cta_direct_report_id")
    if cta_id not in valid_report_ids:
        cta_id = None

    result = DashboardInsight(
        insight=parsed.get("insight") or None,
        cta_label=parsed.get("cta_label") or None,
        cta_direct_report_id=cta_id,
    )
    # Only cache a real, successfully-generated result — not the "no
    # reports yet" or AI-failure early returns above, so those aren't stuck
    # for the full TTL.
    _insight_cache[user_id] = (result, time.time() + _INSIGHT_CACHE_TTL_SECONDS)
    return result


# ---------------------------------------------------------------------------
# Action-first Mission Control. The legacy /insight endpoint above remains
# available while the rollout flag can still return the old dashboard.
# ---------------------------------------------------------------------------

_EVENT_TYPES = {
    "impression",
    "why_opened",
    "cta_clicked",
    "addressed",
    "snoozed",
    "not_relevant",
    "setup_dismissed_today",
    "ai_explanation_succeeded",
    "ai_explanation_failed",
    "downstream_completed",
}
_SAFE_METADATA_KEYS = {
    "reason_codes",
    "coverage",
    "mode",
    "attribution",
    "target_ids",
    "explanation_source",
}
_BRIEF_REFRESH_AFTER = timedelta(hours=24)


class MissionControlEventIn(BaseModel):
    brief_id: str
    event_type: str = Field(min_length=1, max_length=40)
    candidate_key: str = Field(min_length=1, max_length=200)
    evidence_fingerprint: str = Field(min_length=1, max_length=64)
    candidate_type: str = Field(min_length=1, max_length=80)
    entity_type: str | None = Field(default=None, max_length=40)
    entity_id: str | None = None
    rank: int | None = Field(default=None, ge=1, le=3)
    score: int | None = None
    snoozed_until: str | None = None
    parent_event_id: str | None = None
    metadata: dict = Field(default_factory=dict)


class MissionControlEventsIn(BaseModel):
    events: list[MissionControlEventIn] = Field(min_length=1, max_length=10)


class ExplainIn(BaseModel):
    candidate_key: str = Field(min_length=1, max_length=200)
    evidence_fingerprint: str = Field(min_length=1, max_length=64)
    local_date: str
    timezone: str = "UTC"


def _action_first_enabled(user_id: str) -> bool:
    mode = settings.MISSION_CONTROL_ACTION_FIRST_MODE.strip().lower()
    if mode == "off":
        return False
    if mode == "on":
        return True
    if mode == "allowlist":
        allowed = {
            value.strip()
            for value in settings.MISSION_CONTROL_ACTION_FIRST_ALLOWLIST.split(",")
            if value.strip()
        }
        return user_id in allowed
    return False


def _manager_local_date(raw: str | None) -> date:
    utc_today = datetime.now(timezone.utc).date()
    if not raw:
        return utc_today
    try:
        parsed = date.fromisoformat(raw)
    except ValueError:
        raise HTTPException(status_code=422, detail="local_date must be YYYY-MM-DD")
    if abs((parsed - utc_today).days) > 1:
        raise HTTPException(status_code=422, detail="local_date is outside the accepted range")
    return parsed


def _safe_call(coverage: dict[str, str], domain: str, fn, fallback):
    try:
        value = fn()
        coverage[domain] = "ok"
        return value
    except Exception:
        coverage[domain] = "unavailable"
        return fallback


def _load_action_snapshot(user_id: str, supabase, local_date: date) -> tuple[dict, list[dict]]:
    """Load each domain independently so one failure cannot masquerade as all-clear."""
    coverage: dict[str, str] = {}
    org = get_org(user_id, supabase)

    reports = _safe_call(
        coverage,
        "conversations",
        lambda: (
            supabase.table("direct_reports")
            .select("id,name,role_level_id,created_at,one_on_one_cadence_days")
            .eq("manager_id", user_id)
            .is_("archived_at", "null")
            .order("name")
            .execute()
            .data
        ),
        [],
    )
    for report in reports:
        days, source = resolve_cadence_days(report, org)
        report["cadence_days"] = days
        report["cadence_source"] = source

    sessions = []
    if coverage["conversations"] == "ok":
        sessions = _safe_call(
            coverage,
            "conversations",
            lambda: (
                supabase.table("one_on_ones")
                .select("id,direct_report_id,scheduled_at,summary,prep_guide,created_at")
                .eq("manager_id", user_id)
                .order("created_at", desc=True)
                .execute()
                .data
            ),
            [],
        )

    commitments = _safe_call(
        coverage,
        "commitments",
        lambda: (
            supabase.table("commitments")
            .select("id,direct_report_id,status,committed_by,due_date,created_at,completed_at,source_type,source_id")
            .eq("owner_id", user_id)
            .order("created_at", desc=True)
            .execute()
            .data
        ),
        [],
    )
    if coverage["commitments"] == "ok" and any(
        row.get("status") != "done" and row.get("completed_at")
        for row in commitments
    ):
        coverage["commitments"] = "partial"
    goals = _safe_call(
        coverage,
        "goals",
        lambda: (
            supabase.table("goals")
            .select("id,title,status,due_date,created_at")
            .eq("owner_id", user_id)
            .execute()
            .data
        ),
        [],
    )
    projects = _safe_call(
        coverage,
        "projects",
        lambda: (
            supabase.table("projects")
            .select("id,title,status,due_date,goal_id,created_at")
            .eq("owner_id", user_id)
            .execute()
            .data
        ),
        [],
    )
    check_ins = _safe_call(
        coverage,
        "check_ins",
        lambda: (
            supabase.table("check_ins")
            .select("id,goal_id,project_id,status,created_at")
            .eq("owner_id", user_id)
            .order("created_at", desc=True)
            .execute()
            .data
        ),
        [],
    )
    if coverage["check_ins"] != "ok":
        if coverage["goals"] == "ok":
            coverage["goals"] = "partial"
        if coverage["projects"] == "ok":
            coverage["projects"] = "partial"

    # Expectations only affect the optional early-use context prompt.
    role_coverage = _safe_call(coverage, "expectations", lambda: _compute_coverage(supabase), {"roles": []})
    covered_roles = {
        row["role_level_id"]
        for row in role_coverage.get("roles", [])
        if row["metrics_count"] + row["skills_count"] + row["values_count"] > 0
    }
    for report in reports:
        report["role_has_expectations"] = bool(
            report.get("role_level_id") and report["role_level_id"] in covered_roles
        )

    # Capacity never creates a candidate. Only actual logged time off can
    # corroborate an already-dated commitment.
    capacity: dict[str, dict] = {}
    report_ids = [row["id"] for row in reports]
    week_start = local_date - timedelta(days=local_date.weekday())
    week_end = week_start + timedelta(days=6)
    if report_ids:
        def load_capacity():
            profiles = (
                supabase.table("capacity_profiles")
                .select("direct_report_id,contracted_hours_per_week")
                .in_("direct_report_id", report_ids)
                .execute()
                .data
            )
            profile_by_report = {row["direct_report_id"]: row for row in profiles}
            default_hours = 40.0
            if org:
                settings_rows = (
                    supabase.table("capacity_settings")
                    .select("default_hours_per_week")
                    .eq("org_id", org["id"])
                    .execute()
                    .data
                )
                if settings_rows:
                    default_hours = float(settings_rows[0]["default_hours_per_week"])
            time_off = (
                supabase.table("time_off_entries")
                .select("direct_report_id,start_date,end_date,hours_per_day")
                .in_("direct_report_id", report_ids)
                .lte("start_date", week_end.isoformat())
                .gte("end_date", week_start.isoformat())
                .execute()
                .data
            )
            by_report: dict[str, list[dict]] = {}
            for row in time_off:
                by_report.setdefault(row["direct_report_id"], []).append(row)
            for report in reports:
                contracted = float(
                    (profile_by_report.get(report["id"]) or {}).get("contracted_hours_per_week")
                    or default_hours
                )
                hours = _time_off_hours(
                    by_report.get(report["id"], []),
                    week_start,
                    week_end,
                    contracted / 5.0,
                )
                capacity[report["id"]] = {"actual_time_off_hours": round(hours, 1)}
            return capacity

        capacity = _safe_call(coverage, "capacity", load_capacity, {})
    else:
        coverage["capacity"] = "ok"

    events = _safe_call(
        coverage,
        "feedback",
        lambda: (
            supabase.table("mission_control_events")
            .select("candidate_key,evidence_fingerprint,event_type,snoozed_until,created_at")
            .eq("manager_id", user_id)
            .in_("event_type", ["addressed", "not_relevant", "snoozed", "setup_dismissed_today"])
            .order("created_at", desc=True)
            .limit(500)
            .execute()
            .data
        ),
        [],
    )
    snapshot = {
        "reports": reports,
        "sessions": sessions,
        "commitments": commitments,
        "goals": goals,
        "projects": projects,
        "check_ins": check_ins,
        "capacity": capacity,
        "coverage": coverage,
    }
    return snapshot, events


@router.get("/brief")
async def get_action_brief(
    local_date: str | None = None,
    timezone_name: str = "UTC",
    auth=Depends(get_authenticated_client),
):
    user_id, supabase = auth
    if not _action_first_enabled(user_id):
        return {"variant": "legacy"}
    manager_date = _manager_local_date(local_date)
    snapshot, events = _load_action_snapshot(user_id, supabase, manager_date)
    result = build_brief(snapshot, manager_date, events=events)
    generated_at = datetime.now(timezone.utc)
    return {
        "variant": "action_first",
        "brief_id": str(uuid.uuid4()),
        "generated_at": generated_at.isoformat(),
        "stale_after": (generated_at + _BRIEF_REFRESH_AFTER).isoformat(),
        "timezone": timezone_name[:64],
        **result,
    }


@router.post("/events")
async def record_mission_control_events(
    body: MissionControlEventsIn,
    auth=Depends(get_authenticated_client),
):
    user_id, supabase = auth
    rows = []
    now = datetime.now(timezone.utc)
    for event in body.events:
        if event.event_type not in _EVENT_TYPES - {"downstream_completed"}:
            raise HTTPException(status_code=422, detail="Unsupported Mission Control event type")
        try:
            brief_id = str(uuid.UUID(event.brief_id))
            parent_id = str(uuid.UUID(event.parent_event_id)) if event.parent_event_id else None
            entity_id = str(uuid.UUID(event.entity_id)) if event.entity_id else None
        except ValueError:
            raise HTTPException(status_code=422, detail="Invalid event identifier")
        snoozed_until = None
        if event.event_type in {"snoozed", "setup_dismissed_today"}:
            try:
                snoozed = datetime.fromisoformat((event.snoozed_until or "").replace("Z", "+00:00"))
            except ValueError:
                raise HTTPException(status_code=422, detail="A valid snoozed_until is required")
            if snoozed.tzinfo is None:
                raise HTTPException(status_code=422, detail="snoozed_until must include a timezone")
            if not now < snoozed <= now + timedelta(days=90):
                raise HTTPException(status_code=422, detail="snoozed_until must be within 90 days")
            snoozed_until = snoozed.isoformat()
        elif event.snoozed_until:
            raise HTTPException(status_code=422, detail="snoozed_until is only valid for snooze events")
        if parent_id:
            parent = (
                supabase.table("mission_control_events")
                .select("id")
                .eq("id", parent_id)
                .eq("manager_id", user_id)
                .execute()
                .data
            )
            if not parent:
                raise HTTPException(status_code=404, detail="Parent event not found")
        safe_metadata = {key: value for key, value in event.metadata.items() if key in _SAFE_METADATA_KEYS}
        if len(json.dumps(safe_metadata, separators=(",", ":"), default=str)) > 8192:
            raise HTTPException(status_code=422, detail="Mission Control event metadata is too large")
        rows.append(
            {
                "manager_id": user_id,
                "brief_id": brief_id,
                "parent_event_id": parent_id,
                "event_type": event.event_type,
                "candidate_key": event.candidate_key[:200],
                "evidence_fingerprint": event.evidence_fingerprint[:64],
                "candidate_type": event.candidate_type[:80],
                "entity_type": event.entity_type[:40] if event.entity_type else None,
                "entity_id": entity_id,
                "rank": event.rank,
                "score": event.score,
                "snoozed_until": snoozed_until,
                "metadata": safe_metadata,
            }
        )
    inserted = supabase.table("mission_control_events").insert(rows).execute().data
    return {"events": [{"id": row["id"], "event_type": row["event_type"]} for row in inserted]}


@router.post("/reconcile")
async def reconcile_mission_control_outcomes(auth=Depends(get_authenticated_client)):
    """Infer only outcomes current records can establish; never mutate them."""
    user_id, supabase = auth
    since = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    clicks = (
        supabase.table("mission_control_events")
        .select("*")
        .eq("manager_id", user_id)
        .eq("event_type", "cta_clicked")
        .gte("created_at", since)
        .order("created_at")
        .execute()
        .data
    )
    if not clicks:
        return {"completed": 0}
    existing = (
        supabase.table("mission_control_events")
        .select("parent_event_id")
        .eq("manager_id", user_id)
        .eq("event_type", "downstream_completed")
        .execute()
        .data
    )
    done = {row["parent_event_id"] for row in existing}
    inserts = []
    for click in clicks:
        if click["id"] in done or not click.get("entity_id"):
            continue
        completed = False
        candidate_type = click["candidate_type"]
        if candidate_type == "start_due_one_on_one_prep":
            completed = bool(
                supabase.table("one_on_ones")
                .select("id")
                .eq("manager_id", user_id)
                .eq("direct_report_id", click["entity_id"])
                .not_.is_("prep_guide", "null")
                .gt("created_at", click["created_at"])
                .limit(1)
                .execute()
                .data
            )
        elif candidate_type == "commitment_follow_up":
            target_ids = (click.get("metadata") or {}).get("target_ids") or []
            if target_ids:
                completed = bool(
                    supabase.table("commitments")
                    .select("id")
                    .eq("owner_id", user_id)
                    .in_("id", target_ids)
                    .in_("status", ["done", "dropped"])
                    .gt("completed_at", click["created_at"])
                    .limit(1)
                    .execute()
                    .data
                )
        elif candidate_type.startswith("goal_"):
            completed = bool(
                supabase.table("check_ins")
                .select("id")
                .eq("owner_id", user_id)
                .eq("goal_id", click["entity_id"])
                .gt("created_at", click["created_at"])
                .limit(1)
                .execute()
                .data
            )
        elif candidate_type.startswith("project_"):
            completed = bool(
                supabase.table("check_ins")
                .select("id")
                .eq("owner_id", user_id)
                .eq("project_id", click["entity_id"])
                .gt("created_at", click["created_at"])
                .limit(1)
                .execute()
                .data
            )
        if completed:
            inserts.append(
                {
                    "manager_id": user_id,
                    "brief_id": click["brief_id"],
                    "parent_event_id": click["id"],
                    "event_type": "downstream_completed",
                    "candidate_key": click["candidate_key"],
                    "evidence_fingerprint": click["evidence_fingerprint"],
                    "candidate_type": click["candidate_type"],
                    "entity_type": click.get("entity_type"),
                    "entity_id": click.get("entity_id"),
                    "rank": click.get("rank"),
                    "score": click.get("score"),
                    "metadata": {"attribution": "inferred_from_source_record"},
                }
            )
    if inserts:
        supabase.table("mission_control_events").insert(inserts).execute()
    return {"completed": len(inserts)}


@router.post("/explain")
@limiter.limit("10/minute")
async def explain_action_brief(
    request: Request,
    body: ExplainIn,
    auth=Depends(get_authenticated_client),
):
    user_id, supabase = auth
    manager_date = _manager_local_date(body.local_date)
    snapshot, events = _load_action_snapshot(user_id, supabase, manager_date)
    brief = build_brief(snapshot, manager_date, events=events)
    candidates = [brief.get("primary"), *brief.get("secondary", [])]
    candidate = next(
        (
            item for item in candidates
            if item
            and item["candidate_key"] == body.candidate_key
            and item["evidence_fingerprint"] == body.evidence_fingerprint
        ),
        None,
    )
    if not candidate:
        raise HTTPException(status_code=409, detail="Recommendation evidence has changed")
    evidence = "\n".join(f"- {item['label']} (source: {item['source']})" for item in candidate["evidence"])
    prompt = f"""Rewrite the deterministic explanation below as one calm, plain-language sentence for a manager.

ACTION: {candidate['title']}
DETERMINISTIC EXPLANATION: {candidate['explanation']}
ALLOWED FACTS:
{evidence}

Rules:
- Add no fact, diagnosis, cause, motive, risk label, or recommendation.
- Do not quote private notes; none are provided.
- If the facts do not support a useful rewrite, return exactly: null
- Return only the sentence or null, with no JSON or markdown.
"""
    try:
        text = generate_text(prompt, model=AI_DEFAULT_MODEL_LIGHT, max_tokens=120).strip()
    except Exception:
        return {"status": "failed", "explanation": None}
    if not text or text.lower() == "null":
        return {"status": "unavailable", "explanation": None}
    return {"status": "ok", "explanation": text[:500]}
