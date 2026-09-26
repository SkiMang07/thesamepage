import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from config import settings
from observability import RequestContextMiddleware, configure_logging, init_sentry
from routes import assessment_reviews, assessments, assistant, away, beyond, beyond_continuity, capacity, commitments, dashboard, development, direct_reports, documents, entitlement, expectations_ai, goals, invites, one_on_ones, org_units, projects, role_expectations, role_families, roles_import, setup_status, settings as settings_routes, team, transcribe
from utils import get_authenticated_client, get_entitlement, limiter

configure_logging()
logger = logging.getLogger(__name__)

# Before the app is built, so Sentry's FastAPI integration can hook it. A
# no-op until SENTRY_DSN is set on Railway.
if init_sentry(settings.SENTRY_DSN, settings.ENVIRONMENT):
    logger.info("sentry enabled")

app = FastAPI(title="The Same Page API")

# ---------------------------------------------------------------------------
# Unhandled errors come back as a readable 500, not a CORS failure.
#
# Starlette turns an uncaught exception into a 500 in ServerErrorMiddleware,
# which sits OUTSIDE every middleware added here, CORS included. That 500
# carries no CORS headers, so the browser refuses to show it and fetch()
# throws "Failed to fetch": the real error is invisible and the frontend
# can't tell a server bug from a dropped connection. Catching here, inside
# CORS (this is the first middleware registered, so it is the innermost),
# gives the browser a normal JSON 500 it can read.
#
# HTTPExceptions never reach this: FastAPI turns them into responses inside
# the router. logger.exception goes to the JSON logs and, at ERROR level,
# to Sentry (observability.py), so catching here loses no reporting.
# ---------------------------------------------------------------------------
UNHANDLED_ERROR_DETAIL = "Something went wrong on our side. Try again in a moment."


@app.middleware("http")
async def unhandled_errors_as_json(request: Request, call_next):
    try:
        return await call_next(request)
    except Exception:
        logger.exception("unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse(status_code=500, content={"detail": UNHANDLED_ERROR_DETAIL})


# ---------------------------------------------------------------------------
# Read-only gate (PRELAUNCH_BACKLOG §7 B). When a manager's free clock has run
# out and they are not 'active', every write under /api/ gets a 402 and the
# app shows the subscribe banner. Reads still work, so nothing they saved is
# ever out of reach. One middleware rather than a dependency on every write
# route, so a new route can't forget it.
#
# Registered BEFORE CORSMiddleware on purpose: Starlette wraps later-added
# middleware around earlier ones, so CORS sits outside this gate and the 402
# carries CORS headers. The other way round, the browser would see a CORS
# failure instead of the 402.
#
# Fails open. If the entitlement lookup itself errors, the write goes
# through: a billing check must never be the reason the app is down.
# ---------------------------------------------------------------------------
_WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
# POSTs that read, not save, plus accepting an invite (an IC has no clock).
_READ_ONLY_ALLOWED = (
    "/api/invites/",
    "/api/dashboard/events",
    "/api/dashboard/reconcile",
    "/api/dashboard/explain",
    "/api/away/preview",
)
READ_ONLY_DETAIL = (
    "Your free period has ended, so your account is read-only. "
    "Everything you saved is still here."
)


def _entitlement_for(authorization: str) -> dict:
    user_id, client = get_authenticated_client(authorization)
    return get_entitlement(user_id, client)


@app.middleware("http")
async def read_only_gate(request: Request, call_next):
    path = request.url.path
    authorization = request.headers.get("authorization") or ""
    if (
        request.method in _WRITE_METHODS
        and path.startswith("/api/")
        and not path.startswith(_READ_ONLY_ALLOWED)
        and authorization.startswith("Bearer ")
    ):
        try:
            ent = await run_in_threadpool(_entitlement_for, authorization)
        except HTTPException:
            ent = None  # bad token: let the route return its own 401
        except Exception:
            logger.exception("entitlement check failed; allowing write")
            ent = None
        if ent and ent.get("read_only"):
            return JSONResponse(status_code=402, content={"detail": READ_ONLY_DETAIL})
    return await call_next(request)

# Rate limiting. Per-route @limiter.limit decorators on every AI-calling
# endpoint, plus a default limit on all other writes (DEFAULT_WRITE_LIMIT in
# utils.py). Registered BEFORE CORSMiddleware for the same reason as the gate
# above: a 429 the middleware returns itself must still carry CORS headers,
# or the browser reports a CORS failure instead of "slow down". Registered
# AFTER the gate, so it sits outside it: a throttled write never costs an
# entitlement lookup.
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

_ALLOWED_ORIGINS = [settings.FRONTEND_URL, "http://localhost:3000"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Outermost, so every log line from any layer below (the gate, the limiter, a
# route) carries this request's route and, once auth resolves, its user id.
# Order-neutral otherwise: it only sets a contextvar and passes through.
app.add_middleware(RequestContextMiddleware)

app.include_router(direct_reports.router, prefix="/api/direct-reports", tags=["direct-reports"])
app.include_router(away.router, prefix="/api/away", tags=["away"])
app.include_router(one_on_ones.router, prefix="/api/one-on-ones", tags=["one-on-ones"])
app.include_router(commitments.router, prefix="/api/commitments", tags=["commitments"])
app.include_router(goals.router, prefix="/api/goals", tags=["goals"])
app.include_router(projects.router, prefix="/api/projects", tags=["projects"])
app.include_router(org_units.router, prefix="/api/org-units", tags=["org-units"])
app.include_router(role_families.router, prefix="/api/role-families", tags=["role-families"])
# Role JD import (Session 44) — one pure-AI draft endpoint, no writes;
# the commit runs through the role/expectation routers above.
app.include_router(roles_import.router, prefix="/api/roles/import", tags=["roles-import"])
app.include_router(role_expectations.router, prefix="/api/role-expectations", tags=["role-expectations"])
app.include_router(capacity.router, prefix="/api/capacity", tags=["capacity"])
app.include_router(settings_routes.router, prefix="/api/settings", tags=["settings"])
app.include_router(expectations_ai.router, prefix="/api/expectations", tags=["expectations"])
# Period assessments are registered before /api/assessments so the
# /{direct_report_id} scorecard route can never capture "reviews".
app.include_router(assessment_reviews.router, prefix="/api/assessments/reviews", tags=["assessments"])
app.include_router(assessments.router, prefix="/api/assessments", tags=["assessments"])
app.include_router(development.router, prefix="/api/development", tags=["development"])
app.include_router(dashboard.router, prefix="/api/dashboard", tags=["dashboard"])
app.include_router(team.router, prefix="/api/team", tags=["team"])
# Beyond the team — meetings outside the manager's own team. Its outputs
# (commitments, check-ins, secondhand prep context) are what reach the rest
# of the app; it has no Mission Control card. See docs/systems/beyond.md.
app.include_router(beyond.router, prefix="/api/beyond", tags=["beyond"])
# Overview, continuity, private prep items and reviewed AI suggestions for
# the same space (routes/beyond_continuity.py).
app.include_router(beyond_continuity.router, prefix="/api/beyond", tags=["beyond"])
app.include_router(invites.router, prefix="/api/invites", tags=["invites"])
app.include_router(documents.router, prefix="/api/documents", tags=["documents"])
app.include_router(assistant.router, prefix="/api/assistant", tags=["assistant"])
app.include_router(setup_status.router, prefix="/api/setup-status", tags=["setup-status"])
app.include_router(transcribe.router, prefix="/api/transcribe", tags=["transcribe"])
app.include_router(entitlement.router, prefix="/api/entitlement", tags=["entitlement"])


# Catch-all OPTIONS handler — belt-and-suspenders for Railway's reverse proxy,
# which sometimes strips Access-Control-Request-Method before CORSMiddleware
# can detect the preflight. Returns explicit CORS headers directly.
@app.options("/{rest_of_path:path}")
async def options_handler(rest_of_path: str, request: Request) -> Response:
    origin = request.headers.get("Origin", "")
    allow_origin = origin if origin in _ALLOWED_ORIGINS else _ALLOWED_ORIGINS[0]
    return Response(
        status_code=200,
        headers={
            "Access-Control-Allow-Origin": allow_origin,
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, PATCH",
            "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept",
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Max-Age": "86400",
        },
    )


@app.get("/health")
async def health():
    # `dictation` is a boolean, never the key. It exists because the first
    # production failure of dictation was indistinguishable from a vendor
    # outage at the client, and answering "is OPENAI_API_KEY set on this
    # deploy?" required a signed-in browser and devtools. One unauthenticated
    # GET now answers it. Add a flag here for any capability that lives behind
    # a secret this repo does not otherwise use.
    return {
        "status": "ok",
        "environment": settings.ENVIRONMENT,
        "dictation": bool(settings.OPENAI_API_KEY),
    }
