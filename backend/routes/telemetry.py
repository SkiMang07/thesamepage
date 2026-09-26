"""Browser-computed AI-draft telemetry (AI_OPPORTUNITIES E7).

The browser holds stateless AI drafts (wrap-ups, development drafts, Scribe
cards, Librarian proposals) and compares them to what the manager saved. It
posts only the result here: fixed enums and counts. extra="forbid" refuses any
other field, so a caller cannot smuggle text into the event. The route sends
the server-side PostHog event so ad blockers can't drop it.
"""
from typing import Literal, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field

import analytics
from utils import get_authenticated_client

router = APIRouter()


class AiDraftResolvedIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    surface: Literal[analytics.AI_DRAFT_CLIENT_SURFACES]  # type: ignore[valid-type]
    outcome: Literal[analytics.AI_DRAFT_OUTCOMES]  # type: ignore[valid-type]
    edit_bucket: Literal[analytics.EDIT_BUCKETS]  # type: ignore[valid-type]
    seconds_to_confirm: int = Field(ge=0)
    items_drafted: Optional[int] = Field(default=None, ge=0)
    items_kept: Optional[int] = Field(default=None, ge=0)
    items_added: Optional[int] = Field(default=None, ge=0)


@router.post("/ai-draft")
def ai_draft_resolved(body: AiDraftResolvedIn, auth=Depends(get_authenticated_client)):
    user_id, _ = auth
    analytics.ai_draft_resolved(user_id, **body.model_dump())
    return {"ok": True}
