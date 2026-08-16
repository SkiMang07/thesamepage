"""
Shared backend utilities: JWT verification, Supabase client construction.

Auth pattern (copied from Prism Tree, proven at scale):
Every protected route calls get_authenticated_client(authorization) which
verifies the bearer token against Supabase's /auth/v1/user endpoint (not
local JWT parsing — this transparently handles whatever signing algorithm
Supabase uses) and returns an RLS-scoped client so every DB query
automatically enforces per-user data isolation. No route should ever use
the service-role client directly against user data.
"""
import time
import base64
import json
import uuid
from fastapi import HTTPException, Header
from slowapi import Limiter
from slowapi.util import get_remote_address
from supabase import create_client, Client

from config import settings

# Shared rate limiter (added Session 20 — flagged Session 19, see
# foundation_weaknesses project memory note item #4). Lives here rather than
# in main.py so route modules can import it without a circular import on
# main. Keyed by remote IP, not by authenticated user — slowapi's key_func
# runs before FastAPI resolves get_authenticated_client, so it can't see
# user_id without re-parsing the bearer token itself. IP-based is coarser
# (e.g. an office NAT shares one bucket) but is what stops a runaway loop or
# script, which is the actual risk today. Revisit if that coarseness ever
# causes a real false-positive complaint.
limiter = Limiter(key_func=get_remote_address)

# token -> (user_data, cached_until_epoch_seconds)
_token_cache: dict[str, tuple[dict, float]] = {}

_CACHE_SAFETY_BUFFER_SECONDS = 60

# Fixed Session 20 (flagged Session 19, see foundation_weaknesses project
# memory note item #3): entries used to sit here forever once their token
# expired — only overwritten if that exact token was ever seen again. Now
# swept opportunistically on every call, so the cache's size is always
# bounded by the number of currently-unexpired tokens, not by how many
# distinct tokens have ever been issued.
#
# Still per-process / in-memory — not shared across instances. That's
# unchanged and NOT fixed here: the moment this runs on more than one
# Railway instance, each instance keeps its own cache and re-verifies
# independently. Fine at today's single-instance scale; revisit (e.g. a
# shared cache like Redis) before horizontal scaling.
def _evict_expired_tokens(now: float) -> None:
    expired = [t for t, (_, until) in _token_cache.items() if until <= now]
    for t in expired:
        del _token_cache[t]


def _decode_exp_unverified(token: str) -> float | None:
    """Pull the `exp` claim out of a JWT without verifying the signature,
    purely to size the local cache TTL. Never used for auth decisions."""
    try:
        payload_b64 = token.split(".")[1]
        padded = payload_b64 + "=" * (-len(payload_b64) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded))
        return payload.get("exp")
    except Exception:
        return None


def verify_token_with_supabase(token: str) -> dict:
    now = time.time()
    _evict_expired_tokens(now)

    cached = _token_cache.get(token)
    if cached and cached[1] > now:
        return cached[0]

    import httpx

    resp = httpx.get(
        f"{settings.SUPABASE_URL}/auth/v1/user",
        headers={
            "Authorization": f"Bearer {token}",
            "apikey": settings.SUPABASE_ANON_KEY,
        },
        timeout=10.0,
    )

    if resp.status_code in (401, 403):
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    if resp.status_code >= 500:
        raise HTTPException(status_code=500, detail="Auth service unavailable")

    user_data = resp.json()

    exp = _decode_exp_unverified(token)
    ttl = max((exp - now - _CACHE_SAFETY_BUFFER_SECONDS), 0) if exp else 30
    _token_cache[token] = (user_data, now + ttl)

    return user_data


def get_authenticated_client(authorization: str = Header(None)) -> tuple[str, Client]:
    """FastAPI dependency: returns (user_id, rls_scoped_supabase_client)."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or malformed Authorization header")

    token = authorization.removeprefix("Bearer ").strip()
    user_data = verify_token_with_supabase(token)
    user_id = user_data.get("id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Could not resolve user from token")

    client = create_client(settings.SUPABASE_URL, settings.SUPABASE_ANON_KEY)
    client.postgrest.auth(token)
    # Propagate the user's JWT to Storage too (added Session 28 — the Context
    # Engine's upload endpoint is the first route to touch `client.storage`).
    # `postgrest.auth(token)` only sets the Authorization header on the
    # postgrest client's own httpx session — it does NOT touch
    # `client.options.headers`, which is what `client.storage` (lazily built
    # on first access) uses to construct its own httpx session. Without this
    # line, Storage requests would authenticate as the anon key, `auth.uid()`
    # would be null inside storage.objects' RLS policies, and every upload
    # would be rejected — confirmed by reading supabase-py 2.9.1's
    # SyncClient.storage property and BasePostgrestClient.auth() source.
    client.options.headers["Authorization"] = f"Bearer {token}"
    return user_id, client


def get_admin_client() -> Client:
    """Service-role client — bypasses RLS. Use ONLY for admin/background jobs,
    never inside a user-facing request path for user data."""
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)


# ---------------------------------------------------------------------------
# Org bootstrap — shared by every org-scoped write path (Settings' Roles &
# Levels / Expectations, and org_units as of Session 11). Originally lived
# only in settings.py as private helpers; pulled up here once a second
# router (org_units.py) needed the same bootstrap-on-write behavior.
# ---------------------------------------------------------------------------

def get_email_from_token(authorization: str | None) -> str:
    """Re-verify the token to read the email claim (cached in
    verify_token_with_supabase, so this does not add a second network call
    per request)."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    user_data = verify_token_with_supabase(authorization.removeprefix("Bearer ").strip())
    return user_data.get("email") or ""


# ---------------------------------------------------------------------------
# 1:1 cadence resolver (nav rework pass 2, Session 38, 2026-08-16 — see
# docs/ONE_ON_ONES_PAGE_SPEC.md section 4). The number 21 used to be
# hardcoded in three places: dashboard.py's _CADENCE_DAYS, one_on_ones.py's
# prep-prompt staleness logic, and the frontend's dashboard/page.tsx
# CADENCE_DAYS. This is the one resolver every cadence-aware call site must
# go through instead of re-hardcoding the number a fourth time.
# ---------------------------------------------------------------------------

_DEFAULT_CADENCE_DAYS = 21


def resolve_cadence_days(report: dict | None, org: dict | None) -> tuple[int, str]:
    """Precedence: direct_reports.one_on_one_cadence_days ("custom") ->
    organizations.one_on_one_cadence_days ("org") -> 21 ("default", used
    when the manager has no organization row yet — see ensure_org()).

    Returns (days, source) so callers can label which source won, per the
    same honesty convention Capacity uses for logged-vs-assumed hours
    ("every 14 days (custom)" vs "every 21 days (org default)").
    """
    report_cadence = (report or {}).get("one_on_one_cadence_days")
    if report_cadence is not None:
        return report_cadence, "custom"
    org_cadence = (org or {}).get("one_on_one_cadence_days")
    if org_cadence is not None:
        return org_cadence, "org"
    return _DEFAULT_CADENCE_DAYS, "default"


def get_org(user_id: str, supabase: Client) -> dict | None:
    """Read-only org lookup — unlike ensure_org(), never creates one. A GET
    endpoint (dashboard insight, 1:1 overview, prep) shouldn't bootstrap an
    organization row as a side effect of loading; only a Settings write
    should (same reasoning as capacity.py's _get_org_id). Returns None
    before the manager has saved their profile once — callers pass that
    through to resolve_cadence_days(), which treats a missing org the same
    as a missing per-report override and falls back to the hardcoded 21."""
    rows = supabase.table("users").select("org_id").eq("id", user_id).execute().data
    org_id = rows[0]["org_id"] if rows and rows[0].get("org_id") else None
    if not org_id:
        return None
    org_rows = supabase.table("organizations").select("*").eq("id", org_id).execute().data
    return org_rows[0] if org_rows else None


def ensure_org(user_id: str, supabase: Client, email: str, company_name: str | None = None) -> str:
    """Make sure a users row + organization exist and are linked; return
    org_id. Idempotent — safe to call from any org-scoped write path."""
    rows = supabase.table("users").select("*").eq("id", user_id).execute().data
    profile = rows[0] if rows else None

    if profile is None:
        supabase.table("users").insert(
            {"id": user_id, "email": email, "full_name": ""}
        ).execute()
        profile = {"org_id": None}

    if profile.get("org_id"):
        return profile["org_id"]

    org_id = str(uuid.uuid4())
    # returning="minimal": the org isn't linked to the user yet, so the
    # select-own RLS policy would block returning the inserted row.
    supabase.table("organizations").insert(
        {"id": org_id, "name": company_name or "My company"},
        returning="minimal",
    ).execute()
    supabase.table("users").update({"org_id": org_id}).eq("id", user_id).execute()
    return org_id
