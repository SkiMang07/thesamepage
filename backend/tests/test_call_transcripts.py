"""Call transcription server pipeline (docs/systems/call-transcription.md).

These run without a database. The RLS isolation, idempotent billing and
end-to-end route checks were run against a local Postgres with the real
schema; see the commit body for that run.
"""
import os
import re
from pathlib import Path
from types import SimpleNamespace

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2ln")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.c2ln")
os.environ.setdefault("ANTHROPIC_API_KEY", "test")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import ai_core  # noqa: E402
import main  # noqa: E402
import utils  # noqa: E402
from config import TRANSCRIPTION_ALLOWANCES  # noqa: E402
from routes import account  # noqa: E402
from routes import call_transcripts as ct  # noqa: E402

REPO = Path(__file__).resolve().parents[2]


# ── billing ──────────────────────────────────────────────────────────────

def test_vendor_seconds_win_when_reported():
    assert ct.billable_seconds(171.2, 180_000) == 172


def test_client_duration_is_capped_at_segment_plus_15s():
    assert ct.billable_seconds(None, 180_000) == 180
    assert ct.billable_seconds(None, 600_000) == 195   # never an uncapped client number
    assert ct.billable_seconds(None, -5) == 0


# ── lines and interleaving ───────────────────────────────────────────────

def test_one_line_per_segment_when_the_model_has_no_timestamps():
    assert ai_core._call_segment_lines({"text": " Hello there. "}, 360_000) == [{"t_ms": 360_000, "text": "Hello there."}]
    assert ai_core._call_segment_lines({"text": "  "}, 0) == []


def test_timestamped_segments_become_lines_on_the_call_timeline():
    body = {"text": "a b", "segments": [{"start": 1.5, "text": " a "}, {"start": 12.25, "text": "b"}, {"start": 13, "text": ""}]}
    assert ai_core._call_segment_lines(body, 180_000) == [
        {"t_ms": 181_500, "text": "a"}, {"t_ms": 192_250, "text": "b"},
    ]


def test_interleave_orders_by_time_and_labels_by_track():
    segments = [
        {"seq": 0, "track": "other", "offset_ms": 0, "lines": [{"t_ms": 500, "text": "hi"}, {"t_ms": 9000, "text": "sure"}]},
        {"seq": 0, "track": "self", "offset_ms": 0, "lines": [{"t_ms": 500, "text": "hello"}, {"t_ms": 4000, "text": "ready?"}]},
        {"seq": 1, "track": "self", "offset_ms": 180_000, "lines": [{"t_ms": 180_000, "text": "next"}, {"text": ""}]},
    ]
    assert [(l["t_ms"], l["speaker"], l["text"]) for l in ct.interleave(segments)] == [
        (500, "self", "hello"), (500, "other", "hi"), (4000, "self", "ready?"),
        (9000, "other", "sure"), (180_000, "self", "next"),
    ]


def test_call_segments_have_their_own_size_cap():
    assert ai_core.MAX_DICTATION_BYTES == 8 * 1024 * 1024   # dictation untouched
    # 4 MB holds Safari's ~3 MB AAC segment; the length check is the cost guard.
    assert ai_core.MAX_CALL_SEGMENT_BYTES == 4 * 1024 * 1024


def test_transcribe_call_segment_logs_no_text(monkeypatch, caplog):
    monkeypatch.setattr(ai_core.settings, "OPENAI_API_KEY", "sk-test")
    secret = "Jordan said the reorg is happening"
    monkeypatch.setattr(ai_core.httpx, "post", lambda *a, **k: SimpleNamespace(
        raise_for_status=lambda: None,
        json=lambda: {"text": secret, "usage": {"type": "duration", "seconds": 12}},
    ))
    caplog.set_level("DEBUG")
    out = ai_core.transcribe_call_segment(b"audio", 0)
    assert out == {"lines": [{"t_ms": 0, "text": secret}], "audio_seconds": 12.0}
    assert secret not in caplog.text and "audio" not in [r.getMessage() for r in caplog.records]


# ── allowances ───────────────────────────────────────────────────────────

def test_allowances_match_the_plan():
    assert TRANSCRIPTION_ALLOWANCES["paid"] == (30, "month")
    assert TRANSCRIPTION_ALLOWANCES["comped"] == (30, "month")
    assert TRANSCRIPTION_ALLOWANCES["founding"] == (20, "month")
    assert TRANSCRIPTION_ALLOWANCES["test"] == (20, "month")
    assert TRANSCRIPTION_ALLOWANCES["trial"] == (5, "total")
    assert TRANSCRIPTION_ALLOWANCES["read_only"][0] == 0


def test_every_tier_the_database_names_has_an_allowance():
    sql = (REPO / "database" / "schema.sql").read_text()
    body = re.search(r"function public\.transcription_allowance_state\(\).*?\$\$(.*?)\$\$", sql, re.S).group(1)
    tiers = set(re.findall(r"'(\w+)'", body)) & {"ic", "none", "read_only", "comped", "paid", "founding", "test", "trial"}
    assert tiers == set(TRANSCRIPTION_ALLOWANCES)


class _Rpc:
    def __init__(self, state):
        self.state = state

    def rpc(self, name, params):
        assert name == "transcription_allowance_state"
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=self.state))


@pytest.fixture
def no_entitlement(monkeypatch):
    monkeypatch.setattr(ct, "get_entitlement", lambda *a, **k: {})


def test_trial_counts_all_time_and_has_no_reset(no_entitlement):
    a = ct.allowance_for("u", _Rpc({"tier": "trial", "month": "2026-10-01", "month_seconds": 60, "total_seconds": 18_000}))
    assert a["used_seconds"] == 18_000 and a["at_limit"] and a["resets_on"] is None
    assert ct._allowance_message(a) == "You've used the 5 transcription hours in your trial."


def test_monthly_allowance_resets_on_the_first(no_entitlement):
    a = ct.allowance_for("u", _Rpc({"tier": "paid", "month": "2026-12-01", "month_seconds": 108_000, "total_seconds": 900_000}))
    assert a["used_seconds"] == 108_000 and a["at_limit"] and a["resets_on"] == "2027-01-01"
    assert ct._allowance_message(a) == "You've used your 30 hours for December. Resets January 1."


def test_under_the_limit_is_not_at_limit(no_entitlement):
    a = ct.allowance_for("u", _Rpc({"tier": "founding", "month": "2026-10-01", "month_seconds": 3600, "total_seconds": 3600}))
    assert not a["at_limit"] and a["percent"] == 5 and a["allowed_hours"] == 20


# ── the report's view never carries a gap's kind ─────────────────────────

class _Table:
    def __init__(self, rows):
        self.rows = rows

    def __getattr__(self, _name):
        return lambda *a, **k: self

    def execute(self):
        return SimpleNamespace(data=self.rows)


class _ReportClient:
    """What the report's JWT can read: the transcript row and its segments
    through RLS, gaps only through the function."""
    def __init__(self, gaps_from_function):
        self.gaps = gaps_from_function

    def table(self, name):
        if name == "call_transcripts":
            return _Table([{"id": "t1", "owner_id": "manager", "one_on_one_id": "o1", "status": "ready",
                            "capture_mode": "tab", "ended_reason": "allowance", "started_at": None,
                            "ended_at": None, "consent_confirmed_at": "2026-10-23"}])
        if name == "call_transcript_segments":
            return _Table([{"seq": 0, "track": "self", "offset_ms": 0, "lines": [{"t_ms": 0, "text": "hi"}]}])
        raise AssertionError(f"the report's view must not read {name}")

    def rpc(self, name, params):
        assert name == "call_transcript_report_gaps"
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=self.gaps))


@pytest.fixture
def report_client():
    def make(gaps):
        main.app.dependency_overrides[utils.get_authenticated_client] = lambda: ("report", _ReportClient(gaps))
        return TestClient(main.app)
    yield make
    main.app.dependency_overrides.clear()


def test_report_view_strips_kind_even_if_the_function_returned_it(report_client):
    c = report_client([{"start_ms": 1, "end_ms": 2, "kind": "off_record"}])
    body = c.get("/api/call-transcripts/t1").json()
    assert body["viewer"] == "report"
    assert body["gaps"] == [{"start_ms": 1, "end_ms": 2}]
    assert "kind" not in str(body)
    for field in ("capture_mode", "ended_reason", "consent_confirmed_at"):
        assert field not in body


def test_report_cannot_change_it(report_client):
    c = report_client([])
    assert c.delete("/api/call-transcripts/t1").status_code == 403
    assert c.post("/api/call-transcripts/t1/end", json={}).status_code == 403


# ── wiring ───────────────────────────────────────────────────────────────

def test_fixed_paths_are_declared_before_the_id_route():
    paths = [r.path for r in main.app.routes if getattr(r, "path", "").startswith("/api/call-transcripts")]
    first_id = paths.index("/api/call-transcripts/{transcript_id}")
    assert paths.index("/api/call-transcripts/usage") < first_id
    assert paths.index("/api/call-transcripts/consent") < first_id


def test_health_reports_the_capability_not_the_key(monkeypatch):
    monkeypatch.setattr(main.settings, "OPENAI_API_KEY", "sk-secret")
    body = TestClient(main.app).get("/health").json()
    assert body["call_transcription"] is True and "sk-secret" not in str(body)
    monkeypatch.setattr(main.settings, "OPENAI_API_KEY", "")
    assert TestClient(main.app).get("/health").json()["call_transcription"] is False


def test_writes_stay_behind_the_read_only_gate():
    assert not "/api/call-transcripts".startswith(main._READ_ONLY_ALLOWED)


def test_ai_calling_routes_are_rate_limited():
    src = (REPO / "backend" / "routes" / "call_transcripts.py").read_text()
    for route in ('@router.post("")', '@router.post("/{transcript_id}/segments")',
                  '@router.post("/{transcript_id}/pause")', '@router.post("/{transcript_id}/resume")',
                  '@router.post("/{transcript_id}/end")', '@router.delete("/{transcript_id}")',
                  '@router.put("/consent")'):
        i = src.index(route)
        assert "@limiter.limit(" in src[i:i + 120], route


def test_export_keeps_a_reports_view_of_transcripts_out():
    rows = [{"owner_id": "manager"}, {"owner_id": "me"}]
    assert account._own_rows("call_transcripts", rows, "me") == [{"owner_id": "me"}]
    assert account._own_rows("call_transcript_segments", rows, "me") == [{"owner_id": "me"}]
    assert {"call_transcripts", "call_transcript_segments", "call_transcript_gaps", "transcription_usage"} <= set(account.EXPORT_TABLES)


def test_migration_carries_every_object_schema_defines():
    schema = (REPO / "database" / "schema.sql").read_text()
    migration = (REPO / "database" / "migrations" / "2026-10-23_call_transcription.sql").read_text()
    names = ["call_transcripts", "call_transcript_segments", "call_transcript_gaps", "transcription_usage",
             "call_transcript_ids_for_report", "call_transcript_report_gaps", "add_transcription_seconds",
             "transcription_allowance_state", "call_transcripts_select_as_report",
             "call_transcript_segments_select_as_report"]
    for name in names:
        assert name in schema and name in migration, name
    assert "transcription_consent_at" in migration
    assert len(re.findall(r"transcription_consent_at timestamptz", schema)) == 2
