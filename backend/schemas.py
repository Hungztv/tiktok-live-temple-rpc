"""Pydantic v2 schemas: envelope WS, lệnh client, cấu hình game."""
from __future__ import annotations

import time
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from phrases import get_default_phrases

# ---------------------------------------------------------------- hằng số type
CLIENT_HELLO = "CLIENT_HELLO"
TTS_FINISHED = "TTS_FINISHED"
ADMIN_COMMAND = "ADMIN_COMMAND"
PING = "PING"
PONG = "PONG"
STATE_SYNC = "STATE_SYNC"
COMMAND_RESULT = "COMMAND_RESULT"
TTS_SPEAK = "TTS_SPEAK"
TTS_QUEUE_UPDATE = "TTS_QUEUE_UPDATE"
LOG = "LOG"

Role = Literal["overlay", "dashboard"]

ADMIN_ACTIONS: tuple[str, ...] = (
    "connect_tiktok", "disconnect_tiktok", "spawn_players", "mock_event",
    "summon_boss", "trigger_fever", "reset_lake", "tts_toggle", "tts_config",
    "tts_speak_now", "tts_clear_queue", "phrase_upsert", "phrase_delete",
    "player_adjust", "player_kick", "reset_season", "settings_update",
)
AdminAction = Literal[
    "connect_tiktok", "disconnect_tiktok", "spawn_players", "mock_event",
    "summon_boss", "trigger_fever", "reset_lake", "tts_toggle", "tts_config",
    "tts_speak_now", "tts_clear_queue", "phrase_upsert", "phrase_delete",
    "player_adjust", "player_kick", "reset_season", "settings_update",
]


def now_ms() -> int:
    return int(time.time() * 1000)


# ---------------------------------------------------------------- envelope
class Envelope(BaseModel):
    """Khung chung cho mọi message WS."""

    type: str
    ts: int = Field(default_factory=now_ms)
    data: dict[str, Any] = Field(default_factory=dict)


def make_envelope(msg_type: str, data: dict[str, Any] | None = None) -> dict[str, Any]:
    return Envelope(type=msg_type, data=data or {}).model_dump()


# ---------------------------------------------------------------- client -> server
class ClientHelloData(BaseModel):
    model_config = ConfigDict(extra="ignore")
    role: Role


class TtsFinishedData(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(min_length=1, max_length=128)


class AdminCommandData(BaseModel):
    model_config = ConfigDict(extra="ignore")
    action: AdminAction
    params: dict[str, Any] = Field(default_factory=dict)


class CommandResult(BaseModel):
    ok: bool
    action: str
    message: str | None = None
    error: str | None = None


# ---------------------------------------------------------------- cấu hình game
class GachaRates(BaseModel):
    """Tỷ lệ gacha (%), tổng phải = 100."""

    normal: float = Field(default=65, ge=0, le=100)
    rare: float = Field(default=20, ge=0, le=100)
    chest: float = Field(default=5, ge=0, le=100)
    troll: float = Field(default=10, ge=0, le=100)

    @model_validator(mode="after")
    def _sum_100(self) -> "GachaRates":
        total = self.normal + self.rare + self.chest + self.troll
        if abs(total - 100) > 1e-6:
            raise ValueError(f"Tổng tỷ lệ gacha phải bằng 100% (hiện tại {total:g}%)")
        return self


class TtsSettings(BaseModel):
    enabled: bool = True
    voice: Literal["vi-VN-HoaiMyNeural", "vi-VN-NamMinhNeural"] = "vi-VN-HoaiMyNeural"
    rate: int = Field(default=0, ge=-20, le=50)  # %
    pitch: int = Field(default=0, ge=-10, le=20)  # Hz

    @property
    def rate_str(self) -> str:
        return f"{self.rate:+d}%"

    @property
    def pitch_str(self) -> str:
        return f"{self.pitch:+d}Hz"


class GameSettings(BaseModel):
    gacha: GachaRates = Field(default_factory=GachaRates)
    boss_max_hp: int = Field(default=10_000, ge=1)
    boss_interval_minutes: float = Field(default=15, gt=0)
    boss_duration_seconds: int = Field(default=180, ge=5)
    boss_summon_gift_threshold: int = Field(default=1000, ge=1)
    fever_threshold: int = Field(default=1000, ge=1)
    fever_duration_seconds: int = Field(default=60, ge=1)
    tts: TtsSettings = Field(default_factory=TtsSettings)
    # nhóm -> danh sách câu thoại (50 câu mặc định chia 9 nhóm)
    phrases: dict[str, list[str]] = Field(default_factory=get_default_phrases)

    @field_validator("phrases")
    @classmethod
    def _clean_phrases(cls, v: dict[str, list[str]]) -> dict[str, list[str]]:
        return {k: [s.strip() for s in items if s.strip()] for k, items in v.items()}

    def public_game_settings(self) -> dict[str, Any]:
        """Phần game_settings gửi trong STATE_SYNC (không gồm tts và phrases)."""
        return self.model_dump(exclude={"tts", "phrases"})


# ---------------------------------------------------------------- STATE_SYNC
class FeverState(BaseModel):
    heat: int = 0
    max: int = 1000
    active: bool = False
    ends_at: int | None = None


class Top3Entry(BaseModel):
    player_id: int
    nickname: str
    avatar_url: str = ""
    score: int = 0
    rod_level: int = 1


class StatsState(BaseModel):
    active_players: int = 0
    total_likes: int = 0
    total_coins: int = 0
    tiktok_status: Literal[
        "DISCONNECTED", "CONNECTING", "CONNECTED", "OFFLINE_ROOM", "ERROR"
    ] = "DISCONNECTED"
    connected_username: str = ""


class StateSync(BaseModel):
    players_on_shore: list[dict[str, Any]] = Field(default_factory=list)
    top3: list[Top3Entry] = Field(default_factory=list)
    fever: FeverState = Field(default_factory=FeverState)
    boss: dict[str, Any] | None = None
    stats: StatsState = Field(default_factory=StatsState)
    tts_settings: TtsSettings = Field(default_factory=TtsSettings)
    game_settings: dict[str, Any] = Field(default_factory=dict)

# ---------------------------------------------------------------- tham số ADMIN_COMMAND
class SpawnPlayersParams(BaseModel):
    count: int = Field(default=5, ge=1, le=50)


class MockEventParams(BaseModel):
    kind: Literal["comment", "like", "follow", "gift"]
    user_id: str | None = Field(default=None, max_length=128)
    nickname: str | None = Field(default=None, max_length=64)
    text: str = Field(default="cau", max_length=200)
    count: int = Field(default=1, ge=1, le=100_000)  # số tim (like)
    gift: Literal["rose", "ice_cream", "lion", "universe"] = "rose"
    repeat_count: int = Field(default=1, ge=1, le=9999)
    streaking: bool = False
    group_id: str | None = Field(default=None, max_length=64)


class PlayerAdjustParams(BaseModel):
    player_id: int
    score_delta: int = Field(default=0, ge=-1_000_000_000, le=1_000_000_000)
    rod_level: int | None = Field(default=None, ge=1, le=4)


class PlayerKickParams(BaseModel):
    player_id: int


class ResetSeasonParams(BaseModel):
    confirm: bool = False


class TtsToggleParams(BaseModel):
    enabled: bool | None = None  # None = đảo trạng thái


class TtsConfigParams(BaseModel):
    voice: Literal["vi-VN-HoaiMyNeural", "vi-VN-NamMinhNeural"] | None = None
    rate: int | None = Field(default=None, ge=-20, le=50)
    pitch: int | None = Field(default=None, ge=-10, le=20)


class TtsSpeakNowParams(BaseModel):
    text: str = Field(min_length=1, max_length=300)


class PhraseUpsertParams(BaseModel):
    group: str = Field(min_length=1, max_length=64)
    text: str = Field(min_length=1, max_length=300)
    index: int | None = Field(default=None, ge=0)  # None = thêm mới


class PhraseDeleteParams(BaseModel):
    group: str = Field(min_length=1, max_length=64)
    index: int = Field(ge=0)


class ConnectTiktokParams(BaseModel):
    username: str = Field(min_length=1, max_length=64)

    @field_validator("username")
    @classmethod
    def _strip_at(cls, v: str) -> str:
        v = v.replace("@", "").strip()
        if not v:
            raise ValueError("Username không được rỗng")
        return v
