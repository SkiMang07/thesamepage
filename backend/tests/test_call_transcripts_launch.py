"""Launch-surface analytics for call transcription: consent cleared, a
transcript deleted, and a saved wrap-up that had a transcript behind it.
Flags only; never a name or a line of text. Fictional data throughout."""
import os
from types import SimpleNamespace

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2ln")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.c2ln")
os.environ.setdefault("ANTHROPIC_API_KEY", "test")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
import utils  # noqa: E402
from routes import call_transcripts as ct  # noqa: E402


class _Query:
    def __init__(self, client, table):
        self.client, self.table, self.op = client, table, "select"

    def select(self, *_a, **_k):
        return self

    def update(self, values):
        self.op = "update"
        self.client.writes.append((self.table, "update", values))
        return self

    def delete(self):
        self.op = "delete"
        self.client.writes.append((self.table, "delete", None))
        return self

    def __getattr__(self, _name):  # eq, is_, in_, limit, ...
        return lambda *a, **k: self

    def execute(self):
        if self.op != "select":
            return SimpleNamespace(data=[])
        rows = self.client.rows.get(self.table)
        if isinstance(rows, Exception):
            raise rows
        return SimpleNamespace(data=rows or [])


class _Client:
    def __init__(self, rows):
        self.rows, self.writes = rows, []

    def table(self, name):
        return _Query(self, name)


@pytest.fixture
def events(monkeypatch):
    seen = []
    monkeypatch.setattr(ct.analytics, "capture", lambda uid, name, props=None: seen.append((name, props)))
    return seen


@pytest.fixture
def as_manager():
    def make(rows):
        client = _Client(rows)
        main.app.dependency_overrides[utils.get_authenticated_client] = lambda: ("manager-1", client)
        return TestClient(main.app), client
    yield make
    main.app.dependency_overrides.clear()


# ── consent cleared ──────────────────────────────────────────────────────

def test_clearing_consent_that_was_set_fires_once(as_manager, events):
    c, client = as_manager({"direct_reports": [{"id": "dr-1", "transcription_consent_at": "2026-10-20T10:00:00Z"}]})
    r = c.put("/api/call-transcripts/consent", json={"direct_report_id": "dr-1", "consented": False})
    assert r.status_code == 200 and r.json() == {"transcription_consent_at": None}
    assert events == [("transcription_consent_cleared", {"person_kind": "direct_report"})]


def test_unticking_consent_that_was_never_set_fires_nothing(as_manager, events):
    c, _ = as_manager({"outside_people": [{"id": "op-1", "transcription_consent_at": None}]})
    r = c.put("/api/call-transcripts/consent", json={"outside_person_id": "op-1", "consented": False})
    assert r.status_code == 200
    assert events == []


def test_ticking_consent_fires_nothing(as_manager, events):
    c, _ = as_manager({"direct_reports": [{"id": "dr-1", "transcription_consent_at": None}]})
    c.put("/api/call-transcripts/consent", json={"direct_report_id": "dr-1", "consented": True})
    assert events == []


# ── transcript deleted ───────────────────────────────────────────────────

def test_deleting_a_transcript_fires_with_its_meeting_type_only(as_manager, events):
    c, client = as_manager({"call_transcripts": [{"id": "t-1", "owner_id": "manager-1", "one_on_one_id": "o-1"}]})
    r = c.delete("/api/call-transcripts/t-1")
    assert r.status_code == 200 and r.json() == {"deleted": True}
    assert ("call_transcripts", "delete", None) in client.writes
    assert events == [("call_transcript_deleted", {"meeting_type": "one_on_one"})]


# ── a saved wrap-up with a transcript behind it ──────────────────────────

def test_meeting_has_transcript_needs_a_stored_segment():
    with_seg = _Client({"call_transcripts": [{"id": "t-1"}], "call_transcript_segments": [{"seq": 0}]})
    no_seg = _Client({"call_transcripts": [{"id": "t-1"}], "call_transcript_segments": []})
    none = _Client({"call_transcripts": []})
    assert ct.meeting_has_transcript(with_seg, "manager-1", "o-1") is True
    assert ct.meeting_has_transcript(no_seg, "manager-1", "o-1") is False
    assert ct.meeting_has_transcript(none, "manager-1", "o-1") is False


def test_meeting_has_transcript_never_fails_the_save():
    broken = _Client({"call_transcripts": RuntimeError("supabase down")})
    assert ct.meeting_has_transcript(broken, "manager-1", "o-1") is False


def test_log_save_fires_the_event_after_the_write():
    """The event sits after the save and the Undo snapshot, before the
    receipt is returned, so a failed save never counts."""
    import inspect
    from routes import one_on_ones
    src = inspect.getsource(one_on_ones.log_one_on_one)
    assert src.index('"log_undo": snapshot') < src.index("call_transcript_used_in_wrapup") < src.index('"undo_until": undo_until')
    assert 'meeting_has_transcript(supabase, user_id, meeting["id"])' in src
