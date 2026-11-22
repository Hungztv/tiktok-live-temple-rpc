"""Entry point FastAPI: /health và /ws/game (handshake, STATE_SYNC, ping/pong)."""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError
from sqlalchemy import select

from config import AppConfig, get_config, setup_logging
from database import Database, SettingsStore
from game_engine import GameEngine
from models import Player
from schemas import (
    ADMIN_COMMAND,
    CLIENT_HELLO,
    COMMAND_RESULT,
    PING,
    PONG,
    STATE_SYNC,
    TTS_FINISHED,
    AdminCommandData,
    ClientHelloData,
    CommandResult,
    StateSync,
    Top3Entry,
    TtsFinishedData,
)
from tiktok_service import TikTokService
from tts_service import TtsService
from ws_manager import Client, ConnectionManager

logger = logging.getLogger("main")

# Kiểu hàm xử lý có thể được các phase sau gắn vào app.state
StateProvider = Callable[[], Awaitable[dict[str, Any]]]
AdminHandler = Callable[[Client, AdminCommandData], Awaitable[CommandResult]]
TtsFinishedHandler = Callable[[TtsFinishedData], Awaitable[None]]


async def default_state_provider(app: FastAPI) -> dict[str, Any]:
    """STATE_SYNC cơ sở từ DB + cấu hình; GameEngine (phase 2) sẽ thay thế provider này."""
    store: SettingsStore = app.state.settings_store
    db: Database = app.state.db
    settings = store.current
    async with db.session() as s:
        rows = (
            await s.execute(select(Player).order_by(Player.score.desc()).limit(3))
        ).scalars().all()
    top3 = [
        Top3Entry(
            player_id=p.id, nickname=p.nickname, avatar_url=p.avatar_url,
            score=p.score, rod_level=p.rod_level,
        )
        for p in rows
    ]
    state = StateSync(
        top3=top3,
        tts_settings=settings.tts,
        game_settings=settings.public_game_settings(),
    )
    state.fever.max = settings.fever_threshold
    return state.model_dump()


def create_app(config: AppConfig | None = None) -> FastAPI:
    cfg = config or get_config()
    setup_logging(cfg.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        await db.init()
        await store.load()
        await engine.load()
        tts.start()
        engine.start()
        heartbeat = asyncio.create_task(
            manager.heartbeat_loop(cfg.ws_ping_interval_seconds), name="ws-heartbeat"
        )
        logger.info("Backend sẵn sàng (session %s)", app.state.session_id)
        try:
            yield
        finally:
            await tiktok.disconnect(silent=True)
            await tts.stop()
            await engine.stop()
            heartbeat.cancel()
            try:
                await heartbeat
            except asyncio.CancelledError:
                pass
            await db.dispose()

    db = Database(cfg.database_url)
    store = SettingsStore(db)
    manager = ConnectionManager()
    session_id = uuid.uuid4().hex[:12]
    engine = GameEngine(db, store, manager, session_id=session_id)
    tts = TtsService(store=store, manager=manager, config=cfg)
    tiktok = TikTokService(engine=engine, sign_api_key=cfg.sign_api_key)
    engine.tts = tts
    engine.say = tts.say_from_group  # type: ignore[assignment]
    engine.tiktok = tiktok

    app = FastAPI(title="Đại Chiến Thủy Cung", version="0.1.0", lifespan=lifespan)
    app.state.config = cfg
    app.state.db = db
    app.state.settings_store = store
    app.state.manager = manager
    app.state.session_id = session_id
    app.state.engine = engine
    app.state.tts = tts
    app.state.tiktok = tiktok
    app.state.state_provider = engine.build_state_async
    app.state.admin_handler = engine.handle_admin
    app.state.tts_finished_handler = tts.handle_tts_finished

    app.add_middleware(
        CORSMiddleware,
        allow_origins=cfg.cors_origin_list,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/players")
    async def api_players(search: str = "", sort: str = "score") -> list[dict[str, Any]]:
        return engine.list_players(search=search, sort=sort)

    @app.get("/api/settings")
    async def api_settings() -> dict[str, Any]:
        return store.current.model_dump()

    @app.get("/api/phrases")
    async def api_phrases() -> dict[str, list[str]]:
        return store.current.phrases

    @app.websocket("/ws/game")
    async def ws_game(ws: WebSocket) -> None:
        # CORSMiddleware không áp dụng cho WS nên tự kiểm tra Origin
        origin = ws.headers.get("origin")
        if origin is not None and origin not in cfg.cors_origin_list:
            logger.warning("Từ chối WS từ origin lạ: %s", origin)
            await ws.close(code=1008)
            return

        client = await manager.accept(ws)
        try:
            while True:
                raw = await ws.receive_text()
                await _handle_raw(app, client, raw)
        except WebSocketDisconnect:
            pass
        except Exception:
            logger.exception("Lỗi không mong đợi ở vòng lặp WS")
        finally:
            manager.disconnect(client)

    return app


async def _reply_error(manager: ConnectionManager, client: Client, action: str, error: str) -> None:
    """COMMAND_RESULT chỉ gửi cho dashboard; role khác chỉ ghi log."""
    if client.role == "dashboard":
        await manager.send(
            client, COMMAND_RESULT,
            CommandResult(ok=False, action=action, error=error).model_dump(),
        )
    else:
        logger.warning("Message không hợp lệ (%s): %s", action, error)


async def _handle_raw(app: FastAPI, client: Client, raw: str) -> None:
    """Parse + validate 1 message; mọi lỗi định dạng đều được nuốt (không sập WS)."""
    manager: ConnectionManager = app.state.manager
    try:
        msg = json.loads(raw)
        if not isinstance(msg, dict) or not isinstance(msg.get("type"), str):
            raise ValueError("Envelope phải là object có trường 'type'")
        data = msg.get("data") or {}
        if not isinstance(data, dict):
            raise ValueError("'data' phải là object")
    except (ValueError, json.JSONDecodeError) as exc:
        await _reply_error(manager, client, "invalid_message", f"Message sai định dạng: {exc}")
        return

    msg_type: str = msg["type"]

    if msg_type == PING:
        await manager.send(client, PONG)
        return
    if msg_type == PONG:
        return

    try:
        if msg_type == CLIENT_HELLO:
            hello = ClientHelloData.model_validate(data)
            manager.set_role(client, hello.role)
            state = await app.state.state_provider()
            await manager.send(client, STATE_SYNC, state)
            return

        if client.role is None:
            await _reply_error(manager, client, msg_type, "Cần gửi CLIENT_HELLO trước")
            return

        if msg_type == TTS_FINISHED:
            finished = TtsFinishedData.model_validate(data)
            handler: TtsFinishedHandler | None = app.state.tts_finished_handler
            if handler:
                await handler(finished)
            else:
                logger.debug("TTS_FINISHED id=%s (chưa có handler)", finished.id)
            return

        if msg_type == ADMIN_COMMAND:
            if client.role != "dashboard":
                await _reply_error(manager, client, str(data.get("action", "")), "Chỉ dashboard được gửi ADMIN_COMMAND")
                return
            cmd = AdminCommandData.model_validate(data)
            admin: AdminHandler | None = app.state.admin_handler
            if admin is None:
                result = CommandResult(ok=False, action=cmd.action, error="Lệnh chưa được hỗ trợ ở phiên bản hiện tại")
            else:
                result = await admin(client, cmd)
            await manager.send(client, COMMAND_RESULT, result.model_dump())
            return

        await _reply_error(manager, client, msg_type, f"Loại message không hỗ trợ: {msg_type}")
    except ValidationError as exc:
        action = str(data.get("action", msg_type))
        first = exc.errors()[0]
        loc = ".".join(str(p) for p in first["loc"])
        await _reply_error(manager, client, action, f"Dữ liệu không hợp lệ ({loc}): {first['msg']}")
    except Exception as exc:
        logger.exception("Lỗi khi xử lý message %s", msg_type)
        await _reply_error(manager, client, msg_type, f"Lỗi nội bộ: {exc}")


app = create_app()

if __name__ == "__main__":
    import uvicorn

    _cfg = get_config()
    uvicorn.run("main:app", host=_cfg.host, port=_cfg.port, log_level=_cfg.log_level.lower())

