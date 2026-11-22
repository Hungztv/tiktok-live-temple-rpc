"""Kết nối DB async + cache cấu hình game trong RAM."""
from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from models import Base, GameSetting
from schemas import GameSettings

logger = logging.getLogger(__name__)


class Database:
    """Gói engine + session factory; tạo bảng tự động khi khởi động."""

    def __init__(self, url: str) -> None:
        self.url = url
        self.engine: AsyncEngine = create_async_engine(url, future=True)
        self.session_factory = async_sessionmaker(self.engine, expire_on_commit=False)

    async def init(self) -> None:
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("Đã khởi tạo bảng SQLite: %s", self.url)

    async def dispose(self) -> None:
        await self.engine.dispose()

    def session(self) -> AsyncSession:
        return self.session_factory()


class SettingsStore:
    """Cache GameSettings trong RAM; lưu key-value JSON vào DB; áp dụng ngay khi cập nhật."""

    def __init__(self, db: Database) -> None:
        self._db = db
        self._cache = GameSettings()

    @property
    def current(self) -> GameSettings:
        return self._cache

    async def load(self) -> GameSettings:
        async with self._db.session() as s:
            rows = (await s.execute(select(GameSetting))).scalars().all()
        stored = {r.key: r.value for r in rows}
        if "phrases" in stored and not stored["phrases"]:
            del stored["phrases"]  # nếu DB cũ lưu dict rỗng thì nạp bộ 50 câu mặc định
        merged = GameSettings().model_dump()
        merged.update(stored)
        try:
            self._cache = GameSettings.model_validate(merged)
        except ValueError:
            logger.exception("Cấu hình trong DB không hợp lệ, dùng mặc định")
            self._cache = GameSettings()
        await self._persist(self._cache)  # ghi các khoá mặc định còn thiếu
        return self._cache

    async def update(self, patch: dict[str, Any]) -> GameSettings:
        """Gộp patch (merge nông theo khoá gốc, sâu cho dict con), validate rồi lưu."""
        data = self._cache.model_dump()
        for key, value in patch.items():
            if key not in data:
                raise ValueError(f"Khoá cấu hình không tồn tại: {key}")
            if isinstance(value, dict) and isinstance(data[key], dict) and key != "phrases":
                data[key] = {**data[key], **value}
            else:
                data[key] = value
        new_settings = GameSettings.model_validate(data)  # ném ValidationError nếu sai
        await self._persist(new_settings)
        self._cache = new_settings
        logger.info("Đã cập nhật cấu hình game: %s", list(patch))
        return new_settings

    async def _persist(self, settings: GameSettings) -> None:
        async with self._db.session() as s:
            for key, value in settings.model_dump().items():
                row = await s.get(GameSetting, key)
                if row is None:
                    s.add(GameSetting(key=key, value=value))
                else:
                    row.value = value
            await s.commit()
