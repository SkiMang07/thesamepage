"""Call transcription, session 1b review fixes (docs/systems/call-transcription.md).

The routes run against an in-memory stand-in for the database below, which
honours the constraints the routes rely on (one recording per manager, one
open gap, unique (transcript, seq, track)). Billing and the report's access
are SQL; those were checked against a real Postgres with the migration (see
the commit body). All names are fictional.
"""
import os
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2ln")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.c2ln")
os.environ.setdefault("ANTHROPIC_API_KEY", "test")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from postgrest.exceptions import APIError  # noqa: E402

import ai_core  # noqa: E402
import config  # noqa: E402
import main  # noqa: E402
import utils  # noqa: E402
from routes import call_transcripts as ct  # noqa: E402

MANAGER = "manager-morgan"
ONE_ON_ONE = "o-jordan"


def _iso(dt: datetime) -> str:
    return dt.isoformat()


# ── a small in-memory database ───────────────────────────────────────────

class _Query:
    def __init__(self, db, table):
        self.db, self.table, self.filters = db, table, []
        self.op, self.payload, self._limit = "select", None, None

    def select(self, *_a, **_k):
        self.op = "select"
        return self

    def insert(self, payload):
        self.op, self.payload = "insert", payload
        return self

    def update(self, payload):
        self.op, self.payload = "update", payload
        return self

    def delete(self):
        self.op = "delete"
        return self

    def eq(self, col, value):
        self.filters.append(lambda r: r.get(col) == value)
        return self

    def is_(self, col, value):
        assert value == "null"
        self.filters.append(lambda r: r.get(col) is None)
        return self

    def order(self, col, desc=False):
        return self

    def limit(self, n):
        self._limit = n
        return self

    def _rows(self):
        return [r for r in self.db.tables.setdefault(self.table, []) if all(f(r) for f in self.filters)]

    def execute(self):
        rows = self.db.tables.setdefault(self.table, [])
        if self.op == "insert":
            row = {"id": str(uuid.uuid4()), "created_at": _iso(self.db.now()), **self.payload}
            self.db.check_insert(self.table, row)
            if self.table == "call_transcripts":
                row.setdefault("status", "recording")
                for k in ("ended_at", "ended_at_ms", "ended_reason", "last_seq", "expected_seqs"):
                    row.setdefault(k, None)
            if self.table == "call_transcript_segments":
                row.setdefault("billed_at", None)
            if self.table == "call_transcript_gaps":
                row.setdefault("end_ms", None)
            rows.append(row)
            return SimpleNamespace(data=[dict(row)])
        matched = self._rows()
        if self.op == "update":
            for r in matched:
                candidate = {**r, **self.payload}
                if self.table == "call_transcripts" and candidate.get("status") == "recording":
                    others = [o for o in rows if o is not r and o["owner_id"] == candidate["owner_id"]
                              and o.get("status") == "recording"]
                    if others:
                        raise APIError({"code": "23505", "message": "one recording"})
                r.update(self.payload)
            return SimpleNamespace(data=[dict(r) for r in matched])
        if self.op == "delete":
            for r in matched:
                rows.remove(r)
            return SimpleNamespace(data=[dict(r) for r in matched])
        out = [dict(r) for r in matched]
        return SimpleNamespace(data=out[: self._limit] if self._limit else out)


class FakeDB:
    def __init__(self):
        self.clock = datetime(2026, 10, 23, 15, 0, tzinfo=timezone.utc)
        self.tables = {
            "one_on_ones": [{"id": ONE_ON_ONE, "manager_id": MANAGER, "org_id": None, "direct_report_id": "dr-jordan"}],
            "direct_reports": [{"id": "dr-jordan", "manager_id": MANAGER, "transcription_consent_at": None}],
        }
        self.usage = 0
        self.tier = "paid"

    def now(self):
        return self.clock

    def advance(self, **kw):
        self.clock += timedelta(**kw)

    def check_insert(self, table, row):
        rows = self.tables.setdefault(table, [])
        if table == "call_transcripts" and any(
            r["owner_id"] == row["owner_id"] and r.get("status", "recording") == "recording" for r in rows
        ):
            raise APIError({"code": "23505", "message": "one recording"})
        if table == "call_transcript_segments" and any(
            (r["transcript_id"], r["seq"], r["track"]) == (row["transcript_id"], row["seq"], row["track"]) for r in rows
        ):
            raise APIError({"code": "23505", "message": "dup segment"})
        if table == "call_transcript_gaps" and any(
            r["transcript_id"] == row["transcript_id"] and r.get("end_ms") is None for r in rows
        ):
            raise APIError({"code": "23505", "message": "open gap"})

    def table(self, name):
        return _Query(self, name)

    def rpc(self, name, params):
        if name == "transcription_allowance_state":
            data = {"tier": self.tier, "month": "2026-10-01", "month_seconds": self.usage, "total_seconds": self.usage}
        elif name == "add_transcription_seconds":
            # Mirrors the SQL: a seq bills once, at its longest track.
            seg = next(s for s in self.tables["call_transcript_segments"] if s["id"] == params["p_segment_id"])
            if seg["billed_at"] is None:
                seg["billed_at"] = _iso(self.clock)
                prev = max([s["billed_seconds"] for s in self.tables["call_transcript_segments"]
                            if s["transcript_id"] == seg["transcript_id"] and s["seq"] == seg["seq"]
                            and s is not seg and s["billed_at"]] or [0])
                self.usage += max(seg["billed_seconds"] - prev, 0)
            data = self.usage
        elif name == "call_transcript_report_gaps":
            data = [{"start_ms": g["start_ms"], "end_ms": g["end_ms"]}
                    for g in self.tables.get("call_transcript_gaps", []) if g["transcript_id"] == params["p_transcript_id"]]
        else:
            raise AssertionError(name)
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=data))


@pytest.fixture
def db(monkeypatch):
    fake = FakeDB()
    monkeypatch.setattr(ct, "_now", fake.now)
    monkeypatch.setattr(ct, "get_entitlement", lambda *a, **k: {})
    monkeypatch.setattr(ct.settings, "OPENAI_API_KEY", "sk-test")
    monkeypatch.setattr(ct.analytics, "capture", lambda *a, **k: None)
    ct.limiter.enabled = False
    main.app.dependency_overrides[utils.get_authenticated_client] = lambda: (MANAGER, fake)
    yield fake
    main.app.dependency_overrides.clear()
    ct.limiter.enabled = True


@pytest.fixture
def client(db):
    return TestClient(main.app)


def _vendor(monkeypatch, lines_fn=None, seconds=180.0):
    """Stand in for the vendor: one line every 30s across the segment."""
    def fake(raw, offset_ms, **_k):
        lines = lines_fn(offset_ms) if lines_fn else [
            {"t_ms": offset_ms + i * 30_000, "text": f"line {offset_ms + i * 30_000}"} for i in range(6)
        ]
        return {"lines": lines, "audio_seconds": seconds}
    monkeypatch.setattr(ct, "transcribe_call_segment", fake)


def _start(client):
    r = client.post("/api/call-transcripts", json={"one_on_one_id": ONE_ON_ONE, "capture_mode": "tab",
                                                   "consent_confirmed": True})
    assert r.status_code == 200, r.text
    return r.json()["transcript"]["id"]


def _segment(client, tid, seq, track, status=200):
    r = client.post(f"/api/call-transcripts/{tid}/segments",
                    files={"file": ("s.webm", b"x" * 100, "audio/webm")},
                    data={"seq": seq, "track": track, "offset_ms": seq * 180_000, "duration_ms": 180_000})
    assert r.status_code == status, r.text
    return r.json()


# ── 1. allowance counts meeting time once ────────────────────────────────

def test_a_two_track_hour_uses_one_hour(client, db, monkeypatch):
    _vendor(monkeypatch)
    tid = _start(client)
    for seq in range(20):
        _segment(client, tid, seq, "self")
        _segment(client, tid, seq, "other")
    assert db.usage == 3600
    _segment(client, tid, 3, "other")   # a retry
    assert db.usage == 3600


# ── 3. off the record never becomes readable text ────────────────────────

def test_lines_inside_a_gap_are_dropped_on_upload(client, db, monkeypatch):
    _vendor(monkeypatch)
    tid = _start(client)
    assert client.post(f"/api/call-transcripts/{tid}/pause", json={"kind": "off_record", "at_ms": 60_000}).status_code == 200
    _segment(client, tid, 0, "self")   # audio that slipped through while off the record
    stored = db.tables["call_transcript_segments"][0]["lines"]
    assert [l["t_ms"] for l in stored] == [0, 30_000]


def test_lines_inside_a_later_gap_never_come_back_for_owner_or_report(client, db, monkeypatch):
    _vendor(monkeypatch)
    tid = _start(client)
    _segment(client, tid, 0, "self")
    # The gap is recorded after the segment was stored (a late pause call).
    db.tables["call_transcript_gaps"] = [{"id": "g", "transcript_id": tid, "owner_id": MANAGER, "kind": "off_record",
                                          "start_ms": 60_000, "end_ms": 120_000, "created_at": _iso(db.clock)}]
    owner_view = client.get(f"/api/call-transcripts/{tid}").json()
    assert [l["t_ms"] for l in owner_view["lines"]] == [0, 30_000, 120_000, 150_000]

    main.app.dependency_overrides[utils.get_authenticated_client] = lambda: ("report-jordan", db)
    report_view = client.get(f"/api/call-transcripts/{tid}").json()
    assert report_view["viewer"] == "report"
    assert [l["t_ms"] for l in report_view["lines"]] == [0, 30_000, 120_000, 150_000]
    assert "kind" not in str(report_view)


def test_outside_gaps_treats_an_open_gap_as_running_on():
    lines = [{"t_ms": t, "text": "x"} for t in (0, 5, 10, 99_999)]
    assert [l["t_ms"] for l in ct.outside_gaps(lines, [{"start_ms": 5, "end_ms": None}])] == [0]
    assert [l["t_ms"] for l in ct.outside_gaps(lines, [{"start_ms": 5, "end_ms": 10}])] == [0, 10, 99_999]


# ── 4. ready waits for every track ───────────────────────────────────────

def test_ready_waits_for_a_late_other_segment(client, db, monkeypatch):
    _vendor(monkeypatch)
    tid = _start(client)
    _segment(client, tid, 0, "self")
    _segment(client, tid, 0, "other")
    _segment(client, tid, 1, "self")      # Jordan's last 3 minutes haven't landed
    r = client.post(f"/api/call-transcripts/{tid}/end",
                    json={"at_ms": 360_000, "seqs_by_track": {"self": [0, 1], "other": [0, 1]}})
    assert r.json()["transcript"]["status"] == "finishing"
    assert _segment(client, tid, 1, "other")["status"] == "ready"


def test_a_call_tab_added_mid_call_starts_at_a_later_seq(client, db, monkeypatch):
    _vendor(monkeypatch)
    tid = _start(client)
    _segment(client, tid, 0, "mixed")     # mic only, then Jordan's side was added
    _segment(client, tid, 1, "self")
    _segment(client, tid, 1, "other")
    r = client.post(f"/api/call-transcripts/{tid}/end",
                    json={"seqs_by_track": {"mixed": [0], "self": [1], "other": [1]}})
    body = r.json()["transcript"]
    assert body["status"] == "ready" and body["last_seq"] == 1


def test_seqs_by_track_rejects_a_bad_track(client, db, monkeypatch):
    tid = _start(client)
    r = client.post(f"/api/call-transcripts/{tid}/end", json={"seqs_by_track": {"them": [0]}})
    assert r.status_code == 422


# ── 6. a segment's length, not its bytes, is the cost guard ──────────────

def test_a_segment_longer_than_4_minutes_is_refused_and_not_stored(client, db, monkeypatch):
    _vendor(monkeypatch, seconds=50 * 60)
    tid = _start(client)
    body = _segment(client, tid, 0, "self", status=413)
    assert body["detail"]["code"] == "segment_too_long"
    assert not db.tables.get("call_transcript_segments") and db.usage == 0


# ── 7. a long pause doesn't close the call ───────────────────────────────

def test_pause_and_end_still_work_after_a_40_minute_pause(client, db, monkeypatch):
    _vendor(monkeypatch)
    tid = _start(client)
    _segment(client, tid, 0, "self")
    client.post(f"/api/call-transcripts/{tid}/pause", json={"kind": "pause", "at_ms": 180_000})
    db.advance(minutes=40)
    assert client.get(f"/api/call-transcripts/{tid}").json()["status"] == "recording"
    assert client.post(f"/api/call-transcripts/{tid}/resume", json={"at_ms": 2_580_000}).status_code == 200
    r = client.post(f"/api/call-transcripts/{tid}/end", json={"at_ms": 2_600_000, "seqs_by_track": {"self": [0]}})
    assert r.json()["transcript"]["status"] == "ready"


def test_a_pause_left_open_for_over_3_hours_closes_the_call(client, db, monkeypatch):
    _vendor(monkeypatch)
    tid = _start(client)
    _segment(client, tid, 0, "self")
    client.post(f"/api/call-transcripts/{tid}/pause", json={"kind": "pause", "at_ms": 180_000})
    db.advance(hours=3, minutes=1)
    assert client.get(f"/api/call-transcripts/{tid}").json()["status"] == "ready"


# ── 8. resume only continues a call that just stopped ────────────────────

def test_resume_within_30_minutes_reopens_the_same_row(client, db, monkeypatch):
    _vendor(monkeypatch)
    tid = _start(client)
    client.post(f"/api/call-transcripts/{tid}/end", json={"at_ms": 100_000})
    db.advance(minutes=29)
    r = client.post(f"/api/call-transcripts/{tid}/resume", json={"at_ms": 1_840_000})
    assert r.status_code == 200 and r.json()["transcript"]["status"] == "recording"
    assert [g["kind"] for g in db.tables["call_transcript_gaps"]] == ["stopped"]


def test_resume_after_31_minutes_is_refused(client, db, monkeypatch):
    tid = _start(client)
    client.post(f"/api/call-transcripts/{tid}/end", json={"at_ms": 100_000})
    db.advance(minutes=31)
    r = client.post(f"/api/call-transcripts/{tid}/resume", json={"at_ms": 2_000_000})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "resume_window_passed"


def test_reading_an_old_call_does_not_reopen_its_resume_window(client, db, monkeypatch):
    _vendor(monkeypatch)
    tid = _start(client)
    _segment(client, tid, 0, "self")
    db.advance(days=7)                     # abandoned, never ended
    assert client.get(f"/api/call-transcripts/{tid}").json()["status"] == "ready"
    r = client.post(f"/api/call-transcripts/{tid}/resume", json={"at_ms": 0})
    assert r.status_code == 409


# ── 9. a read-only account can still delete and withdraw consent ─────────

def test_read_only_exemptions_are_delete_and_consent_only():
    exempt = main._read_only_exempt
    assert exempt("DELETE", "/api/call-transcripts/abc")
    assert exempt("PUT", "/api/call-transcripts/consent")
    assert not exempt("POST", "/api/call-transcripts")
    assert not exempt("POST", "/api/call-transcripts/abc/segments")
    assert not exempt("POST", "/api/call-transcripts/abc/resume")
    assert not exempt("DELETE", "/api/call-transcripts/abc/segments")
    assert exempt("POST", "/api/settings/account/export") == "/api/settings/account/export".startswith(main._READ_ONLY_ALLOWED)


def test_the_gate_lets_a_read_only_delete_through(monkeypatch):
    monkeypatch.setattr(main, "_entitlement_for", lambda auth: {"read_only": True})
    c = TestClient(main.app)
    headers = {"Authorization": "Bearer t"}
    assert c.post("/api/call-transcripts/abc/end", json={}, headers=headers).status_code == 402
    assert c.delete("/api/call-transcripts/abc", headers=headers).status_code != 402


# ── 5. model, and whisper's invented lines ───────────────────────────────

def test_calls_use_whisper_and_dictation_keeps_its_model():
    assert config.settings.AI_CALL_TRANSCRIBE_MODEL == "whisper-1"
    assert "whisper-1" in ai_core._TIMESTAMP_MODELS
    assert config.settings.AI_TRANSCRIBE_MODEL == "gpt-transcribe"


def test_never_a_diarizing_model():
    assert "diarize" not in config.settings.AI_CALL_TRANSCRIBE_MODEL


def test_whisper_hallucinations_on_a_quiet_track_are_dropped():
    body = {"text": "Thank you for watching. We agreed.", "segments": [
        {"start": 0, "text": "Thank you for watching.", "no_speech_prob": 0.9, "avg_logprob": -1.4, "compression_ratio": 1.1},
        {"start": 4, "text": "We agreed.", "no_speech_prob": 0.05, "avg_logprob": -0.2, "compression_ratio": 1.2},
        {"start": 9, "text": "you you you you you you", "no_speech_prob": 0.1, "avg_logprob": -0.3, "compression_ratio": 3.1},
    ]}
    assert ai_core._call_segment_lines(body, 0) == [{"t_ms": 4000, "text": "We agreed."}]


def test_a_wholly_silent_track_gives_no_lines_not_the_raw_text():
    body = {"text": "Thank you.", "segments": [
        {"start": 0, "text": "Thank you.", "no_speech_prob": 0.95, "avg_logprob": -1.5, "compression_ratio": 1.0}]}
    assert ai_core._call_segment_lines(body, 0) == []


def test_whisper_request_asks_for_timestamps_and_bills_measured_seconds(monkeypatch):
    monkeypatch.setattr(ai_core.settings, "OPENAI_API_KEY", "sk-test")
    seen = {}

    def post(*_a, **k):
        seen.update(k["data"])
        return SimpleNamespace(raise_for_status=lambda: None, json=lambda: {
            "text": "hi", "duration": 179.4, "segments": [{"start": 1, "text": "hi", "no_speech_prob": 0.01,
                                                          "avg_logprob": -0.1, "compression_ratio": 1}]})
    monkeypatch.setattr(ai_core.httpx, "post", post)
    out = ai_core.transcribe_call_segment(b"audio", 180_000)
    assert seen["model"] == "whisper-1" and seen["response_format"] == "verbose_json"
    assert out == {"lines": [{"t_ms": 181_000, "text": "hi"}], "audio_seconds": 179.4}
