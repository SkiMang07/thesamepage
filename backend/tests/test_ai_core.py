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
    assert body["thinking"] == {"type": "disabled"}   # N-13: off by default
    # Only these two breakpoints; nothing on the messages themselves.
    assert "cache_control" not in json.dumps(body["messages"])


def test_tools_call_thinking_true_keeps_model_default(wire):
    msgs = [{"role": "user", "content": "hi"}]
    call_anthropic_with_tools(system="s", messages=msgs, tools=[], thinking=True)
    assert "thinking" not in wire[0]["json"]


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


def test_scribe_loop_keeps_thinking_and_sizes_its_budget_for_it(monkeypatch):
    """N-13: the Scribe's final answers were cut mid-sentence when thinking
    shared a 2,000-token round budget. It keeps thinking, with room for it."""
    import assistant_engine

    seen = []

    def fake_tools(**kwargs):
        seen.append(kwargs)
        return {"stop_reason": "end_turn", "content": [{"type": "thinking", "thinking": ""},
                                                       {"type": "text", "text": "Done."}]}

    monkeypatch.setattr(assistant_engine, "call_anthropic_with_tools", fake_tools)
    text, drafts = assistant_engine.run_assistant_turn([], "hi", {}, "2026-09-26")
    assert text == "Done." and drafts == []
    assert seen[0]["thinking"] is True
    assert seen[0]["max_tokens"] == 4000


def test_batch_submit_sends_each_prompt_exactly_as_a_live_call(monkeypatch):
    """A batched prompt must be byte-for-byte the live call it replaces: same
    cached prefix block, same thinking setting, body as the user turn."""
    sent: list[dict] = []

    def fake_post(url, headers=None, json=None, timeout=None, **kw):
        sent.append({"url": url, "json": json})
        return _Resp({"id": "msgbatch_1", "processing_status": "in_progress"})

    monkeypatch.setattr(ai_core.httpx, "post", fake_post)
    monkeypatch.setattr(ai_core.settings, "ANTHROPIC_API_KEY", "test-key")
    batch_id = ai_core.submit_text_batch(
        [("job-1", CachedPrompt("RULES", "DATA")), ("job-2", "whole prompt")],
        model="claude-sonnet-5",
        max_tokens=2000,
    )
    assert batch_id == "msgbatch_1"
    assert sent[0]["url"].endswith("/v1/messages/batches")
    first, second = sent[0]["json"]["requests"]
    assert first["custom_id"] == "job-1"
    assert first["params"] == {
        "model": "claude-sonnet-5",
        "max_tokens": 2000,
        "thinking": {"type": "disabled"},
        "system": [{"type": "text", "text": "RULES", "cache_control": {"type": "ephemeral"}}],
        "messages": [{"role": "user", "content": "DATA"}],
    }
    assert second["params"]["system"] == "whole prompt"          # one-off: uncached
    assert second["params"]["messages"] == [{"role": "user", "content": "Proceed."}]


def test_batch_results_yield_text_or_the_reason_there_is_none(monkeypatch):
    lines = [
        {"custom_id": "a", "result": {"type": "succeeded", "message": {
            "model": "claude-sonnet-5", "usage": {"input_tokens": 5, "output_tokens": 2},
            "content": [{"type": "thinking", "thinking": ""}, {"type": "text", "text": " {\"x\": 1} "}],
        }}},
        {"custom_id": "b", "result": {"type": "errored", "error": {"type": "invalid_request"}}},
        {"custom_id": "c", "result": {"type": "succeeded", "message": {"content": []}}},
    ]

    class _Text:
        text = "\n".join(json.dumps(line) for line in lines) + "\n"

        def raise_for_status(self):
            return None

    monkeypatch.setattr(ai_core.httpx, "get", lambda url, headers=None, timeout=None: _Text())
    out = list(ai_core.batch_text_results({"results_url": "https://example.invalid/results"}))
    assert out == [("a", '{"x": 1}', None), ("b", None, "errored"), ("c", None, "no_text")]
    with pytest.raises(ai_core.AIBatchError):
        list(ai_core.batch_text_results({"processing_status": "in_progress"}))
