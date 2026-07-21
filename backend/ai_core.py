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

from config import settings, AI_DEFAULT_MODEL_HEAVY, AI_DEFAULT_MODEL_LIGHT

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
