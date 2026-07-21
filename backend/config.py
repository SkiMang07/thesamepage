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

    # Stripe
    STRIPE_SECRET_KEY: str = ""
    STRIPE_WEBHOOK_SECRET: str = ""

    # App
    ENVIRONMENT: str = "development"
    FRONTEND_URL: str = "http://localhost:3000"

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()

# Anthropic model defaults — MUST be valid Anthropic model names.
# (Prism Tree gotcha: an OpenAI name here fails hard since the anthropic
# call path doesn't trigger provider fallback on 4xx errors.)
AI_DEFAULT_MODEL_HEAVY = "claude-sonnet-4-6"
AI_DEFAULT_MODEL_LIGHT = "claude-haiku-4-5-20251001"
