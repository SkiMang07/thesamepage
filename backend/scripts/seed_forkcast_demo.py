#!/usr/bin/env python3
"""Create or reset the guarded Forkcast Labs demo organisation.

Dry-run validation is the default and needs no credentials:

    python backend/scripts/seed_forkcast_demo.py

Applying to production is deliberately explicit. Secrets and the real demo
email are runtime-only and must never be committed:

    SUPABASE_URL=... \
    SUPABASE_SERVICE_ROLE_KEY=... \
    TSP_DEMO_MANAGER_EMAIL=... \
    TSP_DEMO_MANAGER_PASSWORD=... \
      python backend/scripts/seed_forkcast_demo.py --apply

The runner refuses any Supabase project except The Same Page production project,
tags all Auth users as demo-only, and will not reset an untagged or non-Forkcast
account. Every reset is scoped to the fixed Forkcast organisation UUID and the
five tagged demo manager Auth users.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import secrets
import sys
from datetime import date
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from forkcast_demo_data import (  # noqa: E402
    DEMO_MANAGER_NAME,
    DEMO_ORG_NAME,
    DEMO_SLUG,
    SYNTHETIC_MANAGERS,
    build_demo_data,
    seed_id,
    summarize_demo_data,
    validate_demo_data,
)


EXPECTED_PROJECT_REF = "vzzirawzwlqpunqmatmq"
DEMO_ORG_ID = seed_id("org:forkcast")
AUTH_MARKER = "tsp_demo_seed"


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Create/reset the live demo. Without this flag, only validate and print the plan.",
    )
    parser.add_argument(
        "--anchor-date",
        type=date.fromisoformat,
        default=date.today(),
        help="Demo 'today' in YYYY-MM-DD form (defaults to the current date).",
    )
    parser.add_argument(
        "--adopt-existing-empty-user",
        action="store_true",
        help="Allow tagging an existing primary Auth user only when it has no org or manager data.",
    )
    return parser.parse_args()


def _service_role_from_jwt(token: str) -> str | None:
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        return json.loads(base64.urlsafe_b64decode(payload))["role"]
    except (IndexError, KeyError, ValueError, json.JSONDecodeError):
        return None


def _is_service_role_key(token: str) -> bool:
    """Accept legacy service-role JWTs and Supabase's newer secret keys."""
    return _service_role_from_jwt(token) == "service_role" or token.startswith("sb_secret_")


def _project_ref(url: str) -> str:
    hostname = urlparse(url).hostname or ""
    suffix = ".supabase.co"
    return hostname[: -len(suffix)] if hostname.endswith(suffix) else ""


def _user_value(user: Any, name: str, default: Any = None) -> Any:
    if isinstance(user, dict):
        return user.get(name, default)
    return getattr(user, name, default)


def _response_user(response: Any) -> Any:
    return getattr(response, "user", response)


def _list_auth_users(client: Any) -> dict[str, Any]:
    users: dict[str, Any] = {}
    page = 1
    while True:
        batch = client.auth.admin.list_users(page=page, per_page=1000)
        if not batch:
            break
        for user in batch:
            email = (_user_value(user, "email", "") or "").lower()
            if email:
                users[email] = user
        if len(batch) < 1000:
            break
        page += 1
    return users


def _metadata(user: Any) -> dict[str, Any]:
    value = _user_value(user, "user_metadata", {}) or {}
    return value if isinstance(value, dict) else {}


def _is_tagged_demo_user(user: Any, key: str) -> bool:
    metadata = _metadata(user)
    return metadata.get(AUTH_MARKER) is True and metadata.get("demo_slug") == DEMO_SLUG and metadata.get("demo_role") == key


def _manager_has_data(client: Any, user_id: str) -> bool:
    checks = [
        ("users", "id"),
        ("direct_reports", "manager_id"),
        ("one_on_ones", "manager_id"),
        ("commitments", "owner_id"),
        ("goals", "owner_id"),
        ("projects", "owner_id"),
        ("assessments", "manager_id"),
    ]
    for table, column in checks:
        selected = "id,org_id" if table == "users" else "id"
        result = client.table(table).select(selected).eq(column, user_id).limit(1).execute().data or []
        if table == "users":
            if result and result[0].get("org_id") is not None:
                return True
            continue
        if result:
            return True
    return False


def _guard_before_auth_writes(
    client: Any,
    existing_by_email: dict[str, Any],
    requested_users: dict[str, str],
    *,
    allow_adopt_empty: bool,
) -> None:
    """Reject conflicting live state before changing any Auth identity."""
    org = client.table("organizations").select("id,name").eq("id", DEMO_ORG_ID).execute().data or []
    if org and org[0].get("name") != DEMO_ORG_NAME:
        raise RuntimeError("The deterministic demo org id belongs to a differently named organisation")

    for key, email in requested_users.items():
        existing = existing_by_email.get(email.lower())
        if existing is None:
            continue
        user_id = str(_user_value(existing, "id"))
        if not _is_tagged_demo_user(existing, key):
            if key != "demo" or not allow_adopt_empty:
                raise RuntimeError(
                    f"Refusing to use existing untagged Auth user for {key}. "
                    "Use a dedicated empty account; only the primary account can be explicitly adopted."
                )
            if _manager_has_data(client, user_id):
                raise RuntimeError("Refusing to adopt the existing primary user because it already has app data")

        public_rows = client.table("users").select("id,org_id,email").eq("id", user_id).execute().data or []
        if public_rows and public_rows[0].get("org_id") not in {None, DEMO_ORG_ID}:
            raise RuntimeError(f"Refusing to reset {key}: its public user belongs to a non-demo organisation")


def _verify_live_schema(client: Any, rows: dict[str, list[dict[str, Any]]]) -> None:
    """Verify every seeded field against production before any Auth write."""
    for table, table_rows in rows.items():
        if not table_rows:
            continue
        fields = sorted({field for row in table_rows for field in row})
        client.table(table).select(",".join(fields)).limit(0).execute()

    # The 2026-08-25 migration deliberately removed this legacy field. A
    # successful query means production is still one migration behind.
    try:
        client.table("team_meetings").select("meeting_date").limit(0).execute()
    except Exception as exc:
        message = str(exc).lower()
        if "meeting_date" not in message:
            raise RuntimeError("Could not verify the team_meetings migration") from exc
    else:
        raise RuntimeError("Refusing to seed before team_meetings.meeting_date is dropped")


def _ensure_auth_user(
    client: Any,
    existing_by_email: dict[str, Any],
    *,
    key: str,
    email: str,
    full_name: str,
    password: str,
    allow_adopt_empty: bool,
) -> str:
    normalized = email.lower()
    existing = existing_by_email.get(normalized)
    metadata = {
        AUTH_MARKER: True,
        "demo_slug": DEMO_SLUG,
        "demo_role": key,
        "full_name": full_name,
    }
    if existing is None:
        response = client.auth.admin.create_user(
            {
                "email": normalized,
                "password": password,
                "email_confirm": True,
                "user_metadata": metadata,
            }
        )
        user = _response_user(response)
        user_id = str(_user_value(user, "id"))
        if not user_id:
            raise RuntimeError(f"Supabase did not return an id for new {key} demo user")
        existing_by_email[normalized] = user
        return user_id

    user_id = str(_user_value(existing, "id"))
    if not _is_tagged_demo_user(existing, key):
        if key != "demo" or not allow_adopt_empty:
            raise RuntimeError(
                f"Refusing to use existing untagged Auth user for {key}. "
                "Use a dedicated empty account; only the primary account can be explicitly adopted."
            )
        if _manager_has_data(client, user_id):
            raise RuntimeError("Refusing to adopt the existing primary user because it already has app data")

    update: dict[str, Any] = {"email_confirm": True, "user_metadata": metadata}
    if key == "demo":
        update["password"] = password
    client.auth.admin.update_user_by_id(user_id, update)
    return user_id


def _guard_existing_scope(client: Any, manager_ids: dict[str, str]) -> None:
    org = client.table("organizations").select("id,name").eq("id", DEMO_ORG_ID).execute().data or []
    if org and org[0].get("name") != DEMO_ORG_NAME:
        raise RuntimeError("The deterministic demo org id belongs to a differently named organisation")

    for key, user_id in manager_ids.items():
        public_rows = client.table("users").select("id,org_id,email").eq("id", user_id).execute().data or []
        if not public_rows:
            continue
        existing_org = public_rows[0].get("org_id")
        if existing_org not in {None, DEMO_ORG_ID}:
            raise RuntimeError(f"Refusing to reset {key}: its public user belongs to a non-demo organisation")


def _delete_in(client: Any, table: str, column: str, values: list[str]) -> None:
    if values:
        client.table(table).delete().in_(column, values).execute()


def _delete_eq(client: Any, table: str, column: str, value: str) -> None:
    client.table(table).delete().eq(column, value).execute()


def _reset_demo_rows(client: Any, manager_ids: dict[str, str]) -> None:
    managers = list(manager_ids.values())

    # Manager-owned tables first. This also removes interaction state that
    # could hide Mission Control candidates after a reset.
    for table, column in [
        ("mission_control_events", "manager_id"),
        ("assistant_messages", "manager_id"),
        ("direct_report_invites", "manager_id"),
        ("team_meeting_agenda_items", "manager_id"),
        ("team_meetings", "manager_id"),
        ("team_meeting_series", "manager_id"),
        ("team_callouts", "manager_id"),
        ("team_dev_focus", "manager_id"),
        ("team_messages", "manager_id"),
        ("dr_capture_notes", "manager_id"),
        ("development_plans", "manager_id"),
        ("assessments", "manager_id"),
        ("performance_reviews", "manager_id"),
        ("commitments", "owner_id"),
        ("check_ins", "owner_id"),
        ("projects", "owner_id"),
        ("goals", "owner_id"),
        ("one_on_ones", "manager_id"),
        ("one_on_one_series", "manager_id"),
        ("manager_report_connections", "manager_id"),
        ("direct_reports", "manager_id"),
    ]:
        _delete_in(client, table, column, managers)

    # Org-scoped rows. Child objects generally cascade, but explicit order
    # makes the reset auditable and avoids relying on a surprising FK action.
    for table in [
        "document_citations",
        "document_scopes",
        "documents",
        "document_series",
        "work_unit_configs",
        "capacity_settings",
        "value_configs",
        "skill_configs",
        "metric_configs",
        "assessment_levels",
        "org_units",
        "role_levels",
        "role_families",
    ]:
        if table in {"document_citations", "document_scopes"}:
            # These rows scope through documents and disappear with the
            # document delete; there is no direct org_id column to filter.
            continue
        _delete_eq(client, table, "org_id", DEMO_ORG_ID)

    # With every referencing row gone, deleting the org safely removes the
    # public.users projections while preserving Auth users for reuse.
    _delete_eq(client, "organizations", "id", DEMO_ORG_ID)


INSERT_ORDER = [
    "organizations",
    "users",
    "role_families",
    "role_levels",
    "org_units",
    "direct_reports",
    "manager_report_connections",
    "one_on_one_series",
    "one_on_ones",
    "commitments",
    "dr_capture_notes",
    "assessment_levels",
    "assessments",
    "metric_configs",
    "metric_scale_definitions",
    "metric_entries",
    "skill_configs",
    "skill_scale_definitions",
    "skill_assessments",
    "value_configs",
    "value_scale_definitions",
    "value_assessments",
    "goals",
    "projects",
    "check_ins",
    "team_messages",
    "team_meeting_series",
    "team_meetings",
    "team_meeting_agenda_items",
    "team_callouts",
    "capacity_settings",
    "capacity_profiles",
    "time_off_entries",
    "work_unit_configs",
    "development_plans",
    "dev_plan_aspirations",
    "dev_plan_opportunities",
    "dev_plan_training",
    "dev_plan_manager_notes",
    "team_dev_focus",
]


def _insert_demo_rows(client: Any, rows: dict[str, list[dict[str, Any]]]) -> None:
    missing = set(rows) - set(INSERT_ORDER)
    if missing:
        raise RuntimeError(f"No insertion order defined for: {sorted(missing)}")
    for table in INSERT_ORDER:
        table_rows = rows.get(table, [])
        if not table_rows:
            continue
        if table == "users":
            client.table(table).upsert(table_rows, on_conflict="id").execute()
        else:
            client.table(table).insert(table_rows).execute()


def _verify_inserted_rows(client: Any, rows: dict[str, list[dict[str, Any]]]) -> None:
    mismatches: list[str] = []
    for table in INSERT_ORDER:
        expected_rows = rows.get(table, [])
        if not expected_rows:
            continue
        expected_ids = [row["id"] for row in expected_rows]
        found = client.table(table).select("id").in_("id", expected_ids).execute().data or []
        if len(found) != len(expected_ids):
            mismatches.append(f"{table}: expected {len(expected_ids)}, found {len(found)}")
    if mismatches:
        raise RuntimeError("Live verification failed: " + "; ".join(mismatches))


def _dry_run(anchor: date) -> int:
    keys = ["demo", *SYNTHETIC_MANAGERS]
    manager_ids = {key: seed_id(f"dry-auth:{key}") for key in keys}
    manager_emails = {
        "demo": "demo-manager@example.com",
        **{key: profile["email"] for key, profile in SYNTHETIC_MANAGERS.items()},
    }
    rows = build_demo_data(anchor, manager_ids, manager_emails)
    errors = validate_demo_data(rows)
    print(summarize_demo_data(rows))
    print(f"Anchor date: {anchor.isoformat()}")
    print("Primary demo manager: Jamie Vega")
    print("Core screenshot story: Mina Okafor / Copper Kettle rollout")
    if errors:
        print("Validation failed:")
        for error in errors:
            print(f"  - {error}")
        return 1
    print("Validation passed. No network calls or writes were made.")
    return 0


def _apply(anchor: date, adopt_existing_empty_user: bool) -> int:
    from supabase import create_client

    url = os.environ.get("SUPABASE_URL", "").strip()
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    manager_email = os.environ.get("TSP_DEMO_MANAGER_EMAIL", "").strip().lower()
    manager_password = os.environ.get("TSP_DEMO_MANAGER_PASSWORD", "")

    missing = [
        name
        for name, value in [
            ("SUPABASE_URL", url),
            ("SUPABASE_SERVICE_ROLE_KEY", service_role_key),
            ("TSP_DEMO_MANAGER_EMAIL", manager_email),
            ("TSP_DEMO_MANAGER_PASSWORD", manager_password),
        ]
        if not value
    ]
    if missing:
        raise RuntimeError("Missing required runtime variables: " + ", ".join(missing))
    if _project_ref(url) != EXPECTED_PROJECT_REF:
        raise RuntimeError("Refusing to seed an unexpected Supabase project")
    if not _is_service_role_key(service_role_key):
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is not a recognized service-role or secret key")
    if len(manager_password) < 8:
        raise RuntimeError("TSP_DEMO_MANAGER_PASSWORD must be at least 8 characters")

    client = create_client(url, service_role_key)
    manager_ids: dict[str, str] = {}
    manager_emails = {
        "demo": manager_email,
        **{key: profile["email"] for key, profile in SYNTHETIC_MANAGERS.items()},
    }
    preflight_ids = {key: seed_id(f"preflight-auth:{key}") for key in manager_emails}
    preflight_rows = build_demo_data(anchor, preflight_ids, manager_emails)
    preflight_errors = validate_demo_data(preflight_rows)
    if preflight_errors:
        raise RuntimeError("Generated demo data failed validation: " + "; ".join(preflight_errors))
    _verify_live_schema(client, preflight_rows)

    existing = _list_auth_users(client)
    _guard_before_auth_writes(
        client,
        existing,
        manager_emails,
        allow_adopt_empty=adopt_existing_empty_user,
    )

    manager_ids["demo"] = _ensure_auth_user(
        client,
        existing,
        key="demo",
        email=manager_email,
        full_name=DEMO_MANAGER_NAME,
        password=manager_password,
        allow_adopt_empty=adopt_existing_empty_user,
    )
    for key, profile in SYNTHETIC_MANAGERS.items():
        manager_ids[key] = _ensure_auth_user(
            client,
            existing,
            key=key,
            email=profile["email"],
            full_name=profile["full_name"],
            password=secrets.token_urlsafe(32),
            allow_adopt_empty=False,
        )

    _guard_existing_scope(client, manager_ids)
    rows = build_demo_data(anchor, manager_ids, manager_emails)
    errors = validate_demo_data(rows)
    if errors:
        raise RuntimeError("Generated demo data failed validation: " + "; ".join(errors))

    _reset_demo_rows(client, manager_ids)
    _insert_demo_rows(client, rows)
    _verify_inserted_rows(client, rows)

    print(f"Seeded {DEMO_ORG_NAME} for anchor {anchor.isoformat()}.")
    print("Created/reset five demo manager identities and 462 fictional rows.")
    print("Live row verification passed. Password and service credentials were not printed.")
    return 0


def main() -> int:
    args = _parse_args()
    try:
        if not args.apply:
            return _dry_run(args.anchor_date)
        return _apply(args.anchor_date, args.adopt_existing_empty_user)
    except Exception as exc:  # CLI boundary: concise, actionable failure.
        print(f"Forkcast seed failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
