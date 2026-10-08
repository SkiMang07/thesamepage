"""
Commitment tracking — the "remembers what you told them" hook.

Commitments are created in two places (logging a 1:1 via one_on_ones.py, and
as standalone records via POST "" here — added Session 32 for the Scribe
confirm handler). This router is the read/resolve surface: list a manager's
commitments, edit one (wording, due date, who owes it) and mark it
done/dropped/reopened.

GET /board feeds the commitments table on Mission Control and the Team page
(2026-10-08): every commitment that is open or was finished in the last
RECENT_DAYS, each with who owes it and where it was made already resolved, so
the table never has to load 1:1s, meetings, goals and projects to label a row.

Who owes it: committed_by, on every source. A null direct_report_id on a
'manager' row is the manager's own (docs/decisions/nullable-commitment-owner.md);
'counterpart' rows are owed by someone outside the team (Beyond).
"""
from datetime import date, datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import analytics
from utils import get_authenticated_client, meeting_day_of

router = APIRouter()


class CommitmentIn(BaseModel):
    description: str
    direct_report_id: str
    committed_by: str = "direct_report"   # 'direct_report' | 'manager'
    due_date: str | None = None
    is_team_commitment: bool = False


class CommitmentUpdate(BaseModel):
    """Every field optional; only the ones sent change. due_date may be sent
    as null to clear it. `owner` + `direct_report_id` change who owes it (see
    update_commitment). `surface` is analytics only: where the change was made."""
    status: Literal["open", "done", "dropped"] | None = None
    description: str | None = None
    due_date: date | None = None
    owner: Literal["manager", "direct_report"] | None = None
    direct_report_id: str | None = None
    surface: Literal["table", "team_table", "person", "team", "beyond", "other"] | None = None


@router.post("")
def create_commitment(body: CommitmentIn, auth=Depends(get_authenticated_client)):
    """Standalone commitment creation — used by the Scribe confirm handler.
    Validates that the direct report belongs to the manager before inserting."""
    user_id, supabase = auth
    if body.committed_by not in ("manager", "direct_report"):
        raise HTTPException(status_code=422, detail="committed_by must be 'manager' or 'direct_report'")
    # Verify the direct report belongs to this manager (RLS doesn't cover this insert path).
    dr_check = (
        supabase.table("direct_reports")
        .select("id")
        .eq("id", body.direct_report_id)
        .eq("manager_id", user_id)
        .execute()
    )
    if not dr_check.data:
        raise HTTPException(status_code=404, detail="Direct report not found")
    result = (
        supabase.table("commitments")
        .insert({
            "description": body.description,
            "owner_id": user_id,
            "direct_report_id": body.direct_report_id,
            "committed_by": body.committed_by,
            "due_date": body.due_date,
            "is_team_commitment": body.is_team_commitment,
            "source_type": "manual",
            "status": "open",
        })
        .execute()
    )
    return result.data[0]


@router.get("")
def list_commitments(
    direct_report_id: str | None = None,
    status: str | None = None,
    source_type: str | None = None,
    source_id: str | None = None,
    auth=Depends(get_authenticated_client),
):
    """List the manager's commitments, optionally filtered by direct report,
    status, and/or the record it was made in. Includes the direct report's
    name for dashboard use.

    source_type/source_id say where a commitment was made (a 1:1, a team
    meeting, a goal/project, or "manual"). They are returned as stored and
    never resolved here: a caller links one only when it can read that source
    itself, so a deleted or inaccessible source shows as unavailable rather
    than leaking or being guessed at."""
    user_id, supabase = auth

    query = (
        supabase.table("commitments")
        .select("id,description,due_date,status,committed_by,created_at,completed_at,direct_report_id,source_type,source_id,direct_reports(name)")
        .eq("owner_id", user_id)
    )
    if direct_report_id:
        query = query.eq("direct_report_id", direct_report_id)
    if status:
        query = query.eq("status", status)
    if source_type:
        query = query.eq("source_type", source_type)
    if source_id:
        query = query.eq("source_id", source_id)

    rows = query.order("created_at", desc=True).execute().data

    # Flatten the joined direct report name for a cleaner API shape.
    for row in rows:
        joined = row.pop("direct_reports", None) or {}
        row["direct_report_name"] = joined.get("name")
    return rows


@router.patch("/{commitment_id}")
def update_commitment(
    commitment_id: str,
    body: CommitmentUpdate,
    auth=Depends(get_authenticated_client),
):
    """Change status, wording, due date or who owes it. Only fields sent change.

    Who owes it, by kind of row:
    - a counterpart row (someone outside the team owes it) can't change owner;
    - a team row (is_team_commitment) can move to any of the manager's people
      or to the manager (owner 'manager', direct_report_id null);
    - any other row keeps its person and flips committed_by between the
      manager and that person ("I owe Sam" <-> "Sam owes me").
    """
    user_id, supabase = auth
    fields = body.model_fields_set

    rows = (
        supabase.table("commitments")
        .select("id,status,committed_by,direct_report_id,is_team_commitment,org_unit_id")
        .eq("id", commitment_id)
        .eq("owner_id", user_id)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Commitment not found")
    current = rows[0]

    update: dict = {}
    if "status" in fields and body.status:
        update["status"] = body.status
        update["completed_at"] = datetime.now(timezone.utc).isoformat() if body.status == "done" else None
    if "description" in fields:
        text = (body.description or "").strip()
        if not text:
            raise HTTPException(status_code=422, detail="A commitment needs some words")
        update["description"] = text[:1000]
    if "due_date" in fields:
        update["due_date"] = body.due_date.isoformat() if body.due_date else None
    if "owner" in fields and body.owner:
        update.update(_owner_change(supabase, user_id, current, body.owner, body.direct_report_id, "direct_report_id" in fields))

    if not update:
        raise HTTPException(status_code=422, detail="Nothing to change")

    result = (
        supabase.table("commitments")
        .update(update)
        .eq("id", commitment_id)
        .eq("owner_id", user_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Commitment not found")

    if "status" in update and update["status"] != current.get("status"):
        analytics.capture(user_id, "commitment_status_changed", {
            "status": update["status"],
            "owner": _owner_kind(current),
            "surface": body.surface or "other",
        })
    return result.data[0]


def _owner_kind(row: dict) -> str:
    by = row.get("committed_by")
    if by == "counterpart":
        return "counterpart"
    if by == "direct_report" and row.get("direct_report_id"):
        return "report"
    return "you"


def _owner_change(supabase, user_id: str, current: dict, owner: str, report_id: str | None, report_sent: bool) -> dict:
    if current.get("committed_by") == "counterpart":
        raise HTTPException(status_code=422, detail="Someone outside the team owes this; it can't be reassigned here")

    if not current.get("is_team_commitment"):
        # A 1:1 (or other person-bound) row: the person stays, only the side flips.
        if not current.get("direct_report_id"):
            if owner != "manager":
                raise HTTPException(status_code=422, detail="This commitment isn't with anyone on your team")
            return {}
        if report_sent and report_id != current["direct_report_id"]:
            raise HTTPException(status_code=422, detail="A 1:1 commitment stays with the person it was made with")
        return {"committed_by": owner}

    # A team row: owner names who owes it. The manager has no person.
    if owner == "manager":
        change = {"committed_by": "manager", "direct_report_id": None}
        # A row placed on a team only through its owner's team would lose that
        # team when the owner goes; keep it by recording the team now.
        if not current.get("org_unit_id") and current.get("direct_report_id"):
            team = (
                supabase.table("direct_reports").select("org_unit_id")
                .eq("id", current["direct_report_id"]).eq("manager_id", user_id).execute().data
            )
            if team and team[0].get("org_unit_id"):
                change["org_unit_id"] = team[0]["org_unit_id"]
        return change
    target = report_id if report_sent else current.get("direct_report_id")
    if not target:
        raise HTTPException(status_code=422, detail="Pick who owes it")
    found = (
        supabase.table("direct_reports")
        .select("id,org_unit_id")
        .eq("id", target)
        .eq("manager_id", user_id)
        .execute()
        .data
    )
    if not found:
        raise HTTPException(status_code=404, detail="Direct report not found")
    change = {"committed_by": "direct_report", "direct_report_id": target}
    # A row with no team recorded follows its new owner's team, the same
    # fallback the Team page reads with (team.md → Team commitments).
    if not current.get("org_unit_id") and found[0].get("org_unit_id"):
        change["org_unit_id"] = found[0]["org_unit_id"]
    return change


# ---------------------------------------------------------------------------
# The commitments table (Mission Control and the Team page)
# ---------------------------------------------------------------------------

RECENT_DAYS = 30
_SOURCE_KINDS = ("one_on_one", "team_meeting", "outside_meeting", "goal", "project")


def _first(name: str | None) -> str | None:
    return name.split()[0] if name else None


def _rows_by_id(supabase, table: str, cols: str, ids: set[str], owner_col: str, user_id: str) -> dict[str, dict]:
    """One read per source table, scoped to the manager. A failed read leaves
    the source unlabelled ("no longer available") rather than failing the table."""
    if not ids:
        return {}
    try:
        rows = supabase.table(table).select(cols).in_("id", list(ids)).eq(owner_col, user_id).execute().data
    except Exception:
        return {}
    return {r["id"]: r for r in rows}


def _day(value) -> str | None:
    if not value:
        return None
    return str(value)[:10]


def build_board(rows: list[dict], *, reports: dict, outside: dict, sources: dict, units: dict) -> list[dict]:
    """Pure: shape stored commitments into table rows. Archived people's rows
    are dropped, as on Mission Control (reports holds only current people)."""
    out = []
    for r in rows:
        rid = r.get("direct_report_id")
        if rid and rid not in reports:
            continue
        report = reports.get(rid) if rid else None
        person = outside.get(r.get("outside_person_id")) if r.get("outside_person_id") else None
        kind = _owner_kind(r)

        if kind == "report":
            owner_name, with_name = report["name"], None
        elif kind == "counterpart":
            owner_name, with_name = (person or {}).get("name") or "Someone outside the team", None
        else:
            owner_name = None
            with_name = report["name"] if report else (person or {}).get("name")

        org_unit_id = r.get("org_unit_id") or (report or {}).get("org_unit_id")
        out.append({
            "id": r["id"],
            "description": r.get("description") or r.get("title") or "",
            "status": r.get("status"),
            "due_date": r.get("due_date"),
            "created_at": r.get("created_at"),
            "completed_at": r.get("completed_at"),
            "owner": kind,
            "owner_name": owner_name,
            "with_name": with_name,
            "direct_report_id": rid,
            "outside_person_id": r.get("outside_person_id"),
            "is_team_commitment": bool(r.get("is_team_commitment")),
            "org_unit_id": org_unit_id,
            "source": _source(r, report, sources, units),
        })
    return out


def _source(r: dict, report: dict | None, sources: dict, units: dict) -> dict:
    stype, sid = r.get("source_type"), r.get("source_id")
    found = sources.get(stype, {}).get(sid) if sid else None
    base = {"type": stype or "manual", "label": "", "date": None, "href": None}

    if stype == "one_on_one":
        who = _first((report or {}).get("name"))
        if not found:
            return {**base, "label": f"1:1 with {who}" if who else "A 1:1", "href": f"/app/reports/{report['id']}" if report else None}
        day = meeting_day_of(found)
        rid = found.get("direct_report_id") or (report or {}).get("id")
        return {**base, "label": f"1:1 with {who}" if who else "A 1:1", "date": day.isoformat() if day else None,
                "href": f"/app/reports/{rid}?conversation={sid}" if rid else None}
    if stype == "team_meeting":
        if not found:
            return {**base, "label": "A team meeting, no longer available"}
        team = units.get(found.get("org_unit_id"))
        return {**base, "label": f"{team} meeting" if team else "Team meeting",
                "date": _day(found.get("scheduled_at")), "href": f"/app/team/meetings/{sid}"}
    if stype == "outside_meeting":
        if not found:
            return {**base, "label": "A meeting beyond the team, no longer available"}
        return {**base, "label": (found.get("title") or "Meeting beyond the team"),
                "date": _day(found.get("scheduled_at")), "href": f"/app/beyond/meetings/{sid}"}
    if stype == "goal":
        return {**base, "label": f"Goal: {found['title']}" if found else "A goal, no longer available",
                "href": "/app/goals" if found else None}
    if stype == "project":
        return {**base, "label": f"Project: {found['title']}" if found else "A project, no longer available",
                "href": "/app/projects" if found else None}
    # manual: the Team page's "+ Add", the Scribe, promises confirmed from a note.
    return {**base, "label": "Added on the Team page" if r.get("is_team_commitment") else "Added by you",
            "date": _day(r.get("created_at"))}


@router.get("/board")
def commitments_board(auth=Depends(get_authenticated_client)):
    """Open commitments, plus those finished in the last RECENT_DAYS, for the
    commitments table. Also returns the manager's current people (for the
    owner filter and reassigning team rows)."""
    user_id, supabase = auth
    since = (datetime.now(timezone.utc) - timedelta(days=RECENT_DAYS)).isoformat()
    cols = ("id,title,description,due_date,status,committed_by,created_at,completed_at,"
            "direct_report_id,outside_person_id,org_unit_id,is_team_commitment,source_type,source_id")
    open_rows = supabase.table("commitments").select(cols).eq("owner_id", user_id).eq("status", "open").execute().data
    done_rows = (
        supabase.table("commitments").select(cols).eq("owner_id", user_id).eq("status", "done")
        .gte("completed_at", since).execute().data
    )
    rows = open_rows + done_rows

    people = (
        supabase.table("direct_reports").select("id,name,org_unit_id,archived_at")
        .eq("manager_id", user_id).execute().data
    )
    reports = {p["id"]: p for p in people if not p.get("archived_at")}

    outside_ids = {r["outside_person_id"] for r in rows if r.get("outside_person_id")}
    outside = _rows_by_id(supabase, "outside_people", "id,name", outside_ids, "owner_id", user_id)

    wanted: dict[str, set[str]] = {k: set() for k in _SOURCE_KINDS}
    for r in rows:
        if r.get("source_type") in wanted and r.get("source_id"):
            wanted[r["source_type"]].add(r["source_id"])
    sources = {
        "one_on_one": _rows_by_id(supabase, "one_on_ones", "id,direct_report_id,scheduled_at,created_at",
                                  wanted["one_on_one"], "manager_id", user_id),
        "team_meeting": _rows_by_id(supabase, "team_meetings", "id,scheduled_at,org_unit_id",
                                    wanted["team_meeting"], "manager_id", user_id),
        "outside_meeting": _rows_by_id(supabase, "outside_meetings", "id,title,scheduled_at",
                                       wanted["outside_meeting"], "owner_id", user_id),
        "goal": _rows_by_id(supabase, "goals", "id,title", wanted["goal"], "owner_id", user_id),
        "project": _rows_by_id(supabase, "projects", "id,title", wanted["project"], "owner_id", user_id),
    }
    unit_ids = {m.get("org_unit_id") for m in sources["team_meeting"].values() if m.get("org_unit_id")}
    try:
        units = {u["id"]: u["name"] for u in
                 (supabase.table("org_units").select("id,name").in_("id", list(unit_ids)).execute().data if unit_ids else [])}
    except Exception:
        units = {}

    board = build_board(rows, reports=reports, outside=outside, sources=sources, units=units)
    return {
        "commitments": board,
        "people": [{"id": p["id"], "name": p["name"], "org_unit_id": p.get("org_unit_id")}
                   for p in sorted(reports.values(), key=lambda p: p["name"])],
        "recent_days": RECENT_DAYS,
    }
