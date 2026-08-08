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
from datetime import date, datetime

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from ai_core import generate_text
from config import AI_DEFAULT_MODEL_LIGHT
from utils import get_authenticated_client, limiter

router = APIRouter()

# Matches the prep prompt's cadence logic in one_on_ones.py and the
# dashboard's CADENCE_DAYS constant — if one changes, change all three
# (see CLAUDE.md).
_CADENCE_DAYS = 21

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
            f"  • {t['name']} (id: {t['id']}): {t['days_since_last']} days since last 1:1, "
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

TEAM STATUS (cadence threshold is {_CADENCE_DAYS} days — beyond that, a 1:1 is overdue):
{team_block}

AT-RISK GOALS:
{goals_block}

Rules:
- Pick at most ONE thing — the single most pressing item. Do not summarize everything; that defeats the point of a one-line flag.
- Only flag something that clears a real bar: significantly overdue (well past {_CADENCE_DAYS} days), multiple overdue commitments stacking up on one person, or a goal at risk with nothing else mitigating it. A person merely due soon, or with one recent open commitment, is NOT noteworthy.
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

    reports = (
        supabase.table("direct_reports")
        .select("id,name")
        .eq("manager_id", user_id)
        .execute()
        .data
    )
    if not reports:
        return DashboardInsight()

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
        team_summary.append({
            "id": r["id"],
            "name": r["name"],
            "days_since_last": days_since,
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
