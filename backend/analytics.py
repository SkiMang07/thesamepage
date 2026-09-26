"""
Product analytics, server side (PRELAUNCH_BACKLOG §7 D).

The browser sends page views to PostHog (frontend/lib/analytics.ts). Custom
events (prep_sheet_saved, ai_draft_resolved) are sent from here instead: the
backend already knows the moment, and a server-side event can't be dropped by
an ad blocker.

capture() hands the POST to a small background pool and returns at once, so
a slow or down PostHog never delays a response. A failure is logged at
warning and otherwise ignored; analytics is never load-bearing.

What an event may carry: the user id (as distinct_id), and booleans, counts
or enum-like strings. Never a name, email, note text, prompt or transcript.
IPs: the request comes from Railway, not the manager, and $geoip_disable
stops PostHog resolving it; the project's "Discard client IP data" setting
drops it on arrival.

Does nothing until POSTHOG_PROJECT_KEY is set on Railway.
"""
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import httpx

from config import settings

logger = logging.getLogger(__name__)

POSTHOG_CAPTURE_URL = "https://us.i.posthog.com/i/v0/e/"

_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="analytics")


def _send(payload: dict) -> None:
    try:
        response = httpx.post(POSTHOG_CAPTURE_URL, json=payload, timeout=5.0)
        response.raise_for_status()
    except Exception as exc:
        logger.warning("analytics event not sent: %s", type(exc).__name__)


def capture(user_id: str, event: str, properties: dict | None = None) -> None:
    key = settings.POSTHOG_PROJECT_KEY
    if not key or not user_id:
        return
    payload = {
        "api_key": key,
        "event": event,
        "distinct_id": user_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "properties": {
            **(properties or {}),
            "environment": settings.ENVIRONMENT,
            "$lib": "tsp-backend",
            "$geoip_disable": True,
        },
    }
    _pool.submit(_send, payload)


# ── AI-draft quality (AI_OPPORTUNITIES E7) ────────────────────────────────
# One event, ai_draft_resolved, for every draft-then-review surface: was the
# draft kept, how much did the manager change it, how long did review take.
# The text itself never leaves the app. Stateless drafts are compared in the
# browser (lib/aiDraftTelemetry.ts), which posts only these enums and counts
# to /api/telemetry/ai-draft; persisted proposals (assessment items, role
# suggestions, the Librarian's reading of an upload) are compared here, on
# the server, where they already live.

AI_DRAFT_CLIENT_SURFACES = (
    "one_on_one_wrapup",
    "team_wrapup",
    "beyond_wrapup",
    "development_plan",
    "development_note",
    "scribe_proposal",
)
AI_DRAFT_SERVER_SURFACES = ("assessment_item", "role_suggestion", "document_extraction")
AI_DRAFT_OUTCOMES = ("accepted", "discarded", "abandoned")
EDIT_BUCKETS = ("none", "light", "moderate", "heavy")
MAX_SECONDS_TO_CONFIRM = 86_400
_MAX_WORDS = 4_000


def _words(text: str | None) -> list[str]:
    return (text or "").lower().split()[:_MAX_WORDS]


def edit_bucket(draft: str | None, final: str | None) -> str:
    """Word-level edit distance as a share of the draft's length, bucketed.
    Must match editBucket() in frontend/lib/aiDraftTelemetry.ts."""
    a, b = _words(draft), _words(final)
    if a == b:
        return "none"
    prev = list(range(len(b) + 1))
    for i, wa in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, wb in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (wa != wb))
        prev = cur
    ratio = prev[-1] / max(len(a), 1)
    if ratio < 0.10:
        return "light"
    if ratio < 0.40:
        return "moderate"
    return "heavy"


def seconds_since(iso: str | None) -> int | None:
    """Whole seconds from an ISO timestamp to now, capped; None if unreadable."""
    if not iso:
        return None
    try:
        then = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except ValueError:
        return None
    if then.tzinfo is None:
        then = then.replace(tzinfo=timezone.utc)
    secs = int((datetime.now(timezone.utc) - then).total_seconds())
    return max(0, min(secs, MAX_SECONDS_TO_CONFIRM))


def ai_draft_resolved(
    user_id: str,
    *,
    surface: str,
    outcome: str,
    edit_bucket: str = "none",
    seconds_to_confirm: int | None = None,
    items_drafted: int | None = None,
    items_kept: int | None = None,
    items_added: int | None = None,
) -> None:
    """Send ai_draft_resolved. Anything outside the fixed vocabularies is
    dropped rather than sent: this event must never carry free text."""
    if surface not in AI_DRAFT_CLIENT_SURFACES + AI_DRAFT_SERVER_SURFACES:
        return
    if outcome not in AI_DRAFT_OUTCOMES or edit_bucket not in EDIT_BUCKETS:
        return
    if outcome != "accepted":
        edit_bucket = "none"
    props: dict = {
        "surface": surface,
        "outcome": outcome,
        "edited_before_save": edit_bucket != "none",
        "edit_bucket": edit_bucket,
    }
    if isinstance(seconds_to_confirm, int) and not isinstance(seconds_to_confirm, bool):
        props["seconds_to_confirm"] = max(0, min(seconds_to_confirm, MAX_SECONDS_TO_CONFIRM))
    for name, value in (("items_drafted", items_drafted), ("items_kept", items_kept), ("items_added", items_added)):
        if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
            props[name] = min(value, 1_000)
    capture(user_id, "ai_draft_resolved", props)
