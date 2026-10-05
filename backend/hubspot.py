"""
HubSpot contact writes, for the one product email HubSpot sends.

Andrew, 2026-10-05: the first-1:1 wrap-up reminder goes out through his
HubSpot account rather than a new email provider. The app does not send
anything itself. It writes one property onto the manager's HubSpot contact
(`wrapup_reminder_due`, the meeting day) and a HubSpot workflow, triggered when
that property becomes known, sends the email. Timing and "already logged?"
are decided here, in jobs/wrapup_reminder.py; HubSpot only sends.

What crosses to HubSpot: the manager's email, first name, and the meeting
day. Never a direct report's name, a note, or anything else from the record:
the email does not name the report, so HubSpot never needs to know who it was.

Does nothing until HUBSPOT_TOKEN (a private-app token with contact write
access) is set on Railway.
"""
import logging

import httpx

from config import settings

logger = logging.getLogger(__name__)

UPSERT_URL = "https://api.hubapi.com/crm/v3/objects/contacts/batch/upsert"
REMINDER_PROPERTY = "wrapup_reminder_due"


class HubSpotError(Exception):
    """A write HubSpot refused or never answered. The message carries the
    status code only, never the request body (it holds an email address)."""


def enabled() -> bool:
    return bool(settings.HUBSPOT_TOKEN)


def set_contact_properties(email: str, properties: dict, timeout: float = 10.0) -> None:
    """Create or update the contact with this email and set `properties`.

    Raises HubSpotError on any failure so the caller can release its claim and
    retry on a later tick.
    """
    if not enabled():
        raise HubSpotError("HUBSPOT_TOKEN is not set")
    payload = {"inputs": [{"idProperty": "email", "id": email, "properties": properties}]}
    try:
        response = httpx.post(
            UPSERT_URL,
            json=payload,
            headers={"Authorization": f"Bearer {settings.HUBSPOT_TOKEN}"},
            timeout=timeout,
        )
    except httpx.HTTPError as exc:
        raise HubSpotError(f"hubspot unreachable: {type(exc).__name__}") from None
    if response.status_code >= 400:
        raise HubSpotError(f"hubspot upsert refused: {response.status_code}")
