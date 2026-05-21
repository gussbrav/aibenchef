"""Configuracion centralizada (pydantic-settings)."""

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_env: Literal["development", "staging", "production"] = "development"
    app_url: str = "http://localhost:3000"
    api_url: str = "http://localhost:8000"
    log_level: str = "info"

    database_url: str
    database_url_admin: str | None = None
    redis_url: str = "redis://localhost:6379"

    cubejs_api_url: str = "http://localhost:4000/cubejs-api/v1"
    cubejs_api_secret: str

    clerk_secret_key: str = Field(default="")
    clerk_webhook_secret: str = Field(default="")

    stripe_secret_key: str = Field(default="")
    stripe_webhook_secret: str = Field(default="")

    sentry_dsn: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
