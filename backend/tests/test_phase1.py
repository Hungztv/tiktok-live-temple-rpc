"""Kiểm thử Phase 1: /health, bảng SQLite, handshake WS -> STATE_SYNC, ping/pong, lệnh sai."""
from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from config import AppConfig
from main import create_app


@pytest.fixture()
def db_path(tmp_path: Path) -> Path:
    return tmp_path / "test.db"


@pytest.fixture()
def client(db_path: Path):
    cfg = AppConfig(database_url=f"sqlite+aiosqlite:///{db_path.as_posix()}", _env_file=None)
    app = create_app(cfg)
    with TestClient(app) as c:  # chạy lifespan (tạo bảng)
        yield c


def hello(ws, role: str) -> dict:
    ws.send_json({"type": "CLIENT_HELLO", "ts": 0, "data": {"role": role}})
    return ws.receive_json()


def test_health_ok(client: TestClient) -> None:
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_tables_created(client: TestClient, db_path: Path) -> None:
    con = sqlite3.connect(db_path)
    try:
        names = {row[0] for row in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        cols = {row[1] for row in con.execute("PRAGMA table_info(players)")}
    finally:
        con.close()
    assert {"players", "event_logs", "game_settings"} <= names
    assert {
        "tiktok_unique_id", "score", "gold", "rod_level", "lucky_bait_count",
        "total_gift_coins", "last_active",
    } <= cols


@pytest.mark.parametrize("role", ["overlay", "dashboard"])
def test_ws_handshake_state_sync(client: TestClient, role: str) -> None:
    with client.websocket_connect("/ws/game") as ws:
        msg = hello(ws, role)
    assert msg["type"] == "STATE_SYNC"
    assert isinstance(msg["ts"], int)
    data = msg["data"]
    for key in ("players_on_shore", "top3", "fever", "boss", "stats", "tts_settings", "game_settings"):
        assert key in data
    assert data["fever"]["active"] is False
    assert data["stats"]["tiktok_status"] == "DISCONNECTED"
    assert data["game_settings"]["boss_max_hp"] == 10000
    assert data["game_settings"]["gacha"] == {"normal": 65, "rare": 20, "chest": 5, "troll": 10}
    assert data["tts_settings"]["voice"] == "vi-VN-HoaiMyNeural"


def test_ws_ping_pong(client: TestClient) -> None:
    with client.websocket_connect("/ws/game") as ws:
        hello(ws, "overlay")
        ws.send_json({"type": "PING", "ts": 1, "data": {}})
        assert ws.receive_json()["type"] == "PONG"


def test_ws_survives_bad_messages(client: TestClient) -> None:
    with client.websocket_connect("/ws/game") as ws:
        hello(ws, "dashboard")
        ws.send_text("không phải json")
        r1 = ws.receive_json()
        assert r1["type"] == "COMMAND_RESULT" and r1["data"]["ok"] is False
        ws.send_json({"type": "ADMIN_COMMAND", "ts": 0, "data": {"action": "xoa_het"}})
        r2 = ws.receive_json()
        assert r2["type"] == "COMMAND_RESULT" and r2["data"]["ok"] is False
        ws.send_json({"type": "CLIENT_HELLO", "ts": 0, "data": {"role": "hacker"}})
        r3 = ws.receive_json()
        assert r3["data"]["ok"] is False
        # kết nối vẫn sống
        ws.send_json({"type": "PING", "ts": 1, "data": {}})
        assert ws.receive_json()["type"] == "PONG"


def test_overlay_cannot_admin(client: TestClient) -> None:
    with client.websocket_connect("/ws/game") as overlay, client.websocket_connect("/ws/game") as dash:
        hello(overlay, "overlay")
        hello(dash, "dashboard")
        overlay.send_json({"type": "ADMIN_COMMAND", "ts": 0, "data": {"action": "tts_clear_queue", "params": {}}})
        # overlay không nhận COMMAND_RESULT; dashboard vẫn hoạt động bình thường
        dash.send_json({"type": "ADMIN_COMMAND", "ts": 0, "data": {"action": "tts_clear_queue", "params": {}}})
        res = dash.receive_json()
        while res["type"] != "COMMAND_RESULT":
            res = dash.receive_json()
        assert res["type"] == "COMMAND_RESULT" and res["data"]["action"] == "tts_clear_queue"
        overlay.send_json({"type": "PING", "ts": 1, "data": {}})
        assert overlay.receive_json()["type"] == "PONG"  # phản hồi đầu tiên là PONG, không có COMMAND_RESULT


def test_ws_rejects_foreign_origin(client: TestClient) -> None:
    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/game", headers={"origin": "http://evil.example"}):
            pass


async def test_settings_validation_and_cache(tmp_path: Path) -> None:
    from pydantic import ValidationError

    from database import Database, SettingsStore

    db = Database(f"sqlite+aiosqlite:///{(tmp_path / 's.db').as_posix()}")
    await db.init()
    store = SettingsStore(db)
    await store.load()
    with pytest.raises(ValidationError):
        await store.update({"gacha": {"normal": 50}})  # tổng != 100
    assert store.current.gacha.normal == 65  # không đổi khi lỗi
    await store.update({"boss_max_hp": 5000, "gacha": {"normal": 55, "rare": 30}})
    assert store.current.boss_max_hp == 5000
    # nạp lại từ DB bằng store mới -> giữ giá trị đã lưu
    store2 = SettingsStore(db)
    await store2.load()
    assert store2.current.boss_max_hp == 5000 and store2.current.gacha.rare == 30
    await db.dispose()
