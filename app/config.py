"""Application configuration utilities."""
from __future__ import annotations

import os
from functools import lru_cache
from typing import Optional

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Environment-driven configuration for the FastAPI application."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", case_sensitive=False)

    port: int = Field(8000, validation_alias=AliasChoices("PORT", "port"))
    static_dir: str = Field("static", validation_alias=AliasChoices("STATIC_DIR", "static_dir"))
    enable_telemetry: bool = Field(True, validation_alias=AliasChoices("ENABLE_TELEMETRY", "enable_telemetry"))
    telemetry_max_events: int = Field(1000, validation_alias=AliasChoices("TELEMETRY_MAX_EVENTS", "telemetry_max_events"))
    telemetry_rate_limit_seconds: float = Field(
        2.0, validation_alias=AliasChoices("TELEMETRY_RATE_LIMIT_SECONDS", "telemetry_rate_limit_seconds")
    )


@lru_cache()
def get_settings() -> Settings:
    """Return cached application settings."""

    return Settings()
