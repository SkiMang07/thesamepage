"""
Environment configuration for The Same Page backend.
Mirrors Prism Tree's config.py pattern: all secrets read from env vars,
nothing hardcoded, validated at import time via pydantic-settings.
"""
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Supabase
    SUPABASE_URL: str
    SUPABASE_ANON_KEY: str
    SUPABASE_SERVICE_ROLE_KEY: str

    # AI providers
    ANTHROPIC_API_KEY: str = ""
    OPENAI_API_KEY: str = ""
    # Scribe establishes its quality bar independently from the model defaults
    # used by one-shot generation elsewhere. Sonnet 5 matched the Opus 5 eval
    # bar with tighter calibration; this remains environment-configurable.
    AI_SCRIBE_MODEL: str = "claude-sonnet-5"
    # Dictation (talk-to-text). OpenAI rather than Anthropic because Claude
    # has no audio input modality at all, and because OPENAI_API_KEY is
    # already wired here — this adds no new vendor relationship. Alternatives
    # if accuracy on manager-speak disappoints: "gpt-4o-transcribe" (older,
    # 4.0% WER), "gpt-4o-mini-transcribe" (cheapest at $0.18/hr, 4.5% WER).
    AI_TRANSCRIBE_MODEL: str = "gpt-transcribe"

    # Stripe
    STRIPE_SECRET_KEY: str = ""
    STRIPE_WEBHOOK_SECRET: str = ""

    # App
    ENVIRONMENT: str = "development"
    FRONTEND_URL: str = "http://localhost:3000"
    # Reversible Mission Control rollout. `allowlist` accepts a comma-separated
    # set of authenticated user UUIDs in MISSION_CONTROL_ACTION_FIRST_ALLOWLIST.
    MISSION_CONTROL_ACTION_FIRST_MODE: str = "on"
    MISSION_CONTROL_ACTION_FIRST_ALLOWLIST: str = ""

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()

# Anthropic model defaults — MUST be valid Anthropic model names.
# (Prism Tree gotcha: an OpenAI name here fails hard since the anthropic
# call path doesn't trigger provider fallback on 4xx errors.)
AI_DEFAULT_MODEL_HEAVY = "claude-sonnet-4-6"
AI_DEFAULT_MODEL_LIGHT = "claude-haiku-4-5-20251001"
AI_SCRIBE_MODEL = settings.AI_SCRIBE_MODEL

# Transcription model — an OpenAI name, NOT an Anthropic one. This never
# routes through the Anthropic path or the provider-fallback map.
AI_TRANSCRIBE_MODEL = settings.AI_TRANSCRIBE_MODEL
