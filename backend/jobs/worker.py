"""The worker service's entry point.

    python -m jobs.worker          # run forever: one tick every TICK_SECONDS
    python -m jobs.worker --once   # one tick, then exit (a cron service, or a check)

A tick collects every ended batch, then, inside the nightly window, submits
the night's work. All state lives in `ai_jobs`, so a restart, a deploy in the
middle of the night, or two ticks overlapping never prepares an occurrence
twice (the partial unique index on in-flight jobs refuses the second).

Deployed as a second Railway service from the same repo and root directory as
the API, with the same environment variables and this start command. It
serves no HTTP. See docs/ENGINEERING.md → Background worker.
"""
from __future__ import annotations

import argparse
import logging
import os
import time
from datetime import datetime, timezone

from config import settings
from observability import configure_logging, init_sentry

logger = logging.getLogger("jobs.worker")

TICK_SECONDS = int(os.environ.get("WORKER_TICK_SECONDS", "900"))
# 07:00 UTC is 3am in New York and midnight in San Francisco. The window is
# four hours wide so a worker that was down at 07:00 still catches up.
NIGHTLY_HOUR_UTC = int(os.environ.get("NIGHTLY_PREP_HOUR_UTC", "7"))
NIGHTLY_WINDOW_HOURS = 4


def in_nightly_window(now: datetime) -> bool:
    return (now.hour - NIGHTLY_HOUR_UTC) % 24 < NIGHTLY_WINDOW_HOURS


def tick(admin, now: datetime | None = None) -> dict:
    from jobs import nightly_prep

    now = now or datetime.now(timezone.utc)
    result = {"collected": nightly_prep.collect(admin, now), "submitted": 0}
    if in_nightly_window(now):
        result["submitted"] = nightly_prep.submit_due(admin, now)
    return result


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true", help="run one tick and exit")
    args = parser.parse_args(argv)

    configure_logging()
    init_sentry(settings.SENTRY_DSN, settings.ENVIRONMENT)
    if not settings.ANTHROPIC_API_KEY:
        logger.error("worker: ANTHROPIC_API_KEY is not set; nothing to do")
        return

    from utils import get_admin_client

    admin = get_admin_client()
    logger.info("worker_started", extra={"fields": {"tick_seconds": TICK_SECONDS, "nightly_hour_utc": NIGHTLY_HOUR_UTC}})
    while True:
        try:
            tick(admin)
        except Exception:
            # Logged with the traceback (and to Sentry); the next tick retries.
            logger.exception("worker tick failed")
        if args.once:
            return
        time.sleep(TICK_SECONDS)


if __name__ == "__main__":
    main()
