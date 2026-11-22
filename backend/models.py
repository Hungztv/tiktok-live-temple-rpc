"""SQLAlchemy 2.x ORM models."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Player(Base):
    __tablename__ = "players"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tiktok_unique_id: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    nickname: Mapped[str] = mapped_column(String(128), default="")
    avatar_url: Mapped[str] = mapped_column(String, default="")
    score: Mapped[int] = mapped_column(Integer, default=0)
    gold: Mapped[int] = mapped_column(Integer, default=0)
    rod_level: Mapped[int] = mapped_column(Integer, default=1)  # 1-4
    lucky_bait_count: Mapped[int] = mapped_column(Integer, default=0)
    total_gift_coins: Mapped[int] = mapped_column(Integer, default=0)
    last_active: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class EventLog(Base):
    __tablename__ = "event_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    # DONATE / BOSS_KILL / JACKPOT / UPGRADE / FEVER / ADMIN
    type: Mapped[str] = mapped_column(String(32), index=True)
    player_id: Mapped[int | None] = mapped_column(
        ForeignKey("players.id", ondelete="SET NULL"), nullable=True
    )
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    session_id: Mapped[str] = mapped_column(String(64), default="", index=True)


class GameSetting(Base):
    """Key-value JSON cho cấu hình game động."""

    __tablename__ = "game_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[Any] = mapped_column(JSON)
