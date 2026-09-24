"""
Product analytics, server side (PRELAUNCH_BACKLOG §7 D).

The browser sends page views to PostHog (frontend/lib/analytics.ts). The one
custom event, prep_sheet_saved, is sent from here instead: the prep route
already knows whether this is the manager's first sheet, and a server-side
event can't be dropped by an ad blocker.

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
