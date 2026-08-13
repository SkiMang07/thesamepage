#!/usr/bin/env python3
"""
eval/test_assistant.py — 15-utterance eval for the Scribe agent loop (S1).

Usage:
  cd <repo-root>
  python eval/test_assistant.py

Requires ANTHROPIC_API_KEY — loaded from backend/.env if present, otherwise
from the shell environment. Supabase keys are not needed (tool executor is
mocked with realistic fake data).

Exit 0 if ≥13/15 pass; exit 1 otherwise.

Runtime: ~60-90 s (each case makes 2-4 real Anthropic API calls).
"""
import os
import sys
import json
import time
from pathlib import Path

# ---- bootstrap: load this project's backend/.env only ----
_ENV_PATH = Path(__file__).parent.parent / "backend" / ".env"

try:
    from dotenv import load_dotenv as _load_dotenv
    if _ENV_PATH.exists():
        _load_dotenv(_ENV_PATH, override=True)
    # else: rely on shell environment (CI / Railway)
except ImportError:
    pass  # python-dotenv not installed; rely on shell environment

# Fail fast before touching the Anthropic API — one clear message beats
# running all 15 cases into 401s.
if not os.environ.get("ANTHROPIC_API_KEY") or os.environ["ANTHROPIC_API_KEY"].startswith("your-"):
    print(
        f"\nERROR: ANTHROPIC_API_KEY not set in backend/.env\n"
        f"  Edit {_ENV_PATH}\n"
        f"  and replace the placeholder with your real key, then re-run.\n",
        file=sys.stderr,
    )
    sys.exit(1)

# Required by config.py at import time — supply dummies for Supabase since
# the eval never touches the database.
for _k in ("SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"):
    if not os.environ.get(_k):
        os.environ[_k] = f"https://dummy.{_k.lower()}.invalid"

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from assistant_engine import run_assistant_turn  # noqa: E402

# ---- fake data ----
# Realistic but minimal dataset that exercises all 15 cases.
# IDs are deterministic strings so checkers can reference them.

FAKE_GOALS = [
    {"id": "goal-aaw", "title": "Activate the Army", "level": "team", "status": "active"},
    {"id": "goal-obo1", "title": "Improve Onboarding Efficiency", "level": "team", "status": "on_track"},
    {"id": "goal-obo2", "title": "Onboard 2 new AU Support Reps", "level": "team", "status": "active"},
    {"id": "goal-nrr", "title": "Improve NRR", "level": "company", "status": "active"},
    {"id": "goal-uscs", "title": "Onboard New US CSMs", "level": "team", "status": "active"},
    # No "culture" goal — forces case 9 to surface a no-match scenario.
    # No "Value Engine" goal in the live goals list — case 12 (delete) should still refuse.
]

FAKE_PROJECTS: list = []  # empty — forces case 5 to note no HubSpot project found

FAKE_DIRECT_REPORTS = [
    {"id": "dr-jordan", "name": "Jordan", "role_title": "Customer Success Manager"},
    {"id": "dr-leah", "name": "Leah", "role_title": "Account Manager"},
    {"id": "dr-alex", "name": "Alex", "role_title": "Customer Success Manager"},
]

FAKE_ORG_UNITS = [
    {"id": "ou-cs", "name": "Customer Success", "unit_type": "department"},
    {"id": "ou-na", "name": "North America", "unit_type": "team"},
]

TODAY = "2026-08-13"  # Thursday; next Friday = 2026-08-14


def build_executor() -> dict:
    return {
        "list_goals": lambda _: FAKE_GOALS,
        "list_projects": lambda _: FAKE_PROJECTS,
        "list_direct_reports": lambda _: FAKE_DIRECT_REPORTS,
        "list_org_units": lambda _: FAKE_ORG_UNITS,
    }


# ---- helpers ----

def has_draft(drafts: list, entity_type: str) -> bool:
    return any(d.get("entity_type") == entity_type for d in drafts)


def get_draft(drafts: list, entity_type: str) -> dict | None:
    return next((d for d in drafts if d.get("entity_type") == entity_type), None)


def payload_field(drafts: list, entity_type: str, field: str):
    d = get_draft(drafts, entity_type)
    return d.get("payload", {}).get(field) if d else None


def text_has(text: str, *phrases) -> bool:
    tl = text.lower()
    return any(p.lower() in tl for p in phrases)


# ---- 15 eval cases ----

CASES = [
    # -----------------------------------------------------------------
    # 1. Flagship: HubSpot project linked to Activate the Army; clarifier about assignee
    # -----------------------------------------------------------------
    {
        "id": 1,
        "desc": "Project draft linked to Activate the Army; clarifier OR assignee present",
        "utterance": (
            "One project is to build out HubSpot to support our LatAm GTM launch, "
            "connected to Activate the Army."
        ),
        "check": lambda text, drafts: (
            has_draft(drafts, "project")
            and payload_field(drafts, "project", "goal_id") == "goal-aaw"
            # assignee may be missing (agent asks) or present
        ),
    },

    # -----------------------------------------------------------------
    # 2. Same + explicit assignee + end-of-Q3 date → no clarifiers
    # -----------------------------------------------------------------
    {
        "id": 2,
        "desc": "Project: goal linked, due_date=2026-09-30, assignee present (self)",
        "utterance": (
            "One project is to build out HubSpot to support our LatAm GTM launch, "
            "connected to Activate the Army. Assign it to me, due end of Q3."
        ),
        "check": lambda text, drafts: (
            has_draft(drafts, "project")
            and payload_field(drafts, "project", "goal_id") == "goal-aaw"
            and payload_field(drafts, "project", "due_date") == "2026-09-30"
            and payload_field(drafts, "project", "owner_id") is not None
        ),
    },

    # -----------------------------------------------------------------
    # 3. Team goal with inferred level + December due date + success metric
    # -----------------------------------------------------------------
    {
        "id": 3,
        "desc": "Goal: level=team, due_date in December 2026, success_metrics captured",
        "utterance": "Add a goal for the team: cut onboarding time to 14 days by December.",
        "check": lambda text, drafts: (
            has_draft(drafts, "goal")
            and payload_field(drafts, "goal", "level") == "team"
            and (payload_field(drafts, "goal", "due_date") or "").startswith("2026-12")
        ),
    },

    # -----------------------------------------------------------------
    # 4. Goal with unstated level → must ask, no draft
    # -----------------------------------------------------------------
    {
        "id": 4,
        "desc": "No draft; asks which level (company/department/team/individual)",
        "utterance": "New goal: improve NRR.",
        "check": lambda text, drafts: (
            not has_draft(drafts, "goal")
            and text_has(text, "level", "company", "department", "team", "individual")
        ),
    },

    # -----------------------------------------------------------------
    # 5. Ambiguous goal link → asks with candidates, no silent wrong link
    # -----------------------------------------------------------------
    {
        "id": 5,
        "desc": "Asks which onboarding goal; no link_project_goal draft with a wrong id",
        "utterance": "Link the HubSpot project to the onboarding goal.",
        "check": lambda text, drafts: (
            # Must NOT silently emit a draft linking to one of the onboarding goals
            not (
                has_draft(drafts, "link_project_goal")
                and payload_field(drafts, "link_project_goal", "goal_id")
                in ("goal-obo1", "goal-obo2")
            )
            # Must surface some acknowledgment of the ambiguity / missing project
            and len(text) > 10
        ),
    },

    # -----------------------------------------------------------------
    # 6. Check-in with %, status, note
    # -----------------------------------------------------------------
    {
        "id": 6,
        "desc": "Check-in: goal=Activate the Army, progress=40, status=on_track",
        "utterance": (
            "Log a check-in on Activate the Army — we're at 40%, on track, "
            "LatAm hiring closed."
        ),
        "check": lambda text, drafts: (
            has_draft(drafts, "check_in")
            and payload_field(drafts, "check_in", "goal_id") == "goal-aaw"
            and payload_field(drafts, "check_in", "progress") == 40
            and payload_field(drafts, "check_in", "status") == "on_track"
        ),
    },

    # -----------------------------------------------------------------
    # 7. Commitment on Jordan, date resolved to next Friday (2026-08-14)
    # -----------------------------------------------------------------
    {
        "id": 7,
        "desc": "Commitment: direct_report=Jordan (dr-jordan), due_date=2026-08-14",
        "utterance": "Jordan committed to drafting the discovery doc by Friday.",
        "check": lambda text, drafts: (
            has_draft(drafts, "commitment")
            and payload_field(drafts, "commitment", "direct_report_id") == "dr-jordan"
            and payload_field(drafts, "commitment", "due_date") in ("2026-08-14", "2026-08-15")
        ),
    },

    # -----------------------------------------------------------------
    # 8. Time off — not in verb set → polite refusal, no draft
    # -----------------------------------------------------------------
    {
        "id": 8,
        "desc": "No draft; polite refusal mentioning time off or pointing elsewhere",
        "utterance": "Leah's taking PTO the last week of August.",
        "check": lambda text, drafts: (
            len(drafts) == 0
            and text_has(text, "can't", "cannot", "not yet", "time off", "pto", "profile", "page", "don't")
        ),
    },

    # -----------------------------------------------------------------
    # 9. No matching "culture" goal → agent must NOT silently link wrong goal.
    #    Valid behavior is either:
    #      a) project draft (no goal link) + text acknowledging no culture goal found
    #      b) no draft yet + text asking which goal / offering to create (per-spec: two
    #         drafts happen "on acceptance", not necessarily in the first turn)
    # -----------------------------------------------------------------
    {
        "id": 9,
        "desc": "No silent wrong goal link; mentions culture goal not found / offers to create",
        "utterance": "Add a project for the Q4 offsite, connected to the culture goal.",
        "check": lambda text, drafts: (
            # Must NOT silently link to an existing (wrong) goal
            not (
                has_draft(drafts, "project")
                and payload_field(drafts, "project", "goal_id") in (
                    "goal-aaw", "goal-obo1", "goal-obo2", "goal-nrr", "goal-uscs"
                )
            )
            # Must acknowledge the missing goal in text (either path)
            and text_has(text, "culture", "don't see", "no goal", "can't find",
                         "couldn't find", "create", "doesn't exist", "not found", "which")
        ),
    },

    # -----------------------------------------------------------------
    # 10. Multi-entity: project + commitment on Leah
    # -----------------------------------------------------------------
    {
        "id": 10,
        "desc": "Two drafts: project and commitment assigned to Leah",
        "utterance": (
            "Create a project to migrate billing and give Leah a commitment "
            "to own the vendor eval."
        ),
        "check": lambda text, drafts: (
            has_draft(drafts, "project")
            and has_draft(drafts, "commitment")
            and payload_field(drafts, "commitment", "direct_report_id") == "dr-leah"
        ),
    },

    # -----------------------------------------------------------------
    # 11. Page-context resolves "him" to Jordan
    # -----------------------------------------------------------------
    {
        "id": 11,
        "desc": "Commitment on Jordan resolved from page context thread",
        "thread": [
            {"role": "user", "content": "Page context: I am on Jordan's direct report detail page."},
            {"role": "assistant", "content": "Got it — I can see you're on Jordan's page."},
        ],
        "utterance": "add a commitment for him to shadow two AU calls.",
        "check": lambda text, drafts: (
            has_draft(drafts, "commitment")
            and payload_field(drafts, "commitment", "direct_report_id") == "dr-jordan"
        ),
    },

    # -----------------------------------------------------------------
    # 12. Delete request → polite refusal, no draft
    # -----------------------------------------------------------------
    {
        "id": 12,
        "desc": "No draft; polite refusal mentioning delete not supported",
        "utterance": "Delete the Value Engine goal.",
        "check": lambda text, drafts: (
            len(drafts) == 0
            and text_has(text, "can't", "cannot", "delete", "not yet", "goal", "page")
        ),
    },

    # -----------------------------------------------------------------
    # 13. Consult-mode question → polite refusal, no draft
    # -----------------------------------------------------------------
    {
        "id": 13,
        "desc": "No draft; polite refusal to analysis/consult question",
        "utterance": "How is Jordan doing?",
        "check": lambda text, drafts: (
            len(drafts) == 0
            and text_has(
                text,
                "can't advise", "not yet", "coming soon", "can't answer",
                "only log", "analysis", "log things", "can't help",
                "can't do that", "recommend",
            )
        ),
    },

    # -----------------------------------------------------------------
    # 14. "Mark at 50%" recognized as check-in, not edit
    # -----------------------------------------------------------------
    {
        "id": 14,
        "desc": "Check-in: progress=50 on Onboard New US CSMs goal",
        "utterance": "Mark Onboard New US CSMs at 50%",
        "check": lambda text, drafts: (
            has_draft(drafts, "check_in")
            and payload_field(drafts, "check_in", "progress") == 50
            and payload_field(drafts, "check_in", "goal_id") == "goal-uscs"
        ),
    },

    # -----------------------------------------------------------------
    # 15. Vague input → asks one question, no draft invented
    # -----------------------------------------------------------------
    {
        "id": 15,
        "desc": "No draft; agent asks a clarifying question",
        "utterance": "we had a good week.",
        "check": lambda text, drafts: (
            len(drafts) == 0
            and "?" in text
        ),
    },
]


# ---- runner ----

def run_eval(verbose: bool = True) -> int:
    passed = 0
    failed = 0
    failures: list[int] = []

    print(f"\nScribe agent eval — {len(CASES)} cases — today={TODAY}")
    print("(Each case makes 2-4 Anthropic API calls; expect ~60-90 s total)\n")

    for case in CASES:
        cid = case["id"]
        utterance = case["utterance"]
        thread = case.get("thread", [])
        desc = case["desc"]

        if verbose:
            print(f"[{cid:2d}] {utterance[:70]}{'...' if len(utterance) > 70 else ''}")

        try:
            text, drafts = run_assistant_turn(
                thread=thread,
                new_message=utterance,
                tool_executor=build_executor(),
                today_str=TODAY,
            )
            ok = case["check"](text, drafts)
        except Exception as exc:
            text = f"ERROR: {exc}"
            drafts = []
            ok = False

        if ok:
            passed += 1
            if verbose:
                print(f"     ✓ PASS — {desc}")
        else:
            failed += 1
            failures.append(cid)
            if verbose:
                print(f"     ✗ FAIL — {desc}")
                # Show first 300 chars of text and first draft for debugging
                print(f"       text:   {text[:300]!r}")
                if drafts:
                    print(f"       drafts: {json.dumps(drafts[:2], indent=2)[:400]}")
                else:
                    print(f"       drafts: []")

        if verbose:
            time.sleep(0.25)  # small breathing room between cases

    print(f"\n{'='*55}")
    print(f"Results: {passed}/{len(CASES)} passed")
    if failures:
        print(f"Failed cases: {failures}")

    if passed >= 13:
        print(f"✓ EXIT BAR MET (≥13/{len(CASES)})")
        return 0
    else:
        print(f"✗ EXIT BAR NOT MET (need ≥13, got {passed}/{len(CASES)})")
        return 1


if __name__ == "__main__":
    sys.exit(run_eval())
