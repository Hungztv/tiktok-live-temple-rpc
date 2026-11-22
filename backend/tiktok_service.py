"""TikTokService (TikTokLive >= 6.x): kết nối phòng live, chuẩn hoá event, tự reconnect."""
from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import TYPE_CHECKING, Any, Callable

from TikTokLive import TikTokLiveClient
from TikTokLive.events import (
    CommentEvent,
    ConnectEvent,
    DisconnectEvent,
    FollowEvent,
    GiftEvent,
    LikeEvent,
)

from game_engine import GameComment, GameFollow, GameGift, GameLike, UserInfo

if TYPE_CHECKING:
    from game_engine import GameEngine

logger = logging.getLogger("tiktok")

RECONNECT_INITIAL_SECONDS = 2.0
RECONNECT_MAX_SECONDS = 30.0
RECONNECT_MAX_ATTEMPTS = 10


def extract_user_info(event: Any) -> UserInfo:
    """Trích xuất an toàn unique_id, nickname và avatar_url từ event TikTokLive v6+."""
    user = getattr(event, "user", None) or getattr(event, "from_user", None)
    if user is None:
        return UserInfo(unique_id="unknown_user", nickname="Người xem")

    uid = (
        getattr(user, "unique_id", None)
        or getattr(user, "username", None)
        or getattr(user, "id", None)
        or "unknown_user"
    )
    nickname = (
        getattr(user, "nickname", None)
        or getattr(user, "nick_name", None)
        or str(uid)
    )
    avatar_url = ""
    avatar_obj = getattr(user, "avatar_thumb", None) or getattr(user, "avatar", None)
    if avatar_obj is not None:
        urls = getattr(avatar_obj, "m_urls", None) or getattr(avatar_obj, "url_list", None) or getattr(avatar_obj, "urls", None)
        if isinstance(urls, (list, tuple)) and urls:
            avatar_url = str(urls[0])
        elif isinstance(avatar_obj, str):
            avatar_url = avatar_obj
    return UserInfo(unique_id=str(uid), nickname=str(nickname), avatar_url=avatar_url)


def is_gift_streak_finished(event: Any) -> bool:
    """Kiểm tra điều kiện kết thúc chuỗi quà combo trên TikTokLive v6+."""
    gift = getattr(event, "gift", None)
    return bool(not getattr(gift, "streakable", False) or not getattr(event, "streaking", False))


def convert_gift_event(event: Any) -> GameGift | None:
    """Chuyển GiftEvent của TikTokLive sang GameGift nội bộ (nếu đã kết thúc streak)."""
    if not is_gift_streak_finished(event):
        return None
    user = extract_user_info(event)
    gift = getattr(event, "gift", None)
    gift_id = int(getattr(gift, "id", 0) or getattr(event, "gift_id", 0) or 1)
    gift_name = str(getattr(gift, "name", None) or "Quà TikTok")
    diamond_count = int(getattr(gift, "diamond_count", 0) or getattr(event, "diamond_count", 0) or 1)
    repeat_count = int(getattr(event, "repeat_count", 1) or 1)
    streakable = bool(getattr(gift, "streakable", False))
    streaking = bool(getattr(event, "streaking", False))
    group_id = getattr(event, "group_id", None) or getattr(event, "combo_id", None)
    return GameGift(
        user=user,
        gift_id=gift_id,
        gift_name=gift_name,
        diamond_count=max(1, diamond_count),
        repeat_count=max(1, repeat_count),
        streakable=streakable,
        streaking=streaking,
        group_id=str(group_id) if group_id is not None else None,
        timestamp=time.time_ns(),
    )


def classify_tiktok_error(exc: Exception) -> tuple[str, str]:
    """Phân loại lỗi TikTokLive sang (status, thông báo tiếng Việt)."""
    name = type(exc).__name__.lower()
    msg = str(exc).lower()
    if "offline" in name or "offline" in msg or "not live" in msg or "useroffline" in name:
        return ("OFFLINE_ROOM", "Phòng chưa bật live hoặc đã kết thúc phiên phát trực tiếp.")
    if "notfound" in name or "not found" in msg or "user not found" in msg or "invalid user" in msg:
        return ("ERROR", "Không tìm thấy tài khoản TikTok, vui lòng kiểm tra lại @username.")
    if "ratelimit" in name or "rate limit" in msg or "429" in msg or "sign" in name:
        return ("ERROR", "Bị giới hạn tốc độ kết nối (Rate Limit). Hãy thử lại sau ít phút hoặc cấu hình SIGN_API_KEY.")
    return ("ERROR", f"Lỗi kết nối TikTok Live: {exc}")


ClientFactory = Callable[[str, str], Any]


def default_client_factory(username: str, sign_api_key: str) -> TikTokLiveClient:
    web_kwargs: dict[str, Any] = {}
    if sign_api_key:
        os.environ.setdefault("SIGN_API_KEY", sign_api_key)
        web_kwargs["sign_api_key"] = sign_api_key
    try:
        return TikTokLiveClient(unique_id=f"@{username}", web_kwargs=web_kwargs or None)
    except TypeError:
        return TikTokLiveClient(unique_id=f"@{username}")


class TikTokService:
    """Quản lý vòng đời kết nối TikTokLiveClient, tự động reconnect với exponential backoff."""

    def __init__(
        self,
        engine: "GameEngine",
        sign_api_key: str = "",
        client_factory: ClientFactory | None = None,
        backoff_base: float = RECONNECT_INITIAL_SECONDS,
        backoff_max: float = RECONNECT_MAX_SECONDS,
        max_attempts: int = RECONNECT_MAX_ATTEMPTS,
    ) -> None:
        self._engine = engine
        self.sign_api_key = sign_api_key
        self._client_factory: ClientFactory = client_factory or default_client_factory
        self.backoff_base = backoff_base
        self.backoff_max = backoff_max
        self.max_attempts = max_attempts

        self.username: str = ""
        self._client: Any | None = None
        self._runner_task: asyncio.Task[None] | None = None
        self._manual_stop = False

    def _attach_handlers(self, client: Any) -> None:
        @client.on(ConnectEvent)
        async def _on_connect(event: ConnectEvent) -> None:
            logger.info("Đã kết nối TikTok Live: @%s", self.username)
            await self._engine.set_tiktok_status(
                "CONNECTED",
                username=self.username,
                message=f"Đã kết nối phòng live @{self.username}",
            )

        @client.on(DisconnectEvent)
        async def _on_disconnect(event: DisconnectEvent) -> None:
            logger.warning("Ngắt kết nối khỏi phòng live @%s", self.username)

        @client.on(CommentEvent)
        async def _on_comment(event: CommentEvent) -> None:
            text = str(getattr(event, "comment", "") or "")
            if text:
                await self._engine.handle_event(GameComment(user=extract_user_info(event), text=text))

        @client.on(LikeEvent)
        async def _on_like(event: LikeEvent) -> None:
            count = int(getattr(event, "count", 0) or getattr(event, "like_count", 0) or 1)
            await self._engine.handle_event(GameLike(user=extract_user_info(event), count=max(1, count)))

        @client.on(FollowEvent)
        async def _on_follow(event: FollowEvent) -> None:
            await self._engine.handle_event(GameFollow(user=extract_user_info(event)))

        @client.on(GiftEvent)
        async def _on_gift(event: GiftEvent) -> None:
            gift = convert_gift_event(event)
            if gift is not None:
                await self._engine.handle_event(gift)

    async def connect(self, username: str) -> str:
        clean = username.replace("@", "").strip()
        if not clean:
            raise ValueError("Username không hợp lệ")
        await self.disconnect(silent=True)
        self.username = clean
        self._manual_stop = False
        await self._engine.set_tiktok_status(
            "CONNECTING",
            username=clean,
            message=f"Đang kết nối tới phòng live @{clean}...",
        )
        self._runner_task = asyncio.create_task(self._connection_loop(clean), name=f"tiktok-{clean}")
        return f"Đang kết nối tới @{clean}"

    async def disconnect(self, silent: bool = False) -> str:
        self._manual_stop = True
        client = self._client
        self._client = None
        if client is not None:
            disconnect_fn = getattr(client, "disconnect", None)
            if callable(disconnect_fn):
                try:
                    res = disconnect_fn()
                    if asyncio.iscoroutine(res):
                        await res
                except Exception:
                    logger.debug("Bỏ qua lỗi khi đóng TikTokLiveClient", exc_info=True)
        if self._runner_task is not None:
            self._runner_task.cancel()
            try:
                await self._runner_task
            except asyncio.CancelledError:
                pass
            self._runner_task = None
        if not silent:
            await self._engine.set_tiktok_status(
                "DISCONNECTED",
                username="",
                message="Đã ngắt kết nối TikTok Live.",
            )
        return "Đã ngắt kết nối TikTok Live"

    async def _connection_loop(self, username: str) -> None:
        attempt = 0
        while not self._manual_stop:
            try:
                client = self._client_factory(username, self.sign_api_key)
                self._client = client
                self._attach_handlers(client)
                start_fn = getattr(client, "connect", None) or getattr(client, "start", None)
                if start_fn is None:
                    raise RuntimeError("TikTokLiveClient không hỗ trợ connect/start")
                res = start_fn()
                if asyncio.iscoroutine(res):
                    await res
                if self._manual_stop:
                    break
                # Nếu connect() tự thoát mà không do người dùng bấm disconnect -> coi là mất kết nối bất ngờ
                raise ConnectionError("Phiên TikTok Live đã đóng bất ngờ")
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                if self._manual_stop:
                    break
                status, vi_msg = classify_tiktok_error(exc)
                if status == "OFFLINE_ROOM":
                    logger.info("Phòng @%s đang offline: %s", username, vi_msg)
                    await self._engine.set_tiktok_status("OFFLINE_ROOM", username=username, message=vi_msg)
                    break

                attempt += 1
                if attempt > self.max_attempts:
                    await self._engine.set_tiktok_status(
                        "ERROR",
                        username=username,
                        message=f"{vi_msg} (Đã thử kết nối lại {self.max_attempts} lần không thành công).",
                    )
                    break

                delay = min(self.backoff_max, self.backoff_base * (2 ** (attempt - 1)))
                await self._engine.set_tiktok_status(
                    "CONNECTING",
                    username=username,
                    message=f"{vi_msg} — Thử kết nối lại lần {attempt}/{self.max_attempts} sau {delay:.0f}s...",
                )
                await asyncio.sleep(delay)
