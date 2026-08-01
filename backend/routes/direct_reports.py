"""
CRUD for the people a manager manages. Everything else (1:1s, commitments)
hangs off a direct_report_id.

Schema column: manager_id (the logged-in manager's auth.uid()).
RLS enforces this automatically, but we also pass it explicitly for
defense-in-depth. Matches direct_reports.manager_id in schema.sql.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from utils import get_authenticated_client

router = APIRouter()


class DirectReportIn(BaseModel):
    name: str
    role_title: str | None = None
    notes: str | None = None
    # Settings page (Session 6): link a report to a configured role+level.
    role_level_id: str | None = None


@router.get("")
async def list_direct_reports(auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    result = (
        supabase.table("direct_reports")
        .select("*")
        .eq("manager_id", user_id)
        .order("name")
        .execute()
    )
    return result.data


# NOTE: declared before /{report_id} so FastAPI doesn't match "overview" as an id.
@router.get("/overview")
async def get_team_overview(auth=Depends(get_authenticated_client)):
    """Dashboard rollup: every direct report with their last 1:1 date and
    open commitment count. Three queries + a Python merge — fine at MVP
    scale (a manager has a handful of reports, not thousands)."""
    user_id, supabase = auth

    reports = (
        supabase.table("direct_reports")
        .select("id,name,role_title")
        .eq("manager_id", user_id)
        .order("name")
        .execute()
        .data
    )

    one_on_ones = (
        supabase.table("one_on_ones")
        .select("direct_report_id,created_at")
        .eq("manager_id", user_id)
        .order("created_at", desc=True)
        .execute()
        .data
    )

    open_commitments = (
        supabase.table("commitments")
        .select("direct_report_id")
        .eq("owner_id", user_id)
        .eq("status", "open")
        .execute()
        .data
    )

    # Newest-first order means the first occurrence per report is the latest 1:1.
    last_one_on_one: dict = {}
    for row in one_on_ones:
        last_one_on_one.setdefault(row["direct_report_id"], row["created_at"])

    commitment_counts: dict = {}
    for row in open_commitments:
        rid = row["direct_report_id"]
        commitment_counts[rid] = commitment_counts.get(rid, 0) + 1

    return [
        {
            **r,
            "last_one_on_one_at": last_one_on_one.get(r["id"]),
            "open_commitment_count": commitment_counts.get(r["id"], 0),
        }
        for r in reports
    ]


@router.post("")
async def create_direct_report(body: DirectReportIn, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    result = (
        supabase.table("direct_reports")
        .insert({**body.model_dump(), "manager_id": user_id})
        .execute()
    )
    return result.data[0]


@router.get("/{report_id}")
async def get_direct_report(report_id: str, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    try:
        result = (
            supabase.table("direct_reports")
            .select("*")
            .eq("id", report_id)
            .eq("manager_id", user_id)
            .single()
            .execute()
        )
    except Exception:
        raise HTTPException(status_code=404, detail="Direct report not found")
    if not result.data:
        raise HTTPException(status_code=404, detail="Direct report not found")
    return result.data


@router.put("/{report_id}")
async def update_direct_report(report_id: str, body: DirectReportIn, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    result = (
        supabase.table("direct_reports")
        .update(body.model_dump())
        .eq("id", report_id)
        .eq("manager_id", user_id)
        .execute()
    )
    return result.data[0]


@router.delete("/{report_id}")
async def delete_direct_report(report_id: str, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    supabase.table("direct_reports").delete().eq("id", report_id).eq("manager_id", user_id).execute()
    return {"deleted": True}
