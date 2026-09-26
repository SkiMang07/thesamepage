"""
ai_core request shapes — what goes over the wire to Anthropic.

Prompt caching is a request-shape concern: a prefix caches only when it is
sent as a system block carrying `cache_control`, and a one-off prompt must
NOT carry it (a cache write costs 1.25x and a one-off never reads it back).
These tests pin the shape so a refactor can't silently turn caching off, or
on where it costs money.
"""
import json
import os

import pytest

for _k in ("SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"):
    os.environ.setdefault(_k, f"https://dummy.{_k.lower()}.invalid")

import ai_core  # noqa: E402
from ai_core import CachedPrompt, call_anthropic_with_tools, generate_text  # noqa: E402


class _Resp:
    def __init__(self, payload):
        self._payload = payload
        self.status_code = 200

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


@pytest.fixture
def wire(monkeypatch):
    """Capture the JSON body httpx.post would send; answer with a fixed reply."""
    sent: list[dict] = []

    def fake_post(url, headers=None, json=None, timeout=None, **kw):
        sent.append({"url": url, "json": json, "timeout": timeout})
        return _Resp({
            "content": [{"type": "text", "text": "  {\"ok\": true}  "}],
            "usage": {"input_tokens": 10, "output_tokens": 3, "cache_read_input_tokens": 0},
            "stop_reason": "end_turn",
            "model": json["model"],
        })

    monkeypatch.setattr(ai_core.httpx, "post", fake_post)
    monkeypatch.setattr(ai_core.settings, "ANTHROPIC_API_KEY", "test-key")
    return sent


def test_cached_prompt_is_the_full_text_and_keeps_its_parts():
    p = CachedPrompt("RULES", "DATA")
    assert isinstance(p, str)
    assert p == "RULES\n\nDATA"
    assert "RULES" in p and "DATA" in p
    assert p.prefix == "RULES" and p.body == "DATA"
    assert json.dumps({"p": p}) == '{"p": "RULES\\n\\nDATA"}'


def test_legacy_prompt_is_system_plus_proceed_and_uncached(wire):
    out = generate_text("whole prompt", model="claude-sonnet-5", max_tokens=99)
    assert out == '{"ok": true}'
    body = wire[0]["json"]
    assert body["system"] == "whole prompt"           # plain string, no blocks
    assert body["messages"] == [{"role": "user", "content": "Proceed."}]
    assert "cache_control" not in json.dumps(body)
    assert body["max_tokens"] == 99 and body["model"] == "claude-sonnet-5"


def test_split_prompt_caches_the_prefix_and_sends_the_body_as_user(wire):
    generate_text(CachedPrompt("stable rules", "this record"))
    body = wire[0]["json"]
    assert body["system"] == [
        {"type": "text", "text": "stable rules", "cache_control": {"type": "ephemeral"}}
    ]
    assert body["messages"] == [{"role": "user", "content": "this record"}]
    assert "cache_control" not in body      # no top-level automatic caching on a one-shot
    assert body["thinking"] == {"type": "disabled"}


def test_prefix_and_body_kwargs_match_cached_prompt(wire):
    generate_text(prefix="stable rules", body="this record")
    generate_text(CachedPrompt("stable rules", "this record"))
    assert wire[0]["json"] == wire[1]["json"]


def test_prefix_without_body_is_a_programming_error(wire):
    with pytest.raises(ValueError):
        generate_text(prefix="rules only")
    with pytest.raises(ValueError):
        generate_text()
    assert wire == []


def test_tools_call_has_system_breakpoint_and_automatic_caching(wire):
    msgs = [{"role": "user", "content": "hi"}]
    tools = [{"name": "t", "description": "d", "input_schema": {"type": "object"}}]
    call_anthropic_with_tools(system="agent rules", messages=msgs, tools=tools, model="claude-sonnet-5")
    body = wire[0]["json"]
    assert body["cache_control"] == {"type": "ephemeral"}
    assert body["system"] == [
        {"type": "text", "text": "agent rules", "cache_control": {"type": "ephemeral"}}
    ]
    assert body["messages"] == msgs and body["tools"] == tools
    assert "thinking" not in body            # the Scribe keeps the model default
    # Only these two breakpoints; nothing on the messages themselves.
    assert "cache_control" not in json.dumps(body["messages"])


def test_openai_fallback_keeps_the_split(monkeypatch):
    """On a 5xx the prefix is the system message and the body the user turn."""
    import httpx

    calls: list[dict] = []

    class _Err(_Resp):
        def __init__(self):
            super().__init__({})
            self.status_code = 503

        def raise_for_status(self):
            req = httpx.Request("POST", ai_core._ANTHROPIC_URL)
            raise httpx.HTTPStatusError("boom", request=req, response=httpx.Response(503, request=req))

    def fake_post(url, headers=None, json=None, timeout=None, **kw):
        calls.append({"url": url, "json": json})
        if "anthropic" in url:
            return _Err()
        r = _Resp({"choices": [{"message": {"content": "fallback"}}], "usage": {}, "model": json["model"]})
        r.is_error = False
        return r

    monkeypatch.setattr(ai_core.httpx, "post", fake_post)
    monkeypatch.setattr(ai_core.settings, "ANTHROPIC_API_KEY", "k")
    monkeypatch.setattr(ai_core.settings, "OPENAI_API_KEY", "k2")
    out = generate_text(CachedPrompt("rules", "record"), model="claude-sonnet-5")
    assert out == "fallback"
    oa = calls[1]["json"]
    assert oa["model"] == "gpt-4o"
    assert oa["messages"] == [{"role": "system", "content": "rules"}, {"role": "user", "content": "record"}]


def test_usage_log_records_cache_fields(monkeypatch, caplog):
    seen = {}

    def fake_log(msg, extra=None):
        seen.update(extra["fields"])

    monkeypatch.setattr(ai_core.logger, "info", fake_log)
    ai_core._log_usage("anthropic", "text", "claude-sonnet-5", {
        "usage": {"input_tokens": 5, "output_tokens": 7, "cache_read_input_tokens": 4000, "cache_creation_input_tokens": 0},
        "stop_reason": "end_turn",
    }, started=0.0)
    assert seen["cache_read_input_tokens"] == 4000
    assert "cache_creation_input_tokens" not in seen   # zeros are dropped, not logged
    assert seen["input_tokens"] == 5


def test_extract_text_skips_thinking_blocks_and_joins_text():
    from ai_core import extract_text
    resp = {"content": [
        {"type": "thinking", "thinking": "", "signature": "x"},
        {"type": "text", "text": "  first "},
        {"type": "text", "text": "second  "},
    ]}
    assert extract_text("anthropic", resp) == "first second"


def test_extract_text_rejects_a_reply_with_no_text():
    from fastapi import HTTPException
    from ai_core import extract_text
    with pytest.raises(HTTPException):
        extract_text("anthropic", {"content": [{"type": "thinking", "thinking": ""}]})
