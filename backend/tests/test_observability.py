"""Logging carries route + user id; AI calls log model and tokens; Sentry
stays off without a DSN (PRELAUNCH_BACKLOG §7 D)."""
import json
import logging
import os

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2ln")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.c2ln")
os.environ.setdefault("ANTHROPIC_API_KEY", "test")

from fastapi import Depends, FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import ai_core  # noqa: E402
import observability  # noqa: E402


class _Capture(logging.Handler):
    def __init__(self):
        super().__init__()
        self.setFormatter(observability._JsonFormatter())
        self.lines = []

    def emit(self, record):
        self.lines.append(json.loads(self.format(record)))


def test_log_lines_carry_route_and_user_across_the_thread_pool():
    log = logging.getLogger("tsp.test")
    cap = _Capture()
    log.addHandler(cap)
    log.setLevel(logging.INFO)

    # A sync dependency and a sync handler, each on its own pool thread, as
    # get_authenticated_client and every route are in the real app.
    def fake_auth():
        observability.set_request_user("user-123")
        return "user-123"

    app = FastAPI()
    app.add_middleware(observability.RequestContextMiddleware)

    @app.post("/api/things/{thing_id}")
    def handler(thing_id: str, user=Depends(fake_auth)):
        log.info("did a thing")
        return {"ok": True}

    try:
        assert TestClient(app).post("/api/things/42").status_code == 200
    finally:
        log.removeHandler(cap)

    (line,) = cap.lines
    assert line["message"] == "did a thing"
    assert line["route"] == "POST /api/things/42"
    assert line["user_id"] == "user-123"


def test_context_does_not_leak_outside_a_request():
    assert observability.current_request() == {}
    observability.set_request_user("nobody")  # no request: a no-op, not an error
    assert observability.current_request() == {}


def test_ai_usage_line_has_model_and_tokens(caplog):
    caplog.set_level(logging.INFO, logger="ai_core")
    ai_core._log_usage(
        "anthropic", "text", "claude-haiku-4-5-20251001",
        {"model": "claude-haiku-4-5-20251001", "usage": {"input_tokens": 812, "output_tokens": 64}, "stop_reason": "end_turn"},
        started=0.0,
    )
    (rec,) = [r for r in caplog.records if r.getMessage() == "ai_call"]
    assert rec.fields["model"] == "claude-haiku-4-5-20251001"
    assert rec.fields["input_tokens"] == 812
    assert rec.fields["output_tokens"] == 64


def test_sentry_is_off_without_a_dsn():
    assert observability.init_sentry("", "production") is False
