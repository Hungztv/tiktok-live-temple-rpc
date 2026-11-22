"""TTS & AI Caster Service: PriorityQueue, edge-tts, LRU cache, LLMProvider & Fallback."""
from __future__ import annotations

import asyncio
import base64
import hashlib
import itertools
import logging
import random
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any, Callable, Protocol

import edge_tts
import httpx

from config import AppConfig
from database import SettingsStore
from phrases import DEFAULT_PHRASES, render_phrase
from schemas import TTS_QUEUE_UPDATE, TTS_SPEAK, TtsFinishedData, TtsSettings
from ws_manager import ConnectionManager

logger = logging.getLogger("tts")

MAX_QUEUE_SIZE = 20
PLAYER_SPAM_COOLDOWN_SECONDS = 8.0
LRU_CACHE_MAX_ITEMS = 128
EDGE_TTS_TIMEOUT_SECONDS = 8.0
WATCHDOG_EXTRA_MS = 3000
LLM_TIMEOUT_SECONDS = 4.0


# ---------------------------------------------------------------- LLM Provider
class LLMProvider(Protocol):
    async def generate_commentary(self, group: str, context: dict[str, Any], fallback_text: str) -> str:
        ...


class TemplateLLMProvider:
    """Mặc định: trả về câu từ Template Engine (không gọi mạng)."""

    async def generate_commentary(self, group: str, context: dict[str, Any], fallback_text: str) -> str:
        return fallback_text


class GeminiLLMProvider:
    """Gọi Gemini REST API (timeout 4s), lỗi tự động fallback về câu mẫu."""

    def __init__(self, api_key: str, model: str = "gemini-2.0-flash", timeout: float = LLM_TIMEOUT_SECONDS) -> None:
        self.api_key = api_key
        self.model = model
        self.timeout = timeout

    async def generate_commentary(self, group: str, context: dict[str, Any], fallback_text: str) -> str:
        if not self.api_key:
            return fallback_text
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent"
        prompt = (
            "Bạn là BLV AI hài hước của game câu cá Đại Chiến Thủy Cung trên TikTok Live. "
            f"Hãy viết ĐÚNG 1 câu bình luận tiếng Việt ngắn gọn (dưới 30 từ), vui nhộn cho sự kiện '{group}' "
            f"với thông tin {context}. Gợi ý mẫu: '{fallback_text}'."
        )
        payload = {"contents": [{"parts": [{"text": prompt}]}]}
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(url, params={"key": self.api_key}, json=payload)
                resp.raise_for_status()
                data = resp.json()
                text = (
                    data.get("candidates", [{}])[0]
                    .get("content", {})
                    .get("parts", [{}])[0]
                    .get("text", "")
                    .strip()
                )
                return text or fallback_text
        except Exception as exc:
            logger.warning("GeminiLLMProvider lỗi/timeout (%s), fallback về Template Engine", exc)
            return fallback_text


class OllamaLLMProvider:
    """Gọi Ollama HTTP API `/api/generate` (timeout 4s), lỗi tự động fallback về câu mẫu."""

    def __init__(self, base_url: str = "http://127.0.0.1:11434", model: str = "llama3.2", timeout: float = LLM_TIMEOUT_SECONDS) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = timeout

    async def generate_commentary(self, group: str, context: dict[str, Any], fallback_text: str) -> str:
        prompt = (
            "Viết 1 câu bình luận tiếng Việt thật ngắn gọn, hài hước cho game câu cá TikTok Live "
            f"(nhóm: {group}, dữ liệu: {context}). Mẫu tham khảo: {fallback_text}"
        )
        payload = {"model": self.model, "prompt": prompt, "stream": False}
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(f"{self.base_url}/api/generate", json=payload)
                resp.raise_for_status()
                data = resp.json()
                text = str(data.get("response", "")).strip()
                return text or fallback_text
        except Exception as exc:
            logger.warning("OllamaLLMProvider lỗi/timeout (%s), fallback về Template Engine", exc)
            return fallback_text


def build_llm_provider(cfg: AppConfig) -> LLMProvider:
    kind = cfg.llm_provider.strip().lower()
    if kind == "gemini":
        return GeminiLLMProvider(api_key=cfg.gemini_api_key, model=cfg.gemini_model)
    if kind == "ollama":
        return OllamaLLMProvider(base_url=cfg.ollama_url, model=cfg.ollama_model)
    return TemplateLLMProvider()


# ---------------------------------------------------------------- Hàng đợi & Mục đọc
@dataclass(order=True)
class QueuedSpeech:
    priority: int
    seq: int
    id: str = field(compare=False)
    text: str = field(compare=False)
    group: str = field(compare=False, default="instant")
    player_id: int | None = field(compare=False, default=None)
    created_at: float = field(compare=False, default_factory=time.time)

    def public(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "priority": self.priority,
            "text": self.text,
            "group": self.group,
            "player_id": self.player_id,
        }


@dataclass
class SynthesizedAudio:
    audio_base64: str
    mime: str
    duration_ms: int


def estimate_duration_ms(text: str) -> int:
    """Công thức độ dài phụ đề / nhép miệng chuẩn: max(2000, len(text) * 65)."""
    return max(2000, len(text) * 65)


def make_cache_key(text: str, voice: str, rate_str: str, pitch_str: str) -> str:
    raw = f"{text}|{voice}|{rate_str}|{pitch_str}".encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


SynthesizerFunc = Callable[[str, TtsSettings], Any]


async def default_edge_synthesize(text: str, tts_cfg: TtsSettings) -> bytes:
    """Gọi edge-tts stream trong bộ nhớ và trả về bytes mp3."""
    comm = edge_tts.Communicate(
        text=text,
        voice=tts_cfg.voice,
        rate=tts_cfg.rate_str,
        pitch=tts_cfg.pitch_str,
    )
    chunks: list[bytes] = []
    async for chunk in comm.stream():
        if chunk.get("type") == "audio" and chunk.get("data"):
            chunks.append(chunk["data"])
    if not chunks:
        raise RuntimeError("edge-tts không trả về dữ liệu âm thanh")
    return b"".join(chunks)


async def _fake_synth_for_test(text: str, cfg: TtsSettings) -> bytes:
    return b"MP3"


class TtsService:
    """Quản lý hàng đợi ưu tiên, tổng hợp giọng đọc edge-tts (kèm cache LRU) và điều phối phát."""

    def __init__(
        self,
        store: SettingsStore,
        manager: ConnectionManager,
        config: AppConfig | None = None,
        llm_provider: LLMProvider | None = None,
        synthesizer: SynthesizerFunc | None = None,
        clock: Callable[[], float] = time.time,
        rng: random.Random | None = None,
        edge_timeout: float = EDGE_TTS_TIMEOUT_SECONDS,
        watchdog_extra_ms: int = WATCHDOG_EXTRA_MS,
    ) -> None:
        self._store = store
        self._manager = manager
        self._cfg = config or AppConfig(_env_file=None)
        self.llm: LLMProvider = llm_provider or build_llm_provider(self._cfg)
        self._synthesizer: SynthesizerFunc = synthesizer or default_edge_synthesize
        self.clock = clock
        self.rng = rng or random.Random()
        self.edge_timeout = edge_timeout
        self.watchdog_extra_ms = watchdog_extra_ms

        self._queue: asyncio.PriorityQueue[QueuedSpeech] | None = None
        self._seq = itertools.count(1)
        self._cache: OrderedDict[str, SynthesizedAudio] = OrderedDict()
        self._player_last_spoken: dict[int, float] = {}

        self._worker_task: asyncio.Task[None] | None = None
        self._current_id: str | None = None
        self._finished_event: asyncio.Event | None = None

    def _get_queue(self) -> asyncio.PriorityQueue[QueuedSpeech]:
        if self._queue is None:
            self._queue = asyncio.PriorityQueue()
        return self._queue

    def _get_finished_event(self) -> asyncio.Event:
        if self._finished_event is None:
            self._finished_event = asyncio.Event()
        return self._finished_event

    # ------------------------------------------------------------ vòng đời
    def start(self) -> None:
        self._get_queue()
        self._get_finished_event()
        if self._worker_task is None:
            self._worker_task = asyncio.create_task(self._worker_loop(), name="tts-worker")

    async def stop(self) -> None:
        if self._worker_task is not None:
            self._worker_task.cancel()
            try:
                await self._worker_task
            except asyncio.CancelledError:
                pass
            self._worker_task = None

    # ------------------------------------------------------------ hàng đợi
    def queue_size(self) -> int:
        return self._get_queue().qsize()

    def queue_snapshot(self) -> list[dict[str, Any]]:
        items: list[QueuedSpeech] = sorted(list(self._get_queue()._queue))  # type: ignore[attr-defined]
        return [item.public() for item in items]

    async def _broadcast_queue(self) -> None:
        await self._manager.send_to_role("dashboard", TTS_QUEUE_UPDATE, {"items": self.queue_snapshot()})

    def _check_spam(self, priority: int, player_id: int | None, now: float) -> bool:
        """Ở mức ưu tiên 3–4, cùng 1 người chơi không phát quá 1 câu / 8s."""
        if priority not in (3, 4) or player_id is None:
            return True
        last = self._player_last_spoken.get(player_id)
        if last is not None and (now - last) < PLAYER_SPAM_COOLDOWN_SECONDS:
            return False
        self._player_last_spoken[player_id] = now
        return True

    def _enqueue_Sync(self, item: QueuedSpeech) -> bool:
        """Đưa vào PriorityQueue (tối đa 20 câu); nếu đầy thì bỏ câu có độ ưu tiên thấp nhất."""
        q = self._get_queue()
        internal: list[QueuedSpeech] = q._queue  # type: ignore[attr-defined]
        if len(internal) >= MAX_QUEUE_SIZE:
            # Tìm phần tử kém ưu tiên nhất: priority lớn nhất, nếu bằng nhau thì seq lớn nhất (mới nhất)
            worst = max(internal, key=lambda x: (x.priority, x.seq))
            if (item.priority, item.seq) >= (worst.priority, worst.seq):
                return False
            internal.remove(worst)
            import heapq

            heapq.heapify(internal)
        q.put_nowait(item)
        return True

    async def enqueue(
        self,
        text: str,
        priority: int = 3,
        group: str = "custom",
        player_id: int | None = None,
    ) -> QueuedSpeech | None:
        clean = text.strip()
        if not clean:
            return None
        if not self._store.current.tts.enabled and priority > 0:
            return None
        now = self.clock()
        if not self._check_spam(priority, player_id, now):
            logger.debug("Chống spam TTS cho player_id=%s ở priority=%d", player_id, priority)
            return None
        item = QueuedSpeech(
            priority=priority,
            seq=next(self._seq),
            id=f"tts-{uuid.uuid4().hex[:10]}",
            text=clean,
            group=group,
            player_id=player_id,
            created_at=now,
        )
        if not self._enqueue_Sync(item):
            logger.debug("Hàng đợi TTS đã đầy, bỏ qua câu priority=%d", priority)
            return None
        if self._worker_task is not None and self._worker_task.done():
            self._worker_task = asyncio.create_task(self._worker_loop(), name="tts-worker")
        await self._broadcast_queue()
        return item

    async def pop_next(self) -> QueuedSpeech:
        item = await self._get_queue().get()
        await self._broadcast_queue()
        return item

    # ------------------------------------------------------------ API cho GameEngine & Admin
    async def speak_now(self, text: str) -> None:
        """Admin đọc ngay ở mức ưu tiên 0."""
        await self.enqueue(text=text, priority=0, group="admin_instant")

    async def clear_queue(self) -> int:
        internal: list[QueuedSpeech] = self._get_queue()._queue  # type: ignore[attr-defined]
        count = len(internal)
        internal.clear()
        await self._broadcast_queue()
        return count

    async def say_from_group(self, group: str, priority: int, context: dict[str, Any]) -> QueuedSpeech | None:
        """Hook gắn vào GameEngine.say(group, priority, ctx)."""
        if not self._store.current.tts.enabled:
            return None
        player_id = context.get("player_id")
        now = self.clock()
        if not self._check_spam(priority, player_id if isinstance(player_id, int) else None, now):
            return None

        # Chọn câu mẫu
        phrases_map = self._store.current.phrases
        candidates = phrases_map.get(group) or DEFAULT_PHRASES.get(group) or []
        if not candidates:
            if group == "rank_overtake":
                candidates = ["Đại gia soán ngôi! {name} vừa vươn lên chiếm giữ vị trí Top 1 bảng xếp hạng!"]
            else:
                return None

        # Với boss_event, chọn câu phù hợp trạng thái spawn vs defeated nếu có đủ
        event_kind = context.get("event")
        if group == "boss_event" and len(candidates) >= 6:
            pool = candidates[:2] if event_kind == "spawn" else candidates[2:]
        else:
            pool = candidates

        template = self.rng.choice(pool)
        rendered = render_phrase(template, **context)
        final_text = await self.llm.generate_commentary(group, context, rendered)
        final_text = final_text.strip() or rendered

        item = QueuedSpeech(
            priority=priority,
            seq=next(self._seq),
            id=f"tts-{uuid.uuid4().hex[:10]}",
            text=final_text,
            group=group,
            player_id=player_id if isinstance(player_id, int) else None,
            created_at=now,
        )
        if not self._enqueue_Sync(item):
            return None
        await self._broadcast_queue()
        return item

    # ------------------------------------------------------------ Tổng hợp & Cache LRU
    async def synthesize(self, text: str) -> SynthesizedAudio:
        tts_cfg = self._store.current.tts
        key = make_cache_key(text, tts_cfg.voice, tts_cfg.rate_str, tts_cfg.pitch_str)
        if key in self._cache:
            self._cache.move_to_end(key)
            return self._cache[key]

        duration_ms = estimate_duration_ms(text)
        try:
            raw_bytes = await asyncio.wait_for(
                self._synthesizer(text, tts_cfg),
                timeout=self.edge_timeout,
            )
            if not raw_bytes:
                raise RuntimeError("Dữ liệu mp3 rỗng")
            b64 = base64.b64encode(raw_bytes).decode("ascii")
            result = SynthesizedAudio(audio_base64=b64, mime="audio/mpeg", duration_ms=duration_ms)
            self._cache[key] = result
            while len(self._cache) > LRU_CACHE_MAX_ITEMS:
                self._cache.popitem(last=False)
            return result
        except Exception as exc:
            logger.warning("edge-tts lỗi/timeout (%s), dùng fallback phụ đề cho câu: %s", exc, text)
            return SynthesizedAudio(audio_base64="", mime="audio/mpeg", duration_ms=duration_ms)

    # ------------------------------------------------------------ Phát & TTS_FINISHED
    async def handle_tts_finished(self, data: TtsFinishedData) -> None:
        if self._current_id and data.id == self._current_id:
            self._get_finished_event().set()

    async def process_one(self, item: QueuedSpeech) -> dict[str, Any]:
        """Tổng hợp và gửi TTS_SPEAK cho overlay, đợi TTS_FINISHED hoặc watchdog timeout."""
        synth = await self.synthesize(item.text)
        payload = {
            "id": item.id,
            "priority": item.priority,
            "text": item.text,
            "audio_base64": synth.audio_base64,
            "mime": synth.mime,
            "duration_ms": synth.duration_ms,
        }
        self._current_id = item.id
        ev = self._get_finished_event()
        ev.clear()
        await self._manager.send_to_role("overlay", TTS_SPEAK, payload)

        # Nếu có ít nhất 1 overlay đang kết nối thì chờ TTS_FINISHED hoặc watchdog
        if self._manager.count("overlay") > 0:
            timeout_sec = max(0.02, (synth.duration_ms + self.watchdog_extra_ms) / 1000.0)
            deadline = time.monotonic() + timeout_sec
            while not ev.is_set() and time.monotonic() < deadline:
                await asyncio.sleep(0.01)
            if not ev.is_set():
                logger.debug("Watchdog timeout cho TTS id=%s sau %.2fs", item.id, timeout_sec)
        self._current_id = None
        return payload

    async def _worker_loop(self) -> None:
        try:
            while True:
                item = await self.pop_next()
                try:
                    await self.process_one(item)
                except asyncio.CancelledError:
                    raise
                except Exception:
                    logger.exception("Lỗi khi phát câu TTS id=%s", item.id)
                finally:
                    self._get_queue().task_done()
        except asyncio.CancelledError:
            raise
