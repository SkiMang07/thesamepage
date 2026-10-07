"""
GET /api/onboarding/status.

Three states, all derived from real records on every call and stamped once
(Andrew, 2026-09-29; docs/design-proposals/2026-09-29-onboarding-path/
SETUP_MODE_BRIEF.md):

  activated  a prep sheet exists. Reached in the first run.
  set up     three things hold: org, expectations, goals.
               org           at least one org unit, and every active direct
                             report sits in one and has a role (one screen:
                             Settings > People & structure)
               expectations  every role in use has expectations configured
                             (approved: a draft waiting for review doesn't
                             count, but the step says it is waiting and points
                             at it)
               goals         an org-level goal (company or department) and a
                             team goal
  onboarded  set up, plus a logged 1:1, plus a later prep sheet for the same
             person (the sheet that carries forward from that log).

Knowledge documents are not a setup step: they arrive through the notes dump
and stay optional. The first logged 1:1 belongs to onboarded, not to setup.

A manager can skip a step for now (POST /skip-step; users.setup_skipped_steps,
read softly with the prompt columns). A skipped step counts toward ending setup
but is not "done": it is never stamped, it shows as skipped, and the manager can
undo the skip. Skipping org also unblocks expectations, so a manager with no
teams can still reach the later steps.

Both set up and onboarded are sticky. The first time each holds,
users.set_up_at / users.onboarded_at is stamped, and archiving a goal later
does not undo it. Once set up, the step queries stop; once onboarded, the
endpoint answers from the user row alone, because every page load asks. Each
step's first completion is stamped too (users.setup_<step>_at), which is what
lets its analytics event fire exactly once.

Chunk D adds the prompt layer (docs/design-proposals/2026-09-29-onboarding-path/
CHUNK_D_PLAN.md): the entry modal (intro_pending), how loud the setup card is
(card.level: full, quiet or hidden, from card_level()), and the completion
receipt (receipt_pending, GET /receipt). Their state is four columns on users,
read softly so a deploy before the migration only loses the prompt layer.

No AI is involved anywhere in this route.
"""
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict

import analytics
from routes.expectations_ai import _compute_coverage
from routes.org_goals import clear_unknown, read_unknown
from utils import get_authenticated_client, meeting_day_of

logger = logging.getLogger(__name__)

router = APIRouter()

STEP_ORDER = ("org", "expectations", "goals")
STEP_COLUMN = {step: f"setup_{step}_at" for step in STEP_ORDER}
ORG_LEVELS = {"company", "department"}

# The setup card's volume (chunk D). "Not now" snoozes it: 1 day, then 3, 7 and
# 14 (capped). After the first dismissal, or QUIET_AFTER_DAYS without progress,
# it is one quiet line instead of the full card. Completing a step resets both.
SNOOZE_DAYS = (1, 3, 7, 14)
QUIET_AFTER_DAYS = 7
# Setup is steps 4 to 6 of one numbered path: first run (/app/start and the first
# prep sheet) is steps 1 to 3. The frontend numbers with the same constant
# (FIRST_RUN_STEPS in lib/api.ts).
FIRST_RUN_STEPS = 3

PROMPT_COLUMNS = (
    "setup_skipped_steps",
    "setup_intro_seen_at",
    "setup_receipt_seen_at",
    "setup_card_dismissals",
    "setup_card_snoozed_until",
)


def evaluate(
    *,
    reports: list[dict],
    unit_count: int,
    covered_role_ids: set,
    goal_levels: set,
    org_goals_unknown: bool = False,
    queue: list[dict] | None = None,
    open_drafts: dict | None = None,
    skipped: set | None = None,
) -> dict:
    """The setup conditions as plain data. Pure, so it is tested without a database.

    `reports` are the manager's active direct reports (role_level_id, org_unit_id).
    `covered_role_ids` are role levels with at least one configured expectation.
    `org_goals_unknown` is the manager's "Don't know yet" on org goals; `queue` is
    expectation_queue() (who to set expectations for next, soonest 1:1 first).
    `open_drafts` is role level id -> "review" (an unapproved draft the manager
    can review now) or "writing" (a batch draft still being written).
    `skipped` is the steps the manager chose to skip for now.
    """
    skipped = set(skipped or ())
    people = len(reports)
    without_team = sum(1 for r in reports if not r.get("org_unit_id"))
    without_role = sum(1 for r in reports if not r.get("role_level_id"))
    roles_in_use = {r["role_level_id"] for r in reports if r.get("role_level_id")}
    roles_covered = len(roles_in_use & set(covered_role_ids))
    people_ready = sum(1 for r in reports if r.get("role_level_id") in set(covered_role_ids))
    # Drafts on roles in use that aren't approved yet. They don't complete the
    # step (approval does), but they change what it asks for: review first.
    waiting = {rid: state for rid, state in (open_drafts or {}).items()
               if rid in roles_in_use and rid not in set(covered_role_ids)}
    review_people = sorted(
        (r for r in reports if waiting.get(r.get("role_level_id")) == "review"),
        key=lambda r: (r.get("name") or "").lower(),
    )

    org_done = people > 0 and unit_count > 0 and without_team == 0 and without_role == 0
    exp_done = people > 0 and without_role == 0 and roles_covered == len(roles_in_use)
    has_org_goal = bool(goal_levels & ORG_LEVELS)
    has_team_goal = "team" in goal_levels

    return {
        "org": {
            "done": org_done,
            "skipped": "org" in skipped and not org_done,
            "people": people,
            "people_without_team": without_team,
            "people_without_role": without_role,
            "units": unit_count,
        },
        "expectations": {
            "done": exp_done,
            "skipped": "expectations" in skipped and not exp_done,
            # Waits on team and roles, unless the manager skipped that step.
            "blocked": not (org_done or "org" in skipped),
            "people_without_role": without_role,
            "roles_in_use": len(roles_in_use),
            "roles_covered": roles_covered,
            # People whose role has expectations: the ones an assessment can
            # be drafted against. Feeds the Assessments door.
            "people_ready": people_ready,
            # Whose role to set expectations for next, soonest 1:1 first (chunk C).
            # Roles with a draft already are left to review, not listed here.
            "next_role": (queue or [None])[0],
            "queue": queue or [],
            # Unapproved drafts waiting in Needs review, and the people they're for.
            "drafts_to_review": sum(1 for s in waiting.values() if s == "review"),
            "review_people": [r.get("name") for r in review_people if r.get("name")],
            # Batch drafts still being written (not in Needs review yet).
            "drafts_writing": sum(1 for s in waiting.values() if s == "writing"),
        },
        "goals": {
            "done": has_org_goal and has_team_goal,
            "skipped": "goals" in skipped and not (has_org_goal and has_team_goal),
            "has_org_goal": has_org_goal,
            "has_team_goal": has_team_goal,
            # "Don't know yet" (chunk C): recorded, and it does not complete the
            # step. `parked` when the org goal is the only thing missing, so the
            # step stops being the highlighted one and reads "Waiting on your boss".
            "unknown": bool(org_goals_unknown and not has_org_goal),
            "parked": bool(org_goals_unknown and not has_org_goal and has_team_goal),
        },
    }


def next_step(steps: dict) -> str | None:
    """The one step to point at: the first not done and not waiting on another.

    Order is the order a manager can actually do them in; expectations wait on
    org because roles come from there. None when every step is done.
    """
    for key in STEP_ORDER:
        step = steps[key]
        if not step["done"] and not step.get("skipped") and not step.get("blocked") and not step.get("parked"):
            return key
    return None


def _parse_ts(value) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def card_level(*, dismissals: int, snoozed_until, since, now: datetime) -> str:
    """How loud the setup card is: "full", "quiet" or "hidden". Pure.

    hidden  snoozed by a "Not now" that has not run out
    quiet   dismissed before, or QUIET_AFTER_DAYS since the last progress
            (the entry modal closing, or a step completing)
    full    otherwise
    The chip in the header is not governed by this: the requirement stays, only
    the volume changes.
    """
    until = _parse_ts(snoozed_until)
    if until and until > now:
        return "hidden"
    if (dismissals or 0) >= 1:
        return "quiet"
    last = _parse_ts(since)
    if last and now - last >= timedelta(days=QUIET_AFTER_DAYS):
        return "quiet"
    return "full"


def snooze_days(dismissals: int) -> int:
    """How long the nth dismissal hides the card (1-based, capped)."""
    return SNOOZE_DAYS[max(0, min(dismissals - 1, len(SNOOZE_DAYS) - 1))]


STEP_NAME = {"org": "team and roles", "expectations": "role expectations", "goals": "org and team goals"}

STEP_LINE = {
    "org": "Puts each person in a team and gives them a role, so a prep sheet knows who they work alongside and what they do.",
    "expectations": "Gives the sheet a standard to hold each person\u2019s work against.",
    "goals": "Links each person\u2019s work to the goals it serves.",
}


def step_target(steps: dict, key: str) -> dict:
    """The label and link for a step's one action, for surfaces outside the setup
    card (the Mission Control candidate). Mirrors what the card offers."""
    if key == "org":
        return {"label": "Place your people", "href": "/app/settings?section=people&from=setup"}
    if key == "expectations":
        waiting = steps["expectations"].get("drafts_to_review") or 0
        if waiting:
            return {"label": f"Review {waiting} draft{'' if waiting == 1 else 's'}", "href": "/app/expectations#needs-review"}
        nxt = steps["expectations"].get("next_role")
        if not nxt:
            return {"label": "Set expectations", "href": "/app/expectations"}
        first = (nxt.get("person_name") or "").strip().split(" ")[0] or "them"
        if not nxt.get("role_level_id"):
            return {"label": f"Pick a role for {first}", "href": f"/app/expectations/new?assign={nxt['report_id']}"}
        return {
            "label": f"Set expectations for {nxt.get('role_label') or 'this role'}",
            "href": f"/app/expectations/{nxt['role_level_id']}",
        }
    if not steps["goals"]["has_org_goal"]:
        # The goals modal lives on Mission Control; the param opens it there.
        return {"label": "Add company or department goals", "href": "/app/dashboard?setup=goals"}
    # The New goal form, set to a team goal (the only team is picked for you).
    return {"label": "Write your team\u2019s goal", "href": "/app/goals?new=1&level=team"}


def expectation_queue(
    reports: list[dict],
    role_labels: dict,
    covered_role_ids: set,
    next_dates: dict,
    limit: int = 5,
    drafted_role_ids: set | None = None,
) -> list[dict]:
    """Who to set expectations for next. Pure.

    Sequenced by payoff: the person whose 1:1 is soonest goes first, so the role
    that improves the next sheet comes before the rest. A person with no role is
    listed as themselves (the next action is picking a role); a role several
    people share is listed once, at its soonest person. People with no dated 1:1
    follow, by name. A role with an open draft (`drafted_role_ids`) is left out:
    its next action is reviewing that draft, not starting one.
    """
    covered = set(covered_role_ids) | set(drafted_role_ids or ())
    pending = [r for r in reports if not (r.get("role_level_id") and r["role_level_id"] in covered)]
    pending.sort(key=lambda r: (next_dates.get(r["id"]) is None, next_dates.get(r["id"]) or "", (r.get("name") or "").lower()))
    out, seen_roles = [], set()
    for r in pending:
        role_id = r.get("role_level_id")
        if role_id:
            if role_id in seen_roles:
                continue
            seen_roles.add(role_id)
        out.append({
            "report_id": r["id"],
            "person_name": r.get("name"),
            "role_level_id": role_id,
            "role_label": role_labels.get(role_id) if role_id else None,
            "next_1on1_on": next_dates.get(r["id"]),
        })
    return out[:limit]


def _open_drafts(supabase) -> dict:
    """role level id -> "review" | "writing" for every open expectations draft
    in the org (one per role). A batch draft still being written isn't in Needs
    review yet; a stale one reads as failed, which is (Retry lives there)."""
    import expectations_batch as batch
    rows = (
        supabase.table("role_expectation_drafts").select("role_level_id,analysis")
        .eq("status", "open").execute().data
    )
    return {r["role_level_id"]: "writing" if batch.is_drafting(r.get("analysis")) else "review" for r in rows}


def _next_1on1_dates(supabase, user_id: str) -> dict:
    """report id -> the date of their soonest unlogged 1:1, today or later."""
    rows = (
        supabase.table("one_on_ones")
        .select("direct_report_id,scheduled_at,created_at")
        .eq("manager_id", user_id)
        .is_("summary", "null")
        .not_.is_("scheduled_at", "null")
        .limit(200)
        .execute()
        .data
    )
    today = date.today()
    out: dict = {}
    for row in rows:
        day = meeting_day_of(row)
        who = row.get("direct_report_id")
        if day is None or who is None or day < today:
            continue
        if who not in out or day.isoformat() < out[who]:
            out[who] = day.isoformat()
    return out


def carried_forward(logged: list[dict], prepped: list[dict]) -> bool:
    """A prep sheet exists for a person, dated after a 1:1 already logged with them.

    That is the second-cycle activation: the sheet is built on top of a log,
    not only on what the manager typed the first time. "Dated after" is the
    meeting date (utils.meeting_day_of), the only resolver for when a 1:1
    happened or is planned; the logged row itself never counts as its own
    later sheet.
    """
    earliest_log: dict = {}
    for row in logged:
        day = meeting_day_of(row)
        who = row.get("direct_report_id")
        if day is None or who is None:
            continue
        if who not in earliest_log or day < earliest_log[who]:
            earliest_log[who] = day
    for row in prepped:
        day = meeting_day_of(row)
        who = row.get("direct_report_id")
        if day is not None and who in earliest_log and day > earliest_log[who]:
            return True
    return False


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


_USER_COLUMNS = ",".join(["set_up_at", "onboarded_at", *STEP_COLUMN.values()])
_ALL_USER_COLUMNS = ",".join([_USER_COLUMNS, *PROMPT_COLUMNS])


def _user_row(supabase, user_id: str) -> dict:
    """The user's setup stamps and prompt state. The prompt columns are read
    softly: before the chunk D migration the read falls back to the stamps
    alone, and `_prompt` says the prompt layer is not available."""
    try:
        rows = supabase.table("users").select(_ALL_USER_COLUMNS).eq("id", user_id).execute().data
        available = True
    except Exception:
        logger.warning("onboarding: prompt columns unavailable", exc_info=True)
        rows = supabase.table("users").select(_USER_COLUMNS).eq("id", user_id).execute().data
        available = False
    row = dict(rows[0]) if rows else {}
    row["_prompt"] = available
    return row


def _skipped(user: dict) -> set:
    """The steps the manager skipped for now. Empty when the column is not there yet."""
    return {k for k in (user.get("setup_skipped_steps") or []) if k in STEP_ORDER}


def _stamp(supabase, user_id: str, column: str) -> bool:
    """Set a timestamp column once. True only for the call that set it.

    The update is scoped to rows still null, so two tabs loading at the same
    moment cannot stamp twice or fire an event twice.
    """
    rows = (
        supabase.table("users")
        .update({column: _now_iso()})
        .eq("id", user_id)
        .is_(column, "null")
        .execute()
        .data
    )
    return bool(rows)


def _has_prep_sheet(supabase, user_id: str) -> bool:
    return bool(
        supabase.table("one_on_ones")
        .select("id")
        .eq("manager_id", user_id)
        .not_.is_("prep_guide", "null")
        .limit(1)
        .execute()
        .data
    )


def _is_onboarded(supabase, user_id: str) -> bool:
    """A logged 1:1, then a later prep sheet for the same person. Cheap first: no log, no second query."""
    logged = (
        supabase.table("one_on_ones")
        .select("id,direct_report_id,scheduled_at,created_at")
        .eq("manager_id", user_id)
        .not_.is_("summary", "null")
        .execute()
        .data
    )
    if not logged:
        return False
    prepped = (
        supabase.table("one_on_ones")
        .select("id,direct_report_id,scheduled_at,created_at")
        .eq("manager_id", user_id)
        .not_.is_("prep_guide", "null")
        .execute()
        .data
    )
    return carried_forward(logged, prepped)


def _status(
    *,
    activated,
    set_up_at,
    onboarded_at,
    steps,
    done_count,
    assessable_people,
    intro_pending=False,
    receipt_pending=False,
    card=None,
) -> dict:
    return {
        "activated": activated,
        "set_up": set_up_at is not None,
        "set_up_at": set_up_at,
        "onboarded": onboarded_at is not None,
        "onboarded_at": onboarded_at,
        "done_count": done_count,
        "total": len(STEP_ORDER),
        "next_step": next_step(steps) if steps else None,
        # People an assessment can be drafted for. None once set up, when the
        # question no longer matters to the door.
        "assessable_people": assessable_people,
        "steps": steps,
        # Chunk D. The entry modal has not been closed yet; the completion modal
        # has not been closed yet; how loud the setup card is (None once set up).
        "intro_pending": intro_pending,
        "receipt_pending": receipt_pending,
        "card": card,
    }


def _last_progress(user: dict):
    """The latest of the entry modal closing and any step first holding."""
    stamps = [_parse_ts(user.get(c)) for c in ("setup_intro_seen_at", *STEP_COLUMN.values())]
    stamps = [t for t in stamps if t]
    return max(stamps) if stamps else None


def _card(user: dict, intro_pending: bool, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    dismissals = int(user.get("setup_card_dismissals") or 0)
    # While the entry modal is still to be shown, the card is at full volume.
    level = "full" if intro_pending else card_level(
        dismissals=dismissals,
        snoozed_until=user.get("setup_card_snoozed_until"),
        since=_last_progress(user),
        now=now,
    )
    return {"level": level, "dismissals": dismissals, "snoozed_until": user.get("setup_card_snoozed_until")}


def _reset_card(supabase, user_id: str, user: dict) -> None:
    """A step completed: momentum earns the full card back for the next one."""
    if not user.get("_prompt"):
        return
    if not user.get("setup_card_dismissals") and not user.get("setup_card_snoozed_until"):
        return
    supabase.table("users").update({"setup_card_dismissals": 0, "setup_card_snoozed_until": None}).eq("id", user_id).execute()
    user["setup_card_dismissals"] = 0
    user["setup_card_snoozed_until"] = None


def _receipt_pending(user: dict, set_up_at=None) -> bool:
    return bool(user.get("_prompt") and (set_up_at or user.get("set_up_at")) and not user.get("setup_receipt_seen_at"))


def build_status(user_id: str, supabase) -> dict:
    user = _user_row(supabase, user_id)
    total = len(STEP_ORDER)

    if user.get("onboarded_at"):
        return _status(
            activated=True,
            set_up_at=user.get("set_up_at") or user["onboarded_at"],
            onboarded_at=user["onboarded_at"],
            steps=None,
            done_count=total,
            assessable_people=None,
            receipt_pending=_receipt_pending(user),
        )

    activated = _has_prep_sheet(supabase, user_id)
    set_up_at = user.get("set_up_at")
    steps = None
    done_count = total
    assessable = None

    if not set_up_at:
        reports = (
            supabase.table("direct_reports")
            .select("id,name,role_level_id,org_unit_id")
            .eq("manager_id", user_id)
            .is_("archived_at", "null")
            .execute()
            .data
        )
        unit_count = len(supabase.table("org_units").select("id").execute().data)
        coverage = _compute_coverage(supabase)
        covered_role_ids = {
            r["role_level_id"]
            for r in coverage["roles"]
            if r["metrics_count"] + r["skills_count"] + r["values_count"] > 0
        }
        goal_levels = {
            g["level"]
            for g in supabase.table("goals").select("level").neq("status", "cancelled").execute().data
        }
        role_labels = {
            r["id"]: f"{r['job_role']} L{r['job_level']}" if r.get("job_level") else str(r["job_role"])
            for r in supabase.table("role_levels").select("id,job_role,job_level").execute().data
        }
        open_drafts = _open_drafts(supabase)
        unknown = read_unknown(supabase, user_id)
        if unknown and goal_levels & ORG_LEVELS:
            clear_unknown(supabase, user_id)
            unknown = False
        steps = evaluate(
            reports=reports,
            unit_count=unit_count,
            covered_role_ids=covered_role_ids,
            goal_levels=goal_levels,
            org_goals_unknown=unknown,
            queue=expectation_queue(reports, role_labels, covered_role_ids, _next_1on1_dates(supabase, user_id),
                                    drafted_role_ids=set(open_drafts)),
            open_drafts=open_drafts,
            skipped=_skipped(user),
        )
        # A skipped step counts toward ending setup; only a done step is stamped.
        done_count = sum(1 for k in STEP_ORDER if steps[k]["done"] or steps[k]["skipped"])
        assessable = steps["expectations"]["people_ready"]

        for key in STEP_ORDER:
            if steps[key]["done"] and not user.get(STEP_COLUMN[key]):
                if _stamp(supabase, user_id, STEP_COLUMN[key]):
                    user[STEP_COLUMN[key]] = _now_iso()
                    _reset_card(supabase, user_id, user)
                    analytics.capture(user_id, "setup_step_completed", {"step": key, "done_count": done_count})

        if done_count == total:
            set_up_at = _now_iso()
            if _stamp(supabase, user_id, "set_up_at"):
                analytics.capture(user_id, "set_up", {})
            steps = None
            assessable = None

    onboarded_at = None
    if set_up_at and _is_onboarded(supabase, user_id):
        onboarded_at = _now_iso()
        if _stamp(supabase, user_id, "onboarded_at"):
            analytics.capture(user_id, "onboarded", {})

    intro_pending = False
    card = None
    if steps is not None and user.get("_prompt"):
        intro_pending = activated and not user.get("setup_intro_seen_at")
        card = _card(user, intro_pending)
    return _status(
        activated=activated,
        set_up_at=set_up_at,
        onboarded_at=onboarded_at,
        steps=steps,
        done_count=done_count,
        assessable_people=assessable,
        intro_pending=intro_pending,
        receipt_pending=_receipt_pending(user, set_up_at),
        card=card,
    )


@router.get("/status")
def get_onboarding_status(auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    return build_status(user_id, supabase)


def setup_prompt(user_id: str, supabase) -> dict | None:
    """What Mission Control's ranker needs to offer a way back to the next step,
    or None when there is nothing to offer (not activated, already set up, no
    step to point at, or the prompt layer is not available yet). Never raises:
    a failure here only means no candidate."""
    try:
        status = build_status(user_id, supabase)
    except Exception:
        logger.warning("onboarding: setup prompt unavailable", exc_info=True)
        return None
    steps, key, card = status.get("steps"), status.get("next_step"), status.get("card")
    if not status["activated"] or status["set_up"] or not steps or not key or not card:
        return None
    target = step_target(steps, key)
    return {
        "user_id": user_id,
        "next_step": key,
        "done_count": status["done_count"],
        "total": status["total"],
        "card_level": card["level"],
        "changes": STEP_LINE[key],
        **target,
    }


# ---- the entry modal, "Not now", and the completion receipt (chunk D) -------


class IntroSeenIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: Literal["started", "later"]


@router.post("/intro-seen")
def intro_seen(body: IntroSeenIn, auth=Depends(get_authenticated_client)):
    """The manager closed the entry modal. Stamped once; the event fires once."""
    user_id, supabase = auth
    if _stamp(supabase, user_id, "setup_intro_seen_at"):
        analytics.capture(user_id, "setup_intro_resolved", {"action": body.action})
    return {"ok": True}


@router.post("/card-dismissed")
def card_dismissed(auth=Depends(get_authenticated_client)):
    """"Not now" on the setup card: hide it for longer each time."""
    user_id, supabase = auth
    user = _user_row(supabase, user_id)
    if user.get("set_up_at") or not user.get("_prompt"):
        return {"ok": True, "snoozed_until": None}
    now = datetime.now(timezone.utc)
    before = _card(user, intro_pending=False, now=now)["level"]
    dismissals = int(user.get("setup_card_dismissals") or 0) + 1
    until = (now + timedelta(days=snooze_days(dismissals))).isoformat()
    supabase.table("users").update(
        {"setup_card_dismissals": dismissals, "setup_card_snoozed_until": until}
    ).eq("id", user_id).execute()
    analytics.capture(
        user_id,
        "setup_card_dismissed",
        {"dismissals": dismissals, "level_before": before if before in ("full", "quiet") else "quiet"},
    )
    return {"ok": True, "snoozed_until": until}


class SkipStepIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    step: Literal["org", "expectations", "goals"]
    skipped: bool = True


@router.post("/skip-step")
def skip_step(body: SkipStepIn, auth=Depends(get_authenticated_client)):
    """"Skip for now" on a setup step, or undo it. A skipped step counts toward
    ending setup; it is not done, and undoing puts it back. Does nothing once
    set up, or before the prompt-layer migration has run (`ok` false then)."""
    user_id, supabase = auth
    user = _user_row(supabase, user_id)
    if user.get("set_up_at"):
        return {"ok": True, "skipped": sorted(_skipped(user))}
    if not user.get("_prompt"):
        return {"ok": False, "skipped": []}
    current = _skipped(user)
    updated = (current | {body.step}) if body.skipped else (current - {body.step})
    if updated != current:
        supabase.table("users").update({"setup_skipped_steps": [k for k in STEP_ORDER if k in updated]}).eq("id", user_id).execute()
        analytics.capture(user_id, "setup_step_skipped", {"step": body.step, "skipped": body.skipped})
        if body.skipped:
            _reset_card(supabase, user_id, user)
    return {"ok": True, "skipped": [k for k in STEP_ORDER if k in updated]}


def _plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def compose_receipt(
    *,
    people: list[dict],
    unit_count: int,
    covered_role_ids: set,
    org_goals: int,
    team_goals: int,
    prepped_report_ids: set,
    project_count: int,
    check_in_count: int,
    skipped_steps: list[str] | None = None,
) -> dict:
    """The completion receipt as plain data. Pure: counts in, fixed sentences out.

    `lines` say what is now on record. `next` is the optional "when there is
    time" list: at most three, each only when it has something to act on, in a
    fixed order (people with no sheet, a first check-in, a first project).
    """
    covered = set(covered_role_ids)
    ready = [p for p in people if p.get("role_level_id") in covered]
    roles_covered = {p["role_level_id"] for p in ready}
    lines = [
        f"{_plural(len(people), 'person', 'people')} placed across {_plural(unit_count, 'team', 'teams')}.",
        f"{_plural(len(roles_covered), 'role', 'roles')} with expectations, covering {_plural(len(ready), 'person', 'people')}.",
        f"{_plural(org_goals, 'org goal', 'org goals')} and {_plural(team_goals, 'team goal', 'team goals')} on record.",
        "Assessments are open for each person whose role has expectations.",
    ]
    if skipped_steps:
        names = [STEP_NAME[k] for k in STEP_ORDER if k in skipped_steps]
        lines.append(f"Skipped for now: {', '.join(names)}. Each can still be done from its own page.")
    unprepped = [p for p in people if p["id"] not in prepped_report_ids]
    nxt = []
    if unprepped:
        nxt.append({
            "key": "prep_others",
            "label": f"Prepare sheets for {_plural(len(unprepped), 'more person', 'more people')}.",
            "detail": "Each sheet now draws on the expectations and goals you set.",
            "href": "/app/1-1s",
        })
    if (org_goals + team_goals) > 0 and check_in_count == 0:
        nxt.append({
            "key": "first_check_in",
            "label": "Record a first check-in on a goal.",
            "detail": "Check-ins show whether each goal is moving.",
            "href": "/app/goals",
        })
    if project_count == 0:
        nxt.append({
            "key": "first_project",
            "label": "Add a project.",
            "detail": "Projects hold the work behind a goal.",
            "href": "/app/projects",
        })
    return {"lines": lines, "next": nxt[:3]}


def _receipt_data(supabase, user_id: str) -> dict:
    people = (
        supabase.table("direct_reports")
        .select("id,role_level_id,org_unit_id")
        .eq("manager_id", user_id)
        .is_("archived_at", "null")
        .execute()
        .data
    )
    coverage = _compute_coverage(supabase)
    covered = {
        r["role_level_id"]
        for r in coverage["roles"]
        if r["metrics_count"] + r["skills_count"] + r["values_count"] > 0
    }
    goal_levels = [g["level"] for g in supabase.table("goals").select("level").neq("status", "cancelled").execute().data]
    prepped = {
        r["direct_report_id"]
        for r in supabase.table("one_on_ones")
        .select("direct_report_id")
        .eq("manager_id", user_id)
        .not_.is_("prep_guide", "null")
        .execute()
        .data
    }
    return dict(
        people=people,
        unit_count=len(supabase.table("org_units").select("id").execute().data),
        covered_role_ids=covered,
        org_goals=sum(1 for level in goal_levels if level in ORG_LEVELS),
        team_goals=sum(1 for level in goal_levels if level == "team"),
        prepped_report_ids=prepped,
        project_count=len(supabase.table("projects").select("id").eq("owner_id", user_id).limit(1).execute().data),
        check_in_count=len(supabase.table("check_ins").select("id").eq("owner_id", user_id).limit(1).execute().data),
    )


@router.get("/receipt")
def get_receipt(auth=Depends(get_authenticated_client)):
    """The completion receipt, while it is still to be shown; otherwise null."""
    user_id, supabase = auth
    user = _user_row(supabase, user_id)
    if not _receipt_pending(user):
        return None
    return compose_receipt(**_receipt_data(supabase, user_id), skipped_steps=sorted(_skipped(user)))


@router.post("/receipt-seen")
def receipt_seen(auth=Depends(get_authenticated_client)):
    """The manager closed the completion modal. Stamped once; the event fires once."""
    user_id, supabase = auth
    if not _user_row(supabase, user_id).get("set_up_at"):
        return {"ok": True}
    if _stamp(supabase, user_id, "setup_receipt_seen_at"):
        analytics.capture(user_id, "set_up_receipt_seen", {})
    return {"ok": True}
