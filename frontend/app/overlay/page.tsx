"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Crown, Flame, Ship, Skull, Sparkles, Trophy, Volume2, Zap } from "lucide-react";
import { AICasterController } from "@/lib/overlay/caster";
import { EffectsManager } from "@/lib/overlay/effects";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  OverlayWorld,
} from "@/lib/overlay/entities";
import { renderOverlayFrame } from "@/lib/overlay/renderer";
import { soundManager, type AudioContextState } from "@/lib/soundManager";
import type { BannerData, Top3Entry } from "@/lib/types";
import { useGameSocket } from "@/lib/useGameSocket";

/**
 * Component hiển thị số điểm nhảy mượt (interpolation) khi điểm thay đổi.
 */
function AnimatedScore({ value }: { value: number }) {
  const [display, setDisplay] = useState(value);
  const currentRef = useRef(value);

  useEffect(() => {
    const start = currentRef.current;
    const diff = value - start;
    if (diff === 0) return;

    const duration = 420;
    const startTime = performance.now();
    let raf = 0;

    const step = (now: number) => {
      const t = Math.min(1, (now - startTime) / duration);
      const ease = 1 - Math.pow(1 - t, 3);
      const nextVal = Math.round(start + diff * ease);
      currentRef.current = nextVal;
      setDisplay(nextVal);
      if (t < 1) {
        raf = requestAnimationFrame(step);
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <>{display.toLocaleString("vi-VN")}</>;
}

function TopRankCard({ entry, rank }: { entry?: Top3Entry; rank: 1 | 2 | 3 }) {
  const styles = {
    1: {
      wrap: "-mt-1 ring-2 ring-amber-400/90 shadow-lg shadow-amber-500/30",
      bg: "from-amber-400/30 via-slate-900/95 to-slate-950/95",
      crown: "text-amber-300",
      badge: "bg-gradient-to-br from-yellow-300 to-amber-500 text-slate-950",
      avatarSize: "w-9 h-9",
    },
    2: {
      wrap: "mt-1 border border-slate-300/60 shadow-md",
      bg: "from-slate-300/20 via-slate-900/90 to-slate-950/95",
      crown: "text-slate-200",
      badge: "bg-gradient-to-br from-slate-200 to-slate-400 text-slate-950",
      avatarSize: "w-8 h-8",
    },
    3: {
      wrap: "mt-1 border border-amber-700/70 shadow-md",
      bg: "from-amber-700/25 via-slate-900/90 to-slate-950/95",
      crown: "text-amber-500",
      badge: "bg-gradient-to-br from-amber-500 to-orange-700 text-white",
      avatarSize: "w-8 h-8",
    },
  }[rank];

  return (
    <div
      className={`flex items-center gap-2 rounded-2xl bg-gradient-to-b ${styles.bg} ${styles.wrap} px-2.5 py-2 backdrop-blur-md min-w-0`}
    >
      <div className="relative shrink-0">
        {entry?.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={entry.avatar_url}
            alt={entry.nickname}
            crossOrigin="anonymous"
            className={`${styles.avatarSize} rounded-full object-cover border-2 border-white/50`}
          />
        ) : (
          <div
            className={`${styles.avatarSize} rounded-full bg-slate-800 border border-white/25 flex items-center justify-center text-xs font-black text-slate-300`}
          >
            {entry ? (entry.nickname.trim()[0] || "?").toUpperCase() : `#${rank}`}
          </div>
        )}
        <span
          className={`absolute -top-1.5 -left-1.5 w-4 h-4 rounded-full ${styles.badge} text-[10px] font-black flex items-center justify-center shadow`}
        >
          {rank}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <Crown className={`w-3 h-3 shrink-0 ${styles.crown}`} />
          <span className="text-[11px] font-extrabold text-white truncate">
            {entry ? entry.nickname : "Chờ cần thủ"}
          </span>
        </div>
        <div className="text-xs font-black text-amber-300 tabular-nums leading-tight">
          {entry ? <AnimatedScore value={entry.score} /> : "0"}{" "}
          <span className="text-[9px] font-bold text-slate-300">đ</span>
        </div>
      </div>
    </div>
  );
}

function CenterBanner({ banner }: { banner: BannerData }) {
  const theme = (() => {
    switch (banner.kind) {
      case "SOAN_NGOI":
        return {
          grad: "from-amber-500 via-yellow-500 to-orange-600",
          border: "border-yellow-200",
          icon: <Trophy className="w-7 h-7 text-slate-950" />,
        };
      case "JACKPOT":
        return {
          grad: "from-emerald-400 via-teal-500 to-cyan-600",
          border: "border-emerald-200",
          icon: <Sparkles className="w-7 h-7 text-slate-950" />,
        };
      case "TRAWLER":
        return {
          grad: "from-sky-400 via-blue-600 to-indigo-700",
          border: "border-sky-200",
          icon: <Ship className="w-7 h-7 text-white" />,
        };
      case "UPGRADE":
        return {
          grad: "from-cyan-400 via-sky-500 to-blue-600",
          border: "border-cyan-200",
          icon: <Zap className="w-7 h-7 text-slate-950" />,
        };
      case "BOSS":
      case "BOSS_DEFEATED":
      case "BOSS_ESCAPED":
        return {
          grad: "from-rose-600 via-red-600 to-amber-600",
          border: "border-rose-200",
          icon: <Skull className="w-7 h-7 text-white" />,
        };
      default:
        return {
          grad: "from-fuchsia-500 via-rose-500 to-amber-500",
          border: "border-amber-200",
          icon: <Flame className="w-7 h-7 text-white" />,
        };
    }
  })();

  return (
    <motion.div
      key={`${banner.kind}-${banner.title}-${banner.subtitle}`}
      initial={{ opacity: 0, scale: 0.65, y: -35 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.8, y: 20 }}
      transition={{ type: "spring", stiffness: 360, damping: 22 }}
      className={`mx-auto max-w-[92%] rounded-2xl border-2 ${theme.border} bg-gradient-to-r ${theme.grad} px-5 py-3 shadow-2xl flex items-center gap-3.5`}
    >
      <div className="w-12 h-12 rounded-xl bg-white/25 backdrop-blur flex items-center justify-center shrink-0 shadow-inner">
        {theme.icon}
      </div>
      <div className="min-w-0">
        <div className="text-base font-black uppercase tracking-wider text-white drop-shadow">
          {banner.title}
        </div>
        {banner.subtitle && (
          <div className="text-xs font-bold text-white/95 truncate drop-shadow-sm">
            {banner.subtitle}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function OverlayView() {
  const searchParams = useSearchParams();
  const transparent = searchParams.get("transparent") === "1";
  const scaleMode = searchParams.get("scale") === "1";
  const debug = searchParams.get("debug") === "1";

  const { connected, state, activeBanner, sendTtsFinished, subscribe } =
    useGameSocket("overlay");

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const worldRef = useRef<OverlayWorld | null>(null);
  const effectsRef = useRef<EffectsManager | null>(null);
  const casterRef = useRef<AICasterController | null>(null);

  const [audioState, setAudioState] = useState<AudioContextState>("uninitialized");
  const [nowEpochMs, setNowEpochMs] = useState<number>(0);
  const [debugStats, setDebugStats] = useState({
    fps: 60,
    fish: 0,
    particles: 0,
    shore: 0,
    bullets: 0,
    speaking: false,
  });

  const getEngines = () => {
    if (worldRef.current === null) {
      worldRef.current = new OverlayWorld();
    }
    if (effectsRef.current === null) {
      effectsRef.current = new EffectsManager();
    }
    if (casterRef.current === null) {
      casterRef.current = new AICasterController();
    }
    return {
      world: worldRef.current,
      effects: effectsRef.current,
      caster: casterRef.current,
    };
  };

  // Cho phép nền trong suốt hoàn toàn khi nhúng vào OBS Browser Source (?transparent=1)
  useEffect(() => {
    if (!transparent) return;
    const prevHtmlBg = document.documentElement.style.background;
    const prevBodyBg = document.body.style.background;
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    return () => {
      document.documentElement.style.background = prevHtmlBg;
      document.body.style.background = prevBodyBg;
    };
  }, [transparent]);

  // Theo dõi trạng thái AudioContext và thử tự động mở khoá (cho OBS có quyền autoplay)
  useEffect(() => {
    const unsub = soundManager.onStateChange(setAudioState);
    void soundManager.unlock();
    return unsub;
  }, []);

  // Đồng bộ STATE_SYNC vào OverlayWorld
  useEffect(() => {
    if (!state) return;
    const { world } = getEngines();
    world.syncPlayers(state.players_on_shore);
    world.feverActive = state.fever.active;
    world.boss = state.boss;
    soundManager.setBgmMode(
      state.boss ? "boss" : state.fever.active ? "fever" : "chill"
    );
  }, [state]);

  // Lắng nghe trực tiếp các sự kiện thời gian thực từ WebSocket
  useEffect(() => {
    return subscribe((msg) => {
      const { world, effects, caster } = getEngines();
      const nowMs = performance.now();

      switch (msg.type) {
        case "FISH_CAUGHT": {
          const slot = world.triggerFishCaught(msg.data, nowMs);
          const rodLv = msg.data.rod_level ?? slot?.player.rod_level ?? 1;
          if (slot && rodLv === 4 && !msg.data.is_troll) {
            effects.triggerLaser(
              slot.rodTipX,
              slot.rodTipY,
              slot.hookX,
              slot.hookY,
              msg.data.item_type === "rare" ? "#f43f5e" : "#22d3ee"
            );
            soundManager.playLaser();
          }

          if (msg.data.chest_result === "BOMB") {
            soundManager.playBomb();
          } else if (msg.data.chest_result === "DOUBLE") {
            soundManager.playChestDouble();
          } else if (msg.data.is_troll) {
            soundManager.playTroll();
          } else {
            soundManager.playCatch(msg.data.item_type === "rare");
          }
          break;
        }

        case "GIFT_EFFECT":
          effects.triggerGiftEffect(world, msg.data);
          if (msg.data.effect_type === "ELECTRIC_NET") {
            soundManager.playElectricNet();
          } else if (msg.data.effect_type === "UPGRADE_ROD") {
            soundManager.playUpgrade();
          } else if (msg.data.effect_type === "TRAWLER_SHIP") {
            soundManager.playTrawler();
          }
          break;

        case "BOSS_UPDATE":
          effects.triggerBossUpdate(world, msg.data);
          if (msg.data.status === "SPAWNED") {
            soundManager.playBossAlert();
          } else if (msg.data.status === "HIT") {
            soundManager.playBossHit();
          } else if (msg.data.status === "DEFEATED") {
            soundManager.playGoldRain();
          }
          break;

        case "CHAT_BUBBLE":
          world.triggerChatBubble(msg.data, nowMs);
          break;

        case "PLAYER_JOINED":
          soundManager.playCast();
          break;

        case "TTS_SPEAK": {
          const speech = msg.data;
          caster.startSpeech(speech, !speech.audio_base64);
          void soundManager
            .playTtsSpeech(speech.audio_base64, speech.duration_ms, () => {
              caster.stopSpeech(speech.id);
              sendTtsFinished(speech.id);
            })
            .then(({ isFallback }) => {
              if (caster.current && caster.current.id === speech.id) {
                caster.current.isFallback = isFallback;
              }
            });
          break;
        }

        default:
          break;
      }
    });
  }, [subscribe, sendTtsFinished]);

  // Đồng hồ 0.5s cho đếm ngược Fever / Boss & cập nhật bảng Debug
  useEffect(() => {
    const tick = () => {
      setNowEpochMs(Date.now());
      const { world, effects, caster } = getEngines();
      if (debug) {
        setDebugStats({
          fps: world.fps,
          fish: world.fishes.length,
          particles: world.particles.length,
          shore: world.fishers.length,
          bullets: effects.bullets.length,
          speaking: caster.current !== null,
        });
      }
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [debug]);

  // Vòng lặp render Canvas 60FPS bằng requestAnimationFrame + delta-time
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { world, effects, caster } = getEngines();

    let rafId = 0;
    let lastTime = performance.now();

    const frame = (now: number) => {
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      const hidden = typeof document !== "undefined" && document.hidden;

      world.update(dt, now, hidden);
      effects.update(world, dt, hidden);
      caster.update(dt, soundManager.getSpeechAmplitude());

      renderOverlayFrame(ctx, world, {
        transparent,
        nowMs: now,
        isTabHidden: hidden,
        onDrawDeepOceanExtras: (c) => {
          effects.drawDeepOceanEffects(c, world);
        },
        onDrawForegroundExtras: (c) => {
          effects.drawForegroundEffects(c, world);
          caster.draw(c);
        },
      });

      rafId = requestAnimationFrame(frame);
    };

    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  }, [transparent]);

  const handleEnableAudio = async () => {
    await soundManager.unlock();
    soundManager.playCatch(false);
  };

  const fever = state?.fever ?? { heat: 0, max: 1000, active: false, ends_at: null };
  const feverRatio = fever.active
    ? 100
    : Math.min(100, Math.round((fever.heat / Math.max(1, fever.max)) * 100));
  const feverLeftSec =
    fever.active && fever.ends_at && nowEpochMs > 0
      ? Math.max(0, Math.ceil((fever.ends_at - nowEpochMs) / 1000))
      : 0;

  const boss = state?.boss ?? null;
  const bossHpRatio = boss
    ? Math.max(0, Math.min(100, Math.round((boss.current_hp / Math.max(1, boss.max_hp)) * 100)))
    : 0;
  const bossLeftSec =
    boss && boss.ends_at && nowEpochMs > 0
      ? Math.max(0, Math.ceil((boss.ends_at - nowEpochMs) / 1000))
      : 0;

  const top3 = state?.top3 ?? [];

  return (
    <div
      className={`min-h-screen w-full flex items-center justify-center select-none overflow-hidden ${
        transparent ? "bg-transparent" : "bg-slate-950"
      }`}
    >
      <div
        className={`relative aspect-[9/16] overflow-hidden ${
          scaleMode ? "h-screen w-auto" : "w-[540px] h-[960px] max-w-full max-h-screen"
        } ${transparent ? "" : "rounded-2xl shadow-2xl border border-cyan-500/25"}`}
      >
        {/* Canvas nội bộ 1080x1920 sắc nét */}
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="absolute inset-0 w-full h-full block"
        />

        {/* TOP HUD (15% trên): Podium Top 3 Vua Câu Cá + Fever Bar + Thanh máu Boss Kraken */}
        <div className="relative z-10 p-3 space-y-2.5 pointer-events-none">
          {/* Bảng xếp hạng Top 3 kiểu bục vinh quang (Top 2 - Top 1 ở giữa - Top 3) */}
          <div className="grid grid-cols-3 gap-1.5 items-end pt-1">
            <TopRankCard entry={top3[1]} rank={2} />
            <TopRankCard entry={top3[0]} rank={1} />
            <TopRankCard entry={top3[2]} rank={3} />
          </div>

          {/* Thanh Nhiệt Độ Hồ Câu (Fever Bar) kiểu Arcade có hiệu ứng shimmer */}
          <div className="rounded-2xl bg-slate-950/85 border border-cyan-500/35 px-3 py-2 backdrop-blur-md shadow-lg">
            <div className="flex items-center justify-between text-[11px] font-extrabold mb-1.5">
              <span className="inline-flex items-center gap-1.5 text-amber-300">
                <Flame
                  className={`w-4 h-4 ${
                    fever.active ? "text-rose-400 animate-bounce" : "text-amber-400"
                  }`}
                />
                {fever.active
                  ? `FEVER TIME X2 TỐC ĐỘ! (${feverLeftSec}s)`
                  : "NHIỆT ĐỘ HỒ CÂU"}
              </span>
              <span className="text-slate-100 tabular-nums">
                {fever.active ? "MAX 🔥" : `${fever.heat} / ${fever.max} ❤️ (${feverRatio}%)`}
              </span>
            </div>
            <div className="relative h-3 w-full rounded-full bg-slate-900 overflow-hidden p-0.5 border border-slate-700/80">
              <div
                className={`relative h-full rounded-full overflow-hidden transition-all duration-300 ${
                  fever.active
                    ? "bg-gradient-to-r from-yellow-300 via-rose-500 to-fuchsia-500"
                    : "bg-gradient-to-r from-cyan-400 via-amber-400 to-rose-500"
                }`}
                style={{ width: `${feverRatio}%` }}
              >
                <div className="absolute inset-0 w-1/2 bg-gradient-to-r from-transparent via-white/45 to-transparent animate-shimmer" />
              </div>
            </div>
          </div>

          {/* Thanh máu Boss Kraken (chỉ hiện khi có Boss) */}
          {boss && (
            <div className="rounded-2xl bg-gradient-to-r from-rose-950/95 via-red-950/95 to-rose-950/95 border-2 border-rose-400 px-3.5 py-2 backdrop-blur-md shadow-xl shadow-rose-600/30">
              <div className="flex items-center justify-between text-xs font-black text-rose-100 mb-1.5">
                <span className="inline-flex items-center gap-1.5 tracking-wide">
                  <Skull className="w-4 h-4 text-rose-400 animate-pulse" />
                  BOSS KRAKEN ĐẠI DƯƠNG
                </span>
                <span className="tabular-nums text-amber-300">
                  {boss.current_hp.toLocaleString("vi-VN")} /{" "}
                  {boss.max_hp.toLocaleString("vi-VN")} HP · ⏱ {bossLeftSec}s
                </span>
              </div>
              <div className="relative h-3.5 w-full rounded-full bg-slate-950 overflow-hidden p-0.5 border border-rose-400/50">
                <div
                  className="relative h-full rounded-full overflow-hidden bg-gradient-to-r from-rose-600 via-red-500 to-amber-400 transition-all duration-150"
                  style={{ width: `${bossHpRatio}%` }}
                >
                  <div className="absolute inset-0 w-1/2 bg-gradient-to-r from-transparent via-white/35 to-transparent animate-shimmer" />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* BANNER / KILL-FEED TRUNG TÂM (Framer Motion) */}
        <div className="absolute inset-x-0 top-[44%] z-20 pointer-events-none px-3">
          <AnimatePresence mode="wait">
            {activeBanner && <CenterBanner banner={activeBanner} />}
          </AnimatePresence>
        </div>

        {/* Nút nổi bật âm thanh xử lý Autoplay (tự ẩn ngay khi AudioContext running) */}
        {audioState !== "running" && (
          <div className="absolute inset-x-0 top-36 z-30 flex justify-center pointer-events-auto">
            <button
              type="button"
              onClick={handleEnableAudio}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold text-xs shadow-xl border-2 border-white/60 transition transform hover:scale-105 cursor-pointer"
            >
              <Volume2 className="w-4 h-4" />
              🔊 Click để bật âm thanh
            </button>
          </div>
        )}

        {/* Bảng thông số kỹ thuật khi bật ?debug=1 */}
        {debug && (
          <div className="absolute top-28 left-2 z-30 rounded-lg bg-slate-950/85 border border-cyan-500/40 px-2.5 py-1.5 text-[10px] font-mono text-cyan-200 space-y-0.5 pointer-events-none">
            <div>
              FPS: <span className="text-emerald-300 font-bold">{debugStats.fps}</span> | WS:{" "}
              <span className={connected ? "text-emerald-400" : "text-rose-400"}>
                {connected ? "CONNECTED" : "OFFLINE"}
              </span>{" "}
              | Audio: <span className="text-amber-300">{audioState}</span>
            </div>
            <div>
              Shore: {debugStats.shore}/15 | Fish: {debugStats.fish}/40 | Particles:{" "}
              {debugStats.particles}/300 | Bullets: {debugStats.bullets}/60 | Caster:{" "}
              {debugStats.speaking ? "SPEAKING" : "IDLE"}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function OverlayPage() {
  return (
    <Suspense fallback={null}>
      <OverlayView />
    </Suspense>
  );
}
