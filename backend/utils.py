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
import logging
import threading
import time
import base64
import json
import uuid
from datetime import date, datetime
from fastapi import HTTPException, Header
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.wrappers import LimitGroup
import httpx
from gotrue.http_clients import SyncClient as GoTrueHttpClient
from postgrest import SyncPostgrestClient
from postgrest.constants import DEFAULT_POSTGREST_CLIENT_TIMEOUT
from postgrest.utils import SyncClient as PostgrestHttpClient
from supabase import create_client, Client, SupabaseAuthClient

from config import settings
from observability import set_request_user

_logger = logging.getLogger(__name__)

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

# Default limit on every write that has no limit of its own (PRELAUNCH_BACKLOG
# §7 C). The AI routes carry tighter @limiter.limit decorators, which replace
# this default rather than add to it. Reads are left alone: one page load fans
# out to a dozen GETs, and the risk this covers is a runaway client POSTing in
# a loop, not someone clicking around.
#
# slowapi's `default_limits=` argument has no way to say "writes only", so the
# LimitGroup is built by hand with a `methods` list. The bucket is per route
# per IP (slowapi scopes a default limit to the endpoint). Enforced by
# SlowAPIMiddleware in main.py; tests/test_rate_limits.py pins both halves.
DEFAULT_WRITE_LIMIT = "120/minute"
_WRITE_METHODS = ["POST", "PUT", "PATCH", "DELETE"]
limiter._default_limits = [
    LimitGroup(DEFAULT_WRITE_LIMIT, get_remote_address, None, False, _WRITE_METHODS, None, None, 1, False)
]

# token -> (user_data, cached_until_epoch_seconds)
_token_cache: dict[str, tuple[dict, float]] = {}
# Route handlers are plain `def` and run on FastAPI's thread pool, so this
# cache is read and written from many threads at once. The lock covers every
# access; the network call to Supabase happens outside it.
_token_cache_lock = threading.Lock()

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
        # Not logged on purpose: a malformed token just gets the short
        # 30-second cache TTL below, and Supabase still decides validity.
        return None


def verify_token_with_supabase(token: str) -> dict:
    now = time.time()
    with _token_cache_lock:
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
    with _token_cache_lock:
        _token_cache[token] = (user_data, now + ttl)

    return user_data


# ---------------------------------------------------------------------------
# Pooled Supabase connections (pre-launch perf pass, N-5 follow-up).
#
# `create_client()` builds fresh httpx clients for PostgREST and GoTrue on
# every request, and each one reloads the CA bundle from disk (~33 ms of
# GIL-holding CPU apiece, ~140 ms per request) and opens a brand-new TLS
# connection to Supabase. Under concurrency that CPU serialises every request
# in the process.
#
# The fix keeps one Supabase client PER REQUEST (so each user's JWT lives only
# on that request's own httpx session headers, exactly as before) but backs
# those sessions with ONE shared httpx transport. A transport holds the
# connection pool and the SSL context, never headers, so no auth state is
# shared between users. httpcore's pool is thread-safe.
#
# Never call .close()/.aclose() on a pooled client: closing an httpx.Client
# closes its transport, which here is shared by every request. Nothing in
# the codebase does today; per-request clients are simply garbage-collected.
# Storage keeps the library's default (it is only built lazily, on uploads).
#
# HTTP/1.1, not HTTP/2. With http2=True every thread multiplexed onto one
# connection, and when Supabase closed or reset it mid-burst, every in-flight
# request died with "Server disconnected" -> an unhandled 500 with no CORS
# headers -> "Failed to fetch" in the browser. The Team page, which fans out
# 13 GETs at once, hit this on first load. An HTTP/1.1 pool gives each
# concurrent request its own connection (still pooled, still one SSL
# context). retries=1 re-dials a connection that fails to open.
# ---------------------------------------------------------------------------
_SUPABASE_TRANSPORT = httpx.HTTPTransport(
    http2=False,
    retries=1,
    limits=httpx.Limits(max_connections=100, max_keepalive_connections=20, keepalive_expiry=5.0),
)


# ---------------------------------------------------------------------------
# "JWT issued at future" (PRELAUNCH_BACKLOG §7 F, first caught by Sentry on
# 2026-09-24). Right after the browser refreshes its Supabase session, the new
# token's `iat` can be a moment ahead of the database's clock, and PostgREST
# answers 401 "JWT issued at future". The app shell calls /api/entitlement on
# every load, so a manager whose token had just refreshed got a 500.
#
# PostgREST rejects the token before it runs anything, so resending is safe
# for writes as well as reads. One retry, after a pause long enough to cover
# the skew; a second failure is returned as-is so a real clock problem still
# surfaces in Sentry. Wrapping the transport covers every RLS-scoped query and
# RPC in one place instead of route by route.
# ---------------------------------------------------------------------------
_JWT_FUTURE_MARKER = b"JWT issued at future"
_JWT_FUTURE_RETRY_DELAY_SECONDS = 1.0


class _JwtClockSkewRetryTransport(httpx.BaseTransport):
    def __init__(self, inner: httpx.BaseTransport, delay: float = _JWT_FUTURE_RETRY_DELAY_SECONDS):
        self._inner = inner
        self._delay = delay

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        response = self._inner.handle_request(request)
        if response.status_code != 401:
            return response
        response.read()
        if _JWT_FUTURE_MARKER not in response.content:
            return response
        response.close()
        _logger.warning(
            "postgrest rejected a just-issued token (JWT issued at future); retrying once",
            extra={"fields": {"event": "jwt_iat_future_retry", "path": request.url.path}},
        )
        time.sleep(self._delay)
        return self._inner.handle_request(request)

    def close(self) -> None:
        self._inner.close()


_POSTGREST_TRANSPORT = _JwtClockSkewRetryTransport(_SUPABASE_TRANSPORT)


class _PooledPostgrestClient(SyncPostgrestClient):
    def create_session(self, base_url, headers, timeout, verify=True, proxy=None):
        return PostgrestHttpClient(
            base_url=base_url,
            headers=headers,
            timeout=timeout,
            transport=_POSTGREST_TRANSPORT,
            follow_redirects=True,
        )


class _PooledSupabaseClient(Client):
    @staticmethod
    def _init_postgrest_client(rest_url, headers, schema, timeout=DEFAULT_POSTGREST_CLIENT_TIMEOUT, verify=True, proxy=None):
        return _PooledPostgrestClient(rest_url, headers=headers, schema=schema, timeout=timeout)

    @staticmethod
    def _init_supabase_auth_client(auth_url, client_options, verify=True, proxy=None):
        return SupabaseAuthClient(
            url=auth_url,
            auto_refresh_token=client_options.auto_refresh_token,
            persist_session=client_options.persist_session,
            storage=client_options.storage,
            headers=client_options.headers,
            flow_type=client_options.flow_type,
            http_client=GoTrueHttpClient(transport=_SUPABASE_TRANSPORT, follow_redirects=True),
        )


def get_authenticated_client(authorization: str = Header(None)) -> tuple[str, Client]:
    """FastAPI dependency: returns (user_id, rls_scoped_supabase_client)."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or malformed Authorization header")

    token = authorization.removeprefix("Bearer ").strip()
    user_data = verify_token_with_supabase(token)
    user_id = user_data.get("id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Could not resolve user from token")
    set_request_user(user_id)

    client = _PooledSupabaseClient.create(settings.SUPABASE_URL, settings.SUPABASE_ANON_KEY)
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


# ---------------------------------------------------------------------------
# Entitlement: founding places and the free clock (PRELAUNCH_BACKLOG §7 B).
#
# ensure_entitlement() is a SECURITY DEFINER function that creates the
# caller's subscriptions row on first call and reports whether the account
# is read-only. It runs with the user's own JWT client, never service-role.
# Cached per user for a minute because the read-only gate in main.py asks on
# every write; a clock running out or a manual flip to 'active' shows up
# within that minute. GET /api/entitlement always asks fresh.
# ---------------------------------------------------------------------------
_ENTITLEMENT_TTL_SECONDS = 60
_entitlement_cache: dict[str, tuple[dict, float]] = {}
_entitlement_cache_lock = threading.Lock()


def get_entitlement(user_id: str, supabase: Client, fresh: bool = False) -> dict:
    now = time.time()
    if not fresh:
        with _entitlement_cache_lock:
            cached = _entitlement_cache.get(user_id)
        if cached and cached[1] > now:
            return cached[0]

    data = supabase.rpc("ensure_entitlement", {}).execute().data

    with _entitlement_cache_lock:
        expired = [u for u, (_, until) in _entitlement_cache.items() if until <= now]
        for u in expired:
            del _entitlement_cache[u]
        _entitlement_cache[user_id] = (data, now + _ENTITLEMENT_TTL_SECONDS)
    return data


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


def meeting_date_of(row: dict | None) -> str | None:
    """The single canonical answer to "when did this 1:1 happen".

    `one_on_ones.scheduled_at` is the meeting date, planned or backfilled,
    exactly as `team_meetings.scheduled_at` has been since 2026-08-24. Every
    log path now writes a manager-confirmed date there, and the 2026-08-28
    migration backfilled the completed rows that predate that.

    `created_at` is row creation and means nothing about the conversation:
    an ad-hoc log completes an existing workspace, so its created_at is
    whenever that shell happened to be made. It stays here purely as a
    fallback for a row the backfill could not reach, and it is the reason
    this resolver exists at all -- the rule used to be re-implemented at
    every call site, and drifted (History said one date, "Last met" said
    another, and the prep prompt reported a stale gap). Read the meeting
    date through this function, never off the columns.
    """
    if not row:
        return None
    return row.get("scheduled_at") or row.get("created_at")


def meeting_day_of(row: dict | None) -> date | None:
    """meeting_date_of() as a calendar day, for cadence and recency math."""
    value = meeting_date_of(row)
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).date()
    except (ValueError, AttributeError, TypeError):
        return None


def meeting_sort_key(row: dict | None) -> str:
    """Newest-meeting-first sort key. Empty string sorts an undated row last
    under `reverse=True`, which is where an unknown date belongs."""
    return str(meeting_date_of(row) or "")


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
