"""Logic thuần của Boss Kraken (không I/O): HP, sát thương, giới hạn tốc độ, thưởng."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

COMMENT_DAMAGE = 20            # mỗi comment
GIFT_DAMAGE_PER_COIN = 100     # mỗi xu quà
COMMENT_COOLDOWN_SECONDS = 1.0  # 1 phát/giây/người
MVP_BONUS = 5000
LASTHIT_BONUS = 3000
PARTICIPANT_BONUS = 500


@dataclass
class HitResult:
    damage: int          # sát thương thực tế đã trừ (không vượt quá HP còn lại)
    defeated: bool


@dataclass
class BossRewards:
    mvp_id: int | None
    lasthit_id: int | None
    bonuses: dict[int, int] = field(default_factory=dict)  # player_id -> tổng điểm thưởng


class BossManager:
    def __init__(self) -> None:
        self.active = False
        self.max_hp = 0
        self.current_hp = 0
        self.ends_at = 0.0  # giây (theo clock của engine)
        self.damage: dict[int, int] = {}
        self.last_hit_id: int | None = None
        self._last_comment_hit: dict[int, float] = {}

    def spawn(self, max_hp: int, duration_seconds: float, now: float) -> bool:
        """Chỉ cho phép 1 Boss tại một thời điểm."""
        if self.active:
            return False
        self.active = True
        self.max_hp = max_hp
        self.current_hp = max_hp
        self.ends_at = now + duration_seconds
        self.damage = {}
        self.last_hit_id = None
        self._last_comment_hit = {}
        return True

    def hit(self, player_id: int, damage: int) -> HitResult | None:
        if not self.active or damage <= 0:
            return None
        dealt = min(damage, self.current_hp)
        self.current_hp -= dealt
        self.damage[player_id] = self.damage.get(player_id, 0) + dealt
        self.last_hit_id = player_id
        return HitResult(damage=dealt, defeated=self.current_hp <= 0)

    def hit_by_comment(self, player_id: int, now: float) -> HitResult | None:
        """Comment dư trong vòng 1s của cùng người bị bỏ qua (trả None)."""
        if not self.active:
            return None
        last = self._last_comment_hit.get(player_id)
        if last is not None and now - last < COMMENT_COOLDOWN_SECONDS:
            return None
        self._last_comment_hit[player_id] = now
        return self.hit(player_id, COMMENT_DAMAGE)

    def expired(self, now: float) -> bool:
        return self.active and now >= self.ends_at

    def compute_rewards(self) -> BossRewards:
        """MVP (top sát thương) +5000, Last Hit +3000, mọi người gây sát thương +500."""
        bonuses: dict[int, int] = {pid: PARTICIPANT_BONUS for pid, d in self.damage.items() if d > 0}
        mvp_id = max(self.damage, key=lambda pid: self.damage[pid]) if self.damage else None
        if mvp_id is not None:
            bonuses[mvp_id] = bonuses.get(mvp_id, 0) + MVP_BONUS
        if self.last_hit_id is not None:
            bonuses[self.last_hit_id] = bonuses.get(self.last_hit_id, 0) + LASTHIT_BONUS
        return BossRewards(mvp_id=mvp_id, lasthit_id=self.last_hit_id, bonuses=bonuses)

    def end(self) -> None:
        self.active = False
        self.current_hp = 0
        self._last_comment_hit = {}

    def snapshot(self, status: str = "SPAWNED") -> dict[str, Any] | None:
        if not self.active:
            return None
        return {
            "status": status,
            "current_hp": self.current_hp,
            "max_hp": self.max_hp,
            "ends_at": int(self.ends_at * 1000),
        }
