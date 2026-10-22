"""
Your account: take your record, or delete it and leave (PRELAUNCH_BACKLOG §7 E).

GET    /api/settings/account/export   one JSON file of everything the account holds
DELETE /api/settings/account          delete the account, permanently

Both run on the user's own JWT client. The export is plain RLS-scoped reads.
Deletion is the database function delete_my_account() (SECURITY DEFINER,
migrations/2026-10-22_account_deletion.sql), which removes every row the
account owns, the org and the login in one transaction. No service-role key.

Deletion order, and why:
  0. account_deletion_preflight(): the database's own refusals (shared org,
     no permission to remove logins, migration not run), checked before
     anything that can't be undone.
  1. Outside copies first: the HubSpot contact (hubspot.delete_contact) and
     the PostHog person with their events (analytics.delete_person). If either
     can't be done, stop with nothing deleted, so the person can try again
     rather than be left with a half-deleted account and a stray copy.
  2. Uploaded files in Storage (context-engine-docs/{org_id}/...). Must come
     before the database step: the storage delete policy checks
     current_org_id(), which is gone once the account is.
  3. delete_my_account(). If it fails, the files from step 2 are gone but
     every row is intact; documents keep their extracted text.

There are no backups on Supabase Free (Andrew, 2026-10-22), so step 3 is
final. The confirmation in Settings says so and asks for typed confirmation;
the body must carry the same phrase so a stray DELETE can't do it.

Both routes are exempt from the read-only gate (main.py): an account whose
free period ran out can still take its record and leave.
"""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

import analytics
import hubspot
from utils import forget_user, get_authenticated_client, get_email_from_token, limiter

logger = logging.getLogger(__name__)

router = APIRouter()

EXPORT_FORMAT_VERSION = 1
CONFIRM_PHRASE = "delete my account"
_STORAGE_BUCKET = "context-engine-docs"
_PAGE = 1000

# Every table in database/schema.sql is either exported or listed in
# EXPORT_EXCLUDED with the reason. tests/test_account.py enforces it.
ACCOUNT_TABLES = ("users", "organizations", "subscriptions")
EXPORT_TABLES = (
    # Organization setup
    "org_units", "role_families", "role_levels", "assessment_levels",
    "metric_configs", "metric_scale_definitions",
    "skill_configs", "skill_scale_definitions",
    "value_configs", "value_scale_definitions",
    "role_expectation_drafts", "role_expectation_decisions",
    "capacity_settings", "work_unit_configs",
    # People
    "direct_reports", "manager_report_connections", "direct_report_invites",
    "capacity_profiles", "time_off_entries",
    # 1:1s and commitments
    "one_on_one_series", "one_on_ones", "commitments", "dr_capture_notes",
    "away_periods", "away_period_shifts",
    # Assessments and development
    "assessments", "performance_reviews", "metric_entries", "skill_assessments",
    "value_assessments", "career_conversations", "development_plans",
    "dev_plan_aspirations", "dev_plan_opportunities", "dev_plan_training",
    "dev_plan_manager_notes", "team_dev_focus",
    # Goals and projects
    "goals", "projects", "check_ins", "project_follow_throughs",
    # Team
    "team_meeting_series", "team_meetings", "team_meeting_agenda_items",
    "team_callouts", "team_messages",
    # Beyond the team
    "outside_people", "outside_meeting_series", "outside_meetings",
    "outside_meeting_people", "outside_meeting_links", "outside_suggestions",
    "outside_suggestion_runs",
    # Knowledge
    "document_series", "documents", "document_scopes", "document_citations",
    # Mission Control and the Scribe
    "mission_control_events", "mission_control_morning_lines", "assistant_messages",
)
EXPORT_EXCLUDED = {
    "ai_jobs": "overnight-prep job bookkeeping; the prep it produces is in one_on_ones",
    "deleted_accounts": "other people's hashed-email tombstones; never readable by a user",
}
# Columns left out of the export: secrets, not the person's record.
REDACTED_COLUMNS = {
    "direct_report_invites": {"token"},
}


# Paging needs a stable order. Every table has an `id` except these two.
_ORDER_KEYS = {
    "outside_meeting_people": ("meeting_id", "person_id"),
    "mission_control_morning_lines": ("local_date", "fingerprint"),
}


def _read_all(supabase, table: str) -> list[dict]:
    rows: list[dict] = []
    start = 0
    while True:
        query = supabase.table(table).select("*")
        for key in _ORDER_KEYS.get(table, ("id",)):
            query = query.order(key)
        page = query.range(start, start + _PAGE - 1).execute().data or []
        if not page:
            break
        rows.extend(page)
        start += len(page)
    hidden = REDACTED_COLUMNS.get(table)
    if hidden:
        rows = [{k: v for k, v in r.items() if k not in hidden} for r in rows]
    return rows


def build_export(user_id: str, supabase) -> dict:
    users = _read_all(supabase, "users")
    me = next((u for u in users if u.get("id") == user_id), None)
    orgs = _read_all(supabase, "organizations")
    subs = _read_all(supabase, "subscriptions")
    return {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "format_version": EXPORT_FORMAT_VERSION,
        "about": (
            "Everything The Same Page holds for this account, one key per table, "
            "rows exactly as stored. Uploaded files are not included; their "
            "extracted text is in data.documents."
        ),
        "account": {
            "user": me,
            "organization": orgs[0] if orgs else None,
            "subscription": subs[0] if subs else None,
            "other_users_in_organization": [u for u in users if u.get("id") != user_id],
        },
        "data": {
            table: _own_rows(table, _read_all(supabase, table), user_id) for table in EXPORT_TABLES
        },
    }


def _own_rows(table: str, rows: list[dict], user_id: str) -> list[dict]:
    # RLS also shows an invited IC the manager's row about them (notes
    # included). That row is the manager's record, not the IC's.
    if table == "direct_reports":
        return [r for r in rows if r.get("manager_id") == user_id]
    return rows


@router.get("/export")
@limiter.limit("5/minute")
def export_account(request: Request, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    payload = build_export(user_id, supabase)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return JSONResponse(
        payload,
        headers={"Content-Disposition": f'attachment; filename="the-same-page-export-{stamp}.json"'},
    )


UNAVAILABLE = "Account deletion is unavailable right now. Nothing was deleted. Please try again later."
STOPPED = (
    "We couldn't finish deleting your account. Your account and your records are still here, "
    "though some uploaded files or our email and analytics copies may already be gone. "
    "Please try again."
)


class DeleteAccountIn(BaseModel):
    confirm: str


def _storage_paths(user_id: str, supabase) -> list[str]:
    """Every object under the org's folder: the paths documents point at, plus
    a sweep of the folder for anything a failed upload left behind."""
    rows = supabase.table("users").select("org_id").eq("id", user_id).execute().data
    org_id = (rows[0] if rows else {}).get("org_id")
    if not org_id:
        return []
    paths = {d["storage_path"] for d in _read_all(supabase, "documents") if d.get("storage_path")}
    bucket = supabase.storage.from_(_STORAGE_BUCKET)
    for entry in _list_all(bucket, org_id):
        name = entry.get("name")
        if not name:
            continue
        if entry.get("id"):  # a file directly under the org folder
            paths.add(f"{org_id}/{name}")
            continue
        for item in _list_all(bucket, f"{org_id}/{name}"):
            if item.get("name"):
                paths.add(f"{org_id}/{name}/{item['name']}")
    return sorted(paths)


def _list_all(bucket, prefix: str) -> list[dict]:
    entries: list[dict] = []
    while True:
        page = bucket.list(prefix, {"limit": _PAGE, "offset": len(entries)}) or []
        entries.extend(page)
        if len(page) < _PAGE:
            return entries


def _remove_storage(user_id: str, supabase) -> int:
    paths = _storage_paths(user_id, supabase)
    bucket = supabase.storage.from_(_STORAGE_BUCKET)
    removed = 0
    for i in range(0, len(paths), 100):
        batch = paths[i:i + 100]
        # remove() reports only what it deleted; anything RLS refused is
        # silently missing. Stop before the org (and with it any way to reach
        # those files) is gone.
        result = bucket.remove(batch) or []
        removed += len(result)
        if len(result) < len(batch):
            raise RuntimeError(f"storage removed {len(result)} of {len(batch)} files")
    return removed


@router.delete("")
@limiter.limit("3/minute")
def delete_account(
    request: Request,
    body: DeleteAccountIn,
    auth=Depends(get_authenticated_client),
    authorization: str = Header(None),
):
    user_id, supabase = auth
    if body.confirm.strip().lower() != CONFIRM_PHRASE:
        raise HTTPException(status_code=422, detail=f'Type "{CONFIRM_PHRASE}" to confirm.')

    email = get_email_from_token(authorization)

    # 0. Everything that could refuse, before anything that can't be undone.
    if analytics.deletion_needed() and not analytics.deletion_configured():
        logger.error("account deletion refused: PostHog deletion is not configured")
        raise HTTPException(status_code=503, detail=UNAVAILABLE)
    try:
        supabase.rpc("account_deletion_preflight", {}).execute()
    except Exception:
        logger.error("account deletion refused by preflight", exc_info=True)
        raise HTTPException(status_code=503, detail=UNAVAILABLE) from None

    # 1. Outside copies. A failure here leaves the account and every record
    #    intact; a HubSpot delete that already went through is not undone.
    try:
        if hubspot.enabled():
            hubspot.delete_contact(email)
        if analytics.deletion_needed():
            analytics.delete_person(user_id)
    except (hubspot.HubSpotError, analytics.AnalyticsDeletionError) as exc:
        logger.error("account deletion stopped at outside services: %s", exc)
        raise HTTPException(status_code=502, detail=STOPPED) from None

    # 2. Uploaded files.
    try:
        removed = _remove_storage(user_id, supabase)
    except Exception:
        logger.error("account deletion stopped at storage cleanup", exc_info=True)
        raise HTTPException(status_code=502, detail=STOPPED) from None

    # 3. Everything else, in one transaction.
    try:
        supabase.rpc("delete_my_account", {}).execute()
    except Exception:
        logger.error("account deletion failed in delete_my_account()", exc_info=True)
        raise HTTPException(status_code=500, detail=STOPPED) from None
    forget_user(user_id)
    logger.info("account deleted (%d stored files removed)", removed)
    return {"deleted": True}
