"""Your account: export and delete (PRELAUNCH_BACKLOG §7 E).

The database side (delete_my_account() removes every row the account owns and
nothing else) is proven against a real Postgres by
database/checks/account_deletion_check.py. These tests cover what needs no
database: every table is accounted for, the route's order and refusals, and
the HubSpot and PostHog calls.
"""
import re
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import analytics
import hubspot
import main
from config import settings
from routes import account

REPO = Path(__file__).resolve().parents[2]
SCHEMA = REPO / "database" / "schema.sql"


def _strip(sql: str) -> str:
    return re.sub(r"--[^\n]*", "", sql)


def _schema_tables() -> dict[str, str]:
    sql = _strip(SCHEMA.read_text())
    return {
        m.group(1).lower(): m.group(2)
        for m in re.finditer(
            r"create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)\s*\((.*?)\n\)\s*;", sql, re.I | re.S
        )
    }


def _delete_function_body() -> str:
    sql = _strip(SCHEMA.read_text())
    m = re.search(r"function public\.delete_my_account\(\).*?\$\$(.*?)\$\$", sql, re.S)
    assert m, "delete_my_account() not found in schema.sql"
    return m.group(1)


# ── Every table is accounted for ──────────────────────────────────────────

def test_every_schema_table_is_exported_or_excluded_with_a_reason():
    tables = set(_schema_tables())
    assert len(tables) >= 60
    covered = set(account.EXPORT_TABLES) | set(account.ACCOUNT_TABLES) | set(account.EXPORT_EXCLUDED)
    assert tables - covered == set(), "add new tables to EXPORT_TABLES or EXPORT_EXCLUDED in routes/account.py"
    assert covered - tables == set(), "routes/account.py names a table schema.sql doesn't have"
    assert len(account.EXPORT_TABLES) == len(set(account.EXPORT_TABLES))


def test_delete_function_clears_every_no_cascade_reference_to_the_login():
    """A NO ACTION foreign key to auth.users blocks deleting the login. Every
    table holding one must be deleted from by name, or reached by a cascade
    from a table that is (the Postgres check proves which)."""
    body = _delete_function_body()
    deleted = set(re.findall(r"delete\s+from\s+(\w+)", body, re.I))
    blocking = set()
    for table, cols in _schema_tables().items():
        for line in cols.splitlines():
            if re.search(r"references\s+auth\.users", line, re.I) and not re.search(r"on\s+delete\s+(cascade|set\s+null)", line, re.I):
                blocking.add(table)
    # users.id cascades; direct_reports.user_id is unlinked by update.
    missing = blocking - deleted - {"direct_reports"}
    assert not missing, f"delete_my_account() never deletes from: {sorted(missing)}"
    assert "update direct_reports set user_id = null" in body


def test_migration_and_schema_define_the_same_function():
    # The newest migration that (re)defines it must match schema.sql.
    defining = [p for p in sorted((REPO / "database" / "migrations").glob("*.sql"))
                if "function public.delete_my_account()" in p.read_text()]
    migration = defining[-1].read_text()
    m = re.search(r"function public\.delete_my_account\(\).*?\$\$(.*?)\$\$", _strip(migration), re.S)
    assert m and m.group(1).strip() == _delete_function_body().strip()


def test_expired_accounts_can_still_export_and_delete():
    assert "/api/settings/account".startswith(main._READ_ONLY_ALLOWED)


# ── The route ─────────────────────────────────────────────────────────────

class _Query:
    def __init__(self, client, table):
        self.client, self.table = client, table

    def select(self, *_a, **_k):
        return self

    def eq(self, *_a, **_k):
        return self

    def order(self, *_a, **_k):
        return self

    def range(self, start, end):
        self._range = (start, end)
        return self

    def execute(self):
        rows = self.client.tables.get(self.table, [])
        if hasattr(self, "_range"):
            rows = rows[self._range[0]:self._range[1] + 1]
        return SimpleNamespace(data=rows)


class _Bucket:
    def __init__(self, client):
        self.client = client

    def list(self, path, options=None):
        offset = (options or {}).get("offset", 0)
        return self.client.folders.get(path, [])[offset:]

    def remove(self, paths):
        if self.client.storage_fails:
            raise RuntimeError("storage down")
        self.client.calls.append(("storage.remove", list(paths)))
        kept = [p for p in paths if p not in self.client.storage_refuses]
        return [{"name": p} for p in kept]


class FakeClient:
    def __init__(self, tables=None, folders=None, storage_fails=False, refuse_rpc=None):
        self.tables = tables or {}
        self.storage_refuses = set()
        self.refuse_rpc = refuse_rpc
        self.folders = folders or {}
        self.storage_fails = storage_fails
        self.calls = []
        self.storage = SimpleNamespace(from_=lambda _bucket: _Bucket(self))

    def table(self, name):
        return _Query(self, name)

    def rpc(self, name, params):
        self.calls.append(("rpc", name))

        def execute():
            if name == self.refuse_rpc:
                raise RuntimeError(f"{name} refused")
            return SimpleNamespace(data={"ok": True})

        return SimpleNamespace(execute=execute)


@pytest.fixture
def wired(monkeypatch):
    calls = []
    monkeypatch.setattr(account, "get_email_from_token", lambda _a: "manager@example.test")
    monkeypatch.setattr(account.hubspot, "enabled", lambda: True)
    monkeypatch.setattr(account.hubspot, "delete_contact", lambda email: calls.append(("hubspot", email)) or True)
    monkeypatch.setattr(account.analytics, "deletion_needed", lambda: True)
    monkeypatch.setattr(account.analytics, "deletion_configured", lambda: True)
    monkeypatch.setattr(account.analytics, "delete_person", lambda uid: calls.append(("posthog", uid)) or {})
    monkeypatch.setattr(account, "forget_user", lambda uid: calls.append(("forget", uid)))
    return calls


def _delete(client, confirm="delete my account"):
    return account.delete_account.__wrapped__(
        request=None, body=account.DeleteAccountIn(confirm=confirm),
        auth=("user-1", client), authorization="Bearer t",
    )


def _client_with_files():
    return FakeClient(
        tables={"users": [{"org_id": "org-1"}], "documents": [{"storage_path": "org-1/doc-1/a.pdf"}]},
        folders={
            "org-1": [{"name": "doc-1", "id": None}, {"name": "doc-2", "id": None}],
            "org-1/doc-1": [{"name": "a.pdf", "id": "x"}],
            "org-1/doc-2": [{"name": "orphan.txt", "id": "y"}],
        },
    )


def test_delete_runs_outside_copies_then_files_then_the_database(wired):
    client = _client_with_files()
    assert _delete(client) == {"deleted": True}
    assert wired[:2] == [("hubspot", "manager@example.test"), ("posthog", "user-1")]
    assert client.calls == [
        ("rpc", "account_deletion_preflight"),
        ("storage.remove", ["org-1/doc-1/a.pdf", "org-1/doc-2/orphan.txt"]),
        ("rpc", "delete_my_account"),
    ]
    assert wired[-1] == ("forget", "user-1")


def test_delete_needs_the_typed_phrase(wired):
    client = FakeClient()
    with pytest.raises(HTTPException) as exc:
        _delete(client, confirm="delete")
    assert exc.value.status_code == 422
    assert client.calls == [] and wired == []


def test_confirm_phrase_ignores_case_and_spaces(wired):
    assert _delete(FakeClient(), confirm="  Delete My Account ") == {"deleted": True}


def test_an_outside_failure_deletes_nothing(wired, monkeypatch):
    def refuse(_email):
        raise hubspot.HubSpotError("hubspot gdpr delete refused: 403")

    monkeypatch.setattr(account.hubspot, "delete_contact", refuse)
    client = _client_with_files()
    with pytest.raises(HTTPException) as exc:
        _delete(client)
    assert exc.value.status_code == 502
    assert "still here" in exc.value.detail
    assert client.calls == [("rpc", "account_deletion_preflight")]


def test_unconfigured_posthog_deletion_refuses(wired, monkeypatch):
    monkeypatch.setattr(account.analytics, "deletion_configured", lambda: False)
    client = FakeClient()
    with pytest.raises(HTTPException) as exc:
        _delete(client)
    assert exc.value.status_code == 503
    assert "Nothing was deleted" in exc.value.detail
    assert client.calls == [] and wired == []


def test_a_deployment_without_hubspot_or_posthog_still_deletes(wired, monkeypatch):
    monkeypatch.setattr(account.hubspot, "enabled", lambda: False)
    monkeypatch.setattr(account.analytics, "deletion_needed", lambda: False)
    client = FakeClient()
    assert _delete(client) == {"deleted": True}
    assert ("rpc", "delete_my_account") in client.calls
    assert wired == [("forget", "user-1")]


def test_a_preflight_refusal_happens_before_anything_irreversible(wired):
    client = _client_with_files()
    client.refuse_rpc = "account_deletion_preflight"
    with pytest.raises(HTTPException) as exc:
        _delete(client)
    assert exc.value.status_code == 503
    assert "Nothing was deleted" in exc.value.detail
    assert wired == []  # no HubSpot, no PostHog
    assert client.calls == [("rpc", "account_deletion_preflight")]


def test_a_file_storage_quietly_kept_stops_before_the_database(wired):
    client = _client_with_files()
    client.storage_refuses = {"org-1/doc-2/orphan.txt"}
    with pytest.raises(HTTPException) as exc:
        _delete(client)
    assert exc.value.status_code == 502
    assert ("rpc", "delete_my_account") not in client.calls


def test_a_database_failure_says_the_records_are_still_there(wired):
    client = FakeClient()
    client.refuse_rpc = "delete_my_account"
    with pytest.raises(HTTPException) as exc:
        _delete(client)
    assert exc.value.status_code == 500
    assert "still here" in exc.value.detail
    assert ("forget", "user-1") not in wired


def test_a_storage_failure_stops_before_the_database(wired):
    client = _client_with_files()
    client.storage_fails = True
    with pytest.raises(HTTPException) as exc:
        _delete(client)
    assert exc.value.status_code == 502
    assert ("rpc", "delete_my_account") not in client.calls


# ── The export ────────────────────────────────────────────────────────────

def test_export_shape_and_redaction():
    client = FakeClient(tables={
        "users": [{"id": "user-1", "email": "m@example.test"}, {"id": "ic-1", "role": "ic"}],
        "organizations": [{"id": "org-1", "name": "Acme"}],
        "subscriptions": [{"status": "trialing"}],
        "direct_reports": [
            {"id": "dr-1", "name": "Pat", "manager_id": "user-1"},
            {"id": "dr-9", "name": "Me, as someone's report", "manager_id": "boss-1", "notes": "private"},
        ],
        "direct_report_invites": [{"id": "inv-1", "token": "secret", "invited_email": "p@example.test"}],
    })
    out = account.build_export("user-1", client)
    assert out["format_version"] == account.EXPORT_FORMAT_VERSION
    assert out["account"]["user"]["email"] == "m@example.test"
    assert out["account"]["organization"]["name"] == "Acme"
    assert out["account"]["other_users_in_organization"] == [{"id": "ic-1", "role": "ic"}]
    assert set(out["data"]) == set(account.EXPORT_TABLES)
    # An IC can read their manager's row about them; it isn't theirs to export.
    assert out["data"]["direct_reports"] == [{"id": "dr-1", "name": "Pat", "manager_id": "user-1"}]
    assert out["data"]["direct_report_invites"] == [{"id": "inv-1", "invited_email": "p@example.test"}]


def test_export_pages_past_the_postgrest_row_limit():
    rows = [{"id": i} for i in range(2500)]
    client = FakeClient(tables={"commitments": rows})
    assert account._read_all(client, "commitments") == rows


# ── HubSpot and PostHog ───────────────────────────────────────────────────

class _Resp:
    def __init__(self, status, body=None):
        self.status_code, self._body = status, body

    def json(self):
        return self._body


def test_hubspot_skips_a_contact_it_does_not_have(monkeypatch):
    monkeypatch.setattr(settings, "HUBSPOT_TOKEN", "pat-test")
    posts = []
    monkeypatch.setattr(hubspot.httpx, "get", lambda *a, **k: _Resp(404))
    monkeypatch.setattr(hubspot.httpx, "post", lambda *a, **k: posts.append(a) or _Resp(204))
    assert hubspot.delete_contact("nobody@example.test") is False
    assert posts == []  # a GDPR delete by unknown email would blocklist it


def test_hubspot_gdpr_deletes_by_contact_id(monkeypatch):
    monkeypatch.setattr(settings, "HUBSPOT_TOKEN", "pat-test")
    seen = {}

    def get(url, params, headers, timeout):
        seen["get"] = (url, params)
        return _Resp(200, {"id": "901"})

    def post(url, json, headers, timeout):
        seen["post"] = (url, json)
        return _Resp(204)

    monkeypatch.setattr(hubspot.httpx, "get", get)
    monkeypatch.setattr(hubspot.httpx, "post", post)
    assert hubspot.delete_contact("a+b@example.test") is True
    assert seen["get"][0].endswith("/contacts/a%2Bb%40example.test")
    assert seen["get"][1]["idProperty"] == "email"
    assert seen["post"] == (hubspot.GDPR_DELETE_URL, {"objectId": "901"})


def test_hubspot_refusal_raises(monkeypatch):
    monkeypatch.setattr(settings, "HUBSPOT_TOKEN", "pat-test")
    monkeypatch.setattr(hubspot.httpx, "get", lambda *a, **k: _Resp(200, {"id": "1"}))
    monkeypatch.setattr(hubspot.httpx, "post", lambda *a, **k: _Resp(403))
    with pytest.raises(hubspot.HubSpotError):
        hubspot.delete_contact("m@example.test")


def test_posthog_deletes_person_events_and_recordings(monkeypatch):
    monkeypatch.setattr(settings, "POSTHOG_PERSONAL_API_KEY", "phx_test")
    monkeypatch.setattr(settings, "POSTHOG_PROJECT_ID", "12345")
    seen = {}

    def post(url, json, headers, timeout):
        seen.update(url=url, json=json, auth=headers["Authorization"])
        return _Resp(202, {"persons_queued_for_deletion": 1})

    monkeypatch.setattr(analytics.httpx, "post", post)
    analytics.delete_person("user-1")
    assert seen["url"] == "https://us.posthog.com/api/projects/12345/persons/bulk_delete/"
    assert seen["json"] == {"distinct_ids": ["user-1"], "delete_events": True, "delete_recordings": True}
    assert seen["auth"] == "Bearer phx_test"


def test_posthog_without_a_personal_key_raises(monkeypatch):
    monkeypatch.setattr(settings, "POSTHOG_PERSONAL_API_KEY", "")
    with pytest.raises(analytics.AnalyticsDeletionError):
        analytics.delete_person("user-1")
