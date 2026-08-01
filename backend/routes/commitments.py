"""
Commitment tracking — the "remembers what you told them" hook.

Commitments are created in two places (logging a 1:1, and eventually goals/
projects via the polymorphic source_type). This router is the read/resolve
surface: list a manager's commitments and mark them done/dropped/reopened.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from utils import get_authenticated_client

router = APIRouter()


class CommitmentUpdate(BaseModel):
    status: str  # 'open' | 'done' | 'dropped'


@router.get("")
async def list_commitments(
    direct_report_id: str | None = None,
    status: str | None = None,
    auth=Depends(get_authenticated_client),
):
    """List the manager's commitments, optionally filtered by direct report
    and/or status. Includes the direct report's name for dashboard use."""
    user_id, supabase = auth

    query = (
        supabase.table("commitments")
        .select("id,description,due_date,status,created_at,completed_at,direct_report_id,direct_reports(name)")
        .eq("owner_id", user_id)
    )
    if direct_report_id:
        query = query.eq("direct_report_id", direct_report_id)
    if status:
        query = query.eq("status", status)

    rows = query.order("created_at", desc=True).execute().data

    # Flatten the joined direct report name for a cleaner API shape.
    for row in rows:
        joined = row.pop("direct_reports", None) or {}
        row["direct_report_name"] = joined.get("name")
    return rows


@router.patch("/{commitment_id}")
async def update_commitment(
    commitment_id: str,
    body: CommitmentUpdate,
    auth=Depends(get_authenticated_client),
):
    """Mark a commitment done, dropped, or reopen it."""
    user_id, supabase = auth

    if body.status not in ("open", "done", "dropped"):
        raise HTTPException(status_code=422, detail="status must be open, done, or dropped")

    update: dict = {"status": body.status}
    if body.status == "done":
        update["completed_at"] = datetime.now(timezone.utc).isoformat()
    else:
        update["completed_at"] = None

    result = (
        supabase.table("commitments")
        .update(update)
        .eq("id", commitment_id)
        .eq("owner_id", user_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Commitment not found")
    return result.data[0]
