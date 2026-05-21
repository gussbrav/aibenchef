"""Configuracion centralizada con pydantic-settings.

Lee .env (local), variables de entorno (prod), o defaults sanos.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # --- App ---
    log_level: str = Field(default="INFO")
    app_env: str = Field(default="development")

    # --- Database ---
    database_url: str = Field(..., description="postgres://user:pass@host:port/db")

    # --- Storage de archivos crudos ---
    raw_storage_dir: Path = Field(
        default=Path("./local-data/raw"),
        description="Carpeta local donde se almacenan .xls descargados de SBS. "
        "Cuando agreguemos MinIO, esta var se vuelve MINIO_* y se usa el bucket.",
    )

    # --- SBS scraping ---
    sbs_base_url: str = Field(default="https://www.sbs.gob.pe")
    sbs_user_agent: str = Field(
        default="aibenchef-data-platform/0.1 (+https://aibenchef.azoramind.com)",
    )
    sbs_download_concurrency: int = Field(default=8, ge=1, le=32)
    sbs_download_timeout_seconds: int = Field(default=60, ge=10)
    sbs_max_retries: int = Field(default=3, ge=0, le=10)

    # --- Playwright ---
    playwright_headless: bool = Field(default=True)
    playwright_browser: str = Field(default="chromium")

    # --- dbt ---
    dbt_target: str = Field(default="dev")
    dbt_profiles_dir: Path | None = Field(default=None)

    # --- Observabilidad ---
    sentry_dsn: str | None = Field(default=None)


@lru_cache
def settings() -> Settings:
    """Singleton de Settings. Cacheado para no re-parsear en cada acceso."""
    return Settings()  # type: ignore[call-arg]
