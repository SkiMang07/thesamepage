from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from config import settings
from routes import assessments, assistant, capacity, commitments, dashboard, direct_reports, documents, expectations_ai, goals, invites, one_on_ones, org_units, projects, role_families, settings as settings_routes, team
from utils import limiter

app = FastAPI(title="The Same Page API")

_ALLOWED_ORIGINS = [settings.FRONTEND_URL, "http://localhost:3000"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Rate limiting (added Session 20 — see foundation_weaknesses project memory
# note item #4). `slowapi` was already a dependency, unused, since before
# this session. Limits are set per-route (see the @limiter.limit decorators
# on the AI-calling endpoints in routes/one_on_ones.py, routes/assessments.py,
# and routes/dashboard.py) — nothing else in the app is throttled.
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

app.include_router(direct_reports.router, prefix="/api/direct-reports", tags=["direct-reports"])
app.include_router(one_on_ones.router, prefix="/api/one-on-ones", tags=["one-on-ones"])
app.include_router(commitments.router, prefix="/api/commitments", tags=["commitments"])
app.include_router(goals.router, prefix="/api/goals", tags=["goals"])
app.include_router(projects.router, prefix="/api/projects", tags=["projects"])
app.include_router(org_units.router, prefix="/api/org-units", tags=["org-units"])
app.include_router(role_families.router, prefix="/api/role-families", tags=["role-families"])
app.include_router(capacity.router, prefix="/api/capacity", tags=["capacity"])
app.include_router(settings_routes.router, prefix="/api/settings", tags=["settings"])
app.include_router(expectations_ai.router, prefix="/api/expectations", tags=["expectations"])
app.include_router(assessments.router, prefix="/api/assessments", tags=["assessments"])
app.include_router(dashboard.router, prefix="/api/dashboard", tags=["dashboard"])
app.include_router(team.router, prefix="/api/team", tags=["team"])
app.include_router(invites.router, prefix="/api/invites", tags=["invites"])
app.include_router(documents.router, prefix="/api/documents", tags=["documents"])
app.include_router(assistant.router, prefix="/api/assistant", tags=["assistant"])


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
    return {"status": "ok", "environment": settings.ENVIRONMENT}
