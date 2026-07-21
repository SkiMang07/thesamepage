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
