"""
Entitlement: is this manager on a founding place, a 14-day trial, paid, or
read-only? The first call creates their row (see ensure_entitlement() in
schema.sql), so the app shell calling this on load is what starts the clock.
"""
from fastapi import APIRouter, Depends

from utils import get_authenticated_client, get_entitlement

router = APIRouter()


@router.get("")
def read_entitlement(auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    return get_entitlement(user_id, supabase, fresh=True)
