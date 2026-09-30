"""Attach a file to a note (upload chunk 1): the endpoint returns a file's text
and nothing else. No model call, nothing saved, events carry counts only."""
import os

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2ln")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.c2ln")
os.environ.setdefault("ANTHROPIC_API_KEY", "test")

import io  # noqa: E402
import json  # noqa: E402
import zipfile  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import analytics  # noqa: E402
import main  # noqa: E402
import routes.file_text as ft  # noqa: E402
import utils  # noqa: E402

VTT = """WEBVTT

NOTE this is a comment

1
00:00:01.000 --> 00:00:04.000
<v Priya>I asked about the senior title last week.</v>

2
00:00:04.500 --> 00:00:07.000
<v Priya>Nobody has come back to me on it.</v>

3
00:00:07.500 --> 00:00:10.000
<v Sam>I'll find out the timing by Friday.</v>

4
00:00:10.000 --> 00:00:12.000
<v Sam>I'll find out the timing by Friday.</v>
"""

SRT = """1
00:00:01,000 --> 00:00:03,000
We agreed to move the launch a week.

2
00:00:03,500 --> 00:00:06,000
Billing screens still have no owner.
"""


@pytest.fixture
def client(monkeypatch):
    main.app.dependency_overrides[utils.get_authenticated_client] = lambda: ("u1", object())
    sent = []
    monkeypatch.setattr(analytics, "capture", lambda uid, ev, props=None: sent.append((ev, props)))
    yield TestClient(main.app), sent
    main.app.dependency_overrides.clear()


def _docx(paragraphs):
    body = "".join(f"<w:p><w:r><w:t>{p}</w:t></w:r></w:p>" for p in paragraphs)
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body>{body}</w:body></w:document>"
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("word/document.xml", xml)
    return buf.getvalue()


# ── captions ─────────────────────────────────────────────────────────────

def test_vtt_keeps_what_was_said_and_who_said_it():
    out = ft.clean_captions(VTT)
    assert out == (
        "Priya: I asked about the senior title last week. Nobody has come back to me on it.\n"
        "Sam: I'll find out the timing by Friday."
    )
    assert "-->" not in out and "WEBVTT" not in out and "NOTE" not in out


def test_srt_drops_numbers_and_timestamps_and_keeps_line_breaks():
    out = ft.clean_captions(SRT)
    assert out == "We agreed to move the launch a week.\nBilling screens still have no owner."


# ── the endpoint ─────────────────────────────────────────────────────────

def test_a_text_file_comes_back_as_text_and_the_event_has_no_content(client):
    c, sent = client
    body = "Maya asked about the Brightline renewal and the senior title. " * 4
    r = c.post(
        "/api/files/extract-text",
        files={"file": ("Priya 1-1 Sep 22.txt", body.encode(), "text/plain")},
        data={"surface": "one_on_one_notes"},
    )
    assert r.status_code == 200
    assert r.json() == {"name": "Priya 1-1 Sep 22.txt", "text": body.strip(), "chars": len(body.strip()), "truncated": False}
    (event, props), = sent
    assert event == "file_text_extracted"
    assert props == {"surface": "one_on_one_notes", "kind": "txt", "size": "under_1k", "truncated": False}
    assert "Maya" not in json.dumps(sent) and "Priya" not in json.dumps(sent)


def test_a_word_document_is_read(client):
    c, _ = client
    raw = _docx(["Goals for the quarter", "Cut first response time under four hours for every ticket."])
    r = c.post("/api/files/extract-text", files={"file": ("notes.docx", raw, "application/octet-stream")})
    assert r.status_code == 200
    assert "Cut first response time" in r.json()["text"]


def test_a_captions_file_is_cleaned(client):
    c, sent = client
    r = c.post("/api/files/extract-text", files={"file": ("call.vtt", VTT.encode(), "text/vtt")})
    assert r.status_code == 200
    assert r.json()["text"].startswith("Priya: I asked about the senior title")
    assert sent[0][1]["kind"] == "vtt"


def test_long_text_is_cut_and_says_so(client, monkeypatch):
    c, sent = client
    monkeypatch.setattr(ft, "MAX_CHARS", 100)
    r = c.post("/api/files/extract-text", files={"file": ("long.txt", ("word " * 200).encode(), "text/plain")})
    assert r.status_code == 200
    assert r.json()["truncated"] is True and r.json()["chars"] == 100
    assert sent[0][1]["truncated"] is True


def test_audio_and_video_are_refused_by_name(client):
    c, sent = client
    r = c.post("/api/files/extract-text", files={"file": ("standup.m4a", b"\x00" * 200, "audio/mp4")})
    assert r.status_code == 422
    assert "standup.m4a" in r.json()["detail"] and "transcript" in r.json()["detail"]
    assert sent == []


def test_an_unsupported_type_says_what_is_accepted(client):
    c, _ = client
    r = c.post("/api/files/extract-text", files={"file": ("plan.xlsx", b"x" * 200, "application/octet-stream")})
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert "plan.xlsx" in detail and ".vtt" in detail and ".docx" in detail


def test_empty_and_unreadable_files_are_refused(client):
    c, _ = client
    assert c.post("/api/files/extract-text", files={"file": ("a.txt", b"", "text/plain")}).status_code == 422
    r = c.post("/api/files/extract-text", files={"file": ("scan.txt", b"hi", "text/plain")})
    assert r.status_code == 422 and "scan.txt" in r.json()["detail"]
    r = c.post("/api/files/extract-text", files={"file": ("empty.vtt", b"WEBVTT\n\n", "text/vtt")})
    assert r.status_code == 422


def test_an_unknown_surface_is_recorded_as_other(client):
    c, sent = client
    c.post(
        "/api/files/extract-text",
        files={"file": ("n.txt", ("a real sentence about the week. " * 5).encode(), "text/plain")},
        data={"surface": "somewhere-else"},
    )
    assert sent[0][1]["surface"] == "other"


def test_this_route_never_calls_a_model():
    assert not hasattr(ft, "generate_text") and not hasattr(ft, "call_anthropic_with_tools")
