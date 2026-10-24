"""The 1:1 wrap-up drafting from the manager's notes plus the call transcript
(build plan session 4). No database and no model: the prompt is captured and
the model's reply is canned. The live-model eval is eval/test_wrapup_transcript.py.
"""
import os
from types import SimpleNamespace

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2ln")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.c2ln")
os.environ.setdefault("ANTHROPIC_API_KEY", "test")

import json  # noqa: E402

import pytest  # noqa: E402
from fastapi import HTTPException  # noqa: E402

import routes.one_on_ones as mod  # noqa: E402
from routes.one_on_ones import WrapUpRequest, wrap_up_one_on_one  # noqa: E402

OFF_RECORD_SPEECH = "my sister is moving in with us"
OFF_RECORD_NOTE = "family move in spring"


class _Query:
    def __init__(self, db, table):
        self.db, self.table, self.filters, self.single_row, self.n = db, table, [], False, None

    def select(self, *_a, **_k):
        return self

    def eq(self, col, value):
        self.filters.append((col, value))
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, n):
        self.n = n
        return self

    def single(self):
        self.single_row = True
        return self

    def update(self, values):
        self.values = values
        return self

    def execute(self):
        rows = [r for r in self.db[self.table] if all(r.get(c) == v for c, v in self.filters)]
        if getattr(self, "values", None) is not None:
            for r in rows:
                r.update(self.values)
        if self.single_row:
            return SimpleNamespace(data=rows[0] if rows else None)
        return SimpleNamespace(data=[dict(r) for r in rows[: self.n or None]])


def _db(*, owner="manager", one_on_one_report="report", segments=None, gaps=None):
    return {
        "direct_reports": [
            {"id": "report", "manager_id": "manager", "name": "Jordan Lee"},
            {"id": "other-report", "manager_id": "manager", "name": "Sam Ortiz"},
        ],
        "one_on_ones": [{"id": "meeting", "manager_id": "manager", "direct_report_id": one_on_one_report}],
        "call_transcripts": [{
            "id": "t1", "owner_id": owner, "one_on_one_id": "meeting", "team_meeting_id": None,
            "outside_meeting_id": None, "status": "ready", "capture_mode": "tab",
            "started_at": "2026-10-23T12:00:00+00:00", "ended_at": "2026-10-23T12:31:00+00:00",
        }],
        "call_transcript_segments": segments if segments is not None else [
            {"seq": 0, "track": "self", "owner_id": owner, "transcript_id": "t1", "offset_ms": 0, "lines": [
                {"t_ms": 61_000, "text": "Can you pull together the Northwind usage review?"},
                {"t_ms": 723_000, "text": "I'll send you the QBR deck from the offsite by Friday."},
            ]},
            {"seq": 0, "track": "other", "owner_id": owner, "transcript_id": "t1", "offset_ms": 0, "lines": [
                {"t_ms": 64_000, "text": "Sure, I'll have it ready by next Wednesday."},
                {"t_ms": 900_000, "text": OFF_RECORD_SPEECH},
            ]},
        ],
        "call_transcript_gaps": gaps if gaps is not None else [
            {"transcript_id": "t1", "start_ms": 880_000, "end_ms": 1_000_000, "kind": "off_record"},
        ],
    }


def _client(db):
    return SimpleNamespace(table=lambda name: _Query(db, name))


def _run(monkeypatch, db, reply, **body):
    prompts = []
    monkeypatch.setattr(mod, "generate_text", lambda p, **k: prompts.append(p) or reply)
    req = WrapUpRequest(direct_report_id=body.pop("direct_report_id", "report"), **body)
    draft = wrap_up_one_on_one.__wrapped__(SimpleNamespace(), req, auth=("manager", _client(db)))
    return draft, prompts


REPLY = json.dumps({
    "summary": "Northwind wants a usage review before renewing.",
    "commitments": [
        {"description": "Prepare the Northwind usage review", "committed_by": "direct_report",
         "due_date": "2026-10-29", "source": "L2", "owner_unsure": False},
        {"description": "Send Jordan the QBR deck", "committed_by": "manager",
         "due_date": "2026-10-24", "source": "L3", "owner_unsure": False},
        {"description": "Book shadow sessions with Priya", "committed_by": "manager",
         "due_date": None, "source": "notes", "owner_unsure": False},
        {"description": "Something from nowhere", "committed_by": "manager", "source": "L99"},
    ],
    "follow_up_items": ["Team-lead path"],
    "opening_line": "How did the usage review land with Northwind?",
})


def test_the_prompt_gets_two_labelled_inputs_with_speaker_labels(monkeypatch):
    draft, prompts = _run(monkeypatch, _db(), REPLY, raw_notes="Northwind risk is about usage", transcript_id="t1")
    body = prompts[0].body
    assert "THE MANAGER'S NOTES" in body and "Northwind risk is about usage" in body
    assert "THE TRANSCRIPT" in body
    assert "[L1 1:01] YOU (manager): Can you pull together" in body
    assert "[L2 1:04] JORDAN: Sure, I'll have it ready" in body
    assert "[L3 12:03] YOU (manager): I'll send you the QBR deck" in body
    prefix = prompts[0].prefix
    assert "notes win on emphasis" in prefix
    assert "Never quote the transcript at length" in prefix
    assert draft.transcript.lines == 3 and not draft.transcript.mic_only


def test_off_the_record_speech_and_notes_never_reach_the_prompt(monkeypatch):
    # The off-the-record note can't even be sent: the request has no field,
    # and an extra field is ignored.
    req = WrapUpRequest.model_validate({"direct_report_id": "report", "raw_notes": "n",
                                        "transcript_id": "t1", "private_notes": OFF_RECORD_NOTE})
    assert not hasattr(req, "private_notes")
    _draft, prompts = _run(monkeypatch, _db(), REPLY, raw_notes="n", transcript_id="t1")
    assert OFF_RECORD_SPEECH not in prompts[0]
    assert OFF_RECORD_NOTE not in prompts[0]


def test_an_open_gap_cuts_everything_after_it(monkeypatch):
    gaps = [{"transcript_id": "t1", "start_ms": 700_000, "end_ms": None, "kind": "off_record"}]
    draft, prompts = _run(monkeypatch, _db(gaps=gaps), REPLY, raw_notes="n", transcript_id="t1")
    assert "QBR deck" not in prompts[0].body and OFF_RECORD_SPEECH not in prompts[0].body
    assert draft.transcript.lines == 2


def test_cited_lines_become_call_times_and_bad_citations_are_not_trusted(monkeypatch):
    draft, _ = _run(monkeypatch, _db(), REPLY, raw_notes="n", transcript_id="t1")
    by = {c.description: c for c in draft.commitments}
    review = by["Prepare the Northwind usage review"]
    assert (review.source, review.source_ms, review.committed_by, review.owner_unsure) == ("call", 64_000, "direct_report", False)
    deck = by["Send Jordan the QBR deck"]
    assert (deck.source, deck.source_ms, deck.committed_by) == ("call", 723_000, "manager")
    assert by["Book shadow sessions with Priya"].source == "notes"
    nowhere = by["Something from nowhere"]
    assert nowhere.source is None and nowhere.source_ms is None and nowhere.owner_unsure


def test_mic_only_lines_always_ask_the_manager_to_confirm_the_owner(monkeypatch):
    segments = [{"seq": 0, "track": "mixed", "owner_id": "manager", "transcript_id": "t1", "offset_ms": 0, "lines": [
        {"t_ms": 5_000, "text": "Can you send the deck?"}, {"t_ms": 8_000, "text": "Sure, by Friday."},
    ]}]
    reply = json.dumps({"summary": "S", "commitments": [
        {"description": "Send the deck", "committed_by": "direct_report", "source": "L2", "owner_unsure": False},
    ], "follow_up_items": [], "opening_line": ""})
    draft, prompts = _run(monkeypatch, _db(segments=segments, gaps=[]), reply, raw_notes="", transcript_id="t1")
    assert "MIC (both of you, speaker unknown): Sure, by Friday." in prompts[0].body
    assert draft.transcript.mic_only
    assert draft.commitments[0].owner_unsure is True


def test_someone_elses_transcript_is_not_found(monkeypatch):
    with pytest.raises(HTTPException) as err:
        _run(monkeypatch, _db(owner="another-manager"), REPLY, raw_notes="n", transcript_id="t1")
    assert err.value.status_code == 404


def test_a_transcript_of_a_1_1_with_someone_else_is_not_found(monkeypatch):
    with pytest.raises(HTTPException) as err:
        _run(monkeypatch, _db(one_on_one_report="other-report"), REPLY, raw_notes="n", transcript_id="t1")
    assert err.value.status_code == 404


def test_nothing_to_draft_from_skips_the_model(monkeypatch):
    draft, prompts = _run(monkeypatch, _db(segments=[], gaps=[]), REPLY, raw_notes="  ", transcript_id="t1")
    assert prompts == [] and draft.summary == "" and draft.transcript.lines == 0


def test_without_a_transcript_the_prompt_is_the_notes_only_one(monkeypatch):
    draft, prompts = _run(monkeypatch, _db(), REPLY, raw_notes="Typed notes")
    assert "RAW CALL NOTES" in prompts[0].body and "THE TRANSCRIPT" not in prompts[0].body
    assert "owner_unsure" not in prompts[0].prefix
    assert draft.transcript is None and all(c.source is None for c in draft.commitments)


def test_a_long_call_is_cut_to_fit_and_says_so():
    lines = [{"t_ms": i * 1000, "speaker": "self", "text": "x" * 500} for i in range(400)]
    block, truncated = mod.format_transcript_for_wrapup(lines, "Jordan Lee")
    assert truncated and len(block) <= mod.WRAPUP_TRANSCRIPT_MAX_CHARS
    assert block.startswith("[L1 0:00] YOU (manager)")


def test_call_clock_formats():
    assert mod._call_clock(723_000) == "12:03"
    assert mod._call_clock(3_725_000) == "1:02:05"
    assert mod._call_clock(-5) == "0:00"
