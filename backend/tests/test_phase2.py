"""Kiểm thử Phase 2: GameEngine, Boss, quà, fever, gacha, admin, REST."""
from __future__ import annotations

import random
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from boss_manager import BossManager
from config import AppConfig
from database import Database, SettingsStore
from game_engine import (
    GameComment,
    GameEngine,
    GameFollow,
    GameGift,
    GameLike,
    UserInfo,
    half_up,
    normalize_text,
    roll_catch,
)
from main import create_app
from models import EventLog, Player
from schemas import AdminCommandData, GachaRates
from ws_manager import ConnectionManager


class Recorder(ConnectionManager):
    """Ghi lại mọi message engine phát ra."""

    def __init__(self) -> None:
        super().__init__()
        self.events: list[tuple[str, dict[str, Any]]] = []

    async def broadcast(self, msg_type: str, data: dict[str, Any] | None = None) -> None:
        self.events.append((msg_type, data or {}))

    async def send_to_role(self, role: str, msg_type: str, data: dict[str, Any] | None = None) -> None:  # type: ignore[override]
        self.events.append((msg_type, data or {}))

    def got(self, msg_type: str) -> list[dict[str, Any]]:
        return [d for t, d in self.events if t == msg_type]


class Clock:
    def __init__(self) -> None:
        self.t = 1_000_000.0

    def __call__(self) -> float:
        return self.t


@pytest.fixture()
async def env(tmp_path: Path):
    db = Database(f"sqlite+aiosqlite:///{(tmp_path / 'g.db').as_posix()}")
    await db.init()
    store = SettingsStore(db)
    await store.load()
    rec = Recorder()
    clock = Clock()
    engine = GameEngine(db, store, rec, session_id="test", clock=clock, rng=random.Random(42))
    await engine.load()
    yield engine, rec, clock, db, store
    await engine.stop()
    await db.dispose()


def U(name: str) -> UserInfo:
    return UserInfo(unique_id=name, nickname=name.upper())


async def join(engine: GameEngine, name: str) -> Any:
    await engine.handle_event(GameComment(U(name), "cau"))
    return engine.find_player_by_unique_id(name)


async def admin(engine: GameEngine, action: str, **params: Any):
    return await engine.handle_admin(None, AdminCommandData(action=action, params=params))  # type: ignore[arg-type]


async def logs(db: Database, type_: str) -> list[EventLog]:
    async with db.session() as s:
        return list((await s.execute(select(EventLog).where(EventLog.type == type_))).scalars())


# ------------------------------------------------------------------ tham gia / diem
def test_normalize_text() -> None:
    assert normalize_text("  CÂU ") == "cau"
    assert normalize_text("Tham   Gia") == "tham gia"
    assert normalize_text("Điểm") == "diem"


async def test_join_commands(env) -> None:
    engine, rec, clock, db, _ = env
    for i, text in enumerate(["cau", "1", "Tham Gia", "CÂU", " THAM  GIA "]):
        await engine.handle_event(GameComment(U(f"u{i}"), text))
    await engine.handle_event(GameComment(U("lurker"), "xin chào"))
    assert len(engine.shore_players()) == 5
    assert len(rec.got("PLAYER_JOINED")) == 5
    async with db.session() as s:
        ids = {r.tiktok_unique_id for r in (await s.execute(select(Player))).scalars()}
    assert {"u0", "u1", "u2", "u3", "u4", "lurker"} == ids
    # tham gia lần 2 không phát PLAYER_JOINED lại
    await engine.handle_event(GameComment(U("u0"), "cau"))
    assert len(rec.got("PLAYER_JOINED")) == 5


async def test_state_sync_limits_visible_players(env) -> None:
    engine, *_ = env
    for i in range(20):
        await join(engine, f"p{i}")
    st = engine.build_state()
    assert len(st["players_on_shore"]) == 15
    assert st["stats"]["active_players"] == 20


async def test_diem_command_cooldown(env) -> None:
    engine, rec, clock, *_ = env
    p = await join(engine, "a")
    p.score = 123
    await engine.handle_event(GameComment(U("a"), "Điểm"))
    bubbles = rec.got("CHAT_BUBBLE")
    assert len(bubbles) == 1 and "123" in bubbles[0]["text"] and "Cần Tre" in bubbles[0]["text"]
    clock.t += 4.9
    await engine.handle_event(GameComment(U("a"), "tui"))
    assert len(rec.got("CHAT_BUBBLE")) == 1  # cooldown 5s
    clock.t += 0.2
    await engine.handle_event(GameComment(U("a"), "tui"))
    assert len(rec.got("CHAT_BUBBLE")) == 2


async def test_idle_kick_keeps_db(env) -> None:
    engine, rec, clock, db, _ = env
    await join(engine, "a")
    await engine.tick(clock.t + 601)
    assert not engine.shore_players()
    assert rec.got("PLAYER_LEFT")[0]["reason"] == "IDLE"
    async with db.session() as s:
        assert (await s.execute(select(Player))).scalars().first() is not None


# ------------------------------------------------------------------ gacha
def test_gacha_distribution_and_lucky() -> None:
    rng = random.Random(1)
    rates = GachaRates()
    n = 20000
    counts = {"normal": 0, "rare": 0, "chest": 0, "troll": 0}
    chest_double = chest_total = 0
    for _ in range(n):
        c = roll_catch(rng, rates, lucky=False)
        counts[c.item_type] += 1
        if c.item_type == "chest":
            chest_total += 1
            chest_double += c.chest_result == "DOUBLE"
            if c.chest_result == "BOMB":
                assert c.base_points == 0
        if c.item_type == "troll":
            assert c.base_points == 0
        if c.item_type == "normal":
            assert 10 <= c.base_points <= 50
        if c.item_type == "rare":
            assert 100 <= c.base_points <= 300
    for key, expected in (("normal", 0.65), ("rare", 0.20), ("chest", 0.05), ("troll", 0.10)):
        assert abs(counts[key] / n - expected) < 0.015, key
    assert abs(chest_double / chest_total - 0.7) < 0.08
    # lucky: không troll, không bom
    for _ in range(5000):
        c = roll_catch(rng, rates, lucky=True)
        assert c.item_type != "troll" and c.chest_result != "BOMB"


def test_half_up_rounding() -> None:
    assert half_up(15 * 1.5) == 23
    assert half_up(10 * 2.5) == 25


async def test_lucky_bait_consumption_and_fever(env) -> None:
    engine, rec, clock, db, store = env
    await store.update({"gacha": {"normal": 0, "rare": 0, "chest": 0, "troll": 100}})
    p = await join(engine, "a")
    p.lucky_bait_count = 2
    t = clock.t
    for i in range(3):
        p.next_cast_at = t
        await engine.tick(t + i)
    caught = rec.got("FISH_CAUGHT")
    assert [c["is_troll"] for c in caught] == [False, False, True]  # 2 mồi đầu loại troll, lượt 3 hết mồi
    assert p.lucky_bait_count == 0

    # Fever: không trừ mồi, không troll
    p.lucky_bait_count = 1
    async with engine._lock:
        await engine._start_fever(t, "test")
    rec.events.clear()
    for i in range(3):
        p.next_cast_at = t
        await engine.tick(t + 10 + i)
    assert all(not c["is_troll"] for c in rec.got("FISH_CAUGHT"))
    assert p.lucky_bait_count == 1


async def test_cast_interval_by_rod_and_fever(env) -> None:
    engine, rec, clock, *_ = env
    p = await join(engine, "a")
    t = clock.t
    p.next_cast_at = t + 12
    await engine.tick(t + 11.9)
    assert not rec.got("FISH_CAUGHT")
    await engine.tick(t + 12)
    assert len(rec.got("FISH_CAUGHT")) == 1
    assert p.next_cast_at == pytest.approx(t + 24)
    # Fever chia đôi chu kỳ
    async with engine._lock:
        await engine._start_fever(t + 12, "test")
    p.next_cast_at = t + 20
    await engine.tick(t + 20)
    assert p.next_cast_at == pytest.approx(t + 26)
    # Cần Pháo Laser Lv4 = 4s, hệ số x5
    p.rod_level = 4
    assert engine._cast_interval(p) == 2  # 4s / 2 do fever


async def test_points_multiplier(env) -> None:
    engine, rec, clock, db, store = env
    await store.update({"gacha": {"normal": 100, "rare": 0, "chest": 0, "troll": 0}})
    p = await join(engine, "a")
    p.rod_level = 3
    p.next_cast_at = clock.t
    await engine.tick(clock.t)
    c = rec.got("FISH_CAUGHT")[0]
    assert 25 <= c["points"] <= 125 and p.score == c["points"]
    assert c["item_type"] == "normal" and not c["is_troll"] and not c["is_chest"]


# ------------------------------------------------------------------ like / follow
async def test_likes_to_fever(env) -> None:
    engine, rec, clock, db, _ = env
    await engine.handle_event(GameLike(U("a"), 999))
    assert engine.heat == 999 and not engine.fever_active
    await engine.handle_event(GameLike(U("a"), 1))
    assert engine.fever_active and engine.heat == 0
    last = rec.got("FEVER_UPDATE")[-1]
    assert last["active"] and last["ends_at"] == int((clock.t + 60) * 1000)
    await engine.handle_event(GameLike(U("a"), 500))
    assert engine.heat == 0 and engine.total_likes == 1500  # không tích thêm khi Fever
    await engine.tick(clock.t + 61)
    assert not engine.fever_active
    await engine.handle_event(GameLike(U("a"), 10))
    assert engine.heat == 10
    assert len(await logs(db, "FEVER")) == 1


async def test_follow_once_per_session(env) -> None:
    engine, *_ = env
    await engine.handle_event(GameFollow(U("a")))
    await engine.handle_event(GameFollow(U("a")))
    await engine.handle_event(GameFollow(U("b")))
    assert engine.find_player_by_unique_id("a").lucky_bait_count == 1
    assert engine.find_player_by_unique_id("b").lucky_bait_count == 1


# ------------------------------------------------------------------ quà
def gift(name: str, coins: int, **kw: Any) -> GameGift:
    return GameGift(user=U(name), gift_id=kw.pop("gift_id", coins), gift_name=kw.pop("gift_name", f"G{coins}"),
                    diamond_count=coins, **kw)


async def test_gift_three_tiers(env) -> None:
    engine, rec, clock, db, _ = env
    await engine.handle_event(gift("a", 1))
    net = rec.got("GIFT_EFFECT")[-1]
    assert net["effect_type"] == "ELECTRIC_NET" and 3 <= len(net["caught_fish_ids"]) <= 5
    assert net["bonus_points"] >= 30 and engine.find_player_by_unique_id("a").score == net["bonus_points"]

    p = engine.find_player_by_unique_id("a")
    base = p.score
    for expected in (2, 3, 4):
        await engine.handle_event(gift("a", 10))
        ev = rec.got("GIFT_EFFECT")[-1]
        assert ev["effect_type"] == "UPGRADE_ROD" and ev["new_rod_level"] == expected
    assert p.rod_level == 4 and p.score == base
    await engine.handle_event(gift("a", 10))  # đã Lv4 -> +500
    ev = rec.got("GIFT_EFFECT")[-1]
    assert ev["bonus_points"] == 500 and p.score == base + 500 and p.rod_level == 4

    before = p.score
    await engine.handle_event(gift("a", 100))
    ev = rec.got("GIFT_EFFECT")[-1]
    assert ev["effect_type"] == "TRAWLER_SHIP" and p.score == before + 2000
    assert not engine.boss.active
    assert any(b["kind"] == "TRAWLER" for b in rec.got("BANNER"))
    assert len(await logs(db, "UPGRADE")) == 3
    assert len(await logs(db, "DONATE")) == 6


async def test_gift_coin_conversion_repeat(env) -> None:
    engine, rec, *_ = env
    await engine.handle_event(gift("a", 1, repeat_count=10, streakable=True, group_id="g"))
    ev = rec.got("GIFT_EFFECT")[-1]
    assert ev["coins"] == 10 and ev["effect_type"] == "UPGRADE_ROD"
    assert engine.total_coins == 10
    assert engine.find_player_by_unique_id("a").total_gift_coins == 10


async def test_streak_dedupe(env) -> None:
    engine, rec, *_ = env
    await engine.handle_event(gift("a", 1, repeat_count=3, streakable=True, streaking=True, group_id="g1"))
    assert not rec.got("GIFT_EFFECT")  # chuỗi chưa kết thúc
    await engine.handle_event(gift("a", 1, repeat_count=5, streakable=True, streaking=False, group_id="g1"))
    assert len(rec.got("GIFT_EFFECT")) == 1 and engine.total_coins == 5
    await engine.handle_event(gift("a", 1, repeat_count=5, streakable=True, streaking=False, group_id="g1"))
    assert len(rec.got("GIFT_EFFECT")) == 1  # trùng group -> bỏ qua
    await engine.handle_event(gift("a", 1, repeat_count=5, streakable=True, streaking=False, group_id="g2"))
    assert len(rec.got("GIFT_EFFECT")) == 2
    # quà không streakable trùng timestamp cũng bị chặn
    await engine.handle_event(gift("a", 100, timestamp=123))
    await engine.handle_event(gift("a", 100, timestamp=123))
    assert len(rec.got("GIFT_EFFECT")) == 3


async def test_big_gift_summons_boss_once(env) -> None:
    engine, rec, *_ = env
    await engine.handle_event(gift("a", 1000))
    ev = rec.got("GIFT_EFFECT")[-1]
    assert ev["effect_type"] == "TRAWLER_SHIP" and ev["bonus_points"] == 2000
    assert engine.boss.active
    spawned = [b for b in rec.got("BOSS_UPDATE") if b["status"] == "SPAWNED"]
    assert len(spawned) == 1 and spawned[0]["max_hp"] == 10000 and spawned[0]["current_hp"] == 10000
    # Quà triệu hồi không tự gây sát thương
    assert not [b for b in rec.got("BOSS_UPDATE") if b["status"] == "HIT"]
    res = await admin(engine, "summon_boss")
    assert not res.ok  # chỉ 1 Boss tại một thời điểm


async def test_top1_overtake_banner(env) -> None:
    engine, rec, *_ = env
    await engine.handle_event(gift("a", 100))
    assert not [b for b in rec.got("BANNER") if b["kind"] == "SOAN_NGOI"]  # chưa có ai bị soán
    await engine.handle_event(gift("b", 100))  # hoà điểm: người cũ giữ ngôi
    assert not [b for b in rec.got("BANNER") if b["kind"] == "SOAN_NGOI"]
    await engine.handle_event(gift("b", 100))
    banners = [b for b in rec.got("BANNER") if b["kind"] == "SOAN_NGOI"]
    assert len(banners) == 1 and banners[0]["title"] == "ĐẠI GIA SOÁN NGÔI" and banners[0]["nickname"] == "B"
    assert rec.got("LEADERBOARD_UPDATE")[-1]["top3"][0]["nickname"] == "B"


# ------------------------------------------------------------------ boss
def test_boss_manager_rate_limit_and_rewards() -> None:
    b = BossManager()
    assert b.spawn(100, 180, 0)
    assert not b.spawn(100, 180, 0)
    assert b.hit_by_comment(1, 0.0).damage == 20
    assert b.hit_by_comment(1, 0.5) is None  # < 1s
    assert b.hit_by_comment(1, 1.0).damage == 20
    assert b.hit_by_comment(2, 1.0).damage == 20
    r = b.compute_rewards()
    assert r.mvp_id == 1 and r.lasthit_id == 2
    assert r.bonuses == {1: 500 + 5000, 2: 500 + 3000}


async def test_boss_fight_and_rewards(env) -> None:
    engine, rec, clock, db, store = env
    await store.update({"boss_max_hp": 100})
    for n in "abc":
        await join(engine, n)
    assert (await admin(engine, "summon_boss")).ok
    await engine.handle_event(GameComment(U("a"), "hello"))
    await engine.handle_event(GameComment(U("a"), "hello again"))  # trong 1s -> bỏ qua
    hits = [b for b in rec.got("BOSS_UPDATE") if b["status"] == "HIT"]
    assert len(hits) == 1 and hits[0]["damage"] == 20 and hits[0]["current_hp"] == 80
    clock.t += 1
    await engine.handle_event(GameComment(U("a"), "x"))
    await engine.handle_event(GameComment(U("b"), "x"))
    await engine.handle_event(GameComment(U("c"), "x"))
    clock.t += 1
    await engine.handle_event(GameComment(U("a"), "x"))  # a: 60, b: 20, c: 20 -> hết máu
    done = [b for b in rec.got("BOSS_UPDATE") if b["status"] == "DEFEATED"]
    assert len(done) == 1
    a, b, c = (engine.find_player_by_unique_id(n) for n in "abc")
    assert done[0]["mvp_player"]["player_id"] == a.id and done[0]["lasthit_player"]["player_id"] == a.id
    assert (a.score, b.score, c.score) == (500 + 5000 + 3000, 500, 500)
    assert not engine.boss.active
    assert any(x["kind"] == "BOSS_DEFEATED" for x in rec.got("BANNER"))
    kills = [r for r in await logs(db, "BOSS_KILL") if r.payload.get("phase") == "defeated"]
    assert len(kills) == 1 and kills[0].payload["mvp"]["nickname"] == "A"


async def test_boss_gift_damage(env) -> None:
    engine, rec, *_ = env
    await join(engine, "a")
    await admin(engine, "summon_boss")
    await engine.handle_event(gift("a", 1))  # 1 xu = -100 HP
    hit = [b for b in rec.got("BOSS_UPDATE") if b["status"] == "HIT"][-1]
    assert hit["damage"] == 100 and hit["current_hp"] == 9900 and hit["attacker_id"] is not None


async def test_boss_escape_pauses_fishing_and_auto_spawn(env) -> None:
    engine, rec, clock, db, _ = env
    p = await join(engine, "a")
    t = clock.t
    await admin(engine, "summon_boss")
    p.next_cast_at = t
    p.last_interaction = t + 100
    await engine.tick(t + 100)
    assert not rec.got("FISH_CAUGHT")  # gacha tạm dừng khi có Boss
    await engine.tick(t + 181)
    esc = [b for b in rec.got("BOSS_UPDATE") if b["status"] == "ESCAPED"]
    assert len(esc) == 1 and p.score == 0 and not engine.boss.active
    # Boss định kỳ 15 phút sau lần kết thúc
    p.last_interaction = t + 5000
    await engine.tick(t + 181 + 15 * 60 + 1)
    assert engine.boss.active


# ------------------------------------------------------------------ simulator + admin
async def test_simulator_uses_handle_event(env) -> None:
    engine, *_ = env
    seen: list[Any] = []
    original = engine.handle_event

    async def spy(event: Any) -> None:
        seen.append(event)
        await original(event)

    engine.handle_event = spy  # type: ignore[method-assign]
    await engine.simulator.spawn_players(2)
    await engine.simulator.mock_event({"kind": "like", "count": 5})
    await engine.simulator.mock_event({"kind": "gift", "gift": "lion"})
    kinds = [type(e).__name__ for e in seen]
    assert kinds == ["GameComment", "GameComment", "GameLike", "GameGift"]
    assert seen[0].user.avatar_url.startswith("data:image/svg+xml;base64,")


async def test_admin_commands(env) -> None:
    engine, rec, clock, db, _ = env
    assert (await admin(engine, "spawn_players", count=3)).ok
    assert len(engine.shore_players()) == 3
    assert not (await admin(engine, "spawn_players", count=0)).ok
    assert not (await admin(engine, "mock_event", kind="nope")).ok

    res = await admin(engine, "mock_event", kind="gift", gift="universe", nickname="Đại Gia")
    assert res.ok and engine.boss.active
    res = await admin(engine, "mock_event", kind="gift", gift="rose", repeat_count=3, streaking=True)
    assert res.ok

    p = engine.shore_players()[0]
    assert (await admin(engine, "player_adjust", player_id=p.id, score_delta=500, rod_level=3)).ok
    assert p.score == 500 and p.rod_level == 3
    assert (await admin(engine, "player_adjust", player_id=p.id, score_delta=-9999)).ok and p.score == 0
    assert not (await admin(engine, "player_adjust", player_id=9999, score_delta=1)).ok
    assert not (await admin(engine, "player_adjust", player_id=p.id, rod_level=7)).ok

    assert (await admin(engine, "player_kick", player_id=p.id)).ok and not p.on_shore

    # reset mùa giải: cần confirm, lưu snapshot top 10
    q = engine.shore_players()[0]
    await admin(engine, "player_adjust", player_id=q.id, score_delta=777)
    assert not (await admin(engine, "reset_season")).ok
    assert (await admin(engine, "reset_season", confirm=True)).ok
    snaps = [r for r in await logs(db, "ADMIN") if r.payload.get("action") == "reset_season"]
    assert snaps and any(e["score"] == 777 for e in snaps[0].payload["snapshot_top10"])
    assert all(pl.score == 0 for pl in engine._players.values())
    async with db.session() as s:
        assert all(r.score == 0 for r in (await s.execute(select(Player))).scalars())

    assert (await admin(engine, "trigger_fever")).ok and engine.fever_active
    assert not (await admin(engine, "trigger_fever")).ok
    assert (await admin(engine, "reset_lake")).ok
    assert not engine.shore_players() and not engine.boss.active and not engine.fever_active
    assert rec.got("STATE_SYNC")  # reset_lake đồng bộ lại toàn bộ client


async def test_admin_settings_and_tts_and_phrases(env) -> None:
    engine, rec, clock, db, store = env
    bad = await admin(engine, "settings_update", gacha={"normal": 50, "rare": 20, "chest": 5, "troll": 10})
    assert not bad.ok and "100" in (bad.error or "")
    ok = await admin(engine, "settings_update", boss_max_hp=500, fever_threshold=10,
                     gacha={"normal": 55, "rare": 30, "chest": 5, "troll": 10})
    assert ok.ok and engine.settings.boss_max_hp == 500
    await engine.handle_event(GameLike(U("a"), 10))  # ngưỡng mới có hiệu lực ngay
    assert engine.fever_active
    assert not (await admin(engine, "settings_update", bogus=1)).ok

    assert (await admin(engine, "tts_toggle", enabled=False)).ok and not engine.settings.tts.enabled
    assert (await admin(engine, "tts_config", voice="vi-VN-NamMinhNeural", rate=20, pitch=5)).ok
    assert engine.settings.tts.voice == "vi-VN-NamMinhNeural" and engine.settings.tts.rate_str == "+20%"
    assert not (await admin(engine, "tts_config", rate=99)).ok
    assert not (await admin(engine, "tts_speak_now", text="xin chào")).ok  # TTS service chưa gắn (phase 3)
    assert not (await admin(engine, "connect_tiktok", username="@abc")).ok  # TikTok service chưa gắn (phase 3)

    assert (await admin(engine, "phrase_upsert", group="g", text="một")).ok
    assert (await admin(engine, "phrase_upsert", group="g", text="hai")).ok
    assert (await admin(engine, "phrase_upsert", group="g", text="HAI", index=1)).ok
    assert engine.settings.phrases["g"] == ["một", "HAI"]
    assert not (await admin(engine, "phrase_upsert", group="g", text="x", index=9)).ok
    assert (await admin(engine, "phrase_delete", group="g", index=0)).ok
    assert engine.settings.phrases["g"] == ["HAI"]
    assert not (await admin(engine, "phrase_delete", group="g", index=5)).ok


async def test_flush_persists_progress(env) -> None:
    engine, rec, clock, db, _ = env
    await engine.handle_event(gift("a", 100))
    await engine.flush()
    async with db.session() as s:
        row = (await s.execute(select(Player).where(Player.tiktok_unique_id == "a"))).scalar_one()
    assert row.score == 2000 and row.total_gift_coins == 100


# ------------------------------------------------------------------ REST + WS end-to-end
def test_rest_and_ws_admin(tmp_path: Path) -> None:
    cfg = AppConfig(database_url=f"sqlite+aiosqlite:///{(tmp_path / 'r.db').as_posix()}", _env_file=None)
    with TestClient(create_app(cfg)) as client:
        s = client.get("/api/settings").json()
        assert s["boss_max_hp"] == 10000 and s["gacha"]["normal"] == 65
        assert client.get("/api/players").json() == []
        assert client.get("/api/phrases").status_code == 200

        with client.websocket_connect("/ws/game") as ws:
            ws.send_json({"type": "CLIENT_HELLO", "ts": 0, "data": {"role": "dashboard"}})
            assert ws.receive_json()["type"] == "STATE_SYNC"

            def run(action: str, params: dict[str, Any]) -> dict[str, Any]:
                ws.send_json({"type": "ADMIN_COMMAND", "ts": 0, "data": {"action": action, "params": params}})
                while True:
                    m = ws.receive_json()
                    if m["type"] == "COMMAND_RESULT":
                        return m["data"]

            assert run("spawn_players", {"count": 3})["ok"]
            assert run("spawn_players", {"count": "abc"})["ok"] is False
            assert run("settings_update", {"boss_max_hp": 777})["ok"]

        players = client.get("/api/players?sort=nickname").json()
        assert len(players) == 3 and players[0]["on_shore"] is True
        assert client.get("/api/players", params={"search": players[1]["nickname"][:4]}).json()
        assert client.get("/api/settings").json()["boss_max_hp"] == 777


async def test_auto_bot_populate_action_and_yield(env) -> None:
    engine, rec, clock, db, store = env
    assert not engine.settings.auto_bot_enabled

    # Bật Auto-Bot giữ tối thiểu 3 người trên bờ
    res = await admin(
        engine,
        "settings_update",
        auto_bot_enabled=True,
        auto_bot_min_players=3,
        auto_bot_action_interval_seconds=2.0,
    )
    assert res.ok and engine.settings.auto_bot_enabled

    # Tick cách nhau 2.5s -> tự sinh đủ 3 bot (prefix bot_)
    for i in range(3):
        clock.t += 2.5
        await engine.tick(clock.t)
    shore = engine.shore_players()
    assert len(shore) == 3
    assert all(p.unique_id.startswith("bot_") for p in shore)

    # Tick thêm -> bot thực hiện tương tác (like/diem/comment/gift) mà không spawn thêm bot thứ 4
    clock.t += 2.5
    await engine.tick(clock.t)
    assert len(engine.shore_players()) == 3

    # 3 người thật tham gia -> bot tự nhường chỗ (BOT_YIELD) dần trong các tick tiếp theo
    for i in range(3):
        await join(engine, f"human_{i}")
    assert len(engine.shore_players()) == 6
    clock.t += 2.5
    await engine.tick(clock.t)
    assert len(engine.shore_players()) == 5
    assert any(ev["reason"] == "BOT_YIELD" for ev in rec.got("PLAYER_LEFT"))

