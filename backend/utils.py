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
from fastapi import HTTPException, Header
from supabase import create_client, Client

from config import settings

# token -> (user_data, cached_until_epoch_seconds)
_token_cache: dict[str, tuple[dict, float]] = {}

_CACHE_SAFETY_BUFFER_SECONDS = 60


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
    return user_id, client


def get_admin_client() -> Client:
    """Service-role client — bypasses RLS. Use ONLY for admin/background jobs,
    never inside a user-facing request path for user data."""
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)
