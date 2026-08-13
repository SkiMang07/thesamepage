"""
/api/assistant — The Scribe's endpoints (S3: thread persistence added).

POST /api/assistant/message
  Takes the new user utterance, loads the stored thread from assistant_messages,
  runs the Claude tool-use loop, saves user + assistant turns to the DB, returns
  {text, drafts}. Thread is now entirely server-managed; the client no longer
  needs to pass it.

GET /api/assistant/thread
  Returns the stored thread for the current manager so the drawer can hydrate
  on mount (survives refresh + devices).

Auth: same get_authenticated_client() pattern as every other route.
Rate: POST is 10/minute per IP. GET is unthrottled (read-only, cheap).
"""
import json
from datetime import date

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from assistant_engine import run_assistant_turn
from utils import get_authenticated_client, limiter

router = APIRouter()


class AssistantMessageIn(BaseModel):
    message: str
    # Human-readable label for the current page, e.g. "Jordan's direct report
    # page". Injected into the system prompt ephemerally (not stored in the
    # thread) so pronouns and implicit references resolve against the right page.
    page_context: str | None = None


def _build_tool_executor(supabase, user_id: str) -> dict:
    """Build the read-tool callables for run_assistant_turn, scoped to this user."""
    return {
        "list_goals": lambda _: (
            supabase.table("goals")
            .select("id,title,level,status")
            .eq("owner_id", user_id)
            .order("title")
            .execute()
            .data
        ),
        "list_projects": lambda _: (
            supabase.table("projects")
            .select("id,title,status")
            .eq("owner_id", user_id)
            .order("title")
            .execute()
            .data
        ),
        "list_direct_reports": lambda _: (
            supabase.table("direct_reports")
            .select("id,name,role_title")
            .eq("manager_id", user_id)
            .order("name")
            .execute()
            .data
        ),
        "list_org_units": lambda _: (
            supabase.table("org_units")
            .select("id,name,unit_type")
            .execute()
            .data
        ),
    }


def _load_thread(supabase, user_id: str) -> list[dict]:
    """Load the stored assistant thread for this manager, oldest-first."""
    rows = (
        supabase.table("assistant_messages")
        .select("role,content")
        .eq("manager_id", user_id)
        .order("created_at")
        .execute()
        .data
    )
    return [{"role": r["role"], "content": r["content"]} for r in rows]


def _save_turn(supabase, user_id: str, user_text: str, assistant_text: str, drafts: list) -> None:
    """Persist one user+assistant turn to assistant_messages."""
    supabase.table("assistant_messages").insert([
        {"manager_id": user_id, "role": "user", "content": user_text},
        {
            "manager_id": user_id,
            "role": "assistant",
            "content": assistant_text,
            "drafts": drafts if drafts else None,
        },
    ]).execute()


@router.get("/thread")
async def get_thread(auth=Depends(get_authenticated_client)):
    """Return the stored thread for the current manager (for drawer hydration)."""
    user_id, supabase = auth
    rows = (
        supabase.table("assistant_messages")
        .select("id,role,content,drafts,created_at")
        .eq("manager_id", user_id)
        .order("created_at")
        .execute()
        .data
    )
    return rows


@router.post("/message")
@limiter.limit("10/minute")
async def post_message(
    request: Request,
    body: AssistantMessageIn,
    auth=Depends(get_authenticated_client),
):
    user_id, supabase = auth
    today_str = date.today().isoformat()

    # Load stored thread from DB (client no longer manages the thread)
    thread = _load_thread(supabase, user_id)

    tool_executor = _build_tool_executor(supabase, user_id)

    text, drafts = run_assistant_turn(
        thread=thread,
        new_message=body.message,
        tool_executor=tool_executor,
        today_str=today_str,
        page_context=body.page_context or None,
    )

    # Persist this turn to the DB so future messages continue the thread
    _save_turn(supabase, user_id, body.message, text, drafts)

    return {"text": text, "drafts": drafts}
