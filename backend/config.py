"""Cấu hình ứng dụng, đọc từ biến môi trường / file .env."""
from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent


class AppConfig(BaseSettings):
    """Cấu hình tĩnh (cần restart để đổi). Cấu hình game động nằm ở bảng game_settings."""

    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    host: str = "127.0.0.1"
    port: int = 8000
    database_url: str = f"sqlite+aiosqlite:///{(BASE_DIR / 'game.db').as_posix()}"
    # Danh sách origin frontend, phân tách bằng dấu phẩy
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    log_level: str = "INFO"

    # TikTok
    tiktok_username: str = ""
    sign_api_key: str = ""

    # LLM tuỳ chọn (mặc định dùng Template Engine)
    llm_provider: str = "template"  # template | gemini | ollama
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.0-flash"
    ollama_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "llama3.2"

    ws_ping_interval_seconds: float = Field(default=20.0, gt=0)

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_config() -> AppConfig:
    return AppConfig()


def setup_logging(level: str = "INFO") -> None:
    """Thiết lập logging chuẩn cho toàn backend."""
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
    )
