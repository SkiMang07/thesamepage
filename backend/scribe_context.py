"""Connected, permission-scoped evidence retrieval for Scribe.

This module deliberately exposes one broad person/team-context capability rather
than a workflow per question. The model decides which people it needs; this
layer guarantees that every returned record belongs to one of those people and
to the authenticated manager.
"""
from collections import defaultdict

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
