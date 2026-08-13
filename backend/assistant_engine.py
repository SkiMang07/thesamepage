"""
The Scribe — conversational data entry agent loop.

run_assistant_turn() is the single entry point: takes the thread, the new
message, a dict of tool executors (callables keyed by tool name), and today's
date string; returns (agent_text, drafts) where drafts is a list of emit_draft
payloads collected during the loop.

The agent has five read tools (list_goals, list_projects, list_direct_reports,
list_org_units, emit_draft) and zero write tools. All writes happen when the
client calls the existing endpoint on confirm — the agent literally cannot write.

Architecture:
  route → _build_tool_executor() → run_assistant_turn() → call_anthropic_with_tools()
                                    ↑ loop until end_turn or MAX_LOOPS
"""
import json
import logging
from fastapi import HTTPException

from ai_core import call_anthropic_with_tools
from config import AI_DEFAULT_MODEL_HEAVY

logger = logging.getLogger("assistant_engine")

MAX_TOOL_LOOPS = 8

# ---------------------------------------------------------------------------
# Tool definitions (Anthropic tool-use schema)
# ---------------------------------------------------------------------------

TOOLS = [
    {
        "name": "list_goals",
        "description": (
            "Return all goals visible to this manager: id, title, level, status. "
            "Call before emitting a goal-related draft so you can match existing records."
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "list_projects",
        "description": (
            "Return all projects visible to this manager: id, title, status. "
            "Call before linking a project to a goal so you can resolve the project id."
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "list_direct_reports",
        "description": (
            "Return all direct reports for this manager: id, name, role_title. "
            "Call before assigning a commitment or project to a named person."
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "list_org_units",
        "description": (
            "Return all org units (teams and departments): id, name, unit_type. "
            "Call when setting org_unit_id on a department- or team-level goal."
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "emit_draft",
        "description": (
            "Stage a draft entity for the user to review. Call once per entity you "
            "want to create or log. This does NOT write anything — it only queues a "
            "draft that the user must confirm. Call emit_draft AFTER calling any "
            "necessary read tools so you can fill in the correct ids."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "entity_type": {
                    "type": "string",
                    "enum": [
                        "project",
                        "goal",
                        "link_project_goal",
                        "check_in",
                        "commitment",
                        "direct_report",
                    ],
                    "description": "Which kind of record to draft.",
                },
                "payload": {
                    "type": "object",
                    "description": (
                        "The draft fields. Omit optional fields rather than guessing. "
                        "See system prompt for the exact shape per entity_type."
                    ),
                },
                "display": {
                    "type": "object",
                    "description": (
                        "Human-readable labels for linked records shown in the draft "
                        "card, e.g. {goal_title: 'Activate the Army'}. "
                        "Include a label for every id you set in payload."
                    ),
                },
            },
            "required": ["entity_type", "payload"],
        },
    },
]

# ---------------------------------------------------------------------------
# System prompt template  ({TODAY} and {CURRENT_YEAR} substituted at call time)
# ---------------------------------------------------------------------------

SYSTEM_PROMPT_TEMPLATE = """\
You are the data-entry assistant for The Same Page — a management OS for first-time managers. You help managers record what is happening by talking through it naturally instead of filling out forms.

Today's date: {TODAY}

=== WHAT YOU CAN DO ===

You assist with exactly these six verbs. Nothing else in v1.

1. CREATE PROJECT
   Required: title
   Optional: goal_id (link to a goal), direct_report_id (assign to a report), owner_id (set to "self" to assign to the manager), due_date (YYYY-MM-DD), description
   status defaults to "active". Omit success_metrics — projects don't have that field.

2. CREATE GOAL
   Required: title, level
   level MUST be one of: company, department, team, individual
   — "for the team" → level = team
   — "for the company" → level = company
   — "for [person name]" or "individual goal" → level = individual
   — If level is COMPLETELY UNSTATED and not inferable, you MUST ASK before emitting a draft. Do not guess.
   Optional: description, success_metrics (free text), due_date, direct_report_id (for individual goals only), org_unit_id
   IMPORTANT: org_unit_id is optional. NEVER ask about it unless the user mentions a specific team or department name. If the user says "for the team" without naming which team, set level=team and leave org_unit_id unset — do NOT ask which team.

3. LINK PROJECT ↔ GOAL
   Connect an existing or in-draft project to an existing or in-draft goal.
   Required: project_id, goal_id

4. LOG A CHECK-IN (on a goal OR project)
   Required: either goal_id or project_id (exactly one), status
   status must be one of: active, on_track, at_risk, completed, cancelled
   Optional: progress (0–100 integer percent), note (one-line observation)
   CRITICAL: "mark X at 50%", "we're at 40%, on track", "update X to 60%", "log progress on Y" — these are ALL check-ins. NEVER treat them as edits to the record. Even if phrased as "mark" or "update", recognize them as check-ins.

5. ADD A COMMITMENT
   Required: description (what is owed), direct_report_id (who owes it)
   committed_by: use "direct_report" when a report made the commitment; "manager" when the manager did.
   Optional: due_date, is_team_commitment (boolean, default false)

6. ADD A DIRECT REPORT
   Required: name
   Optional: role_title

=== WHAT YOU CANNOT DO ===

Decline gracefully and point to the right place:
- EDITS / field changes on existing records → "I can't edit records yet — you can update that directly on the Goals / Projects page."
- DELETES → "I can't delete records yet — you can do that on the [Goals / Projects / etc.] page."
- ANALYSIS QUESTIONS ("How is Jordan doing?", "What are our risks?", "Summarize...") → "I can only log things right now — analysis and recommendations are coming soon."
- TIME OFF → "I can't log time off yet — you can add it on the direct report's profile page."
- MEETING NOTES, PERFORMANCE REVIEWS, and anything else not in the six verbs → "I can't do that yet."
- CONSULT MODE ("What should I do about...", "Is it risky to...") → "I can only log things right now — judgment and recommendations are coming soon."

=== HOW TO PROCESS EACH REQUEST ===

Step 1 — Identify which verbs are being requested. There may be more than one.

Step 2 — Call read tools to look up candidate records. Always call the relevant tool BEFORE emitting a draft, so you know which ids to use.

Step 3 — Apply entity linking rules:
  HIGH CONFIDENCE (one clear match by name) → link it; put the record's real name in the display field.
  AMBIGUOUS (multiple plausible matches) → DO NOT emit a draft. ASK the user which one, listing the candidate names.
  NO MATCH → say you don't see that record; offer to create it (which would be a second draft in this turn).
  A silently wrong link is the worst outcome. When in doubt, ask.

Step 4 — Call emit_draft once per entity. Use only fields you know. Leave optional fields absent rather than fabricating a value.

Step 5 — Reply in plain, concise language:
  • Confirm what was drafted.
  • Note any unresolved links or ambiguity.
  • Ask AT MOST ONE OR TWO clarifying questions — only for genuine forks (level, assignee when unstated).
  • For missing optional fields say "No due date yet — add one anytime." Never interrogate.

=== DATE RESOLUTION ===

Always resolve relative dates using today's date ({TODAY}):
  "by Friday" or "this Friday" → the next Friday after today
  "next week" → 7 days from today
  "end of Q1" → March 31, {CURRENT_YEAR}
  "end of Q2" → June 30, {CURRENT_YEAR}
  "end of Q3" → September 30, {CURRENT_YEAR}
  "end of Q4" → December 31, {CURRENT_YEAR}
  "by December" / "in December" / "by end of year" → December 31, {CURRENT_YEAR}
  "next month" → last day of the next calendar month
State the resolved YYYY-MM-DD date in the payload. Never leave a date as relative text.

=== PAGE CONTEXT ===

If the conversation thread contains a message beginning with "Page context:", use it to resolve pronouns ("him", "her", "them") and implicit references ("give him a commitment"). Always state the resolved name explicitly in the draft's display field — never apply it invisibly.

=== DRAFT PAYLOAD SHAPES ===

Use these exact field names. Omit optional fields when not stated.

PROJECT:
  entity_type: "project"
  payload: { title, goal_id?, direct_report_id?, owner_id? ("self" for the manager), due_date?, description?, status: "active" }
  display: { goal_title?, assignee_name? }

GOAL:
  entity_type: "goal"
  payload: { title, level (required), due_date?, success_metrics?, description?, direct_report_id?, org_unit_id? }

LINK_PROJECT_GOAL:
  entity_type: "link_project_goal"
  payload: { project_id, goal_id }
  display: { project_title, goal_title }

CHECK_IN:
  entity_type: "check_in"
  payload: { goal_id? OR project_id?, status (required), progress? (int 0–100), note? }
  display: { parent_title }

COMMITMENT:
  entity_type: "commitment"
  payload: { description (required), direct_report_id (required), committed_by ("direct_report"|"manager"), due_date?, is_team_commitment?: false }
  display: { assignee_name }

DIRECT_REPORT:
  entity_type: "direct_report"
  payload: { name (required), role_title? }
"""


# ---------------------------------------------------------------------------
# Agent loop
# ---------------------------------------------------------------------------

def run_assistant_turn(
    thread: list[dict],
    new_message: str,
    tool_executor: dict,
    today_str: str,
    page_context: str | None = None,
) -> tuple[str, list]:
    """Run the Claude tool-use loop for one user turn.

    thread        — prior messages in Anthropic format [{role, content}, ...]
    new_message   — the manager's current utterance
    tool_executor — dict of tool_name → callable(input_dict) → serialisable result.
                    Must include at least list_goals, list_projects,
                    list_direct_reports, list_org_units, emit_draft.
    today_str     — YYYY-MM-DD date string injected into the system prompt.
    page_context  — optional human-readable label for the page the drawer is on,
                    e.g. "Jordan's direct report page". Injected into the system
                    prompt ephemerally (not stored in the thread) so pronouns and
                    implicit references resolve correctly.

    Returns (text, drafts):
      text   — the agent's final reply text
      drafts — list of emit_draft payloads collected during this turn
    """
    drafts: list = []
    current_year = today_str[:4]
    system = (
        SYSTEM_PROMPT_TEMPLATE
        .replace("{TODAY}", today_str)
        .replace("{CURRENT_YEAR}", current_year)
    )
    if page_context:
        system += (
            f"\n\n=== CURRENT PAGE CONTEXT ===\n"
            f"The manager is currently on: {page_context}\n"
            f"Use this to resolve pronouns (\"him\", \"her\", \"them\") and implicit "
            f"references. Always state the resolved name explicitly in the draft's "
            f"display field — never apply it invisibly.\n"
        )

    # Wrap emit_draft to capture payloads without the caller needing to track them
    def _capturing_emit_draft(input_data: dict) -> dict:
        drafts.append(input_data)
        return {"ok": True, "draft_index": len(drafts) - 1}

    executor = {**tool_executor, "emit_draft": _capturing_emit_draft}

    # Build messages: thread history + new user turn
    messages: list[dict] = list(thread) + [{"role": "user", "content": new_message}]

    for iteration in range(MAX_TOOL_LOOPS):
        response = call_anthropic_with_tools(
            system=system,
            messages=messages,
            tools=TOOLS,
            model=AI_DEFAULT_MODEL_HEAVY,
            max_tokens=2000,
        )

        stop_reason = response.get("stop_reason", "end_turn")
        content = response.get("content", [])

        if stop_reason != "tool_use":
            # Final turn — extract all text blocks and return
            text_parts = [
                block["text"] for block in content if block.get("type") == "text"
            ]
            return " ".join(text_parts).strip(), drafts

        # There are tool_use blocks to execute
        # First, collect any text from this intermediate turn (informational, not returned)
        tool_use_blocks = [b for b in content if b.get("type") == "tool_use"]

        # Append assistant message with full content (required by Anthropic API)
        messages.append({"role": "assistant", "content": content})

        # Execute each tool and build the tool_result user turn
        tool_results = []
        for block in tool_use_blocks:
            tool_name = block.get("name", "")
            tool_input = block.get("input", {})
            tool_id = block.get("id", "")

            fn = executor.get(tool_name)
            if fn is not None:
                try:
                    result = fn(tool_input)
                except Exception as exc:
                    logger.warning("Tool %s raised: %s", tool_name, exc)
                    result = {"error": str(exc)}
            else:
                result = {"error": f"Unknown tool: {tool_name}"}

            tool_results.append({
                "type": "tool_result",
                "tool_use_id": tool_id,
                "content": json.dumps(result, default=str),
            })

        messages.append({"role": "user", "content": tool_results})

    # Max iterations reached — fail gracefully
    logger.warning("Assistant loop hit MAX_TOOL_LOOPS (%d) without end_turn", MAX_TOOL_LOOPS)
    return (
        "I had trouble processing that request. Please try rephrasing or use the form directly.",
        drafts,
    )
