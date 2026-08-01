from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from config import settings
from routes import commitments, direct_reports, one_on_ones

app = FastAPI(title="The Same Page API")

_ALLOWED_ORIGINS = [settings.FRONTEND_URL, "http://localhost:3000"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(direct_reports.router, prefix="/api/direct-reports", tags=["direct-reports"])
app.include_router(one_on_ones.router, prefix="/api/one-on-ones", tags=["one-on-ones"])
app.include_router(commitments.router, prefix="/api/commitments", tags=["commitments"])


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
