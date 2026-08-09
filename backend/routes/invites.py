"""
Public-facing side of the direct-report invite flow (Team Mission Control,
Session 22 — see docs/SESSION_HISTORY.md and the team_mission_control
project memory note). The invite itself is created by a manager via
POST /api/direct-reports/{report_id}/invite (direct_reports.py); this router
is what an invited report hits before they have any account at all.

GET /{token} is intentionally unauthenticated — there is no bearer token yet,
since the visitor hasn't logged in. It uses a plain anon-key Supabase client
(NOT get_admin_client() — see utils.py's explicit warning against
service-role for user data) and calls get_invite_preview(), a SECURITY
DEFINER function granted to the `anon` role in schema.sql that returns only
a minimal, non-sensitive projection (names + expiry, never the row itself).
This keeps the "never service-role for user data" rule intact even though
there's no authenticated user to scope through yet.

POST /{token}/accept runs after the report has signed in via the same
magic-link flow /app/login uses (see frontend/app/invite/[token]/page.tsx),
so it goes through the normal get_authenticated_client() dependency and
calls accept_direct_report_invite() — the SECURITY DEFINER function that
actually claims the direct_reports row.
"""
from fastapi import APIRouter, Depends, HTTPException
from supabase import create_client

from config import settings
from utils import get_authenticated_client

router = APIRouter()


def _anon_client():
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_ANON_KEY)


@router.get("/{token}")
async def preview_invite(token: str):
    rows = _anon_client().rpc("get_invite_preview", {"p_token": token}).execute().data
    if not rows or not rows[0].get("valid"):
        raise HTTPException(status_code=404, detail="This invite link is invalid or has expired")
    row = rows[0]
    return {
        "report_name": row["report_name"],
        "invited_email": row["invited_email"],
        "manager_name": row["manager_name"],
        "expires_at": row["expires_at"],
    }


@router.post("/{token}/accept")
async def accept_invite(token: str, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    try:
        direct_report_id = supabase.rpc("accept_direct_report_invite", {"p_token": token}).execute().data
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"direct_report_id": direct_report_id}
