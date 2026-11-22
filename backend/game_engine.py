"""GameEngine: nguồn chân lý duy nhất cho gacha, điểm, fever, quà, Boss.

Mọi nguồn sự kiện (TikTok thật, Mock Simulator) đều đi qua `handle_event`.
"""
from __future__ import annotations

import asyncio
import logging
import math
import random
import time
import unicodedata
import uuid
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Protocol

from pydantic import ValidationError

from boss_manager import BossManager
from database import Database, SettingsStore
from models import EventLog, Player
from schemas import (
    AdminCommandData,
    CommandResult,
    ConnectTiktokParams,
    GachaRates,
    MockEventParams,
    PhraseDeleteParams,
    PhraseUpsertParams,
    PlayerAdjustParams,
    PlayerKickParams,
    ResetSeasonParams,
    SpawnPlayersParams,
    TtsConfigParams,
    TtsSpeakNowParams,
    TtsToggleParams,
)
from ws_manager import Client, ConnectionManager

logger = logging.getLogger("engine")

# ---------------------------------------------------------------- hằng số game
TICK_SECONDS = 0.25
IDLE_KICK_SECONDS = 600
SHORE_VISIBLE_MAX = 15
DIEM_COOLDOWN_SECONDS = 5.0
FLUSH_INTERVAL_SECONDS = 5.0
GIFT_CACHE_SIZE = 4096

JOIN_COMMANDS = {"cau", "1", "tham gia"}
SCORE_COMMANDS = {"diem", "tui"}


@dataclass(frozen=True)
class RodSpec:
    name: str
    interval: float  # giây
    multiplier: float


RODS: dict[int, RodSpec] = {
    1: RodSpec("Cần Tre", 12.0, 1.0),
    2: RodSpec("Cần Sắt", 9.0, 1.5),
    3: RodSpec("Cần Vàng", 6.0, 2.5),
    4: RodSpec("Pháo Laser", 4.0, 5.0),
}

NORMAL_FISH = ["Cá Rô", "Cá Chép", "Cá Ngừ"]
RARE_FISH = ["Cá Mập Trắng", "Cá Voi Xanh", "Rùa Vàng"]
TROLL_ITEMS = ["Dép Tổ Ong", "Quần Đùi Rách", "Xương Cá"]
NORMAL_RANGE = (10, 50)
RARE_RANGE = (100, 300)


# ---------------------------------------------------------------- sự kiện chuẩn hoá
@dataclass(frozen=True)
class UserInfo:
    unique_id: str
    nickname: str = ""
    avatar_url: str = ""


@dataclass
class GameComment:
    user: UserInfo
    text: str


@dataclass
class GameLike:
    user: UserInfo
    count: int


@dataclass
class GameFollow:
    user: UserInfo


@dataclass
class GameGift:
    user: UserInfo
    gift_id: int
    gift_name: str
    diamond_count: int
    repeat_count: int = 1
    streakable: bool = False
    streaking: bool = False
    group_id: str | None = None
    timestamp: int = field(default_factory=time.time_ns)


GameEvent = GameComment | GameLike | GameFollow | GameGift


# ---------------------------------------------------------------- tiện ích thuần
def normalize_text(text: str) -> str:
    """Chữ thường, bỏ dấu tiếng Việt (đ -> d), gộp khoảng trắng."""
    t = unicodedata.normalize("NFD", text.lower().replace("đ", "d"))
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return " ".join(t.split())


def half_up(x: float) -> int:
    return int(math.floor(x + 0.5))


@dataclass
class CatchResult:
    item_type: str  # normal | rare | chest | troll
    item_name: str
    base_points: int
    chest_result: str | None = None  # DOUBLE | BOMB


def roll_fish_points(rng: random.Random, rates: GachaRates) -> tuple[str, str, int]:
    """Cá thường/hiếm theo tỷ lệ tương đối giữa 2 nhóm."""
    total = rates.normal + rates.rare
    is_rare = total > 0 and rng.random() * total >= rates.normal
    if is_rare:
        return "rare", rng.choice(RARE_FISH), rng.randint(*RARE_RANGE)
    return "normal", rng.choice(NORMAL_FISH), rng.randint(*NORMAL_RANGE)


def roll_catch(rng: random.Random, rates: GachaRates, lucky: bool) -> CatchResult:
    """Gacha. `lucky` (mồi thơm / Fever): bỏ troll, rương luôn x2 (không có bom)."""
    weights = {
        "normal": rates.normal, "rare": rates.rare, "chest": rates.chest,
        "troll": 0.0 if lucky else rates.troll,
    }
    total = sum(weights.values())
    if total <= 0:
        weights, total = {"normal": 1.0, "rare": 0.0, "chest": 0.0, "troll": 0.0}, 1.0
    pick = rng.random() * total
    category = "normal"
    for key, w in weights.items():
        if w <= 0:
            continue
        category = key
        if pick < w:
            break
        pick -= w

    if category == "troll":
        return CatchResult("troll", rng.choice(TROLL_ITEMS), 0)
    if category == "chest":
        # Rương: 70% nhân đôi điểm lượt đó, 30% bom đen mặt; lucky -> luôn nhân đôi
        if not lucky and rng.random() >= 0.7:
            return CatchResult("chest", "Bom Đen Mặt", 0, "BOMB")
        _, _, base = roll_fish_points(rng, rates)
        return CatchResult("chest", "Rương Báu x2", base * 2, "DOUBLE")
    if category == "rare":
        return CatchResult("rare", rng.choice(RARE_FISH), rng.randint(*RARE_RANGE))
    return CatchResult("normal", rng.choice(NORMAL_FISH), rng.randint(*NORMAL_RANGE))


# ---------------------------------------------------------------- trạng thái người chơi
@dataclass(eq=False)
class PlayerState:
    id: int
    unique_id: str
    nickname: str
    avatar_url: str
    score: int = 0
    gold: int = 0
    rod_level: int = 1
    lucky_bait_count: int = 0
    total_gift_coins: int = 0
    last_interaction: float = 0.0
    on_shore: bool = False
    next_cast_at: float = 0.0
    last_diem_at: float = float("-inf")

    def public(self) -> dict[str, Any]:
        return {
            "player_id": self.id,
            "tiktok_unique_id": self.unique_id,
            "nickname": self.nickname,
            "avatar_url": self.avatar_url,
            "score": self.score,
            "rod_level": self.rod_level,
            "rod_name": RODS[self.rod_level].name,
            "lucky_bait_count": self.lucky_bait_count,
        }


class CommandError(Exception):
    """Lỗi nghiệp vụ của ADMIN_COMMAND (thông báo cho dashboard)."""


class TikTokController(Protocol):
    async def connect(self, username: str) -> str: ...
    async def disconnect(self) -> str: ...


class TtsController(Protocol):
    async def speak_now(self, text: str) -> None: ...
    async def clear_queue(self) -> int: ...


SayHook = Callable[[str, int, dict[str, Any]], Awaitable[None]]


class GameEngine:
    def __init__(
        self,
        db: Database,
        store: SettingsStore,
        manager: ConnectionManager,
        session_id: str = "",
        clock: Callable[[], float] = time.time,
        rng: random.Random | None = None,
    ) -> None:
        from simulator import Simulator  # import muộn để tránh vòng lặp

        self._db = db
        self._store = store
        self._manager = manager
        self.session_id = session_id
        self.clock = clock
        self.rng = rng or random.Random()
        self.simulator = Simulator(self, self.rng)
        self.boss = BossManager()

        self._players: dict[str, PlayerState] = {}      # theo unique_id
        self._by_id: dict[int, PlayerState] = {}
        self._dirty: set[str] = set()
        self._lock: asyncio.Lock | None = None
        self._task: asyncio.Task[None] | None = None

        self.heat = 0
        self.fever_active = False
        self.fever_ends_at: float | None = None
        self.total_likes = 0
        self.total_coins = 0
        self.tiktok_status = "DISCONNECTED"
        self.connected_username = ""
        self._followed: set[str] = set()
        self._seen_gifts: OrderedDict[tuple[str, int, Any], None] = OrderedDict()
        self._top1_id: int | None = None
        self._last_top3: list[tuple[int, int]] | None = None
        self._boss_base = clock()
        self._last_flush = clock()
        self._last_idle_chat = clock()

        # Hook gắn bởi các phase sau
        self.tiktok: TikTokController | None = None
        self.tts: TtsController | None = None
        self.say: SayHook | None = None

    # ------------------------------------------------------------ vòng đời
    @property
    def _async_lock(self) -> asyncio.Lock:
        if self._lock is None:
            self._lock = asyncio.Lock()
        return self._lock

    @property
    def settings(self):
        return self._store.current

    async def load(self) -> None:
        """Nạp toàn bộ người chơi từ DB vào RAM (bộ nhớ là nguồn tính toán, DB là lưu trữ)."""
        from sqlalchemy import select

        async with self._db.session() as s:
            rows = (await s.execute(select(Player))).scalars().all()
        for r in rows:
            st = PlayerState(
                id=r.id, unique_id=r.tiktok_unique_id, nickname=r.nickname, avatar_url=r.avatar_url,
                score=r.score, gold=r.gold, rod_level=min(4, max(1, r.rod_level)),
                lucky_bait_count=r.lucky_bait_count, total_gift_coins=r.total_gift_coins,
            )
            self._players[st.unique_id] = st
            self._by_id[st.id] = st
        self._boss_base = self.clock()
        self._refresh_top1_silent()
        logger.info("Đã nạp %d người chơi từ DB", len(rows))

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._run(), name="game-scheduler")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        await self.flush()

    async def _run(self) -> None:
        """Scheduler duy nhất, tick 250ms, duyệt toàn bộ người chơi."""
        while True:
            try:
                await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Lỗi trong scheduler tick")
            await asyncio.sleep(TICK_SECONDS)

    # ------------------------------------------------------------ truy vấn
    def find_player_by_unique_id(self, unique_id: str) -> PlayerState | None:
        return self._players.get(unique_id)

    def _ranking(self) -> list[PlayerState]:
        return sorted((p for p in self._players.values() if p.score > 0), key=lambda p: (-p.score, p.id))

    def _top3_payload(self) -> list[dict[str, Any]]:
        return [
            {"player_id": p.id, "nickname": p.nickname, "avatar_url": p.avatar_url,
             "score": p.score, "rod_level": p.rod_level}
            for p in self._ranking()[:3]
        ]

    def _fever_payload(self) -> dict[str, Any]:
        return {
            "heat": self.heat,
            "max": self.settings.fever_threshold,
            "active": self.fever_active,
            "ends_at": int(self.fever_ends_at * 1000) if self.fever_ends_at is not None else None,
        }

    def shore_players(self) -> list[PlayerState]:
        return [p for p in self._players.values() if p.on_shore]

    def build_state(self) -> dict[str, Any]:
        shore = sorted(self.shore_players(), key=lambda p: -p.last_interaction)[:SHORE_VISIBLE_MAX]
        return {
            "players_on_shore": [p.public() for p in shore],
            "top3": self._top3_payload(),
            "fever": self._fever_payload(),
            "boss": self.boss.snapshot("SPAWNED"),
            "stats": {
                "active_players": len(self.shore_players()),
                "total_likes": self.total_likes,
                "total_coins": self.total_coins,
                "tiktok_status": self.tiktok_status,
                "connected_username": self.connected_username,
            },
            "tts_settings": self.settings.tts.model_dump(),
            "game_settings": self.settings.public_game_settings(),
        }

    async def build_state_async(self) -> dict[str, Any]:
        return self.build_state()

    def list_players(self, search: str = "", sort: str = "score") -> list[dict[str, Any]]:
        q = search.strip().lower()
        items = [
            p for p in self._players.values()
            if not q or q in p.nickname.lower() or q in p.unique_id.lower()
        ]
        keys: dict[str, Callable[[PlayerState], Any]] = {
            "score": lambda p: p.score,
            "rod_level": lambda p: p.rod_level,
            "nickname": lambda p: p.nickname.lower(),
            "last_active": lambda p: p.last_interaction,
        }
        key = keys.get(sort, keys["score"])
        items.sort(key=key, reverse=sort != "nickname")
        return [{**p.public(), "gold": p.gold, "total_gift_coins": p.total_gift_coins, "on_shore": p.on_shore}
                for p in items]

    # ------------------------------------------------------------ broadcast / log / say
    async def _bc(self, msg_type: str, data: dict[str, Any] | None = None) -> None:
        await self._manager.broadcast(msg_type, data)

    async def _banner(self, kind: str, title: str, subtitle: str = "", player: PlayerState | None = None) -> None:
        await self._bc("BANNER", {
            "kind": kind, "title": title, "subtitle": subtitle,
            "player_id": player.id if player else None,
            "nickname": player.nickname if player else None,
        })

    async def _log(self, type_: str, message: str, player: PlayerState | None = None,
                   payload: dict[str, Any] | None = None) -> None:
        payload = payload or {}
        ts = datetime.now(timezone.utc).replace(tzinfo=None)
        try:
            async with self._db.session() as s:
                row = EventLog(timestamp=ts, type=type_, player_id=player.id if player else None,
                               payload=payload, session_id=self.session_id)
                s.add(row)
                await s.commit()
                log_id = row.id
        except Exception:
            logger.exception("Ghi event_logs thất bại")
            log_id = 0
        logger.info("[%s] %s", type_, message)
        await self._manager.send_to_role("dashboard", "LOG", {
            "id": log_id, "timestamp": ts.isoformat(), "type": type_, "message": message, "payload": payload,
        })

    async def _say(self, group: str, priority: int, **ctx: Any) -> None:
        """Yêu cầu AI Caster nói (phase 3 gắn hook); lỗi không ảnh hưởng game."""
        if self.say is None:
            return
        try:
            await self.say(group, priority, ctx)
        except Exception:
            logger.exception("Hook caster lỗi (group=%s)", group)

    # ------------------------------------------------------------ người chơi
    async def _ensure_player(self, user: UserInfo) -> PlayerState:
        p = self._players.get(user.unique_id)
        if p is not None:
            if user.nickname and user.nickname != p.nickname:
                p.nickname = user.nickname
                self._dirty.add(p.unique_id)
            if user.avatar_url and user.avatar_url != p.avatar_url:
                p.avatar_url = user.avatar_url
                self._dirty.add(p.unique_id)
            return p
        async with self._db.session() as s:
            row = Player(tiktok_unique_id=user.unique_id, nickname=user.nickname or user.unique_id,
                         avatar_url=user.avatar_url)
            s.add(row)
            await s.commit()
            await s.refresh(row)
        p = PlayerState(id=row.id, unique_id=row.tiktok_unique_id, nickname=row.nickname,
                        avatar_url=row.avatar_url)
        self._players[p.unique_id] = p
        self._by_id[p.id] = p
        return p

    def _cast_interval(self, p: PlayerState) -> float:
        # Fever: chia đôi chu kỳ câu
        return RODS[p.rod_level].interval / (2 if self.fever_active else 1)

    async def _join(self, p: PlayerState, now: float) -> bool:
        p.last_interaction = now
        self._dirty.add(p.unique_id)
        if p.on_shore:
            return False
        p.on_shore = True
        p.next_cast_at = now + self._cast_interval(p) * self.rng.uniform(0.3, 1.0)
        await self._bc("PLAYER_JOINED", p.public())
        return True

    async def _leave(self, p: PlayerState, reason: str) -> None:
        if not p.on_shore:
            return
        p.on_shore = False
        await self._bc("PLAYER_LEFT", {"player_id": p.id, "nickname": p.nickname, "reason": reason})

    async def flush(self) -> None:
        """Ghi người chơi 'bẩn' xuống DB (gom lô để tránh ghi mỗi lượt câu)."""
        if not self._dirty:
            return
        ids = list(self._dirty)
        self._dirty.clear()
        try:
            async with self._db.session() as s:
                for uid in ids:
                    st = self._players.get(uid)
                    if st is None:
                        continue
                    row = await s.get(Player, st.id)
                    if row is None:
                        continue
                    row.nickname, row.avatar_url = st.nickname, st.avatar_url
                    row.score, row.gold, row.rod_level = st.score, st.gold, st.rod_level
                    row.lucky_bait_count, row.total_gift_coins = st.lucky_bait_count, st.total_gift_coins
                    row.last_active = datetime.fromtimestamp(st.last_interaction or time.time(), timezone.utc).replace(tzinfo=None)
                await s.commit()
        except Exception:
            logger.exception("Flush người chơi thất bại")
            self._dirty.update(ids)

    # ------------------------------------------------------------ xếp hạng
    def _refresh_top1_silent(self) -> None:
        r = self._ranking()
        self._top1_id = r[0].id if r else None

    async def _after_score_change(self, p: PlayerState, announce: bool = True) -> None:
        self._dirty.add(p.unique_id)
        r = self._ranking()
        best = r[0] if r else None
        if best is None:
            self._top1_id = None
        elif self._top1_id is None:
            self._top1_id = best.id
        elif best.id != self._top1_id:
            incumbent = self._by_id.get(self._top1_id)
            # Chỉ soán ngôi khi điểm LỚN HƠN (hoà thì người cũ giữ ngôi)
            if incumbent is None or best.score > incumbent.score:
                self._top1_id = best.id
                if announce and incumbent is not None:
                    await self._banner("SOAN_NGOI", "ĐẠI GIA SOÁN NGÔI", f"{best.nickname} lên Top 1!", best)
                    await self._say("rank_overtake", 2, name=best.nickname, player_id=best.id)
        await self._broadcast_leaderboard()

    async def _broadcast_leaderboard(self) -> None:
        top3 = self._top3_payload()
        sig = [(t["player_id"], t["score"]) for t in top3]
        if sig != self._last_top3:
            self._last_top3 = sig
            await self._bc("LEADERBOARD_UPDATE", {"top3": top3})

    # ------------------------------------------------------------ entry point
    async def handle_event(self, event: GameEvent) -> None:
        """Cổng vào duy nhất cho mọi sự kiện (TikTok thật + mock)."""
        async with self._async_lock:
            try:
                now = self.clock()
                if isinstance(event, GameComment):
                    await self._on_comment(event, now)
                elif isinstance(event, GameLike):
                    await self._on_like(event, now)
                elif isinstance(event, GameFollow):
                    await self._on_follow(event, now)
                elif isinstance(event, GameGift):
                    await self._on_gift(event, now)
            except Exception:
                logger.exception("Lỗi xử lý sự kiện %s", type(event).__name__)

    # ------------------------------------------------------------ comment
    async def _on_comment(self, ev: GameComment, now: float) -> None:
        text = normalize_text(ev.text)
        if not text:
            return
        p = await self._ensure_player(ev.user)

        if self.boss.active:
            # Có Boss: mọi comment đều tham gia + bắn Boss
            await self._join(p, now)
            res = self.boss.hit_by_comment(p.id, now)
            if res is not None:
                await self._after_boss_hit(p, res.damage, res.defeated, now)
            if text in SCORE_COMMANDS:
                await self._send_bubble(p, now)
            return

        if text in JOIN_COMMANDS:
            await self._join(p, now)
        elif text in SCORE_COMMANDS:
            if p.on_shore:
                p.last_interaction = now
                await self._send_bubble(p, now)
        elif p.on_shore:
            p.last_interaction = now

    async def _send_bubble(self, p: PlayerState, now: float) -> None:
        if not p.on_shore or now - p.last_diem_at < DIEM_COOLDOWN_SECONDS:
            return
        p.last_diem_at = now
        rod = RODS[p.rod_level]
        await self._bc("CHAT_BUBBLE", {
            "player_id": p.id, "nickname": p.nickname, "score": p.score, "rod_name": rod.name,
            "text": f"{p.score} điểm · {rod.name}",
        })

    # ------------------------------------------------------------ like / fever
    async def _on_like(self, ev: GameLike, now: float) -> None:
        count = max(0, ev.count)
        self.total_likes += count
        p = self._players.get(ev.user.unique_id)
        if p is not None and p.on_shore:
            p.last_interaction = now
        if self.fever_active or count == 0:
            await self._bc("FEVER_UPDATE", self._fever_payload())
            return
        self.heat = min(self.heat + count, self.settings.fever_threshold)
        if self.heat >= self.settings.fever_threshold:
            await self._start_fever(now, "likes")
        else:
            await self._bc("FEVER_UPDATE", self._fever_payload())

    async def _start_fever(self, now: float, source: str) -> None:
        self.fever_active = True
        self.fever_ends_at = now + self.settings.fever_duration_seconds
        self.heat = 0
        await self._bc("FEVER_UPDATE", self._fever_payload())
        await self._banner("FEVER", "FEVER TIME!", f"x2 tốc độ trong {self.settings.fever_duration_seconds}s")
        await self._log("FEVER", f"Fever bắt đầu ({source})", payload={"source": source})

    # ------------------------------------------------------------ follow
    async def _on_follow(self, ev: GameFollow, now: float) -> None:
        if ev.user.unique_id in self._followed:
            return  # mỗi người chỉ được +1 mồi trong mỗi phiên chạy server
        self._followed.add(ev.user.unique_id)
        p = await self._ensure_player(ev.user)
        p.lucky_bait_count += 1
        if p.on_shore:
            p.last_interaction = now
        self._dirty.add(p.unique_id)

    # ------------------------------------------------------------ quà
    def _gift_seen(self, key: tuple[str, int, Any]) -> bool:
        """Cache LRU chống xử lý trùng quà."""
        if key in self._seen_gifts:
            self._seen_gifts.move_to_end(key)
            return True
        self._seen_gifts[key] = None
        while len(self._seen_gifts) > GIFT_CACHE_SIZE:
            self._seen_gifts.popitem(last=False)
        return False

    async def _on_gift(self, ev: GameGift, now: float) -> None:
        # Chỉ xử lý khi streak KẾT THÚC hoặc quà không streakable
        if not (not ev.streakable or not ev.streaking):
            return
        coins = ev.diamond_count * ev.repeat_count
        if coins <= 0:
            return
        if self._gift_seen((ev.user.unique_id, ev.gift_id, ev.group_id or ev.timestamp)):
            logger.debug("Bỏ qua quà trùng của %s", ev.user.unique_id)
            return

        p = await self._ensure_player(ev.user)
        await self._join(p, now)
        p.total_gift_coins += coins
        self.total_coins += coins
        s = self.settings
        boss_was_active = self.boss.active

        effect: str
        bonus = 0
        fish_ids: list[str] = []
        if coins >= 100:
            effect = "TRAWLER_SHIP"
            bonus = 2000
            p.score += bonus
        elif coins >= 10:
            effect = "UPGRADE_ROD"
            if p.rod_level < 4:
                p.rod_level += 1
                p.next_cast_at = min(p.next_cast_at, now + self._cast_interval(p))
                await self._log("UPGRADE", f"{p.nickname} nâng cần lên Lv{p.rod_level}", p,
                                {"rod_level": p.rod_level})
            else:
                bonus = 500
                p.score += bonus
        else:
            effect = "ELECTRIC_NET"
            for _ in range(self.rng.randint(3, 5)):
                _, _, pts = roll_fish_points(self.rng, s.gacha)
                bonus += pts
                fish_ids.append(f"net-{uuid.uuid4().hex[:8]}")
            p.score += bonus

        await self._bc("GIFT_EFFECT", {
            "player_id": p.id, "nickname": p.nickname, "gift_name": ev.gift_name, "coins": coins,
            "effect_type": effect, "new_rod_level": p.rod_level, "bonus_points": bonus,
            "caught_fish_ids": fish_ids,
        })
        await self._log("DONATE", f"{p.nickname} tặng {ev.gift_name} x{ev.repeat_count} ({coins} xu) → {effect}", p,
                        {"gift": ev.gift_name, "coins": coins, "effect": effect, "bonus_points": bonus})

        if effect == "TRAWLER_SHIP":
            await self._banner("TRAWLER", "TÀU ĐÁNH CÁ", f"{p.nickname} +{bonus} điểm", p)
            await self._say("gift_trawler", 2, name=p.nickname, gift=ev.gift_name, points=bonus, player_id=p.id)
        elif effect == "UPGRADE_ROD":
            await self._banner("UPGRADE", "NÂNG CẤP CẦN", f"{p.nickname} → {RODS[p.rod_level].name}", p)
            await self._say("gift_upgrade", 3, name=p.nickname, gift=ev.gift_name, level=p.rod_level, player_id=p.id)
        else:
            await self._say("gift_small", 3, name=p.nickname, gift=ev.gift_name, points=bonus, player_id=p.id)

        await self._after_score_change(p)

        if boss_was_active:
            res = self.boss.hit(p.id, coins * 100)
            if res is not None:
                await self._after_boss_hit(p, res.damage, res.defeated, now)
        elif coins >= s.boss_summon_gift_threshold:
            # Quà triệu hồi không tự gây sát thương lên Boss vừa gọi ra
            await self._summon_boss(now, f"quà của {p.nickname}")

    # ------------------------------------------------------------ boss
    async def _summon_boss(self, now: float, source: str) -> bool:
        s = self.settings
        if not self.boss.spawn(s.boss_max_hp, s.boss_duration_seconds, now):
            return False
        await self._bc("BOSS_UPDATE", self.boss.snapshot("SPAWNED"))
        await self._banner("BOSS", "BOSS KRAKEN XUẤT HIỆN!", "Comment để bắn Boss!")
        await self._say("boss_event", 1, name="Kraken", event="spawn")
        await self._log("BOSS_KILL", f"Boss Kraken xuất hiện ({source})", payload={"source": source, "phase": "spawn"})
        return True

    async def _after_boss_hit(self, p: PlayerState, damage: int, defeated: bool, now: float) -> None:
        snap = self.boss.snapshot("HIT") or {"status": "HIT", "current_hp": 0, "max_hp": self.boss.max_hp,
                                              "ends_at": int(self.boss.ends_at * 1000)}
        snap = {**snap, "status": "HIT", "attacker_id": p.id, "damage": damage}
        await self._bc("BOSS_UPDATE", snap)
        if defeated:
            await self._boss_defeated(now)

    async def _boss_defeated(self, now: float) -> None:
        rewards = self.boss.compute_rewards()
        max_hp, ends_at = self.boss.max_hp, int(self.boss.ends_at * 1000)
        damages = dict(self.boss.damage)
        self.boss.end()
        touched: list[PlayerState] = []
        for pid, bonus in rewards.bonuses.items():
            pl = self._by_id.get(pid)
            if pl is not None:
                pl.score += bonus
                touched.append(pl)

        def info(pid: int | None) -> dict[str, Any] | None:
            pl = self._by_id.get(pid) if pid is not None else None
            if pl is None or pid is None:
                return None
            return {"player_id": pl.id, "nickname": pl.nickname, "damage": damages.get(pid, 0)}

        mvp, last = info(rewards.mvp_id), info(rewards.lasthit_id)
        await self._bc("BOSS_UPDATE", {
            "status": "DEFEATED", "current_hp": 0, "max_hp": max_hp, "ends_at": ends_at,
            "mvp_player": mvp, "lasthit_player": last,
        })
        await self._banner("BOSS_DEFEATED", "BOSS KRAKEN BỊ HẠ GỤC!",
                           f"MVP: {mvp['nickname'] if mvp else '-'} | Last Hit: {last['nickname'] if last else '-'}")
        await self._say("boss_event", 1, name=mvp["nickname"] if mvp else "", event="defeated",
                        lasthit=last["nickname"] if last else "")
        await self._log("BOSS_KILL", "Boss Kraken bị tiêu diệt", None, {
            "phase": "defeated", "mvp": mvp, "lasthit": last,
            "damages": {str(k): v for k, v in damages.items()},
            "bonuses": {str(k): v for k, v in rewards.bonuses.items()},
        })
        self._after_boss_end(now)
        for pl in touched:
            await self._after_score_change(pl)

    async def _boss_escaped(self, now: float) -> None:
        max_hp, ends_at = self.boss.max_hp, int(self.boss.ends_at * 1000)
        hp = self.boss.current_hp
        self.boss.end()
        await self._bc("BOSS_UPDATE", {"status": "ESCAPED", "current_hp": hp, "max_hp": max_hp, "ends_at": ends_at})
        await self._banner("BOSS_ESCAPED", "BOSS ĐÃ TRỐN THOÁT", "Không ai nhận thưởng...")
        await self._log("BOSS_KILL", "Boss Kraken trốn thoát", None, {"phase": "escaped"})
        self._after_boss_end(now)

    def _after_boss_end(self, now: float) -> None:
        """Lên lịch Boss kế tiếp và dàn lại giờ câu để không dồn cục."""
        self._boss_base = now
        for p in self.shore_players():
            p.next_cast_at = now + self._cast_interval(p) * self.rng.uniform(0.3, 1.0)

    # ------------------------------------------------------------ scheduler tick
    async def tick(self, now: float | None = None) -> None:
        async with self._async_lock:
            await self._tick(self.clock() if now is None else now)

    async def _tick(self, now: float) -> None:
        s = self.settings
        if self.fever_active and self.fever_ends_at is not None and now >= self.fever_ends_at:
            self.fever_active = False
            self.fever_ends_at = None
            await self._bc("FEVER_UPDATE", self._fever_payload())

        if self.boss.expired(now):
            await self._boss_escaped(now)
        elif not self.boss.active and now >= self._boss_base + s.boss_interval_minutes * 60:
            await self._summon_boss(now, "định kỳ")
            self._boss_base = now

        for p in list(self._players.values()):
            if p.on_shore and now - p.last_interaction >= IDLE_KICK_SECONDS:
                await self._leave(p, "IDLE")  # chỉ rời bờ, dữ liệu DB giữ nguyên

        if not self.boss.active:
            for p in list(self._players.values()):
                if p.on_shore and now >= p.next_cast_at:
                    await self._cast(p, now)

        if now - self._last_flush >= FLUSH_INTERVAL_SECONDS:
            self._last_flush = now
            await self.flush()

        # Giao lưu ngẫu nhiên (idle_chat, ưu tiên 4) mỗi 45s khi không có Boss
        if not self.boss.active and now - self._last_idle_chat >= 45.0:
            self._last_idle_chat = now
            await self._say("idle_chat", 4)

    # ------------------------------------------------------------ câu cá
    async def _cast(self, p: PlayerState, now: float) -> None:
        rod = RODS[p.rod_level]
        p.next_cast_at = now + self._cast_interval(p)
        lucky = self.fever_active or p.lucky_bait_count > 0
        if not self.fever_active and p.lucky_bait_count > 0:
            p.lucky_bait_count -= 1  # Fever thì không trừ mồi

        catch = roll_catch(self.rng, self.settings.gacha, lucky)
        points = half_up(catch.base_points * rod.multiplier)
        p.score += points
        is_chest = catch.item_type == "chest"
        await self._bc("FISH_CAUGHT", {
            "player_id": p.id, "nickname": p.nickname, "item_type": catch.item_type,
            "item_name": catch.item_name, "points": points, "is_troll": catch.item_type == "troll",
            "is_chest": is_chest, "chest_result": catch.chest_result, "rod_level": p.rod_level,
        })

        ctx = {"name": p.nickname, "item": catch.item_name, "points": points, "level": p.rod_level, "player_id": p.id}
        if catch.item_type == "troll":
            await self._say("troll_sandal" if catch.item_name == "Dép Tổ Ong" else "troll_trash", 3, **ctx)
        elif catch.chest_result == "BOMB":
            await self._say("chest_bomb", 3, **ctx)
        elif catch.chest_result == "DOUBLE":
            await self._banner("JACKPOT", "NỔ HŨ x2!", f"{p.nickname} +{points}", p)
            await self._log("JACKPOT", f"{p.nickname} nổ rương x2 (+{points})", p, {"points": points})
            await self._say("rare_fish", 3, **ctx)
        elif catch.item_type == "rare":
            await self._say("rare_fish", 3, **ctx)

        if points > 0:
            await self._after_score_change(p)
        else:
            self._dirty.add(p.unique_id)

    # ------------------------------------------------------------ TikTok status
    async def set_tiktok_status(self, status: str, username: str | None = None, message: str = "") -> None:
        self.tiktok_status = status
        if username is not None:
            self.connected_username = username
        await self._bc("TIKTOK_STATUS", {
            "status": status, "connected_username": self.connected_username, "message": message,
        })

    # ================================================================ ADMIN
    async def handle_admin(self, client: Client | None, cmd: AdminCommandData) -> CommandResult:
        handlers: dict[str, Callable[[dict[str, Any]], Awaitable[str]]] = {
            "connect_tiktok": self._adm_connect_tiktok,
            "disconnect_tiktok": self._adm_disconnect_tiktok,
            "spawn_players": self._adm_spawn_players,
            "mock_event": self._adm_mock_event,
            "summon_boss": self._adm_summon_boss,
            "trigger_fever": self._adm_trigger_fever,
            "reset_lake": self._adm_reset_lake,
            "tts_toggle": self._adm_tts_toggle,
            "tts_config": self._adm_tts_config,
            "tts_speak_now": self._adm_tts_speak_now,
            "tts_clear_queue": self._adm_tts_clear_queue,
            "phrase_upsert": self._adm_phrase_upsert,
            "phrase_delete": self._adm_phrase_delete,
            "player_adjust": self._adm_player_adjust,
            "player_kick": self._adm_player_kick,
            "reset_season": self._adm_reset_season,
            "settings_update": self._adm_settings_update,
        }
        try:
            message = await handlers[cmd.action](cmd.params)
            return CommandResult(ok=True, action=cmd.action, message=message)
        except ValidationError as exc:
            first = exc.errors()[0]
            loc = ".".join(str(x) for x in first["loc"])
            return CommandResult(ok=False, action=cmd.action, error=f"Tham số không hợp lệ ({loc}): {first['msg']}")
        except CommandError as exc:
            return CommandResult(ok=False, action=cmd.action, error=str(exc))
        except Exception as exc:
            logger.exception("Lỗi khi chạy lệnh admin %s", cmd.action)
            return CommandResult(ok=False, action=cmd.action, error=f"Lỗi nội bộ: {exc}")

    async def _broadcast_state(self) -> None:
        await self._bc("STATE_SYNC", self.build_state())

    async def _adm_connect_tiktok(self, params: dict[str, Any]) -> str:
        p = ConnectTiktokParams.model_validate(params)
        if self.tiktok is None:
            raise CommandError("TikTok service chưa được khởi tạo")
        return await self.tiktok.connect(p.username)

    async def _adm_disconnect_tiktok(self, params: dict[str, Any]) -> str:
        if self.tiktok is None:
            raise CommandError("TikTok service chưa được khởi tạo")
        return await self.tiktok.disconnect()

    async def _adm_spawn_players(self, params: dict[str, Any]) -> str:
        p = SpawnPlayersParams.model_validate(params)
        users = await self.simulator.spawn_players(p.count)
        return f"Đã tạo {len(users)} người chơi giả lập"

    async def _adm_mock_event(self, params: dict[str, Any]) -> str:
        MockEventParams.model_validate(params)
        return await self.simulator.mock_event(params)

    async def _adm_summon_boss(self, params: dict[str, Any]) -> str:
        async with self._async_lock:
            if not await self._summon_boss(self.clock(), "admin"):
                raise CommandError("Đang có Boss, không thể triệu hồi thêm")
        return "Đã triệu hồi Boss Kraken"

    async def _adm_trigger_fever(self, params: dict[str, Any]) -> str:
        async with self._async_lock:
            if self.fever_active:
                raise CommandError("Fever đang chạy")
            await self._start_fever(self.clock(), "admin")
        return "Đã kích hoạt Fever Time"

    async def _adm_reset_lake(self, params: dict[str, Any]) -> str:
        async with self._async_lock:
            now = self.clock()
            for p in self.shore_players():
                await self._leave(p, "RESET_LAKE")
            if self.boss.active:
                self.boss.end()
                self._boss_base = now
            self.fever_active, self.fever_ends_at, self.heat = False, None, 0
            await self._log("ADMIN", "Làm sạch hồ", payload={"action": "reset_lake"})
            await self._broadcast_state()
        return "Đã làm sạch hồ"

    async def _adm_tts_toggle(self, params: dict[str, Any]) -> str:
        p = TtsToggleParams.model_validate(params)
        enabled = (not self.settings.tts.enabled) if p.enabled is None else p.enabled
        await self._store.update({"tts": {"enabled": enabled}})
        await self._broadcast_state()
        return "TTS đã " + ("bật" if enabled else "tắt")

    async def _adm_tts_config(self, params: dict[str, Any]) -> str:
        p = TtsConfigParams.model_validate(params)
        patch = p.model_dump(exclude_none=True)
        if not patch:
            raise CommandError("Không có thông số TTS nào để cập nhật")
        await self._store.update({"tts": patch})
        await self._broadcast_state()
        return "Đã cập nhật cấu hình giọng đọc"

    async def _adm_tts_speak_now(self, params: dict[str, Any]) -> str:
        p = TtsSpeakNowParams.model_validate(params)
        if self.tts is None:
            raise CommandError("TTS service chưa sẵn sàng")
        await self.tts.speak_now(p.text)
        return "Đã đưa vào phát ngay"

    async def _adm_tts_clear_queue(self, params: dict[str, Any]) -> str:
        if self.tts is None:
            raise CommandError("TTS service chưa sẵn sàng")
        n = await self.tts.clear_queue()
        return f"Đã xoá {n} câu khỏi hàng đợi"

    async def _adm_phrase_upsert(self, params: dict[str, Any]) -> str:
        p = PhraseUpsertParams.model_validate(params)
        phrases = {k: list(v) for k, v in self.settings.phrases.items()}
        items = phrases.setdefault(p.group, [])
        if p.index is None:
            items.append(p.text)
        elif p.index < len(items):
            items[p.index] = p.text
        else:
            raise CommandError(f"Chỉ số {p.index} không tồn tại trong nhóm {p.group}")
        await self._store.update({"phrases": phrases})
        return "Đã lưu câu thoại"

    async def _adm_phrase_delete(self, params: dict[str, Any]) -> str:
        p = PhraseDeleteParams.model_validate(params)
        phrases = {k: list(v) for k, v in self.settings.phrases.items()}
        items = phrases.get(p.group)
        if items is None or p.index >= len(items):
            raise CommandError("Không tìm thấy câu thoại cần xoá")
        items.pop(p.index)
        await self._store.update({"phrases": phrases})
        return "Đã xoá câu thoại"

    def _get_player_or_raise(self, player_id: int) -> PlayerState:
        p = self._by_id.get(player_id)
        if p is None:
            raise CommandError(f"Không tìm thấy người chơi id={player_id}")
        return p

    async def _adm_player_adjust(self, params: dict[str, Any]) -> str:
        a = PlayerAdjustParams.model_validate(params)
        async with self._async_lock:
            p = self._get_player_or_raise(a.player_id)
            p.score = max(0, p.score + a.score_delta)
            if a.rod_level is not None:
                p.rod_level = a.rod_level
            await self._after_score_change(p, announce=False)
            await self._log("ADMIN", f"Chỉnh {p.nickname}: điểm {a.score_delta:+d}, cần {a.rod_level or '-'}", p,
                            {"action": "player_adjust", "score_delta": a.score_delta, "rod_level": a.rod_level})
            if p.on_shore:
                await self._bc("PLAYER_JOINED", p.public())  # làm mới thông tin hiển thị
        return f"Đã chỉnh {p.nickname}: {p.score} điểm, {RODS[p.rod_level].name}"

    async def _adm_player_kick(self, params: dict[str, Any]) -> str:
        k = PlayerKickParams.model_validate(params)
        async with self._async_lock:
            p = self._get_player_or_raise(k.player_id)
            if not p.on_shore:
                raise CommandError(f"{p.nickname} không ở trên bờ")
            await self._leave(p, "KICK")
            await self._log("ADMIN", f"Kick {p.nickname}", p, {"action": "player_kick"})
        return f"Đã kick {p.nickname} khỏi bờ"

    async def _adm_reset_season(self, params: dict[str, Any]) -> str:
        r = ResetSeasonParams.model_validate(params)
        if not r.confirm:
            raise CommandError("Cần xác nhận (confirm=true) để reset mùa giải")
        async with self._async_lock:
            top10 = [{"player_id": p.id, "nickname": p.nickname, "score": p.score} for p in self._ranking()[:10]]
            await self._log("ADMIN", "Reset mùa giải (đã lưu snapshot Top 10)",
                            payload={"action": "reset_season", "snapshot_top10": top10})
            for p in self._players.values():
                p.score = 0
                self._dirty.add(p.unique_id)
            self._top1_id = None
            await self.flush()
            await self._broadcast_leaderboard()
            await self._broadcast_state()
        return "Đã reset mùa giải, điểm về 0"

    async def _adm_settings_update(self, params: dict[str, Any]) -> str:
        if not params:
            raise CommandError("Không có cấu hình nào để cập nhật")
        try:
            await self._store.update(params)
        except ValueError as exc:  # gồm cả ValidationError (kế thừa ValueError)
            if isinstance(exc, ValidationError):
                raise
            raise CommandError(str(exc)) from exc
        await self._log("ADMIN", "Cập nhật cấu hình game", payload={"action": "settings_update", "keys": list(params)})
        await self._broadcast_state()
        return "Đã lưu và áp dụng cấu hình"

