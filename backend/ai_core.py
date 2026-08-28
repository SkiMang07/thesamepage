"""
Centralized AI call helpers. Every AI call in the app routes through here —
never call the Anthropic/OpenAI SDKs directly from route or domain modules.
This is the single place that knows about provider fallback, model mapping,
and response-shape extraction, so a provider outage or API change is a
one-file fix instead of a grep-and-replace across the codebase.
"""
import logging
import httpx
from fastapi import HTTPException

from config import settings, AI_DEFAULT_MODEL_HEAVY, AI_DEFAULT_MODEL_LIGHT, AI_TRANSCRIBE_MODEL

logger = logging.getLogger("ai_core")

_ANTHROPIC_TO_OPENAI = {
    "claude-sonnet-4-6": "gpt-4o",
    "claude-haiku-4-5-20251001": "gpt-4o-mini",
}


def _call_anthropic(prompt: str, model: str = AI_DEFAULT_MODEL_HEAVY, max_tokens: int = 1500) -> dict:
    try:
        resp = httpx.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": settings.ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": model,
                "max_tokens": max_tokens,
                "system": prompt,
                "messages": [{"role": "user", "content": "Proceed."}],
            },
            timeout=60.0,
        )
        resp.raise_for_status()
        return resp.json()
    except httpx.HTTPStatusError as e:
        if e.response.status_code >= 500 and settings.OPENAI_API_KEY:
            logger.warning("Anthropic 5xx, falling back to OpenAI: %s", e)
            fallback_model = _ANTHROPIC_TO_OPENAI.get(model, "gpt-4o-mini")
            return _call_openai(prompt, model=fallback_model, max_tokens=max_tokens)
        raise HTTPException(status_code=502, detail=f"AI call failed: {e}")


def _call_openai(prompt: str, model: str = "gpt-4o-mini", max_tokens: int = 1500) -> dict:
    resp = httpx.post(
        "https://api.openai.com/v1/chat/completions",
        headers={"Authorization": f"Bearer {settings.OPENAI_API_KEY}"},
        json={
            "model": model,
            "max_tokens": max_tokens,
            "messages": [
                {"role": "system", "content": prompt},
                {"role": "user", "content": "Proceed."},
            ],
        },
        timeout=60.0,
    )
    resp.raise_for_status()
    return resp.json()


def extract_text(provider: str, response: dict) -> str:
    try:
        if provider == "anthropic":
            return response["content"][0]["text"].strip()
        return response["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError) as e:
        raise HTTPException(status_code=502, detail=f"Unexpected AI response shape: {e}")


def generate_text(prompt: str, model: str = AI_DEFAULT_MODEL_HEAVY, max_tokens: int = 1500) -> str:
    """Convenience wrapper: prompt in, plain text out. Use this from route
    handlers for the common case (no need to touch provider/response internals)."""
    response = _call_anthropic(prompt, model=model, max_tokens=max_tokens)
    return extract_text("anthropic", response)


def _call_anthropic_with_document(
    prompt: str,
    document_base64: str,
    media_type: str,
    model: str = AI_DEFAULT_MODEL_HEAVY,
    max_tokens: int = 1500,
) -> dict:
    """Like _call_anthropic, but the user turn carries a base64-encoded
    document (PDF) instead of the fixed "Proceed." text, using Claude's
    native document/vision content block. No OpenAI fallback on 5xx here —
    _call_openai's chat-completions shape has no equivalent native PDF
    input, and building a second extraction path would defeat the point of
    the Claude-native decision (see docs/CONTEXT_ENGINE_BUILD_PLAN.md,
    resolution #1). A 5xx just fails the call; the caller marks the
    document row status='failed' and the user re-uploads."""
    try:
        resp = httpx.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": settings.ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": model,
                "max_tokens": max_tokens,
                "system": prompt,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "document",
                                "source": {
                                    "type": "base64",
                                    "media_type": media_type,
                                    "data": document_base64,
                                },
                            },
                            {"type": "text", "text": "Proceed."},
                        ],
                    }
                ],
            },
            # Documents (multi-page decks) take meaningfully longer to
            # process than a text-only prompt — the 60s budget on
            # _call_anthropic is sized for the latter.
            timeout=120.0,
        )
        resp.raise_for_status()
        return resp.json()
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"AI document call failed: {e}")


def call_anthropic_with_tools(
    system: str,
    messages: list,
    tools: list,
    model: str = AI_DEFAULT_MODEL_HEAVY,
    max_tokens: int = 2000,
) -> dict:
    """Call Anthropic with tool definitions. Returns raw response dict (stop_reason + content).
    No OpenAI fallback — the tool-use message format is Anthropic-specific and has no
    equivalent in the chat-completions shape."""
    try:
        resp = httpx.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": settings.ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": model,
                "max_tokens": max_tokens,
                "system": system,
                "messages": messages,
                "tools": tools,
            },
            timeout=60.0,
        )
        resp.raise_for_status()
        return resp.json()
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"AI tool call failed: {e}")


def generate_text_from_document(
    prompt: str,
    document_base64: str,
    media_type: str = "application/pdf",
    model: str = AI_DEFAULT_MODEL_HEAVY,
    max_tokens: int = 4000,
) -> str:
    """Like generate_text(), but the user turn carries a base64 document
    (PDF) instead of "Proceed." — the Context Engine's Librarian extraction
    call (docs/CONTEXT_ENGINE_BUILD_PLAN.md Session II) uses this to read
    decks/PDFs via Claude's native PDF/vision support instead of a separate
    extraction library, per build-plan resolution #1."""
    response = _call_anthropic_with_document(
        prompt, document_base64, media_type, model=model, max_tokens=max_tokens
    )
    return extract_text("anthropic", response)


# --- dictation --------------------------------------------------------------
# Talk-to-text. Batch, never streaming: the manager taps stop and waits ~1-2s,
# and OpenAI's realtime transcription endpoint costs 3.8x the batch one for a
# latency win nobody asked for here. Cost at the batch rate is ~$0.27/hour of
# audio, which is under $2 per manager per YEAR at realistic dictation volumes.
#
# Audio is sent, transcribed, and dropped. Nothing is stored — not in Supabase
# Storage, not on disk, not in a log line. The bytes exist in memory for the
# length of one request. That is a promise made in the UI (see NoteField's
# first-use notice), so do not add caching here without changing that copy.

_TRANSCRIBE_URL = "https://api.openai.com/v1/audio/transcriptions"

# Hard ceiling on a single dictation. OpenAI's own limit is 25MB; this is far
# tighter because a dictation is a person talking into a text box, not a
# meeting recording. At the 32kbps the browser is told to record at, 5 minutes
# is ~1.2MB, so 8MB is generous headroom for browsers that ignore the bitrate
# hint (Safari does).
MAX_DICTATION_BYTES = 8 * 1024 * 1024


def transcribe_audio(
    audio_bytes: bytes,
    filename: str = "dictation.webm",
    content_type: str = "audio/webm",
    vocabulary: str = "",
) -> str:
    """Audio in, plain text out. Verbatim — this does NOT clean up, summarise
    or restructure what was said.

    That restraint is deliberate. Every other AI write in this app is
    draft-then-review because the model is producing something the manager did
    not say. Dictation is the opposite: the words are already the manager's, so
    passing them through a model to be "tidied" would quietly make a draft out
    of something that was never a draft. Cosmetic cleanup (leading filler, a
    trailing full stop in a one-line field) happens deterministically in
    _tidy() below, where it can be read and reasoned about.

    `vocabulary` is an optional comma-separated hint — direct-report names, team
    and product nouns — passed to the model's `prompt` parameter to bias
    spelling. This is what stops "Priya" coming back as "Prea". It is a hint,
    not an instruction: the model still transcribes what it hears.
    """
    if not settings.OPENAI_API_KEY:
        raise HTTPException(status_code=503, detail="Dictation is not configured on this server")
    if not audio_bytes:
        raise HTTPException(status_code=422, detail="Empty recording")
    if len(audio_bytes) > MAX_DICTATION_BYTES:
        raise HTTPException(status_code=413, detail="Recording too long — 5 minutes max")

    data = {"model": AI_TRANSCRIBE_MODEL, "response_format": "json"}
    hint = (vocabulary or "").strip()
    if hint:
        # Capped hard. A prompt hint is a vocabulary nudge, not a channel for
        # shipping arbitrary record content to the transcription vendor.
        data["prompt"] = hint[:400]

    try:
        resp = httpx.post(
            _TRANSCRIBE_URL,
            headers={"Authorization": f"Bearer {settings.OPENAI_API_KEY}"},
            files={"file": (filename, audio_bytes, content_type)},
            data=data,
            timeout=120.0,
        )
        resp.raise_for_status()
    except httpx.HTTPStatusError as e:
        logger.warning("transcription failed: %s %s", e.response.status_code, e.response.text[:300])
        raise HTTPException(status_code=502, detail="Could not transcribe that recording")
    except httpx.RequestError as e:
        logger.warning("transcription request error: %s", e)
        raise HTTPException(status_code=502, detail="Could not reach the transcription service")

    try:
        return resp.json()["text"].strip()
    except (KeyError, ValueError) as e:
        raise HTTPException(status_code=502, detail=f"Unexpected transcription response shape: {e}")
