"""Connected, permission-scoped evidence retrieval for Scribe.

This module deliberately exposes broad context capabilities rather than a
workflow per question: get_people_context for people, get_entity_context (C3)
for one goal, project or org unit. The model decides what it needs; this layer
guarantees that every returned record belongs to the authenticated manager.
"""
from collections import defaultdict
from datetime import date

from fastapi import HTTPException

from routes.direct_reports import fetch_role_expectations


MAX_PEOPLE_PER_CALL = 12


def _group(rows: list[dict], key: str) -> dict[str, list[dict]]:
    grouped: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        value = row.get(key)
        if value:
            grouped[str(value)].append(row)
    return grouped


def _tag(
    rows: list[dict],
    source_type: str,
    *,
    date_key: str = "created_at",
    visibility: str = "manager_record",
) -> list[dict]:
    tagged: list[dict] = []
    for row in rows:
        item = dict(row)
        item["_source"] = {
            "ref": f"{source_type}:{row.get('id')}",
            "type": source_type,
            "date": row.get(date_key) or row.get("created_at"),
            "visibility": visibility,
        }
        tagged.append(item)
    return tagged


def _select_for_people(
    supabase,
    table: str,
    columns: str,
    direct_report_ids: list[str],
    *,
    order: str = "created_at",
    limit: int = 240,
) -> list[dict]:
    # Keep enough rows for every requested person before the per-person slices
    # below are applied. One prolific record must not crowd everybody else out
    # of a team comparison merely because the database limit was global.
    query_limit = min(limit * len(direct_report_ids), 1000)
    return (
        supabase.table(table)
        .select(columns)
        .in_("direct_report_id", direct_report_ids)
        .order(order, desc=True)
        .limit(query_limit)
        .execute()
        .data
    )


def get_people_context(
    supabase,
    user_id: str,
    direct_report_ids: list[str],
) -> dict:
    """Return connected evidence for one or more manager-owned people.

    The query is intentionally broad so Scribe can answer open-ended questions.
    Rows are grouped by stable direct_report_id and carry source metadata. The
    caller should first use list_direct_reports to resolve names and ambiguity.
    """
    ids = list(dict.fromkeys(str(value) for value in direct_report_ids if value))
    if not ids:
        raise HTTPException(status_code=422, detail="At least one direct report is required")
    if len(ids) > MAX_PEOPLE_PER_CALL:
        raise HTTPException(
            status_code=422,
            detail=f"At most {MAX_PEOPLE_PER_CALL} people can be loaded at once",
        )

    reports = (
        supabase.table("direct_reports")
        .select(
            "id,name,role_title,notes,start_date,role_level_id,org_unit_id,"
            "one_on_one_cadence_days,archived_at,created_at"
        )
        .eq("manager_id", user_id)
        .in_("id", ids)
        .execute()
        .data
    )
    found = {str(row["id"]) for row in reports}
    missing = [value for value in ids if value not in found]
    if missing:
        raise HTTPException(status_code=404, detail="One or more direct reports were not found")

    org_unit_ids = list({str(r["org_unit_id"]) for r in reports if r.get("org_unit_id")})
    org_units = (
        supabase.table("org_units")
        .select("id,name,unit_type,parent_unit_id")
        .in_("id", org_unit_ids)
        .execute()
        .data
        if org_unit_ids else []
    )
    org_units_by_id = {str(row["id"]): row for row in org_units}

    expectations_by_role: dict[str, dict | None] = {}
    for role_level_id in {str(r["role_level_id"]) for r in reports if r.get("role_level_id")}:
        expectations_by_role[role_level_id] = fetch_role_expectations(supabase, role_level_id)

    one_on_ones = _select_for_people(
        supabase,
        "one_on_ones",
        "id,direct_report_id,scheduled_at,summary,notes,carry_forward_items,created_at",
        ids,
    )
    commitments = _select_for_people(
        supabase,
        "commitments",
        "id,direct_report_id,description,committed_by,source_type,source_id,due_date,"
        "status,completed_at,is_team_commitment,created_at",
        ids,
    )
    captures = _select_for_people(
        supabase,
        "dr_capture_notes",
        "id,direct_report_id,content,created_at",
        ids,
    )
    goals = _select_for_people(
        supabase,
        "goals",
        "id,direct_report_id,title,description,success_metrics,level,org_unit_id,status,due_date,created_at",
        ids,
    )
    projects = _select_for_people(
        supabase,
        "projects",
        "id,direct_report_id,title,description,goal_id,org_unit_id,status,due_date,created_at",
        ids,
    )
    assessments = _select_for_people(
        supabase,
        "assessments",
        "id,direct_report_id,level_ordinal,notes,source_type,source_id,created_at",
        ids,
    )
    skill_assessments = _select_for_people(
        supabase,
        "skill_assessments",
        "id,direct_report_id,skill_config_id,evaluation_point,notes,assessed_at",
        ids,
        order="assessed_at",
    )
    value_assessments = _select_for_people(
        supabase,
        "value_assessments",
        "id,direct_report_id,value_config_id,evaluation_point,notes,assessed_at",
        ids,
        order="assessed_at",
    )
    metric_entries = _select_for_people(
        supabase,
        "metric_entries",
        "id,direct_report_id,metric_config_id,value,period,recorded_at",
        ids,
        order="recorded_at",
    )
    time_off = _select_for_people(
        supabase,
        "time_off_entries",
        "id,direct_report_id,start_date,end_date,hours_per_day,type,notes,created_at",
        ids,
        order="start_date",
    )
    messages = _select_for_people(
        supabase,
        "team_messages",
        "id,direct_report_id,message,created_at",
        ids,
    )

    capacity_profiles = (
        supabase.table("capacity_profiles")
        .select("*")
        .in_("direct_report_id", ids)
        .execute()
        .data
    )

    development_plans = (
        supabase.table("development_plans")
        .select("*")
        .eq("manager_id", user_id)
        .in_("direct_report_id", ids)
        .execute()
        .data
    )
    plan_ids = [str(row["id"]) for row in development_plans]
    aspirations = (
        supabase.table("dev_plan_aspirations").select("*")
        .in_("development_plan_id", plan_ids).execute().data
        if plan_ids else []
    )
    opportunities = (
        supabase.table("dev_plan_opportunities").select("*")
        .in_("development_plan_id", plan_ids).order("created_at", desc=True).execute().data
        if plan_ids else []
    )
    training = (
        supabase.table("dev_plan_training").select("*")
        .in_("development_plan_id", plan_ids).order("created_at", desc=True).execute().data
        if plan_ids else []
    )
    manager_notes = (
        supabase.table("dev_plan_manager_notes").select("*")
        .in_("development_plan_id", plan_ids).order("created_at", desc=True).execute().data
        if plan_ids else []
    )

    goal_ids = [str(row["id"]) for row in goals]
    project_ids = [str(row["id"]) for row in projects]
    goal_check_ins = (
        supabase.table("check_ins").select("*")
        .in_("goal_id", goal_ids).order("created_at", desc=True)
        .limit(min(60 * len(ids), 720)).execute().data
        if goal_ids else []
    )
    project_check_ins = (
        supabase.table("check_ins").select("*")
        .in_("project_id", project_ids).order("created_at", desc=True)
        .limit(min(60 * len(ids), 720)).execute().data
        if project_ids else []
    )

    grouped = {
        "one_on_ones": _group(one_on_ones, "direct_report_id"),
        "commitments": _group(commitments, "direct_report_id"),
        "captures": _group(captures, "direct_report_id"),
        "goals": _group(goals, "direct_report_id"),
        "projects": _group(projects, "direct_report_id"),
        "assessments": _group(assessments, "direct_report_id"),
        "skill_assessments": _group(skill_assessments, "direct_report_id"),
        "value_assessments": _group(value_assessments, "direct_report_id"),
        "metric_entries": _group(metric_entries, "direct_report_id"),
        "time_off": _group(time_off, "direct_report_id"),
        "messages": _group(messages, "direct_report_id"),
        "capacity_profiles": _group(capacity_profiles, "direct_report_id"),
        "development_plans": _group(development_plans, "direct_report_id"),
    }
    aspirations_by_plan = _group(aspirations, "development_plan_id")
    opportunities_by_plan = _group(opportunities, "development_plan_id")
    training_by_plan = _group(training, "development_plan_id")
    manager_notes_by_plan = _group(manager_notes, "development_plan_id")

    goal_owner = {str(row["id"]): str(row["direct_report_id"]) for row in goals}
    project_owner = {str(row["id"]): str(row["direct_report_id"]) for row in projects}
    goal_check_ins_by_person: dict[str, list[dict]] = defaultdict(list)
    project_check_ins_by_person: dict[str, list[dict]] = defaultdict(list)
    for row in goal_check_ins:
        owner = goal_owner.get(str(row.get("goal_id")))
        if owner:
            goal_check_ins_by_person[owner].append(row)
    for row in project_check_ins:
        owner = project_owner.get(str(row.get("project_id")))
        if owner:
            project_check_ins_by_person[owner].append(row)

    contexts: list[dict] = []
    for report in reports:
        report_id = str(report["id"])
        report_record = dict(report)
        # The free-form profile note is manager-private evidence. Keep it out of
        # the general identity object so downstream answers cannot accidentally
        # imply that it has the same visibility as name, role, or start date.
        profile_private_note = report_record.pop("notes", None)
        report_record["_source"] = {
            "ref": f"direct_report:{report_id}",
            "type": "direct_report",
            "date": report.get("created_at"),
            "visibility": "manager_record",
        }
        role_level_id = report.get("role_level_id")
        plans = grouped["development_plans"].get(report_id, [])
        plan = plans[0] if plans else None
        plan_id = str(plan["id"]) if plan else None

        contexts.append({
            "person": report_record,
            "profile_private_note": (
                {
                    "content": profile_private_note,
                    "_source": {
                        "ref": f"direct_report_note:{report_id}",
                        "type": "direct_report_note",
                        "date": report.get("created_at"),
                        "visibility": "manager_private",
                    },
                }
                if profile_private_note else None
            ),
            "org_unit": org_units_by_id.get(str(report.get("org_unit_id"))),
            "role_expectations": expectations_by_role.get(str(role_level_id)) if role_level_id else None,
            "one_on_ones": _tag(
                grouped["one_on_ones"].get(report_id, [])[:12],
                "one_on_one",
                date_key="scheduled_at",
                visibility="manager_private",
            ),
            "commitments": _tag(grouped["commitments"].get(report_id, [])[:40], "commitment"),
            "capture_notes": _tag(
                grouped["captures"].get(report_id, [])[:20],
                "capture_note",
                visibility="manager_private",
            ),
            "goals": _tag(grouped["goals"].get(report_id, [])[:30], "goal"),
            "projects": _tag(grouped["projects"].get(report_id, [])[:30], "project"),
            "goal_check_ins": _tag(goal_check_ins_by_person.get(report_id, [])[:60], "goal_check_in"),
            "project_check_ins": _tag(project_check_ins_by_person.get(report_id, [])[:60], "project_check_in"),
            "overall_assessments": _tag(grouped["assessments"].get(report_id, [])[:12], "assessment"),
            "skill_assessments": _tag(
                grouped["skill_assessments"].get(report_id, [])[:60],
                "skill_assessment",
                date_key="assessed_at",
            ),
            "value_assessments": _tag(
                grouped["value_assessments"].get(report_id, [])[:60],
                "value_assessment",
                date_key="assessed_at",
            ),
            "metric_entries": _tag(
                grouped["metric_entries"].get(report_id, [])[:60],
                "metric_entry",
                date_key="recorded_at",
            ),
            "development": {
                "plan": plan,
                "aspirations": aspirations_by_plan.get(plan_id, []) if plan_id else [],
                "opportunities": opportunities_by_plan.get(plan_id, []) if plan_id else [],
                "training": training_by_plan.get(plan_id, []) if plan_id else [],
                "manager_private_notes": _tag(
                    manager_notes_by_plan.get(plan_id, []) if plan_id else [],
                    "development_manager_note",
                    visibility="manager_private",
                ),
            },
            "capacity_profiles": grouped["capacity_profiles"].get(report_id, []),
            "time_off": _tag(grouped["time_off"].get(report_id, [])[:30], "time_off", date_key="start_date"),
            "manager_messages": _tag(grouped["messages"].get(report_id, [])[:30], "team_message"),
        })

    return {
        "scope": {
            "manager_id": user_id,
            "direct_report_ids": ids,
            "people_count": len(contexts),
        },
        "people": contexts,
    }


# ---------------------------------------------------------------------------
# C3 — goal, project and org-unit context packets
# ---------------------------------------------------------------------------
#
# Scope is today's rule, deliberately unchanged: a goal or project must be owned
# by the manager; an org unit's own row is readable org-wide (as list_org_units
# is), but everything inside it is limited to the manager's own records. When
# DEPARTMENT_ROLLUP phase 1 lands, _unit_scope_note and the owner filters here
# are the one place to switch to the shared scope definition.

ENTITY_TYPES = ("goal", "project", "org_unit")

_GOAL_COLUMNS = (
    "id,title,description,success_metrics,level,org_unit_id,direct_report_id,"
    "parent_goal_id,status,due_date,measure_label,measure_format,measure_unit,"
    "measure_target,measure_direction,created_at"
)
_GOAL_BRIEF_COLUMNS = "id,title,level,org_unit_id,direct_report_id,parent_goal_id,status,due_date"
_PROJECT_COLUMNS = "id,title,description,goal_id,org_unit_id,direct_report_id,status,due_date,created_at"
_PROJECT_BRIEF_COLUMNS = "id,title,goal_id,org_unit_id,direct_report_id,status,due_date"
_CHECK_IN_COLUMNS = (
    "id,goal_id,project_id,status,progress,note,measured_value,source_type,source_id,created_at"
)
_COMMITMENT_COLUMNS = (
    "id,description,direct_report_id,org_unit_id,committed_by,source_type,source_id,"
    "due_date,status,completed_at,is_team_commitment,created_at"
)

MAX_CHECK_INS = 20
MAX_COMMITMENTS = 40
MAX_UNIT_RECORDS = 40
MAX_TEAM_MEETINGS = 6
MAX_UNITS_IN_SUBTREE = 25
TIME_OFF_WINDOW_DAYS = 30


def _not_found(entity_type: str) -> HTTPException:
    return HTTPException(status_code=404, detail=f"That {entity_type.replace('_', ' ')} was not found")


def _latest_check_ins(supabase, user_id: str, column: str, ids: list[str]) -> dict[str, dict]:
    """Most recent check-in per goal or project id."""
    if not ids:
        return {}
    rows = (
        supabase.table("check_ins")
        .select(_CHECK_IN_COLUMNS)
        .eq("owner_id", user_id)
        .in_(column, ids)
        .order("created_at", desc=True)
        .limit(min(10 * len(ids), 400))
        .execute()
        .data
    )
    latest: dict[str, dict] = {}
    for row in rows:
        key = str(row.get(column))
        if key not in latest:
            latest[key] = row
    return latest


def _people_by_id(supabase, user_id: str, ids: set[str]) -> dict[str, dict]:
    ids = {value for value in ids if value}
    if not ids:
        return {}
    rows = (
        supabase.table("direct_reports")
        .select("id,name,role_title,org_unit_id,archived_at")
        .eq("manager_id", user_id)
        .in_("id", sorted(ids))
        .execute()
        .data
    )
    return {str(row["id"]): row for row in rows}


def _units_by_id(supabase, ids: set[str]) -> dict[str, dict]:
    ids = {value for value in ids if value}
    if not ids:
        return {}
    rows = (
        supabase.table("org_units")
        .select("id,name,unit_type,parent_unit_id")
        .in_("id", sorted(ids))
        .execute()
        .data
    )
    return {str(row["id"]): row for row in rows}


def _with_latest(rows: list[dict], latest: dict[str, dict], source_type: str) -> list[dict]:
    tagged = _tag(rows, source_type)
    for row in tagged:
        check_in = latest.get(str(row["id"]))
        row["latest_check_in"] = (
            _tag([check_in], f"{source_type}_check_in")[0] if check_in else None
        )
    return tagged


def _measure(goal: dict, check_ins: list[dict]) -> dict | None:
    """The goal's numeric measure and its latest reading, reported as data."""
    if not goal.get("measure_format"):
        return None
    readings = [row for row in check_ins if row.get("measured_value") is not None]
    latest = readings[0] if readings else None
    return {
        "label": goal.get("measure_label"),
        "format": goal.get("measure_format"),
        "unit": goal.get("measure_unit"),
        "target": goal.get("measure_target"),
        "direction": goal.get("measure_direction"),
        "latest_reading": latest.get("measured_value") if latest else None,
        "latest_reading_at": latest.get("created_at") if latest else None,
        "readings_recorded": len(readings),
    }


def _sourced_commitments(
    supabase, user_id: str, source_type: str, source_ids: list[str]
) -> list[dict]:
    if not source_ids:
        return []
    return (
        supabase.table("commitments")
        .select(_COMMITMENT_COLUMNS)
        .eq("owner_id", user_id)
        .eq("source_type", source_type)
        .in_("source_id", source_ids)
        .order("created_at", desc=True)
        .limit(MAX_COMMITMENTS)
        .execute()
        .data
    )


def _open_first(rows: list[dict]) -> list[dict]:
    # Open work first (soonest due first), then the most recently closed.
    open_rows = sorted(
        (row for row in rows if row.get("status") == "open"),
        key=lambda row: str(row.get("due_date") or "9999-12-31"),
    )
    closed = [row for row in rows if row.get("status") != "open"]
    return (open_rows + closed)[:MAX_COMMITMENTS]


def _goal_context(supabase, user_id: str, goal_id: str) -> dict:
    rows = (
        supabase.table("goals").select(_GOAL_COLUMNS)
        .eq("owner_id", user_id).eq("id", goal_id).limit(1).execute().data
    )
    if not rows:
        raise _not_found("goal")
    goal = rows[0]

    parent = (
        supabase.table("goals").select(_GOAL_BRIEF_COLUMNS)
        .eq("owner_id", user_id).eq("id", str(goal["parent_goal_id"])).limit(1).execute().data
        if goal.get("parent_goal_id") else []
    )
    children = (
        supabase.table("goals").select(_GOAL_BRIEF_COLUMNS)
        .eq("owner_id", user_id).eq("parent_goal_id", goal_id)
        .order("title").limit(MAX_UNIT_RECORDS).execute().data
    )
    projects = (
        supabase.table("projects").select(_PROJECT_BRIEF_COLUMNS)
        .eq("owner_id", user_id).eq("goal_id", goal_id)
        .order("title").limit(MAX_UNIT_RECORDS).execute().data
    )
    check_ins = (
        supabase.table("check_ins").select(_CHECK_IN_COLUMNS)
        .eq("owner_id", user_id).eq("goal_id", goal_id)
        .order("created_at", desc=True).limit(MAX_CHECK_INS).execute().data
    )
    child_ids = [str(row["id"]) for row in children]
    project_ids = [str(row["id"]) for row in projects]
    latest_goal = _latest_check_ins(supabase, user_id, "goal_id", child_ids)
    latest_project = _latest_check_ins(supabase, user_id, "project_id", project_ids)
    commitments = (
        _sourced_commitments(supabase, user_id, "goal", [goal_id])
        + _sourced_commitments(supabase, user_id, "project", project_ids)
    )

    related = [goal, *parent, *children, *projects]
    people = _people_by_id(supabase, user_id, {str(r.get("direct_report_id") or "") for r in related})
    units = _units_by_id(supabase, {str(r.get("org_unit_id") or "") for r in related})

    record = _tag([goal], "goal")[0]
    return {
        "entity_type": "goal",
        "goal": record,
        "owner_person": people.get(str(goal.get("direct_report_id"))),
        "org_unit": units.get(str(goal.get("org_unit_id"))),
        "measure": _measure(goal, check_ins),
        "parent_goal": _tag(parent, "goal")[0] if parent else None,
        "child_goals": _with_latest(children, latest_goal, "goal"),
        "linked_projects": _with_latest(projects, latest_project, "project"),
        "check_ins": _tag(check_ins, "goal_check_in"),
        "commitments": _tag(_open_first(commitments), "commitment"),
        "related_people": list(people.values()),
        "related_org_units": list(units.values()),
    }


def _project_context(supabase, user_id: str, project_id: str) -> dict:
    rows = (
        supabase.table("projects").select(_PROJECT_COLUMNS)
        .eq("owner_id", user_id).eq("id", project_id).limit(1).execute().data
    )
    if not rows:
        raise _not_found("project")
    project = rows[0]

    goal_rows = (
        supabase.table("goals").select(_GOAL_COLUMNS)
        .eq("owner_id", user_id).eq("id", str(project["goal_id"])).limit(1).execute().data
        if project.get("goal_id") else []
    )
    goal = goal_rows[0] if goal_rows else None
    goal_check_ins = (
        supabase.table("check_ins").select(_CHECK_IN_COLUMNS)
        .eq("owner_id", user_id).eq("goal_id", str(goal["id"]))
        .order("created_at", desc=True).limit(MAX_CHECK_INS).execute().data
        if goal else []
    )
    check_ins = (
        supabase.table("check_ins").select(_CHECK_IN_COLUMNS)
        .eq("owner_id", user_id).eq("project_id", project_id)
        .order("created_at", desc=True).limit(MAX_CHECK_INS).execute().data
    )
    commitments = _sourced_commitments(supabase, user_id, "project", [project_id])

    related = [project, *([goal] if goal else [])]
    people = _people_by_id(supabase, user_id, {str(r.get("direct_report_id") or "") for r in related})
    units = _units_by_id(supabase, {str(r.get("org_unit_id") or "") for r in related})

    linked_goal = None
    if goal:
        linked_goal = {
            **{key: goal.get(key) for key in ("id", "title", "level", "status", "due_date", "org_unit_id")},
            "measure": _measure(goal, goal_check_ins),
            "latest_check_in": _tag(goal_check_ins[:1], "goal_check_in")[0] if goal_check_ins else None,
            "_source": {"ref": f"goal:{goal['id']}", "type": "goal", "date": goal.get("created_at"),
                        "visibility": "manager_record"},
        }
    return {
        "entity_type": "project",
        "project": _tag([project], "project")[0],
        "owner_person": people.get(str(project.get("direct_report_id"))),
        "org_unit": units.get(str(project.get("org_unit_id"))),
        "linked_goal": linked_goal,
        "check_ins": _tag(check_ins, "project_check_in"),
        "commitments": _tag(_open_first(commitments), "commitment"),
        "related_people": list(people.values()),
        "related_org_units": list(units.values()),
    }


def _subtree(all_units: list[dict], root_id: str) -> list[dict]:
    children: dict[str, list[dict]] = defaultdict(list)
    for unit in all_units:
        if unit.get("parent_unit_id"):
            children[str(unit["parent_unit_id"])].append(unit)
    by_id = {str(unit["id"]): unit for unit in all_units}
    ordered: list[dict] = []
    queue = [root_id]
    seen: set[str] = set()
    while queue and len(ordered) < MAX_UNITS_IN_SUBTREE:
        current = queue.pop(0)
        if current in seen or current not in by_id:
            continue
        seen.add(current)
        ordered.append(by_id[current])
        queue.extend(str(child["id"]) for child in sorted(children[current], key=lambda u: u.get("name") or ""))
    return ordered


def _unit_scope_note() -> str:
    return (
        "Only this manager's own records are included: their direct reports, goals, "
        "projects, commitments and team meetings in this unit and the units under it. "
        "Teams or people run by other managers are not visible here, so a thin packet "
        "means thin evidence, not a quiet team."
    )


def _org_unit_context(supabase, user_id: str, unit_id: str, today: date) -> dict:
    all_units = (
        supabase.table("org_units")
        .select("id,name,unit_type,parent_unit_id,leader_user_id")
        .order("name")
        .execute()
        .data
    )
    by_id = {str(unit["id"]): unit for unit in all_units}
    unit = by_id.get(unit_id)
    if not unit:
        raise _not_found("org_unit")
    subtree = _subtree(all_units, unit_id)
    unit_ids = [str(row["id"]) for row in subtree]
    parent = by_id.get(str(unit.get("parent_unit_id"))) if unit.get("parent_unit_id") else None

    people = (
        supabase.table("direct_reports")
        .select("id,name,role_title,org_unit_id,start_date")
        .eq("manager_id", user_id)
        .is_("archived_at", "null")
        .in_("org_unit_id", unit_ids)
        .order("name")
        .execute()
        .data
    )
    person_ids = [str(row["id"]) for row in people]

    # Compact roster signals only. 1:1 notes, private notes, assessments and
    # development stay out; Scribe calls get_people_context for depth.
    meetings = (
        supabase.table("one_on_ones")
        .select("id,direct_report_id,scheduled_at")
        .in_("direct_report_id", person_ids)
        .order("scheduled_at", desc=True)
        .limit(min(40 * len(person_ids), 1000))
        .execute()
        .data
        if person_ids else []
    )
    person_commitments = (
        supabase.table("commitments")
        .select("id,direct_report_id,status,due_date")
        .in_("direct_report_id", person_ids)
        .eq("status", "open")
        .limit(1000)
        .execute()
        .data
        if person_ids else []
    )
    today_iso = today.isoformat()
    last_meeting: dict[str, str] = {}
    next_meeting: dict[str, str] = {}
    for row in meetings:
        key = str(row.get("direct_report_id"))
        when = str(row.get("scheduled_at") or "")[:10]
        if not when:
            continue
        if when <= today_iso:
            last_meeting.setdefault(key, when)
        elif key not in next_meeting or when < next_meeting[key]:
            next_meeting[key] = when
    open_counts: dict[str, int] = defaultdict(int)
    overdue_counts: dict[str, int] = defaultdict(int)
    for row in person_commitments:
        key = str(row.get("direct_report_id"))
        open_counts[key] += 1
        if row.get("due_date") and str(row["due_date"])[:10] < today_iso:
            overdue_counts[key] += 1
    roster = []
    for person in people:
        key = str(person["id"])
        roster.append({
            **{field: person.get(field) for field in ("id", "name", "role_title", "org_unit_id", "start_date")},
            "last_one_on_one_date": last_meeting.get(key),
            "next_one_on_one_date": next_meeting.get(key),
            "open_commitments": open_counts.get(key, 0),
            "overdue_commitments": overdue_counts.get(key, 0),
            "_source": {"ref": f"direct_report:{key}", "type": "direct_report",
                        "date": person.get("start_date"), "visibility": "manager_record"},
        })

    goals = (
        supabase.table("goals").select(_GOAL_BRIEF_COLUMNS)
        .eq("owner_id", user_id).in_("org_unit_id", unit_ids)
        .order("title").limit(MAX_UNIT_RECORDS).execute().data
    )
    projects = (
        supabase.table("projects").select(_PROJECT_BRIEF_COLUMNS)
        .eq("owner_id", user_id).in_("org_unit_id", unit_ids)
        .order("title").limit(MAX_UNIT_RECORDS).execute().data
    )
    latest_goal = _latest_check_ins(supabase, user_id, "goal_id", [str(r["id"]) for r in goals])
    latest_project = _latest_check_ins(supabase, user_id, "project_id", [str(r["id"]) for r in projects])

    team_meetings = (
        supabase.table("team_meetings")
        .select("id,org_unit_id,scheduled_at,summary,logged_at")
        .eq("manager_id", user_id)
        .in_("org_unit_id", unit_ids)
        .order("scheduled_at", desc=True)
        .limit(MAX_TEAM_MEETINGS)
        .execute()
        .data
    )
    meeting_ids = [str(row["id"]) for row in team_meetings]
    agenda = (
        supabase.table("team_meeting_agenda_items")
        .select("id,meeting_id,position,item,covered")
        .eq("manager_id", user_id)
        .in_("meeting_id", meeting_ids)
        .order("position")
        .execute()
        .data
        if meeting_ids else []
    )
    agenda_by_meeting = _group(agenda, "meeting_id")
    # Summary and agenda only; raw notes never leave the meeting screen.
    meeting_records = _tag(
        [{field: row.get(field) for field in ("id", "org_unit_id", "scheduled_at", "summary", "logged_at")}
         for row in team_meetings],
        "team_meeting",
        date_key="scheduled_at",
    )
    for row in meeting_records:
        row["agenda_items"] = [
            {"item": item.get("item"), "covered": item.get("covered")}
            for item in agenda_by_meeting.get(str(row["id"]), [])
        ]

    team_commitments = (
        supabase.table("commitments").select(_COMMITMENT_COLUMNS)
        .eq("owner_id", user_id).eq("is_team_commitment", True)
        .in_("org_unit_id", unit_ids)
        .order("created_at", desc=True).limit(MAX_COMMITMENTS * 2).execute().data
    )
    callouts = (
        supabase.table("team_callouts")
        .select("id,org_unit_id,message,updated_at")
        .eq("manager_id", user_id)
        .in_("org_unit_id", unit_ids)
        .execute()
        .data
    )
    time_off_rows = (
        supabase.table("time_off_entries")
        .select("id,direct_report_id,start_date,end_date,type,hours_per_day")
        .in_("direct_report_id", person_ids)
        .order("start_date")
        .limit(200)
        .execute()
        .data
        if person_ids else []
    )
    window_end = date.fromordinal(today.toordinal() + TIME_OFF_WINDOW_DAYS).isoformat()
    upcoming_time_off = [
        row for row in time_off_rows
        if str(row.get("end_date") or "")[:10] >= today_iso
        and str(row.get("start_date") or "")[:10] <= window_end
    ]

    return {
        "entity_type": "org_unit",
        "org_unit": {**unit, "_source": {"ref": f"org_unit:{unit_id}", "type": "org_unit",
                                          "date": None, "visibility": "shared_org_context"}},
        "parent_unit": parent,
        "units_in_scope": subtree,
        "coverage": _unit_scope_note(),
        "roster": roster,
        "goals": _with_latest(goals, latest_goal, "goal"),
        "projects": _with_latest(projects, latest_project, "project"),
        "team_meetings": meeting_records,
        "team_commitments": _tag(_open_first(team_commitments), "commitment"),
        "must_knows": _tag(
            [row for row in callouts if (row.get("message") or "").strip()],
            "team_callout",
            date_key="updated_at",
        ),
        "upcoming_time_off": _tag(upcoming_time_off, "time_off", date_key="start_date"),
    }


def get_entity_context(
    supabase,
    user_id: str,
    entity_type: str,
    entity_id: str,
    *,
    today: date | None = None,
) -> dict:
    """Return one connected, manager-scoped packet for a goal, project or org unit.

    Resolve the id first with list_goals, list_projects, list_org_units or
    search_workspace. A record outside the manager's scope is a 404, never a
    partial packet.
    """
    kind = str(entity_type or "").strip()
    record_id = str(entity_id or "").strip()
    if kind not in ENTITY_TYPES:
        raise HTTPException(status_code=422, detail="entity_type must be goal, project or org_unit")
    if not record_id:
        raise HTTPException(status_code=422, detail="entity_id is required")
    if kind == "goal":
        return _goal_context(supabase, user_id, record_id)
    if kind == "project":
        return _project_context(supabase, user_id, record_id)
    return _org_unit_context(supabase, user_id, record_id, today or date.today())
