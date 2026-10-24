"""Echo dedupe for call transcripts (scoping §5, build plan session 2).

Without headphones the manager's mic hears Jordan through the speakers, so
Jordan's words are transcribed twice: once on `other` (the call tab, the clean
copy) and once on `self`. drop_echo() removes the `self` copy on read.

All dialogue here is fictional.
"""
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


def line(t_ms, speaker, text):
    return {"t_ms": t_ms, "speaker": speaker, "text": text}


def texts(lines):
    return [(l["speaker"], l["text"]) for l in lines]


def test_an_echo_of_jordan_on_the_mic_is_dropped():
    lines = [
        line(10_000, "other", "I can have the onboarding deck ready by Thursday."),
        line(10_400, "self", "I can have the onboarding deck ready by Thursday"),
        line(14_000, "self", "Great, send it to me first."),
    ]
    assert texts(ct.drop_echo(lines)) == [
        ("other", "I can have the onboarding deck ready by Thursday."),
        ("self", "Great, send it to me first."),
    ]


def test_echo_with_small_transcription_differences_is_still_caught():
    # The speaker copy is muddier: one word lost, punctuation and case differ.
    lines = [
        line(30_000, "other", "The renewal call with Halvorsen Farms moved to next Tuesday."),
        line(31_200, "self", "the renewal call with Halverson farms moved to next Tuesday"),
    ]
    assert texts(ct.drop_echo(lines)) == [("other", "The renewal call with Halvorsen Farms moved to next Tuesday.")]


def test_an_echo_spanning_two_of_jordans_lines_is_dropped():
    lines = [
        line(50_000, "other", "I talked to the support team."),
        line(52_500, "other", "They want a second reviewer on escalations."),
        line(50_300, "self", "I talked to the support team they want a second reviewer on escalations"),
    ]
    lines.sort(key=lambda l: l["t_ms"])
    assert [s for s, _ in texts(ct.drop_echo(lines))] == ["other", "other"]


def test_the_manager_restating_jordan_afterwards_is_kept():
    lines = [
        line(70_000, "other", "I'll send the deck Friday."),
        line(76_000, "self", "So you'll send the deck Friday, and I'll review it Monday."),
    ]
    assert ct.drop_echo(lines) == lines


def test_the_same_words_said_far_apart_are_kept():
    lines = [
        line(10_000, "other", "Can we talk about the hiring plan?"),
        line(95_000, "self", "Can we talk about the hiring plan?"),
    ]
    assert ct.drop_echo(lines) == lines


def test_short_lines_need_an_exact_match_close_in_time():
    lines = [
        line(5_000, "other", "Yeah, sure."),
        line(5_600, "self", "yeah sure"),          # echo: dropped
        line(20_000, "other", "Okay."),
        line(20_300, "self", "Okay, good."),       # different words: kept
        line(40_000, "other", "Thanks."),
        line(44_000, "self", "Thanks."),           # too far apart: kept
    ]
    assert texts(ct.drop_echo(lines)) == [
        ("other", "Yeah, sure."),
        ("other", "Okay."),
        ("self", "Okay, good."),
        ("other", "Thanks."),
        ("self", "Thanks."),
    ]


def test_a_manager_line_that_only_partly_overlaps_is_kept():
    # Talking over Jordan: some shared words, but most of it is the manager's.
    lines = [
        line(60_000, "other", "The pilot results came in this morning."),
        line(60_500, "self", "Before the pilot results, can we cover your goals for next quarter?"),
    ]
    assert ct.drop_echo(lines) == lines


def test_mixed_and_other_lines_are_never_dropped():
    mic_only = [line(1_000, "mixed", "Morning."), line(1_200, "mixed", "Morning.")]
    assert ct.drop_echo(mic_only) == mic_only
    tab_only = [line(1_000, "other", "Hi there."), line(1_100, "other", "Hi there.")]
    assert ct.drop_echo(tab_only) == tab_only


def test_an_empty_or_punctuation_only_line_is_left_alone():
    lines = [line(1_000, "other", "..."), line(1_100, "self", "...")]
    assert ct.drop_echo(lines) == lines


# ── through GET ───────────────────────────────────────────────────────────

class _Table:
    def __init__(self, rows):
        self.rows = rows

    def __getattr__(self, _name):
        return lambda *a, **k: self

    def execute(self):
        return SimpleNamespace(data=self.rows)


class _OwnerClient:
    def table(self, name):
        if name == "call_transcripts":
            return _Table([{"id": "t1", "owner_id": "manager", "one_on_one_id": "o1", "status": "ready",
                            "capture_mode": "tab", "ended_reason": "manager", "started_at": None,
                            "ended_at": None, "consent_confirmed_at": "2026-10-23", "last_activity_at": None}])
        if name == "call_transcript_segments":
            return _Table([
                {"seq": 0, "track": "other", "offset_ms": 0, "lines": [
                    {"t_ms": 2_000, "text": "I finished the churn analysis for the northern accounts."}]},
                {"seq": 0, "track": "self", "offset_ms": 0, "lines": [
                    {"t_ms": 2_300, "text": "I finished the churn analysis for the northern accounts"},
                    {"t_ms": 8_000, "text": "Nice. What surprised you?"}]},
            ])
        if name == "call_transcript_gaps":
            return _Table([])
        raise AssertionError(f"unexpected table {name}")


@pytest.fixture
def owner_client():
    main.app.dependency_overrides[utils.get_authenticated_client] = lambda: ("manager", _OwnerClient())
    yield TestClient(main.app)
    main.app.dependency_overrides.clear()


def test_get_returns_the_transcript_without_the_echo(owner_client):
    body = owner_client.get("/api/call-transcripts/t1").json()
    assert [(l["speaker"], l["text"]) for l in body["lines"]] == [
        ("other", "I finished the churn analysis for the northern accounts."),
        ("self", "Nice. What surprised you?"),
    ]
