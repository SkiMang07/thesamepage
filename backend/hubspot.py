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
from urllib.parse import quote

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


# ── Account deletion (PRELAUNCH_BACKLOG §7 E) ─────────────────────────────
# When a manager deletes their account, their HubSpot contact goes too: a
# GDPR delete, which HubSpot makes permanent. Looked up first, because a GDPR
# delete by an email HubSpot doesn't have blocklists that email for good. A
# deleted contact can still come back through the API (a later sign-up's
# wrap-up reminder), just as a new contact with no history.
#
# The portal is shared with Prism Tree and By 2 Pedals, so this also removes
# the person from those lists if the same email is there. That is what the
# person asked for.
CONTACT_URL = "https://api.hubapi.com/crm/v3/objects/contacts/{id}"
GDPR_DELETE_URL = "https://api.hubapi.com/crm/v3/objects/contacts/gdpr-delete"


def delete_contact(email: str, timeout: float = 10.0) -> bool:
    """Permanently delete the contact with this email, if HubSpot has one.

    Returns True when a contact was deleted, False when there was none.
    Raises HubSpotError on any failure so the caller can stop before deleting
    anything else.
    """
    if not enabled():
        raise HubSpotError("HUBSPOT_TOKEN is not set")
    if not email:
        return False
    headers = {"Authorization": f"Bearer {settings.HUBSPOT_TOKEN}"}
    try:
        found = httpx.get(
            CONTACT_URL.format(id=quote(email, safe="")),
            params={"idProperty": "email", "properties": "email"},
            headers=headers,
            timeout=timeout,
        )
    except httpx.HTTPError as exc:
        raise HubSpotError(f"hubspot unreachable: {type(exc).__name__}") from None
    if found.status_code == 404:
        return False
    if found.status_code >= 400:
        raise HubSpotError(f"hubspot lookup refused: {found.status_code}")
    contact_id = (found.json() or {}).get("id")
    if not contact_id:
        return False
    try:
        response = httpx.post(
            GDPR_DELETE_URL, json={"objectId": str(contact_id)}, headers=headers, timeout=timeout,
        )
    except httpx.HTTPError as exc:
        raise HubSpotError(f"hubspot unreachable: {type(exc).__name__}") from None
    if response.status_code >= 400:
        raise HubSpotError(f"hubspot gdpr delete refused: {response.status_code}")
    return True
