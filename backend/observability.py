"""
Logging, request context and error monitoring (PRELAUNCH_BACKLOG §7 D).

Three things, set up once from main.py:

1. configure_logging(): one JSON line per log record on stdout, which Railway
   parses into searchable fields (level, message, route, user_id). Every
   record carries the route and user of the request it was logged from,
   without the call site having to pass them.
2. RequestContextMiddleware: records "METHOD /path" for each request in a
   contextvar. get_authenticated_client() in utils.py adds the user id to the
   same context once the token is verified.
3. init_sentry(): sends unhandled errors, and anything logged at ERROR, to
   Sentry. Does nothing until SENTRY_DSN is set, so it is safe to deploy
   before the account exists.

Why a mutable dict in the contextvar rather than two plain contextvars:
route handlers and sync dependencies run on the thread pool, each in a COPY
of the request's context. A contextvar set inside get_authenticated_client
would vanish when that dependency's thread returns. Mutating a dict that the
middleware put in the context is visible to every copy.

Never log a prompt, a transcript, note text or audio. Ids, counts, model
names and status codes only. Dictation in particular promises the manager
that nothing they say is kept (see routes/transcribe.py).
"""
import json
import logging
import sys
from contextvars import ContextVar
from datetime import datetime, timezone

_request_ctx: ContextVar[dict | None] = ContextVar("request_ctx", default=None)


def set_request_user(user_id: str) -> None:
    ctx = _request_ctx.get()
    if ctx is not None:
        ctx["user_id"] = user_id


def current_request() -> dict:
    return _request_ctx.get() or {}


class RequestContextMiddleware:
    """Pure ASGI (not BaseHTTPMiddleware) so it adds no task hop per request."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        token = _request_ctx.set({"route": f"{scope['method']} {scope['path']}", "user_id": None})
        try:
            await self.app(scope, receive, send)
        finally:
            _request_ctx.reset(token)


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        ctx = current_request()
        line = {
            "time": datetime.fromtimestamp(record.created, timezone.utc).isoformat(timespec="milliseconds"),
            "level": record.levelname.lower(),
            "logger": record.name,
            "message": record.getMessage(),
        }
        if ctx.get("route"):
            line["route"] = ctx["route"]
        if ctx.get("user_id"):
            line["user_id"] = ctx["user_id"]
        fields = getattr(record, "fields", None)
        if isinstance(fields, dict):
            line.update(fields)
        if record.exc_info:
            line["exc"] = self.formatException(record.exc_info)
        return json.dumps(line, default=str)


def configure_logging(level: int = logging.INFO) -> None:
    root = logging.getLogger()
    if any(getattr(h, "_tsp", False) for h in root.handlers):
        return  # already configured (tests import main more than once)
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(_JsonFormatter())
    handler._tsp = True  # type: ignore[attr-defined]
    root.addHandler(handler)
    root.setLevel(level)
    # httpx logs every request URL at INFO, which would put Supabase query
    # strings (ids, filters) in the log for every call.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)


def _attach_request_context(event, _hint):
    ctx = current_request()
    if ctx.get("user_id"):
        event["user"] = {"id": ctx["user_id"]}
    if ctx.get("route"):
        event.setdefault("tags", {})["route"] = ctx["route"]
    return event


def init_sentry(dsn: str, environment: str) -> bool:
    """Returns True when Sentry was switched on."""
    if not dsn:
        return False
    import sentry_sdk

    sentry_sdk.init(
        dsn=dsn,
        environment=environment,
        # Errors only. Performance tracing is a separate decision (and a
        # separate bill); turn it on here when it's wanted.
        traces_sample_rate=0.0,
        # No request bodies, cookies or IPs. The user id is attached by
        # _attach_request_context, and nothing else about the person.
        send_default_pii=False,
        max_request_body_size="never",
        before_send=_attach_request_context,
    )
    return True
