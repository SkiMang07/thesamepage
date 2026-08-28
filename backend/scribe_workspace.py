"""Authorization-safe, query-aware workspace retrieval for Scribe.

The boundary is deterministic: the authenticated manager's ownership filters,
stable person/org relationships, confirmed document scopes, source metadata,
and compact result limits are all enforced here. Relevance ranking is a small
lexical heuristic over bounded relational rows plus the Context Engine's
existing two-tier document retrieval. The model remains responsible for the
open-ended reasoning in the middle.
"""
from datetime import date, datetime, timezone
from typing import Any

from fastapi import HTTPException

import context_engine
from routes.direct_reports import fetch_role_expectations


MAX_RESULTS = 12
MAX_SCOPE_IDS = 12
MAX_ACTIVE_REPORTS = 120
MAX_ROWS_PER_SOURCE = 240

SOURCE_TYPES = {
    "goal",
    "project",
    "check_in",
    "commitment",
    "person",
    "org_unit",
    "role_expectation",
    "one_on_one",
    "private_note",
    "company_document",
}


def _parse_date(value: Any, field_name: str) -> date | None:
    if value in (None, ""):
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"{field_name} must be YYYY-MM-DD") from exc


def _normalise_time_range(raw: dict | None) -> tuple[date | None, date | None]:
    value = raw or {}
    start = _parse_date(value.get("start"), "time_range.start")
    end = _parse_date(value.get("end"), "time_range.end")
    if start and end and start > end:
        raise HTTPException(status_code=422, detail="time_range.start must not be after time_range.end")
    return start, end


def _bounded_ids(values: Any, label: str) -> list[str]:
    ids = list(dict.fromkeys(str(value) for value in (values or []) if value))
    if len(ids) > MAX_SCOPE_IDS:
        raise HTTPException(status_code=422, detail=f"At most {MAX_SCOPE_IDS} {label} may be searched")
    return ids


def _row_date(row: dict, *keys: str) -> str | None:
    for key in keys:
        if row.get(key):
            return str(row[key])
    return None


def _date_in_range(value: str | None, start: date | None, end: date | None) -> bool:
    if not start and not end:
        return True
    if not value:
        return False
    try:
        parsed = date.fromisoformat(str(value)[:10])
    except ValueError:
        return False
    return (not start or parsed >= start) and (not end or parsed <= end)


def _age_metadata(value: str | None, today: date) -> dict:
    if not value:
        return {"age_days": None, "is_stale": None}
    try:
        age = (today - date.fromisoformat(str(value)[:10])).days
    except ValueError:
        return {"age_days": None, "is_stale": None}
    return {"age_days": max(age, 0), "is_stale": age > 180}


def _subject(
    *,
    org_id: str | None,
    report: dict | None = None,
    org_unit: dict | None = None,
    org_unit_ids: list[str | None] | None = None,
    org_scope_labels: list[str] | None = None,
) -> dict:
    return {
        "organization_id": org_id,
        "direct_report_id": str(report["id"]) if report else None,
        "person_name": report.get("name") if report else None,
        "org_unit_id": (
            str(org_unit["id"])
            if org_unit
            else str(report["org_unit_id"])
            if report and report.get("org_unit_id")
            else None
        ),
        "org_unit_name": org_unit.get("name") if org_unit else None,
        "org_unit_ids": org_unit_ids,
        "org_scope_labels": org_scope_labels,
    }


def _query_rows(
    supabase,
    table: str,
    columns: str,
    ownership_column: str,
    user_id: str,
    *,
    report_ids: list[str] | None = None,
    org_unit_ids: list[str] | None = None,
    order: str = "created_at",
) -> list[dict]:
    query = supabase.table(table).select(columns).eq(ownership_column, user_id)
    if report_ids is not None:
        if not report_ids:
            return []
        query = query.in_("direct_report_id", report_ids)
    elif org_unit_ids:
        query = query.in_("org_unit_id", org_unit_ids)
    return query.order(order, desc=True).limit(MAX_ROWS_PER_SOURCE).execute().data


def search_workspace(
    supabase,
    user_id: str,
    query: str,
    *,
    scope: dict | None = None,
    source_types: list[str] | None = None,
    time_range: dict | None = None,
    today: date | None = None,
) -> dict:
    """Return compact, ranked evidence from the manager's accessible workspace."""
    clean_query = " ".join((query or "").split())[:500]
    if not clean_query:
        raise HTTPException(status_code=422, detail="search_workspace requires a query")
    requested_types = set(source_types or SOURCE_TYPES)
    unsupported = requested_types - SOURCE_TYPES
    if unsupported:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported source types: {', '.join(sorted(unsupported))}",
        )

    scope = scope or {}
    requested_report_ids = _bounded_ids(scope.get("direct_report_ids"), "direct reports")
    requested_org_unit_ids = _bounded_ids(scope.get("org_unit_ids"), "org units")
    range_start, range_end = _normalise_time_range(time_range)
    today = today or date.today()
    retrieved_at = datetime.now(timezone.utc).isoformat()

    user_rows = (
        supabase.table("users")
        .select("id,org_id")
        .eq("id", user_id)
        .limit(1)
        .execute()
        .data
    )
    org_id = str(user_rows[0]["org_id"]) if user_rows and user_rows[0].get("org_id") else None

    reports_query = (
        supabase.table("direct_reports")
        .select(
            "id,name,role_title,notes,start_date,role_level_id,org_unit_id,"
            "archived_at,created_at"
        )
        .eq("manager_id", user_id)
        .is_("archived_at", "null")
    )
    if requested_report_ids:
        reports_query = reports_query.in_("id", requested_report_ids)
    reports = reports_query.order("name").limit(MAX_ACTIVE_REPORTS).execute().data
    reports_by_id = {str(row["id"]): row for row in reports}
    if requested_report_ids and set(reports_by_id) != set(requested_report_ids):
        raise HTTPException(status_code=404, detail="One or more direct reports were not found")

    org_units: list[dict] = []
    if org_id:
        units_query = (
            supabase.table("org_units")
            .select("id,name,unit_type,parent_unit_id,leader_user_id,created_at")
            .eq("org_id", org_id)
        )
        if requested_org_unit_ids:
            units_query = units_query.in_("id", requested_org_unit_ids)
        org_units = units_query.order("name").limit(MAX_ROWS_PER_SOURCE).execute().data
    org_units_by_id = {str(row["id"]): row for row in org_units}
    if requested_org_unit_ids and set(org_units_by_id) != set(requested_org_unit_ids):
        raise HTTPException(status_code=404, detail="One or more org units were not found")

    if requested_report_ids and requested_org_unit_ids:
        mismatched = [
            report_id for report_id in requested_report_ids
            if str(reports_by_id[report_id].get("org_unit_id")) not in requested_org_unit_ids
        ]
        if mismatched:
            raise HTTPException(
                status_code=422,
                detail="Direct report scope does not belong to the requested org-unit scope",
            )

    effective_report_ids = (
        requested_report_ids
        if requested_report_ids
        else [
            str(row["id"]) for row in reports
            if not requested_org_unit_ids
            or str(row.get("org_unit_id")) in requested_org_unit_ids
        ]
    )
    # If no explicit unit scope was requested, fetch labels for the active
    # reports' units. These are org-scoped and explicitly constrained to the
    # authenticated user's org even though RLS already applies.
    report_unit_ids = sorted({
        str(reports_by_id[report_id]["org_unit_id"])
        for report_id in effective_report_ids
        if reports_by_id.get(report_id, {}).get("org_unit_id")
    })
    missing_unit_ids = [value for value in report_unit_ids if value not in org_units_by_id]
    if org_id and missing_unit_ids:
        unit_rows = (
            supabase.table("org_units")
            .select("id,name,unit_type,parent_unit_id,leader_user_id,created_at")
            .eq("org_id", org_id)
            .in_("id", missing_unit_ids)
            .execute()
            .data
        )
        org_units_by_id.update({str(row["id"]): row for row in unit_rows})

    candidates: list[dict] = []

    def add_result(
        *,
        source_id: str,
        source_type: str,
        subject: dict,
        relevant_date: str | None,
        visibility: str,
        label: str,
        search_text: str,
        excerpt: str | None = None,
        fact: dict | None = None,
        route: str | None = None,
        score_boost: float = 0.0,
    ) -> None:
        if source_type not in requested_types:
            return
        if not _date_in_range(relevant_date, range_start, range_end):
            return
        relevance = context_engine._lexical_relevance(clean_query, search_text)
        if relevance <= 0:
            return
        candidates.append({
            "source_ref": f"{source_type}:{source_id}",
            "source_id": str(source_id),
            "source_type": source_type,
            "subject": subject,
            "relevant_date": relevant_date,
            "visibility": visibility,
            "label": label,
            "excerpt": context_engine._compact_excerpt(excerpt, clean_query) if excerpt else None,
            "fact": fact,
            "route": route,
            "retrieved_at": retrieved_at,
            "_score": relevance + score_boost,
            **_age_metadata(relevant_date, today),
        })

    if "person" in requested_types or "private_note" in requested_types:
        for report_id in effective_report_ids:
            report = reports_by_id[report_id]
            unit = org_units_by_id.get(str(report.get("org_unit_id")))
            person_subject = _subject(org_id=org_id, report=report, org_unit=unit)
            add_result(
                source_id=report_id,
                source_type="person",
                subject=person_subject,
                relevant_date=_row_date(report, "start_date", "created_at"),
                visibility="manager_record",
                label=report.get("name") or "Direct report",
                search_text=" ".join(str(report.get(key) or "") for key in ("name", "role_title", "start_date")),
                fact={"name": report.get("name"), "role_title": report.get("role_title"), "start_date": report.get("start_date")},
                route=f"/app/reports/{report_id}",
            )
            if report.get("notes"):
                add_result(
                    source_id=report_id,
                    source_type="private_note",
                    subject=person_subject,
                    relevant_date=_row_date(report, "created_at"),
                    visibility="manager_private",
                    label=f"Private profile note for {report.get('name')}",
                    search_text=str(report["notes"]),
                    excerpt=str(report["notes"]),
                    route=f"/app/reports/{report_id}",
                )

    if "org_unit" in requested_types:
        searchable_units = org_units if requested_org_unit_ids else list(org_units_by_id.values())
        for unit in searchable_units:
            add_result(
                source_id=str(unit["id"]),
                source_type="org_unit",
                subject=_subject(org_id=org_id, org_unit=unit),
                relevant_date=_row_date(unit, "created_at"),
                visibility="shared_org_context",
                label=unit.get("name") or "Org unit",
                search_text=" ".join(str(unit.get(key) or "") for key in ("name", "unit_type")),
                fact={
                    "name": unit.get("name"),
                    "unit_type": unit.get("unit_type"),
                    "parent_unit_id": unit.get("parent_unit_id"),
                    "leader_user_id": unit.get("leader_user_id"),
                },
                route="/app/org",
            )

    records_report_filter = effective_report_ids if requested_report_ids else None
    records_unit_filter = requested_org_unit_ids or None
    goals = _query_rows(
        supabase,
        "goals",
        "id,title,description,success_metrics,level,status,due_date,direct_report_id,org_unit_id,created_at",
        "owner_id",
        user_id,
        report_ids=records_report_filter,
        org_unit_ids=records_unit_filter,
    ) if {"goal", "check_in"} & requested_types else []
    projects = _query_rows(
        supabase,
        "projects",
        "id,title,description,goal_id,status,due_date,direct_report_id,org_unit_id,created_at",
        "owner_id",
        user_id,
        report_ids=records_report_filter,
        org_unit_ids=records_unit_filter,
    ) if {"project", "check_in"} & requested_types else []

    def record_subject(row: dict) -> dict:
        report = reports_by_id.get(str(row.get("direct_report_id")))
        unit = org_units_by_id.get(str(row.get("org_unit_id")))
        if not unit and report:
            unit = org_units_by_id.get(str(report.get("org_unit_id")))
        return _subject(org_id=org_id, report=report, org_unit=unit)

    for goal in goals:
        add_result(
            source_id=str(goal["id"]),
            source_type="goal",
            subject=record_subject(goal),
            relevant_date=_row_date(goal, "due_date", "created_at"),
            visibility="manager_record",
            label=goal.get("title") or "Goal",
            search_text=" ".join(str(goal.get(key) or "") for key in ("title", "description", "success_metrics", "level", "status", "due_date")),
            fact={key: goal.get(key) for key in ("title", "level", "status", "due_date", "success_metrics")},
            route="/app/goals",
            score_boost=0.5 if goal.get("status") == "at_risk" else 0,
        )
    for project in projects:
        add_result(
            source_id=str(project["id"]),
            source_type="project",
            subject=record_subject(project),
            relevant_date=_row_date(project, "due_date", "created_at"),
            visibility="manager_record",
            label=project.get("title") or "Project",
            search_text=" ".join(str(project.get(key) or "") for key in ("title", "description", "status", "due_date")),
            fact={key: project.get(key) for key in ("title", "status", "due_date", "goal_id")},
            route="/app/projects",
            score_boost=0.5 if project.get("status") == "at_risk" else 0,
        )

    if "commitment" in requested_types:
        commitments = _query_rows(
            supabase,
            "commitments",
            "id,title,description,direct_report_id,committed_by,source_type,source_id,due_date,status,completed_at,is_team_commitment,created_at",
            "owner_id",
            user_id,
            report_ids=effective_report_ids,
        )
        for commitment in commitments:
            report = reports_by_id.get(str(commitment.get("direct_report_id")))
            unit = org_units_by_id.get(str(report.get("org_unit_id"))) if report else None
            add_result(
                source_id=str(commitment["id"]),
                source_type="commitment",
                subject=_subject(org_id=org_id, report=report, org_unit=unit),
                relevant_date=_row_date(commitment, "due_date", "completed_at", "created_at"),
                visibility="manager_record",
                label=commitment.get("title") or commitment.get("description") or "Commitment",
                search_text=" ".join(str(commitment.get(key) or "") for key in ("title", "description", "committed_by", "status", "due_date")),
                excerpt=commitment.get("description"),
                fact={key: commitment.get(key) for key in ("committed_by", "due_date", "status", "is_team_commitment")},
                route=f"/app/reports/{report['id']}" if report else "/app/1-1s",
            )

    if {"one_on_one", "private_note"} & requested_types:
        one_on_ones = _query_rows(
            supabase,
            "one_on_ones",
            "id,direct_report_id,scheduled_at,summary,notes,created_at",
            "manager_id",
            user_id,
            report_ids=effective_report_ids,
            order="scheduled_at",
        )
        for meeting in one_on_ones:
            report = reports_by_id.get(str(meeting.get("direct_report_id")))
            unit = org_units_by_id.get(str(report.get("org_unit_id"))) if report else None
            meeting_subject = _subject(org_id=org_id, report=report, org_unit=unit)
            route = f"/app/reports/{report['id']}" if report else "/app/1-1s"
            if meeting.get("summary"):
                add_result(
                    source_id=str(meeting["id"]),
                    source_type="one_on_one",
                    subject=meeting_subject,
                    relevant_date=_row_date(meeting, "scheduled_at", "created_at"),
                    visibility="manager_record",
                    label=f"1:1 with {report.get('name') if report else 'direct report'}",
                    search_text=str(meeting["summary"]),
                    excerpt=str(meeting["summary"]),
                    route=route,
                )
            if meeting.get("notes"):
                add_result(
                    source_id=str(meeting["id"]),
                    source_type="private_note",
                    subject=meeting_subject,
                    relevant_date=_row_date(meeting, "scheduled_at", "created_at"),
                    visibility="manager_private",
                    label=f"Private 1:1 note for {report.get('name') if report else 'direct report'}",
                    search_text=str(meeting["notes"]),
                    excerpt=str(meeting["notes"]),
                    route=route,
                )

        captures = _query_rows(
            supabase,
            "dr_capture_notes",
            "id,direct_report_id,content,created_at",
            "manager_id",
            user_id,
            report_ids=effective_report_ids,
        ) if "private_note" in requested_types else []
        for capture in captures:
            report = reports_by_id.get(str(capture.get("direct_report_id")))
            unit = org_units_by_id.get(str(report.get("org_unit_id"))) if report else None
            add_result(
                source_id=str(capture["id"]),
                source_type="private_note",
                subject=_subject(org_id=org_id, report=report, org_unit=unit),
                relevant_date=_row_date(capture, "created_at"),
                visibility="manager_private",
                label=f"Private capture note for {report.get('name') if report else 'direct report'}",
                search_text=str(capture.get("content") or ""),
                excerpt=capture.get("content"),
                route=f"/app/reports/{report['id']}" if report else None,
            )

    if "role_expectation" in requested_types:
        expectations_by_role: dict[str, dict] = {}
        for report_id in effective_report_ids:
            report = reports_by_id[report_id]
            role_level_id = report.get("role_level_id")
            if not role_level_id:
                continue
            role_key = str(role_level_id)
            if role_key not in expectations_by_role:
                expectations_by_role[role_key] = fetch_role_expectations(supabase, role_key) or {}
            expectations = expectations_by_role[role_key]
            unit = org_units_by_id.get(str(report.get("org_unit_id")))
            expectation_subject = _subject(org_id=org_id, report=report, org_unit=unit)
            role_level = expectations.get("role_level") or {}
            if role_level.get("job_responsibilities"):
                add_result(
                    source_id=str(role_level["id"]),
                    source_type="role_expectation",
                    subject=expectation_subject,
                    relevant_date=_row_date(role_level, "created_at"),
                    visibility="shared_org_context",
                    label=f"{role_level.get('job_role')} responsibilities for {report.get('name')}",
                    search_text=str(role_level["job_responsibilities"]),
                    excerpt=str(role_level["job_responsibilities"]),
                    fact={"role_level_id": str(role_level["id"]), "expectation_kind": "responsibilities"},
                    route="/app/settings?section=roles",
                )
            for kind, name_key, expectation_key in (
                ("skills", "skill_name", "expectation"),
                ("values", "value_name", "description"),
                ("metrics", "metric_name", "expectation"),
            ):
                for config in expectations.get(kind) or []:
                    description = config.get(expectation_key) or config.get("description") or ""
                    add_result(
                        source_id=str(config["id"]),
                        source_type="role_expectation",
                        subject=expectation_subject,
                        relevant_date=_row_date(config, "created_at"),
                        visibility="shared_org_context",
                        label=f"{config.get(name_key) or kind.title()} expectation for {report.get('name')}",
                        search_text=f"{config.get(name_key) or ''} {description}",
                        excerpt=description,
                        fact={
                            "role_level_id": str(role_level_id),
                            "expectation_config_id": str(config["id"]),
                            "expectation_kind": kind,
                        },
                        route="/app/settings?section=roles",
                    )

    if "check_in" in requested_types:
        parents = {
            **{str(row["id"]): ("goal", row) for row in goals},
            **{str(row["id"]): ("project", row) for row in projects},
        }
        for parent_column, parent_rows in (("goal_id", goals), ("project_id", projects)):
            parent_ids = [str(row["id"]) for row in parent_rows]
            if not parent_ids:
                continue
            check_ins = (
                supabase.table("check_ins")
                .select("id,goal_id,project_id,status,progress,note,created_at")
                .eq("owner_id", user_id)
                .in_(parent_column, parent_ids)
                .order("created_at", desc=True)
                .limit(MAX_ROWS_PER_SOURCE)
                .execute()
                .data
            )
            for check_in in check_ins:
                parent_id = str(check_in.get(parent_column))
                parent_type, parent = parents[parent_id]
                add_result(
                    source_id=str(check_in["id"]),
                    source_type="check_in",
                    subject=record_subject(parent),
                    relevant_date=_row_date(check_in, "created_at"),
                    visibility="manager_record",
                    label=f"Check-in on {parent.get('title')}",
                    search_text=" ".join(str(check_in.get(key) or "") for key in ("status", "progress", "note")) + f" {parent.get('title') or ''}",
                    excerpt=check_in.get("note"),
                    fact={
                        "parent_type": parent_type,
                        "parent_id": parent_id,
                        "status": check_in.get("status"),
                        "progress": check_in.get("progress"),
                    },
                    route="/app/goals" if parent_type == "goal" else "/app/projects",
                    score_boost=0.5 if check_in.get("status") == "at_risk" else 0,
                )

    if "company_document" in requested_types and org_id:
        if requested_org_unit_ids:
            document_scope_ids = requested_org_unit_ids
        elif requested_report_ids:
            document_scope_ids = report_unit_ids
        else:
            document_scope_ids = None
        documents = context_engine.search_confirmed_documents(
            supabase,
            org_id,
            clean_query,
            today,
            org_unit_ids=document_scope_ids,
        )
        for document in documents:
            relevant_date = _row_date(document, "effective_date", "confirmed_at", "created_at")
            if not _date_in_range(relevant_date, range_start, range_end):
                continue
            document_age = _age_metadata(relevant_date, today)
            if document.get("freshness_class") == "evergreen":
                document_age["is_stale"] = False
            candidates.append({
                "source_ref": f"company_document:{document['id']}",
                "source_id": str(document["id"]),
                "source_type": "company_document",
                "subject": _subject(
                    org_id=org_id,
                    org_unit_ids=document.get("org_unit_ids"),
                    org_scope_labels=document.get("scope_labels"),
                ),
                "relevant_date": relevant_date,
                "visibility": "confirmed_company_document",
                "label": document.get("title") or "Company document",
                "excerpt": document.get("matched_excerpt"),
                "fact": {
                    "category": document.get("category"),
                    "freshness_class": document.get("freshness_class"),
                    "effective_date": document.get("effective_date"),
                },
                "route": "/app/context",
                "retrieved_at": retrieved_at,
                "_score": float(document.get("search_score") or 0) + 0.35,
                **document_age,
            })

    def result_date_rank(item: dict) -> int:
        value = item.get("relevant_date")
        if not value:
            return 0
        try:
            return -date.fromisoformat(str(value)[:10]).toordinal()
        except ValueError:
            return 0

    candidates.sort(
        key=lambda item: (
            -item["_score"],
            item.get("relevant_date") is None,
            result_date_rank(item),
            item["source_ref"],
        )
    )
    # Keep the packet compact and prevent one broad private-note history from
    # crowding out goals, projects, or company context.
    results: list[dict] = []
    per_type: dict[str, int] = {}
    per_person: dict[str, int] = {}
    for candidate in candidates:
        source_type = candidate["source_type"]
        person_id = candidate["subject"].get("direct_report_id")
        if per_type.get(source_type, 0) >= 4:
            continue
        if person_id and per_person.get(person_id, 0) >= 5:
            continue
        candidate.pop("_score", None)
        results.append(candidate)
        per_type[source_type] = per_type.get(source_type, 0) + 1
        if person_id:
            per_person[person_id] = per_person.get(person_id, 0) + 1
        if len(results) >= MAX_RESULTS:
            break

    return {
        "query": clean_query,
        "scope": {
            "manager_id": user_id,
            "organization_id": org_id,
            "direct_report_ids": requested_report_ids,
            "org_unit_ids": requested_org_unit_ids,
        },
        "source_types": sorted(requested_types),
        "time_range": {
            "start": range_start.isoformat() if range_start else None,
            "end": range_end.isoformat() if range_end else None,
        },
        "retrieved_at": retrieved_at,
        "result_count": len(results),
        "results": results,
    }
