"""The first-1:1 wrap-up reminder (Andrew, 2026-10-05).

Onboarded needs a logged 1:1, and nothing outside the app brought a manager
back after their first real meeting to log it (VP of Customer Success review,
2026-10-05, finding #1). This sends one email, once per manager, on the
evening of their first 1:1's date if it has not been logged.

Who is due, all of it:
  - a manager (not an IC) with no logged 1:1 at all (no one_on_ones row with a
    summary), so this is only ever about the first one;
  - who has an unlogged 1:1 dated in the last few days;
  - whose evening has come: 18:00 on the meeting day in the series timezone,
    or in New York when the series says UTC (the column's default, which
    means nobody set it);
  - and not more than GIVE_UP_AFTER past that evening, so a worker that was
    down for a week does not send a stale reminder;
  - who has not been reminded before (users.wrapup_reminder_sent_at).

Sending is HubSpot's job (hubspot.py): this writes the meeting day onto the
manager's HubSpot contact and a HubSpot workflow sends the email. The claim
(stamping wrapup_reminder_sent_at) comes first, so two ticks never both write;
if HubSpot refuses, the claim is released and the next tick retries.

The worker runs with the service-role client. Every query here carries an
explicit manager predicate. The users column is read softly: until the
migration runs, this does nothing rather than failing the tick.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import analytics
import hubspot
from utils import meeting_day_of

logger = logging.getLogger("jobs.wrapup_reminder")

EVENING_HOUR = 18
DEFAULT_TIMEZONE = "America/New_York"
GIVE_UP_AFTER = timedelta(hours=48)
# scheduled_at is a date at noon UTC. Look back far enough to cover
# GIVE_UP_AFTER, and a day ahead for timezones east of UTC, whose evening
# can come before noon UTC.
LOOKBACK_DAYS = 3
LOOKAHEAD_DAYS = 1
MAX_PER_RUN = 200
MANAGER_ROLES = {"manager", "director", "vp"}


def zone_for(name: str | None) -> ZoneInfo:
    if not name or name.upper() == "UTC":
        return ZoneInfo(DEFAULT_TIMEZONE)
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo(DEFAULT_TIMEZONE)


def evening_of(day: date, zone: ZoneInfo) -> datetime:
    return datetime.combine(day, time(EVENING_HOUR), tzinfo=zone)


def is_due(day: date, zone: ZoneInfo, now: datetime) -> bool:
    start = evening_of(day, zone)
    return start <= now < start + GIVE_UP_AFTER


def find_due(admin, now: datetime) -> list[dict]:
    """Managers to remind now: [{user_id, email, first_name, meeting_day, tz_known}]."""
    since = (now - timedelta(days=LOOKBACK_DAYS)).date().isoformat()
    until = (now + timedelta(days=LOOKAHEAD_DAYS + 1)).date().isoformat()
    meetings = (
        admin.table("one_on_ones")
        .select("id,manager_id,series_id,scheduled_at,created_at")
        .is_("summary", "null")
        .not_.is_("scheduled_at", "null")
        .gte("scheduled_at", since)
        .lt("scheduled_at", until)
        .execute()
        .data
        or []
    )
    if not meetings:
        return []

    manager_ids = sorted({m["manager_id"] for m in meetings})
    series_ids = sorted({m["series_id"] for m in meetings if m.get("series_id")})
    zones: dict = {}
    if series_ids:
        for s in (
            admin.table("one_on_one_series")
            .select("id,timezone")
            .in_("manager_id", manager_ids)
            .in_("id", series_ids)
            .execute()
            .data
            or []
        ):
            zones[s["id"]] = s.get("timezone")

    # The earliest due meeting per manager.
    due: dict = {}
    for m in meetings:
        day = meeting_day_of(m)
        if not day:
            continue
        tz_name = zones.get(m.get("series_id"))
        if not is_due(day, zone_for(tz_name), now):
            continue
        current = due.get(m["manager_id"])
        if current is None or day < current["meeting_day"]:
            due[m["manager_id"]] = {
                "meeting_day": day,
                "tz_known": bool(tz_name) and tz_name.upper() != "UTC",
            }
    if not due:
        return []

    ids = sorted(due)
    logged = {
        r["manager_id"]
        for r in (
            admin.table("one_on_ones")
            .select("manager_id")
            .in_("manager_id", ids)
            .not_.is_("summary", "null")
            .execute()
            .data
            or []
        )
    }
    candidates = [i for i in ids if i not in logged]
    if not candidates:
        return []
    users = (
        admin.table("users")
        .select("id,email,full_name,role,wrapup_reminder_sent_at")
        .in_("id", candidates)
        .is_("wrapup_reminder_sent_at", "null")
        .execute()
        .data
        or []
    )
    out = []
    for u in users:
        if u.get("role") not in MANAGER_ROLES or not u.get("email"):
            continue
        out.append({
            "user_id": u["id"],
            "email": u["email"],
            "first_name": (u.get("full_name") or "").strip().split(" ")[0],
            **due[u["id"]],
        })
    return sorted(out, key=lambda r: (r["meeting_day"], r["user_id"]))[:MAX_PER_RUN]


def run(admin, now: datetime | None = None) -> int:
    """Send what is due. Returns how many reminders were handed to HubSpot."""
    if not hubspot.enabled():
        return 0
    now = now or datetime.now(timezone.utc)
    try:
        candidates = find_due(admin, now)
    except Exception:
        # Most likely the migration has not run yet (no wrapup_reminder_sent_at).
        logger.warning("wrapup reminder: selection failed; skipping this tick", exc_info=True)
        return 0

    sent = 0
    for c in candidates:
        claimed = (
            admin.table("users")
            .update({"wrapup_reminder_sent_at": now.isoformat()})
            .eq("id", c["user_id"])
            .is_("wrapup_reminder_sent_at", "null")
            .execute()
            .data
        )
        if not claimed:
            continue
        properties = {hubspot.REMINDER_PROPERTY: c["meeting_day"].isoformat()}
        if c["first_name"]:
            properties["firstname"] = c["first_name"]
        try:
            hubspot.set_contact_properties(c["email"], properties)
        except hubspot.HubSpotError as exc:
            logger.warning("wrapup reminder not handed to HubSpot: %s", exc)
            admin.table("users").update({"wrapup_reminder_sent_at": None}).eq("id", c["user_id"]).execute()
            continue
        sent += 1
        analytics.capture(c["user_id"], "wrapup_reminder_sent", {"tz_known": c["tz_known"]})
    if sent:
        logger.info("wrapup_reminders_sent", extra={"fields": {"count": sent}})
    return sent


def main() -> None:
    """One pass, then exit: `python -m jobs.wrapup_reminder`.

    For a Railway cron service (every 30 minutes is enough) while the full
    worker stays parked: it runs this reminder and nothing else, so it never
    starts overnight prep or spends on AI. Once the worker runs, its tick
    calls run() too; running both is safe, the claim on users stops a double
    send.
    """
    from config import settings
    from observability import configure_logging, init_sentry
    from utils import get_admin_client

    configure_logging()
    init_sentry(settings.SENTRY_DSN, settings.ENVIRONMENT)
    if not hubspot.enabled():
        logger.error("wrapup reminder: HUBSPOT_TOKEN is not set; nothing to do")
        return
    sent = run(get_admin_client())
    logger.info("wrapup_reminder_pass", extra={"fields": {"sent": sent}})


if __name__ == "__main__":
    main()
