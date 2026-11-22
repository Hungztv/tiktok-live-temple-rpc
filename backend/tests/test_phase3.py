"""Kiểm thử Phase 3: 50 câu thoại (9 nhóm), PriorityQueue, cache LRU, fallback TTS, TTS_FINISHED, LLMProvider & TikTokService."""
from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from config import AppConfig
from database import Database, SettingsStore
from game_engine import GameEngine, GameGift, UserInfo
from main import create_app
from phrases import DEFAULT_PHRASES, count_total_phrases, render_phrase
from schemas import TtsFinishedData, TtsSettings
from tiktok_service import (
    TikTokService,
    classify_tiktok_error,
    convert_gift_event,
    extract_user_info,
    is_gift_streak_finished,
)
from tts_service import (
    GeminiLLMProvider,
    OllamaLLMProvider,
    TemplateLLMProvider,
    TtsService,
    estimate_duration_ms,
)
from ws_manager import ConnectionManager


async def _instant_mp3(text: str, cfg: TtsSettings) -> bytes:
    return b"FAKE_MP3"


class OverlayRecorder(ConnectionManager):
    """Ghi lại các bản tin gửi tới overlay & dashboard."""

    def __init__(self, overlay_count: int = 0) -> None:
        super().__init__()
        self.overlay_count = overlay_count
        self.overlay_msgs: list[tuple[str, dict[str, Any]]] = []
        self.dashboard_msgs: list[tuple[str, dict[str, Any]]] = []
        self.broadcast_msgs: list[tuple[str, dict[str, Any]]] = []

    def count(self, role: str | None = None) -> int:  # type: ignore[override]
        if role == "overlay":
            return self.overlay_count
        return 0

    async def send_to_role(self, role: str, msg_type: str, data: dict[str, Any] | None = None) -> None:  # type: ignore[override]
        if role == "overlay":
            self.overlay_msgs.append((msg_type, data or {}))
        elif role == "dashboard":
            self.dashboard_msgs.append((msg_type, data or {}))

    async def broadcast(self, msg_type: str, data: dict[str, Any] | None = None) -> None:
        self.broadcast_msgs.append((msg_type, data or {}))


# ------------------------------------------------------------------ 1. 50 câu thoại
def test_phrases_exact_50_and_groups() -> None:
    expected_counts = {
        "troll_sandal": 8,
        "troll_trash": 6,
        "chest_bomb": 4,
        "rare_fish": 8,
        "gift_small": 4,
        "gift_upgrade": 4,
        "gift_trawler": 4,
        "boss_event": 6,
        "idle_chat": 6,
    }
    assert set(DEFAULT_PHRASES.keys()) == set(expected_counts.keys())
    for group, expected in expected_counts.items():
        items = DEFAULT_PHRASES[group]
        assert len(items) == expected, f"Nhóm {group} phải có {expected} câu"
        assert all(isinstance(s, str) and len(s.strip()) > 15 for s in items)
    assert count_total_phrases() == 50


def test_safe_template_render() -> None:
    # Không lỗi khi thiếu biến hoặc có biến lạ {unknown}
    text = render_phrase("Xin chào {name}, câu được {item} (+{points}) {unknown_var}!", name="An", points=50)
    assert "An" in text and "50" in text and "{unknown_var}" in text


# ------------------------------------------------------------------ 2. PriorityQueue & Chống spam
async def test_priority_queue_ordering_and_max_capacity(tmp_path: Path) -> None:
    db = Database(f"sqlite+aiosqlite:///{(tmp_path / 'q.db').as_posix()}")
    await db.init()
    store = SettingsStore(db)
    await store.load()
    rec = OverlayRecorder()
    tts = TtsService(store=store, manager=rec, synthesizer=_instant_mp3)

    await tts.enqueue("Giao lưu 4", priority=4)
    await tts.enqueue("Quà nhỏ 3", priority=3)
    await tts.enqueue("Đại gia 2", priority=2)
    await tts.enqueue("Boss 1", priority=1)
    await tts.enqueue("Admin 0", priority=0)

    popped = [(await tts.pop_next()).priority for _ in range(5)]
    assert popped == [0, 1, 2, 3, 4]

    # Hàng đợi tối đa 20 câu; khi đầy thì loại bỏ câu có độ ưu tiên thấp nhất
    for i in range(20):
        await tts.enqueue(f"Thấp {i}", priority=4)
    assert tts.queue_size() == 20
    # Đẩy thêm câu ưu tiên 1 -> phải vào được và đuổi 1 câu ưu tiên 4 ra
    item = await tts.enqueue("Khẩn cấp Boss", priority=1)
    assert item is not None and tts.queue_size() == 20
    first = await tts.pop_next()
    assert first.priority == 1 and first.text == "Khẩn cấp Boss"
    await db.dispose()


async def test_spam_protection_per_player(tmp_path: Path) -> None:
    db = Database(f"sqlite+aiosqlite:///{(tmp_path / 'spam.db').as_posix()}")
    await db.init()
    store = SettingsStore(db)
    await store.load()
    now = 1000.0
    tts = TtsService(store=store, manager=OverlayRecorder(), clock=lambda: now)

    assert await tts.enqueue("Câu 1", priority=3, player_id=7) is not None
    assert await tts.enqueue("Câu 2", priority=3, player_id=7) is None  # bị chặn trong 8s
    assert await tts.enqueue("Người khác", priority=3, player_id=8) is not None
    # Ưu tiên 2 (quà lớn) không bị chặn bởi cooldown 3-4
    assert await tts.enqueue("Quà lớn", priority=2, player_id=7) is not None
    now += 8.5
    assert await tts.enqueue("Câu 3 sau 8s", priority=3, player_id=7) is not None
    await db.dispose()


# ------------------------------------------------------------------ 3. Cache LRU & Fallback chống kẹt
async def test_lru_cache_and_fallback_on_error_or_timeout(tmp_path: Path) -> None:
    db = Database(f"sqlite+aiosqlite:///{(tmp_path / 'tts.db').as_posix()}")
    await db.init()
    store = SettingsStore(db)
    await store.load()
    rec = OverlayRecorder()

    calls = 0

    async def fake_synth(text: str, cfg: TtsSettings) -> bytes:
        nonlocal calls
        calls += 1
        return f"audio:{text}:{cfg.voice}".encode("utf-8")

    tts = TtsService(store=store, manager=rec, synthesizer=fake_synth)
    a1 = await tts.synthesize("Xin chào thủy cung")
    a2 = await tts.synthesize("Xin chào thủy cung")
    assert calls == 1  # lần 2 lấy từ cache LRU
    assert a1.audio_base64 == a2.audio_base64 and a1.audio_base64 != ""

    # Khi edge-tts lỗi hoặc mất mạng -> vẫn trả TTS_SPEAK với audio_base64="" và duration_ms = max(2000, len(text)*65)
    async def broken_synth(text: str, cfg: TtsSettings) -> bytes:
        raise ConnectionError("Không có kết nối mạng tới edge-tts")

    tts_broken = TtsService(store=store, manager=rec, synthesizer=broken_synth)
    text = "Chúc mừng đại gia câu trúng cá mập trắng siêu to khổng lồ!"
    item = await tts_broken.enqueue(text, priority=1)
    assert item is not None
    popped = await tts_broken.pop_next()
    payload = await tts_broken.process_one(popped)
    assert payload["audio_base64"] == ""
    assert payload["duration_ms"] == estimate_duration_ms(text) == max(2000, len(text) * 65)
    assert rec.overlay_msgs[-1][0] == "TTS_SPEAK"
    await db.dispose()


# ------------------------------------------------------------------ 4. Luồng TTS_FINISHED & Watchdog
async def test_tts_finished_unlocks_next_speech_and_watchdog(tmp_path: Path) -> None:
    db = Database(f"sqlite+aiosqlite:///{(tmp_path / 'fin.db').as_posix()}")
    await db.init()
    store = SettingsStore(db)
    await store.load()
    rec = OverlayRecorder(overlay_count=1)

    tts = TtsService(
        store=store,
        manager=rec,
        synthesizer=_instant_mp3,
        watchdog_extra_ms=50,
    )
    tts.start()

    item1 = await tts.enqueue("Câu thứ nhất", priority=1)
    item2 = await tts.enqueue("Câu thứ hai", priority=1)
    assert item1 is not None and item2 is not None

    # Đợi câu 1 được phát sang overlay
    for _ in range(30):
        if len(rec.overlay_msgs) >= 1:
            break
        await asyncio.sleep(0.02)
    assert len(rec.overlay_msgs) == 1
    first_id = rec.overlay_msgs[0][1]["id"]
    assert first_id == item1.id

    # Khi chưa gửi TTS_FINISHED, câu 2 chưa được phát
    await asyncio.sleep(0.05)
    assert len(rec.overlay_msgs) == 1

    # Overlay gửi TTS_FINISHED -> câu 2 được phát ngay
    await tts.handle_tts_finished(TtsFinishedData(id=first_id))
    for _ in range(30):
        if len(rec.overlay_msgs) >= 2:
            break
        await asyncio.sleep(0.02)
    assert len(rec.overlay_msgs) == 2
    assert rec.overlay_msgs[1][1]["id"] == item2.id

    # Cho kết thúc câu 2
    await tts.handle_tts_finished(TtsFinishedData(id=item2.id))
    await tts.stop()
    await db.dispose()

    # Kiểm tra thêm cơ chế watchdog timeout: nếu overlay không gửi TTS_FINISHED thì vẫn tự thoát
    db2 = Database(f"sqlite+aiosqlite:///{(tmp_path / 'wd.db').as_posix()}")
    await db2.init()
    store2 = SettingsStore(db2)
    await store2.load()
    rec2 = OverlayRecorder(overlay_count=1)
    tts_wd = TtsService(
        store=store2,
        manager=rec2,
        synthesizer=_instant_mp3,
        watchdog_extra_ms=-1950,  # duration_ms=2000 + (-1950) = 50ms timeout trong test
    )
    q_item = await tts_wd.enqueue("Ngắn", priority=1)
    assert q_item is not None
    popped = await tts_wd.pop_next()
    await tts_wd.process_one(popped)  # tự hoàn thành sau ~50ms không cần TTS_FINISHED
    assert len(rec2.overlay_msgs) == 1
    await db2.dispose()


# ------------------------------------------------------------------ 5. LLMProvider fallback
async def test_llm_providers_fallback_to_template() -> None:
    tpl = TemplateLLMProvider()
    assert await tpl.generate_commentary("rare_fish", {}, "Câu mẫu gốc") == "Câu mẫu gốc"

    # Gemini không có key hoặc lỗi mạng -> trả câu mẫu gốc
    gem = GeminiLLMProvider(api_key="", timeout=0.2)
    assert await gem.generate_commentary("rare_fish", {}, "Câu mẫu Gemini") == "Câu mẫu Gemini"

    # Ollama trỏ cổng không mở -> tự fallback về câu mẫu gốc
    oll = OllamaLLMProvider(base_url="http://127.0.0.1:59999", timeout=0.2)
    assert await oll.generate_commentary("rare_fish", {}, "Câu mẫu Ollama") == "Câu mẫu Ollama"


# ------------------------------------------------------------------ 6. TikTokService & tích hợp GameEngine
async def test_tiktok_gift_streak_and_service_reconnect(tmp_path: Path) -> None:
    # Kiểm tra quy tắc streakable trên TikTokLive v6+
    ev_streaking = SimpleNamespace(
        user=SimpleNamespace(unique_id="u1", nickname="Tèo", avatar_thumb=SimpleNamespace(m_urls=["http://a/1.png"])),
        gift=SimpleNamespace(id=5655, name="Hoa Hồng", diamond_count=1, streakable=True),
        repeat_count=3,
        streaking=True,
        group_id="grp1",
    )
    assert not is_gift_streak_finished(ev_streaking)
    assert convert_gift_event(ev_streaking) is None

    ev_done = SimpleNamespace(
        user=ev_streaking.user,
        gift=ev_streaking.gift,
        repeat_count=5,
        streaking=False,
        group_id="grp1",
    )
    assert is_gift_streak_finished(ev_done)
    g = convert_gift_event(ev_done)
    assert g is not None and g.user.unique_id == "u1" and g.repeat_count == 5 and g.user.avatar_url == "http://a/1.png"

    status, msg = classify_tiktok_error(RuntimeError("UserOfflineError: user is offline"))
    assert status == "OFFLINE_ROOM" and "live" in msg.lower()

    # Tích hợp GameEngine + TtsService + TikTokService
    db = Database(f"sqlite+aiosqlite:///{(tmp_path / 'int.db').as_posix()}")
    await db.init()
    store = SettingsStore(db)
    await store.load()
    rec = OverlayRecorder()
    engine = GameEngine(db, store, rec, session_id="s3")
    await engine.load()
    tts = TtsService(store=store, manager=rec, synthesizer=_instant_mp3)
    engine.tts = tts
    engine.say = tts.say_from_group  # type: ignore[assignment]

    # Tặng quà lớn -> tự động đẩy câu đọc vào hàng đợi TTS ở ưu tiên 2
    await engine.handle_event(
        GameGift(user=UserInfo("vip1", "Đại Gia Minh"), gift_id=6104, gift_name="Sư Tử", diamond_count=100)
    )
    assert tts.queue_size() >= 1
    top_speech = await tts.pop_next()
    assert top_speech.priority == 2 and "Đại Gia Minh" in top_speech.text
    await db.dispose()


def test_ws_end_to_end_tts_and_phrases(tmp_path: Path) -> None:
    cfg = AppConfig(database_url=f"sqlite+aiosqlite:///{(tmp_path / 'e2e.db').as_posix()}", _env_file=None)
    app = create_app(cfg)
    with TestClient(app) as client:
        # Thay synthesizer bằng hàm trả nhanh để không gọi mạng thật trong test
        app.state.tts._synthesizer = _instant_mp3
        phrases = client.get("/api/phrases").json()
        assert sum(len(v) for v in phrases.values()) == 50

        with client.websocket_connect("/ws/game") as ov, client.websocket_connect("/ws/game") as dash:
            ov.send_json({"type": "CLIENT_HELLO", "ts": 0, "data": {"role": "overlay"}})
            assert ov.receive_json()["type"] == "STATE_SYNC"
            dash.send_json({"type": "CLIENT_HELLO", "ts": 0, "data": {"role": "dashboard"}})
            assert dash.receive_json()["type"] == "STATE_SYNC"

            dash.send_json({
                "type": "ADMIN_COMMAND",
                "ts": 0,
                "data": {"action": "tts_speak_now", "params": {"text": "Alo 1 2 3"}},
            })
            speak = ov.receive_json()
            assert speak["type"] == "TTS_SPEAK"
            assert speak["data"]["text"] == "Alo 1 2 3"
            assert speak["data"]["priority"] == 0
            ov.send_json({"type": "TTS_FINISHED", "ts": 0, "data": {"id": speak["data"]["id"]}})
