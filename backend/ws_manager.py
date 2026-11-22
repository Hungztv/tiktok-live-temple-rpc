"""Quản lý kết nối WebSocket theo role (overlay / dashboard)."""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket

from schemas import PING, Role, make_envelope

logger = logging.getLogger(__name__)

# Loại message chỉ gửi cho từng role
OVERLAY_ONLY = {"TTS_SPEAK"}
DASHBOARD_ONLY = {"TTS_QUEUE_UPDATE", "LOG", "COMMAND_RESULT"}


@dataclass(eq=False)
class Client:
    ws: WebSocket
    role: Role | None = None
    send_lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class ConnectionManager:
    def __init__(self) -> None:
        self._clients: set[Client] = set()

    # ------------------------------------------------------------ vòng đời
    async def accept(self, ws: WebSocket) -> Client:
        await ws.accept()
        client = Client(ws=ws)
        self._clients.add(client)
        logger.info("WS kết nối mới (tổng %d)", len(self._clients))
        return client

    def set_role(self, client: Client, role: Role) -> None:
        client.role = role
        logger.info("WS đăng ký role=%s", role)

    def disconnect(self, client: Client) -> None:
        self._clients.discard(client)
        logger.info("WS ngắt kết nối role=%s (còn %d)", client.role, len(self._clients))

    def count(self, role: Role | None = None) -> int:
        return sum(1 for c in self._clients if role is None or c.role == role)

    # ------------------------------------------------------------ gửi
    async def send(self, client: Client, msg_type: str, data: dict[str, Any] | None = None) -> bool:
        """Gửi tới 1 client; lỗi thì gỡ client, không ném exception."""
        try:
            async with client.send_lock:
                await client.ws.send_json(make_envelope(msg_type, data))
            return True
        except Exception as exc:  # client rớt giữa chừng
            logger.warning("Gửi WS thất bại (%s), gỡ client: %s", msg_type, exc)
            self.disconnect(client)
            return False

    def _targets(self, msg_type: str) -> list[Client]:
        # Client chưa gửi CLIENT_HELLO (role=None) không nhận broadcast
        if msg_type in OVERLAY_ONLY:
            return [c for c in self._clients if c.role == "overlay"]
        if msg_type in DASHBOARD_ONLY:
            return [c for c in self._clients if c.role == "dashboard"]
        return [c for c in self._clients if c.role is not None]

    async def broadcast(self, msg_type: str, data: dict[str, Any] | None = None) -> None:
        targets = self._targets(msg_type)
        if targets:
            await asyncio.gather(*(self.send(c, msg_type, data) for c in targets))

    async def send_to_role(self, role: Role, msg_type: str, data: dict[str, Any] | None = None) -> None:
        targets = [c for c in self._clients if c.role == role]
        if targets:
            await asyncio.gather(*(self.send(c, msg_type, data) for c in targets))

    # ------------------------------------------------------------ heartbeat
    async def heartbeat_loop(self, interval: float) -> None:
        """Gửi PING mỗi `interval` giây; client chết sẽ bị gỡ khi gửi lỗi."""
        try:
            while True:
                await asyncio.sleep(interval)
                await asyncio.gather(*(self.send(c, PING) for c in list(self._clients)))
        except asyncio.CancelledError:
            raise
