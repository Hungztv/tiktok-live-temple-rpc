"""Mock Simulator: tạo người chơi/sự kiện giả, đẩy qua CÙNG GameEngine.handle_event."""
from __future__ import annotations

import base64
import itertools
import random
import uuid
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from game_engine import GameComment, GameFollow, GameGift, GameLike, UserInfo
from schemas import MockEventParams

if TYPE_CHECKING:
    from game_engine import GameEngine

LAST_NAMES = ["Nguyễn", "Trần", "Lê", "Phạm", "Hoàng", "Vũ", "Đặng", "Bùi", "Đỗ", "Ngô"]
MID_NAMES = ["Văn", "Thị", "Minh", "Quốc", "Thanh", "Ngọc", "Hữu", "Bảo", "Gia", "Anh"]
FIRST_NAMES = ["Hùng", "Lan", "Tú", "Mai", "Nam", "Hà", "Phúc", "Linh", "Khoa", "Trang", "Đạt", "Vy", "Long", "Thảo"]
COLORS = ["#ff6b6b", "#feca57", "#48dbfb", "#1dd1a1", "#5f27cd", "#ff9ff3", "#ff9f43", "#54a0ff", "#00d2d3", "#c8d6e5"]

# Danh mục quà giả lập: key -> (id, tên, xu, streakable)
GIFT_CATALOG: dict[str, tuple[int, str, int, bool]] = {
    "rose": (5655, "Hoa Hồng", 1, True),
    "ice_cream": (5827, "Kem", 10, True),
    "lion": (6104, "Sư Tử", 100, False),
    "universe": (6662, "TikTok Universe", 1000, False),
}


def make_avatar(nickname: str, color: str) -> str:
    """Avatar SVG data-URI nhiều màu, hiển thị chữ cái đầu."""
    initial = (nickname.strip()[:1] or "?").upper()
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">'
        f'<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{color}"/>'
        '<stop offset="1" stop-color="#2d3436"/></linearGradient></defs>'
        '<circle cx="64" cy="64" r="64" fill="url(#g)"/>'
        '<text x="64" y="64" font-size="64" font-family="Arial,sans-serif" font-weight="bold" fill="#fff" '
        f'text-anchor="middle" dominant-baseline="central">{initial}</text></svg>'
    )
    return "data:image/svg+xml;base64," + base64.b64encode(svg.encode("utf-8")).decode("ascii")


@dataclass(frozen=True)
class MockUser:
    info: UserInfo


class Simulator:
    def __init__(self, engine: "GameEngine", rng: random.Random | None = None) -> None:
        self._engine = engine
        self._rng = rng or random.Random()
        self._counter = itertools.count(1)
        self.users: dict[str, MockUser] = {}

    # ------------------------------------------------------------ người dùng
    def new_user(self, nickname: str | None = None, unique_id: str | None = None) -> MockUser:
        rng = self._rng
        nick = nickname or f"{rng.choice(LAST_NAMES)} {rng.choice(MID_NAMES)} {rng.choice(FIRST_NAMES)}"
        uid = unique_id or f"mock_{next(self._counter)}_{uuid.uuid4().hex[:4]}"
        user = MockUser(UserInfo(unique_id=uid, nickname=nick, avatar_url=make_avatar(nick, rng.choice(COLORS))))
        self.users[uid] = user
        return user

    def _resolve_user(self, user_id: str | None, nickname: str | None) -> MockUser:
        if user_id:
            if user_id in self.users:
                return self.users[user_id]
            known = self._engine.find_player_by_unique_id(user_id)
            if known is not None:
                user = MockUser(UserInfo(known.unique_id, known.nickname, known.avatar_url))
                self.users[user_id] = user
                return user
            return self.new_user(nickname=nickname or user_id, unique_id=user_id)
        if nickname:
            return self.new_user(nickname=nickname)
        if self.users:
            return self._rng.choice(list(self.users.values()))
        return self.new_user()

    # ------------------------------------------------------------ hành động
    async def spawn_players(self, count: int) -> list[MockUser]:
        """Tạo N người chơi và cho comment 'cau' qua engine (giống người thật)."""
        created: list[MockUser] = []
        for _ in range(count):
            user = self.new_user()
            await self._engine.handle_event(GameComment(user=user.info, text="cau"))
            created.append(user)
        return created

    async def mock_event(self, params: dict[str, Any]) -> str:
        p = MockEventParams.model_validate(params)
        user = self._resolve_user(p.user_id, p.nickname).info
        if p.kind == "comment":
            await self._engine.handle_event(GameComment(user=user, text=p.text))
            return f"{user.nickname} comment: {p.text}"
        if p.kind == "like":
            await self._engine.handle_event(GameLike(user=user, count=p.count))
            return f"{user.nickname} thả {p.count} tim"
        if p.kind == "follow":
            await self._engine.handle_event(GameFollow(user=user))
            return f"{user.nickname} follow"
        gift_id, gift_name, diamonds, streakable = GIFT_CATALOG[p.gift]
        kwargs: dict[str, Any] = {}
        if p.group_id:
            kwargs["group_id"] = p.group_id
        elif streakable:
            kwargs["group_id"] = uuid.uuid4().hex  # mỗi chuỗi quà có group riêng
        await self._engine.handle_event(
            GameGift(
                user=user, gift_id=gift_id, gift_name=gift_name, diamond_count=diamonds,
                repeat_count=p.repeat_count, streakable=streakable,
                streaking=p.streaking and streakable, **kwargs,
            )
        )
        return f"{user.nickname} tặng {gift_name} x{p.repeat_count}"
