"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Coins,
  Crown,
  Edit3,
  ExternalLink,
  Flame,
  Gamepad2,
  Heart,
  Link2,
  Link2Off,
  Mic,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  Ship,
  Skull,
  Sliders,
  Sparkles,
  Trash2,
  UserMinus,
  Users,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  XCircle,
} from "lucide-react";
import type {
  CommandResultData,
  FullGameSettings,
  GachaRates,
  PlayerRecord,
  PublicGameSettings,
  TikTokStatus,
  TtsVoice,
} from "@/lib/types";
import { getDefaultBackendHttpUrl, useGameSocket } from "@/lib/useGameSocket";

interface ToastItem {
  id: string;
  ok: boolean;
  action: string;
  text: string;
}

type StudioTab = "control" | "caster" | "players" | "balance";

const PHRASE_GROUP_LABELS: Record<string, string> = {
  troll_sandal: "Dép tổ ong (troll_sandal)",
  troll_trash: "Rác / Xương cá (troll_trash)",
  chest_bomb: "Bom đen mặt (chest_bomb)",
  rare_fish: "Cá hiếm & Nổ hũ (rare_fish)",
  gift_small: "Quà nhỏ & Lưới điện (gift_small)",
  gift_upgrade: "Nâng cấp cần (gift_upgrade)",
  gift_trawler: "Tàu đánh cá đại gia (gift_trawler)",
  boss_event: "Sự kiện Boss Kraken (boss_event)",
  idle_chat: "Giao lưu ngẫu nhiên (idle_chat)",
};

const ROD_NAMES: Record<number, string> = {
  1: "Lv1 · Cần Tre",
  2: "Lv2 · Cần Sắt",
  3: "Lv3 · Cần Vàng",
  4: "Lv4 · Pháo Laser",
};

const TIKTOK_BADGE: Record<
  TikTokStatus,
  { label: string; dot: string; text: string; bg: string }
> = {
  DISCONNECTED: {
    label: "Chưa kết nối",
    dot: "bg-slate-400",
    text: "text-slate-300",
    bg: "bg-slate-800/80 border-slate-700",
  },
  CONNECTING: {
    label: "Đang kết nối...",
    dot: "bg-amber-400 animate-ping",
    text: "text-amber-300",
    bg: "bg-amber-950/60 border-amber-500/40",
  },
  CONNECTED: {
    label: "Đang Live",
    dot: "bg-emerald-400 animate-pulse",
    text: "text-emerald-300",
    bg: "bg-emerald-950/60 border-emerald-500/40",
  },
  OFFLINE_ROOM: {
    label: "Phòng Offline",
    dot: "bg-orange-400",
    text: "text-orange-300",
    bg: "bg-orange-950/60 border-orange-500/40",
  },
  ERROR: {
    label: "Lỗi kết nối",
    dot: "bg-rose-500",
    text: "text-rose-300",
    bg: "bg-rose-950/60 border-rose-500/40",
  },
};

const LOG_BADGE: Record<string, string> = {
  DONATE: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  BOSS_KILL: "bg-rose-500/20 text-rose-300 border-rose-500/30",
  JACKPOT: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  UPGRADE: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  FEVER: "bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/30",
  ADMIN: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
};

const DEFAULT_PUBLIC_SETTINGS: PublicGameSettings = {
  gacha: { normal: 65, rare: 20, chest: 5, troll: 10 },
  boss_max_hp: 10000,
  boss_interval_minutes: 15,
  boss_duration_seconds: 180,
  boss_summon_gift_threshold: 1000,
  fever_threshold: 1000,
  fever_duration_seconds: 60,
  auto_bot_enabled: false,
  auto_bot_min_players: 5,
  auto_bot_action_interval_seconds: 8,
};

export default function DashboardPage() {
  const { connected, reconnecting, state, logs, ttsQueue, sendCommand, subscribe } =
    useGameSocket("dashboard");

  const [activeTab, setActiveTab] = useState<StudioTab>("control");

  // ---------------------------------------------------------------- Toast
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const pushToast = useCallback((res: CommandResultData) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const text = res.ok
      ? res.message || "Thực hiện thành công"
      : res.error || "Thao tác thất bại";
    setToasts((prev) => [{ id, ok: res.ok, action: res.action, text }, ...prev].slice(0, 5));
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3800);
  }, []);

  // ---------------------------------------------------------------- Status Bar
  const [usernameInput, setUsernameInput] = useState("");
  const [tiktokNote, setTiktokNote] = useState("");

  // ---------------------------------------------------------------- Simulator
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [customNickname, setCustomNickname] = useState("");
  const [commentText, setCommentText] = useState("cau");
  const [giftRepeat, setGiftRepeat] = useState(1);
  const [giftStreaking, setGiftStreaking] = useState(false);

  // ---------------------------------------------------------------- AI Caster & Phrases
  const [ttsVoice, setTtsVoice] = useState<TtsVoice>("vi-VN-HoaiMyNeural");
  const [ttsRate, setTtsRate] = useState(0);
  const [ttsPitch, setTtsPitch] = useState(0);
  const [instantSpeakText, setInstantSpeakText] = useState("");
  const [phrasesMap, setPhrasesMap] = useState<Record<string, string[]>>({});
  const [selectedPhraseGroup, setSelectedPhraseGroup] = useState("rare_fish");
  const [newPhraseText, setNewPhraseText] = useState("");
  const [editingPhrase, setEditingPhrase] = useState<{ index: number; text: string } | null>(
    null
  );

  // ---------------------------------------------------------------- Player CRM
  const [players, setPlayers] = useState<PlayerRecord[]>([]);
  const [playerSearch, setPlayerSearch] = useState("");
  const [playerSort, setPlayerSort] = useState<"score" | "rod_level" | "nickname">("score");
  const [confirmResetSeason, setConfirmResetSeason] = useState(false);

  // ---------------------------------------------------------------- Game Balance
  const [balanceForm, setBalanceForm] = useState<PublicGameSettings>(DEFAULT_PUBLIC_SETTINGS);

  // Live Log scroll
  const logBoxRef = useRef<HTMLDivElement | null>(null);
  const [autoScrollLogs, setAutoScrollLogs] = useState(true);

  const fetchPlayers = useCallback(async (search: string, sort: string) => {
    try {
      const base = getDefaultBackendHttpUrl();
      const params = new URLSearchParams({ search, sort });
      const res = await fetch(`${base}/api/players?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as PlayerRecord[];
      setPlayers(data);
    } catch {
      // Giữ nguyên dữ liệu cũ khi mạng tạm gián đoạn
    }
  }, []);

  const fetchPhrases = useCallback(async () => {
    try {
      const base = getDefaultBackendHttpUrl();
      const res = await fetch(`${base}/api/phrases`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as Record<string, string[]>;
      setPhrasesMap(data);
    } catch {
      // Giữ nguyên danh sách cũ
    }
  }, []);

  // Nạp cấu hình ban đầu từ REST API
  useEffect(() => {
    let active = true;
    const loadInitialSettings = async () => {
      try {
        const base = getDefaultBackendHttpUrl();
        const res = await fetch(`${base}/api/settings`, { cache: "no-store" });
        if (!res.ok || !active) return;
        const data = (await res.json()) as FullGameSettings;
        if (!active) return;
        setTtsVoice(data.tts.voice);
        setTtsRate(data.tts.rate);
        setTtsPitch(data.tts.pitch);
        setPhrasesMap(data.phrases);
        setBalanceForm({
          gacha: { ...data.gacha },
          boss_max_hp: data.boss_max_hp,
          boss_interval_minutes: data.boss_interval_minutes,
          boss_duration_seconds: data.boss_duration_seconds,
          boss_summon_gift_threshold: data.boss_summon_gift_threshold,
          fever_threshold: data.fever_threshold,
          fever_duration_seconds: data.fever_duration_seconds,
          auto_bot_enabled: data.auto_bot_enabled ?? false,
          auto_bot_min_players: data.auto_bot_min_players ?? 5,
          auto_bot_action_interval_seconds: data.auto_bot_action_interval_seconds ?? 8,
        });
      } catch {
        // Sẽ tự đồng bộ qua STATE_SYNC
      }
    };
    void loadInitialSettings();
    return () => {
      active = false;
    };
  }, []);

  // Nạp lại bảng người chơi khi đổi bộ lọc
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchPlayers(playerSearch, playerSort);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [playerSearch, playerSort, fetchPlayers]);

  // Đồng bộ sự kiện WS
  useEffect(() => {
    let refreshTimer: number | null = null;
    const schedulePlayersRefresh = () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        void fetchPlayers(playerSearch, playerSort);
      }, 300);
    };

    const unsub = subscribe((msg) => {
      switch (msg.type) {
        case "STATE_SYNC":
          setTtsVoice(msg.data.tts_settings.voice);
          setTtsRate(msg.data.tts_settings.rate);
          setTtsPitch(msg.data.tts_settings.pitch);
          setBalanceForm({
            ...msg.data.game_settings,
            gacha: { ...msg.data.game_settings.gacha },
          });
          if (msg.data.stats.connected_username) {
            setUsernameInput((prev) => prev || msg.data.stats.connected_username);
          }
          schedulePlayersRefresh();
          break;

        case "TIKTOK_STATUS":
          setTiktokNote(msg.data.message);
          break;

        case "COMMAND_RESULT":
          pushToast(msg.data);
          if (msg.data.ok) {
            if (
              msg.data.action === "phrase_upsert" ||
              msg.data.action === "phrase_delete"
            ) {
              void fetchPhrases();
            }
            if (
              msg.data.action === "spawn_players" ||
              msg.data.action === "mock_event" ||
              msg.data.action === "player_adjust" ||
              msg.data.action === "player_kick" ||
              msg.data.action === "reset_season" ||
              msg.data.action === "reset_lake"
            ) {
              schedulePlayersRefresh();
            }
          }
          break;

        case "PLAYER_JOINED":
        case "PLAYER_LEFT":
        case "GIFT_EFFECT":
        case "LEADERBOARD_UPDATE":
          schedulePlayersRefresh();
          break;

        default:
          break;
      }
    });

    return () => {
      unsub();
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    };
  }, [subscribe, pushToast, fetchPlayers, fetchPhrases, playerSearch, playerSort]);

  // Tự cuộn Live Event Log
  useEffect(() => {
    if (autoScrollLogs && logBoxRef.current) {
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
    }
  }, [logs, autoScrollLogs]);

  // ---------------------------------------------------------------- Derived data
  const orderedLogs = useMemo(() => [...logs].reverse(), [logs]);
  const gachaTotal = useMemo(() => {
    const g = balanceForm.gacha;
    return Number((g.normal + g.rare + g.chest + g.troll).toFixed(2));
  }, [balanceForm.gacha]);
  const isGachaValid = Math.abs(gachaTotal - 100) < 0.001;

  const phraseGroups = useMemo(() => {
    const keys = new Set([
      ...Object.keys(PHRASE_GROUP_LABELS),
      ...Object.keys(phrasesMap),
    ]);
    return Array.from(keys);
  }, [phrasesMap]);
  const activePhrases = phrasesMap[selectedPhraseGroup] ?? [];

  // ---------------------------------------------------------------- Handlers
  const handleConnectTiktok = () => {
    const clean = usernameInput.replace(/@/g, "").trim();
    if (!clean) return;
    setUsernameInput(clean);
    sendCommand("connect_tiktok", { username: clean });
  };

  const buildMockTarget = () => {
    const uid = selectedPlayerId.trim();
    const nick = customNickname.trim();
    return {
      user_id: uid || undefined,
      nickname: !uid && nick ? nick : undefined,
    };
  };

  const handleMockComment = (textOverride?: string) => {
    const txt = (textOverride ?? commentText).trim();
    if (!txt) return;
    sendCommand("mock_event", {
      kind: "comment",
      text: txt,
      ...buildMockTarget(),
    });
  };

  const handleMockGift = (gift: "rose" | "ice_cream" | "lion" | "universe") => {
    sendCommand("mock_event", {
      kind: "gift",
      gift,
      repeat_count: Math.max(1, giftRepeat),
      streaking: giftStreaking,
      ...buildMockTarget(),
    });
  };

  const handleSpeakNow = () => {
    const txt = instantSpeakText.trim();
    if (!txt) return;
    sendCommand("tts_speak_now", { text: txt });
    setInstantSpeakText("");
  };

  const handleAddPhrase = () => {
    const txt = newPhraseText.trim();
    if (!txt) return;
    sendCommand("phrase_upsert", { group: selectedPhraseGroup, text: txt });
    setNewPhraseText("");
  };

  const handleSaveEditPhrase = () => {
    if (!editingPhrase) return;
    const txt = editingPhrase.text.trim();
    if (!txt) return;
    sendCommand("phrase_upsert", {
      group: selectedPhraseGroup,
      text: txt,
      index: editingPhrase.index,
    });
    setEditingPhrase(null);
  };

  const handleGachaChange = (field: keyof GachaRates, val: number) => {
    const safe = Number.isFinite(val) ? Math.max(0, Math.min(100, val)) : 0;
    setBalanceForm((prev) => ({
      ...prev,
      gacha: { ...prev.gacha, [field]: safe },
    }));
  };

  const handleSaveBalance = () => {
    if (!isGachaValid) return;
    sendCommand("settings_update", balanceForm);
  };

  const stats = state?.stats;
  const tiktokStatus: TikTokStatus = stats?.tiktok_status ?? "DISCONNECTED";
  const badge = TIKTOK_BADGE[tiktokStatus];
  const ttsEnabled = state?.tts_settings.enabled ?? true;
  const feverPct = state?.fever.active
    ? 100
    : Math.min(100, Math.round(((state?.fever.heat ?? 0) / Math.max(1, state?.fever.max ?? 1000)) * 100));
  const bossPct = state?.boss
    ? Math.max(0, Math.min(100, Math.round((state.boss.current_hp / Math.max(1, state.boss.max_hp)) * 100)))
    : 0;
  const top3 = state?.top3 ?? [];

  return (
    <div className="min-h-screen bg-[#020617] bg-[radial-gradient(ellipse_at_top,_rgba(14,165,233,0.14),_transparent_55%),radial-gradient(ellipse_at_bottom_right,_rgba(168,85,247,0.1),_transparent_50%)] text-slate-100 p-4 lg:p-6">
      {/* Toast thông báo COMMAND_RESULT */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-80 max-w-[90vw] pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-2.5 rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur-xl text-xs ${
              t.ok
                ? "bg-emerald-950/90 border-emerald-400/40 text-emerald-100"
                : "bg-rose-950/90 border-rose-400/40 text-rose-100"
            }`}
          >
            {t.ok ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            )}
            <div className="min-w-0">
              <div className="font-bold uppercase tracking-wider text-[10px] opacity-75">
                {t.action}
              </div>
              <div className="font-medium break-words">{t.text}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="max-w-[1640px] mx-auto space-y-5">
        {/* ============================================================ PHÂN KHU 1: STATUS BAR STUDIO */}
        <header className="rounded-3xl bg-slate-900/75 backdrop-blur-xl border border-slate-800/90 p-5 shadow-2xl space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            {/* Logo & Status pills */}
            <div className="flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-cyan-400 via-sky-500 to-blue-600 flex items-center justify-center text-xl shadow-lg shadow-cyan-500/25">
                🐟
              </div>
              <div>
                <h1 className="text-lg font-black tracking-tight bg-gradient-to-r from-white via-cyan-100 to-amber-200 bg-clip-text text-transparent">
                  Đại Chiến Thủy Cung · Studio
                </h1>
                <div className="flex flex-wrap items-center gap-2 mt-0.5 text-xs">
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border ${
                      connected
                        ? "bg-emerald-950/60 border-emerald-500/40 text-emerald-300"
                        : "bg-rose-950/60 border-rose-500/40 text-rose-300"
                    }`}
                  >
                    {connected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5 animate-pulse" />}
                    {connected ? "Backend Online" : reconnecting ? "Đang nối lại..." : "Mất kết nối"}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border font-medium ${badge.bg} ${badge.text}`}
                  >
                    <span className={`w-2 h-2 rounded-full ${badge.dot}`} />
                    TikTok: {badge.label}
                    {stats?.connected_username ? ` (@${stats.connected_username})` : ""}
                  </span>
                </div>
              </div>
            </div>

            {/* Thanh kết nối TikTok + Link mở Overlay */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center bg-slate-950/90 border border-slate-700/80 rounded-2xl overflow-hidden focus-within:border-cyan-400 transition">
                <span className="pl-3.5 text-slate-400 text-sm font-bold">@</span>
                <input
                  type="text"
                  value={usernameInput}
                  onChange={(e) => setUsernameInput(e.target.value.replace(/@/g, ""))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleConnectTiktok();
                  }}
                  placeholder="username_tiktok"
                  className="bg-transparent px-2.5 py-2 text-sm text-white placeholder:text-slate-500 outline-none w-44"
                />
              </div>
              <button
                type="button"
                onClick={handleConnectTiktok}
                disabled={!connected}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 disabled:opacity-40 text-xs font-extrabold text-slate-950 shadow-lg shadow-emerald-500/20 transition cursor-pointer"
              >
                <Link2 className="w-4 h-4" />
                Kết nối Live
              </button>
              <button
                type="button"
                onClick={() => sendCommand("disconnect_tiktok", {})}
                disabled={!connected || tiktokStatus === "DISCONNECTED"}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-2xl bg-slate-800 hover:bg-rose-600/80 disabled:opacity-40 text-xs font-bold text-slate-200 transition cursor-pointer"
              >
                <Link2Off className="w-4 h-4" />
                Ngắt
              </button>

              <Link
                href="/overlay"
                target="_blank"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-2xl bg-cyan-500/15 border border-cyan-400/50 hover:bg-cyan-500/25 text-cyan-200 text-xs font-bold transition"
              >
                Mở Overlay <ExternalLink className="w-3.5 h-3.5" />
              </Link>
              <Link
                href="/overlay?transparent=1"
                target="_blank"
                className="inline-flex items-center gap-1 px-3 py-2 rounded-2xl bg-slate-800/90 border border-slate-700 hover:border-slate-500 text-slate-300 text-xs font-semibold transition"
              >
                OBS Transparent <ExternalLink className="w-3 h-3" />
              </Link>
            </div>
          </div>

          {/* 5 Thẻ KPI trực quan có thanh progress mini */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <div className="rounded-2xl bg-slate-950/75 border border-slate-800/90 p-3.5 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-300 shrink-0">
                <Users className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-semibold text-slate-400">Trên bờ hồ</div>
                <div className="text-lg font-black tabular-nums leading-tight">
                  {stats?.active_players ?? 0}
                  <span className="text-xs font-medium text-slate-500 ml-1">
                    ({state?.players_on_shore.length ?? 0}/15)
                  </span>
                </div>
              </div>
            </div>

            <div className="rounded-2xl bg-slate-950/75 border border-slate-800/90 p-3.5 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-300 shrink-0">
                <Heart className="w-5 h-5" />
              </div>
              <div>
                <div className="text-[11px] font-semibold text-slate-400">Tổng Tim Live</div>
                <div className="text-lg font-black tabular-nums leading-tight">
                  {(stats?.total_likes ?? 0).toLocaleString("vi-VN")}
                </div>
              </div>
            </div>

            <div className="rounded-2xl bg-slate-950/75 border border-slate-800/90 p-3.5 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-300 shrink-0">
                <Coins className="w-5 h-5" />
              </div>
              <div>
                <div className="text-[11px] font-semibold text-slate-400">Tổng Xu Quà</div>
                <div className="text-lg font-black tabular-nums text-amber-300 leading-tight">
                  {(stats?.total_coins ?? 0).toLocaleString("vi-VN")}
                </div>
              </div>
            </div>

            <div className="rounded-2xl bg-slate-950/75 border border-slate-800/90 p-3.5 space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-semibold">
                <span className="inline-flex items-center gap-1 text-orange-300">
                  <Flame className="w-3.5 h-3.5" /> Fever
                </span>
                <span className="tabular-nums text-slate-300">
                  {state?.fever.active ? "ACTIVE 🔥" : `${feverPct}%`}
                </span>
              </div>
              <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-amber-400 to-rose-500 transition-all"
                  style={{ width: `${feverPct}%` }}
                />
              </div>
              <div className="text-[10px] text-slate-500 tabular-nums">
                {state?.fever.heat ?? 0} / {state?.fever.max ?? 1000} tim
              </div>
            </div>

            <div className="rounded-2xl bg-slate-950/75 border border-slate-800/90 p-3.5 space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-semibold">
                <span className="inline-flex items-center gap-1 text-rose-300">
                  <Skull className="w-3.5 h-3.5" /> Boss Kraken
                </span>
                <span className="tabular-nums text-slate-300">
                  {state?.boss ? `${bossPct}%` : "Đang ngủ"}
                </span>
              </div>
              <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-rose-600 to-amber-400 transition-all"
                  style={{ width: `${bossPct}%` }}
                />
              </div>
              <div className="text-[10px] text-slate-500 tabular-nums">
                {state?.boss
                  ? `${state.boss.current_hp.toLocaleString("vi-VN")} / ${state.boss.max_hp.toLocaleString("vi-VN")} HP`
                  : "Chưa triệu hồi"}
              </div>
            </div>
          </div>

          {tiktokNote && (
            <div className="text-xs text-cyan-200 bg-cyan-950/40 border border-cyan-500/30 rounded-xl px-3.5 py-2">
              🔔 TikTok Live: <span className="font-semibold">{tiktokNote}</span>
            </div>
          )}
        </header>

        {/* ============================================================ LƯỚI STUDIO 12 CỘT */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
          {/* CỘT TRÁI (8 CỘT): Bảng điều khiển chia 4 Tab cực thoáng & trực quan */}
          <div className="xl:col-span-8 space-y-4">
            {/* Thanh chọn Tab */}
            <nav className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-1.5 rounded-2xl bg-slate-900/80 border border-slate-800 backdrop-blur">
              {(
                [
                  { id: "control", label: "Điều khiển & Bot", icon: Gamepad2, color: "from-cyan-500 to-blue-600" },
                  { id: "caster", label: "AI Caster & Thoại", icon: Mic, color: "from-fuchsia-500 to-purple-600" },
                  { id: "players", label: `Người chơi (${players.length})`, icon: Users, color: "from-amber-500 to-orange-600" },
                  { id: "balance", label: "Cân bằng Game", icon: Sliders, color: "from-emerald-500 to-teal-600" },
                ] as const
              ).map((tab) => {
                const Icon = tab.icon;
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-extrabold transition cursor-pointer ${
                      active
                        ? `bg-gradient-to-r ${tab.color} text-white shadow-lg`
                        : "text-slate-400 hover:text-white hover:bg-slate-800/70"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {tab.label}
                  </button>
                );
              })}
            </nav>

            {/* ======================== TAB 1: ĐIỀU KHIỂN LIVE, SIMULATOR & AUTO-BOT */}
            {activeTab === "control" && (
              <div className="space-y-4">
                {/* Quyền năng Admin + Auto-Bot nổi bật */}
                <section className="rounded-3xl bg-slate-900/75 border border-slate-800 p-5 space-y-4 shadow-xl">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-sm font-black uppercase tracking-wider text-cyan-300">
                      ⚡ Điều khiển Hồ Câu Tức Thì
                    </h2>
                    <button
                      type="button"
                      onClick={() => sendCommand("spawn_players", { count: 5 })}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-sky-600 hover:from-cyan-400 hover:to-sky-500 text-xs font-extrabold text-slate-950 shadow-lg shadow-cyan-500/20 cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      Spawn 5 Người Chơi Ngẫu Nhiên
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <button
                      type="button"
                      onClick={() => sendCommand("summon_boss", {})}
                      className="flex items-center justify-center gap-2.5 py-3.5 px-4 rounded-2xl bg-gradient-to-r from-rose-600/30 to-red-600/20 border border-rose-500/50 hover:border-rose-400 hover:from-rose-600/45 text-sm font-extrabold text-rose-100 transition cursor-pointer"
                    >
                      <Skull className="w-5 h-5 text-rose-400" />
                      Triệu hồi Boss Kraken
                    </button>
                    <button
                      type="button"
                      onClick={() => sendCommand("trigger_fever", {})}
                      className="flex items-center justify-center gap-2.5 py-3.5 px-4 rounded-2xl bg-gradient-to-r from-amber-500/25 to-orange-500/20 border border-amber-500/50 hover:border-amber-400 hover:from-amber-500/40 text-sm font-extrabold text-amber-100 transition cursor-pointer"
                    >
                      <Flame className="w-5 h-5 text-amber-400" />
                      Kích hoạt Fever Time
                    </button>
                    <button
                      type="button"
                      onClick={() => sendCommand("reset_lake", {})}
                      className="flex items-center justify-center gap-2.5 py-3.5 px-4 rounded-2xl bg-slate-800/80 border border-slate-700 hover:border-slate-500 hover:bg-slate-800 text-sm font-bold text-slate-200 transition cursor-pointer"
                    >
                      <Ship className="w-5 h-5 text-sky-400" />
                      Làm sạch hồ
                    </button>
                  </div>

                  {/* Khối Auto-Bot khi vắng người */}
                  <div className="rounded-2xl bg-indigo-950/35 border border-indigo-500/40 p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-400/40 flex items-center justify-center text-indigo-300">
                          <Bot className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="text-sm font-extrabold text-indigo-100">
                            Auto-Bot giữ hồ sôi động khi vắng người
                          </div>
                          <div className="text-xs text-slate-400">
                            Tự thả bot câu cá, thả tim, bắn Boss khi hồ vắng — tự động nhường chỗ khi người xem thật vào đủ đông.
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const nextEnabled = !balanceForm.auto_bot_enabled;
                          setBalanceForm((p) => ({ ...p, auto_bot_enabled: nextEnabled }));
                          sendCommand("settings_update", {
                            auto_bot_enabled: nextEnabled,
                            auto_bot_min_players: balanceForm.auto_bot_min_players,
                            auto_bot_action_interval_seconds:
                              balanceForm.auto_bot_action_interval_seconds,
                          });
                        }}
                        className={`px-4 py-2 rounded-xl border text-xs font-extrabold transition cursor-pointer ${
                          balanceForm.auto_bot_enabled
                            ? "bg-indigo-500 border-indigo-300 text-white shadow-lg shadow-indigo-500/30"
                            : "bg-slate-900 border-slate-700 text-slate-400 hover:text-white"
                        }`}
                      >
                        {balanceForm.auto_bot_enabled ? "🤖 AUTO-BOT: ĐANG BẬT" : "AUTO-BOT: ĐANG TẮT"}
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-4 text-xs pt-2 border-t border-indigo-500/20">
                      <label className="inline-flex items-center gap-2 text-slate-300">
                        <span>Giữ tối thiểu trên bờ:</span>
                        <input
                          type="number"
                          min={1}
                          max={15}
                          value={balanceForm.auto_bot_min_players}
                          onChange={(e) =>
                            setBalanceForm((p) => ({
                              ...p,
                              auto_bot_min_players: Math.max(1, Math.min(15, Number(e.target.value) || 1)),
                            }))
                          }
                          className="w-16 bg-slate-950 border border-slate-700 rounded-xl px-2 py-1 text-xs font-bold text-white text-center"
                        />
                        <span className="text-slate-400">người</span>
                      </label>

                      <label className="inline-flex items-center gap-2 text-slate-300">
                        <span>Chu kỳ tương tác:</span>
                        <input
                          type="number"
                          min={1}
                          max={120}
                          value={balanceForm.auto_bot_action_interval_seconds}
                          onChange={(e) =>
                            setBalanceForm((p) => ({
                              ...p,
                              auto_bot_action_interval_seconds: Math.max(
                                1,
                                Math.min(120, Number(e.target.value) || 8)
                              ),
                            }))
                          }
                          className="w-16 bg-slate-950 border border-slate-700 rounded-xl px-2 py-1 text-xs font-bold text-white text-center"
                        />
                        <span className="text-slate-400">giây</span>
                      </label>

                      <button
                        type="button"
                        onClick={() =>
                          sendCommand("settings_update", {
                            auto_bot_enabled: balanceForm.auto_bot_enabled,
                            auto_bot_min_players: balanceForm.auto_bot_min_players,
                            auto_bot_action_interval_seconds:
                              balanceForm.auto_bot_action_interval_seconds,
                          })
                        }
                        className="ml-auto px-3.5 py-1.5 rounded-xl bg-indigo-600/80 hover:bg-indigo-500 text-xs font-bold text-white cursor-pointer"
                      >
                        Lưu cấu hình Bot
                      </button>
                    </div>
                  </div>
                </section>

                {/* Giả lập sự kiện & Tặng quà 1-Click */}
                <section className="rounded-3xl bg-slate-900/75 border border-slate-800 p-5 space-y-4 shadow-xl">
                  <h2 className="text-sm font-black uppercase tracking-wider text-amber-300">
                    🎁 Giả Lập Tương Tác &amp; Quà Tặng (Simulator)
                  </h2>

                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                        Chọn người chơi mục tiêu
                      </label>
                      <select
                        value={selectedPlayerId}
                        onChange={(e) => setSelectedPlayerId(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white outline-none focus:border-cyan-400"
                      >
                        <option value="">-- Ngẫu nhiên hoặc tạo mới --</option>
                        {players.map((p) => (
                          <option key={p.player_id} value={p.tiktok_unique_id}>
                            {p.nickname} ({p.score.toLocaleString("vi-VN")}đ · {ROD_NAMES[p.rod_level] ?? `Lv${p.rod_level}`})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                        Hoặc nhập tên người chơi mới
                      </label>
                      <input
                        type="text"
                        value={customNickname}
                        onChange={(e) => setCustomNickname(e.target.value)}
                        disabled={selectedPlayerId !== ""}
                        placeholder="VD: Đại Gia Hải Phòng..."
                        className="w-full bg-slate-950 border border-slate-700 disabled:opacity-45 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-slate-600 outline-none focus:border-cyan-400"
                      />
                    </div>
                  </div>

                  {/* Comment / Like / Follow */}
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex-1 min-w-[220px] flex gap-2">
                      <input
                        type="text"
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleMockComment();
                        }}
                        placeholder="Nhập nội dung comment..."
                        className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white outline-none focus:border-cyan-400"
                      />
                      <button
                        type="button"
                        onClick={() => handleMockComment()}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-cyan-300 cursor-pointer"
                      >
                        <Send className="w-3.5 h-3.5" />
                        Comment
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleMockComment("cau")}
                      className="px-3 py-2 rounded-xl bg-sky-950/70 border border-sky-500/40 hover:bg-sky-900/70 text-xs font-bold text-sky-200 cursor-pointer"
                    >
                      &quot;cau&quot;
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMockComment("diem")}
                      className="px-3 py-2 rounded-xl bg-sky-950/70 border border-sky-500/40 hover:bg-sky-900/70 text-xs font-bold text-sky-200 cursor-pointer"
                    >
                      &quot;diem&quot;
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        sendCommand("mock_event", {
                          kind: "like",
                          count: 200,
                          ...buildMockTarget(),
                        })
                      }
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-500/20 border border-rose-500/40 hover:bg-rose-500/35 text-xs font-bold text-rose-200 cursor-pointer"
                    >
                      <Heart className="w-3.5 h-3.5" />
                      +200 Tim
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        sendCommand("mock_event", { kind: "follow", ...buildMockTarget() })
                      }
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-500/20 border border-emerald-500/40 hover:bg-emerald-500/35 text-xs font-bold text-emerald-200 cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      Follow (+1 Mồi)
                    </button>
                  </div>

                  {/* 4 Thẻ Quà Tặng 1-Click lớn & rõ ràng */}
                  <div className="pt-2 border-t border-slate-800 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-bold text-slate-300">Tặng Quà 1-Click:</span>
                      <div className="flex items-center gap-4">
                        <label className="inline-flex items-center gap-1.5 text-slate-300">
                          <span>Số lượng (repeat):</span>
                          <input
                            type="number"
                            min={1}
                            max={999}
                            value={giftRepeat}
                            onChange={(e) =>
                              setGiftRepeat(Math.max(1, Number(e.target.value) || 1))
                            }
                            className="w-16 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white text-center"
                          />
                        </label>
                        <label className="inline-flex items-center gap-1.5 text-slate-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={giftStreaking}
                            onChange={(e) => setGiftStreaking(e.target.checked)}
                            className="accent-amber-400"
                          />
                          <span>Đang combo (streaking)</span>
                        </label>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <button
                        type="button"
                        onClick={() => handleMockGift("rose")}
                        className="group rounded-2xl bg-gradient-to-b from-sky-500/15 to-slate-950 border border-sky-500/35 hover:border-sky-400 p-3.5 text-left transition hover:-translate-y-0.5 cursor-pointer"
                      >
                        <div className="text-2xl mb-1">🌹</div>
                        <div className="text-sm font-extrabold text-white">Hoa Hồng</div>
                        <div className="text-[11px] font-semibold text-sky-300">1 xu · Lưới Điện</div>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleMockGift("ice_cream")}
                        className="group rounded-2xl bg-gradient-to-b from-amber-500/15 to-slate-950 border border-amber-500/35 hover:border-amber-400 p-3.5 text-left transition hover:-translate-y-0.5 cursor-pointer"
                      >
                        <div className="text-2xl mb-1">🍦</div>
                        <div className="text-sm font-extrabold text-white">Kem Ốc Quế</div>
                        <div className="text-[11px] font-semibold text-amber-300">10 xu · Nâng Cấp Cần</div>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleMockGift("lion")}
                        className="group rounded-2xl bg-gradient-to-b from-indigo-500/15 to-slate-950 border border-indigo-500/35 hover:border-indigo-400 p-3.5 text-left transition hover:-translate-y-0.5 cursor-pointer"
                      >
                        <div className="text-2xl mb-1">🦁</div>
                        <div className="text-sm font-extrabold text-white">Sư Tử</div>
                        <div className="text-[11px] font-semibold text-indigo-300">100 xu · Tàu Đánh Cá</div>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleMockGift("universe")}
                        className="group rounded-2xl bg-gradient-to-b from-rose-500/20 to-slate-950 border border-rose-500/40 hover:border-rose-400 p-3.5 text-left transition hover:-translate-y-0.5 cursor-pointer"
                      >
                        <div className="text-2xl mb-1">🌌</div>
                        <div className="text-sm font-extrabold text-white">Universe</div>
                        <div className="text-[11px] font-semibold text-rose-300">1000 xu · Gọi Boss</div>
                      </button>
                    </div>
                  </div>
                </section>
              </div>
            )}

            {/* ======================== TAB 2: AI CASTER & KHO CÂU THOẠI */}
            {activeTab === "caster" && (
              <section className="rounded-3xl bg-slate-900/75 border border-slate-800 p-5 space-y-5 shadow-xl">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-black uppercase tracking-wider text-fuchsia-300 flex items-center gap-2">
                    <Mic className="w-4 h-4" />
                    AI Caster &amp; Voice Studio
                  </h2>
                  <button
                    type="button"
                    onClick={() => sendCommand("tts_toggle", { enabled: !ttsEnabled })}
                    className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border text-xs font-extrabold transition cursor-pointer ${
                      ttsEnabled
                        ? "bg-emerald-500/20 border-emerald-400 text-emerald-200"
                        : "bg-slate-800 border-slate-700 text-slate-400"
                    }`}
                  >
                    {ttsEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                    Giọng đọc AI: {ttsEnabled ? "ĐANG BẬT" : "ĐÃ TẮT"}
                  </button>
                </div>

                {/* Đọc ngay (Instant Broadcast) */}
                <div className="rounded-2xl bg-fuchsia-950/30 border border-fuchsia-500/40 p-4 space-y-2">
                  <div className="text-xs font-bold text-fuchsia-200">
                    📢 Đọc Ngay (Instant Broadcast — Ưu tiên cao nhất P0)
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={instantSpeakText}
                      onChange={(e) => setInstantSpeakText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSpeakNow();
                      }}
                      placeholder="Nhập lời bình luận rồi nhấn Enter để AI Caster đọc ngay lập tức..."
                      className="flex-1 bg-slate-950 border border-fuchsia-500/40 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-slate-500 outline-none focus:border-fuchsia-400"
                    />
                    <button
                      type="button"
                      onClick={handleSpeakNow}
                      className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-fuchsia-500 to-purple-600 hover:from-fuchsia-400 hover:to-purple-500 text-xs font-extrabold text-white shadow-lg cursor-pointer"
                    >
                      Phát ngay
                    </button>
                  </div>
                </div>

                {/* Cấu hình giọng đọc */}
                <div className="rounded-2xl bg-slate-950/75 border border-slate-800 p-4 space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setTtsVoice("vi-VN-HoaiMyNeural");
                        sendCommand("tts_config", { voice: "vi-VN-HoaiMyNeural" });
                      }}
                      className={`py-2.5 px-4 rounded-xl border text-xs font-extrabold transition cursor-pointer ${
                        ttsVoice === "vi-VN-HoaiMyNeural"
                          ? "bg-fuchsia-500/20 border-fuchsia-400 text-fuchsia-200"
                          : "bg-slate-900 border-slate-700 text-slate-400 hover:text-white"
                      }`}
                    >
                      👩 Giọng Nữ · Hoài My (vi-VN)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setTtsVoice("vi-VN-NamMinhNeural");
                        sendCommand("tts_config", { voice: "vi-VN-NamMinhNeural" });
                      }}
                      className={`py-2.5 px-4 rounded-xl border text-xs font-extrabold transition cursor-pointer ${
                        ttsVoice === "vi-VN-NamMinhNeural"
                          ? "bg-cyan-500/20 border-cyan-400 text-cyan-200"
                          : "bg-slate-900 border-slate-700 text-slate-400 hover:text-white"
                      }`}
                    >
                      👨 Giọng Nam · Nam Minh (vi-VN)
                    </button>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4 text-xs">
                    <div>
                      <div className="flex justify-between text-slate-300 mb-1.5">
                        <span>Tốc độ đọc (Rate)</span>
                        <span className="font-extrabold text-cyan-300">
                          {ttsRate >= 0 ? `+${ttsRate}%` : `${ttsRate}%`}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={-20}
                        max={50}
                        value={ttsRate}
                        onChange={(e) => setTtsRate(Number(e.target.value))}
                        className="w-full accent-cyan-400"
                      />
                    </div>
                    <div>
                      <div className="flex justify-between text-slate-300 mb-1.5">
                        <span>Cao độ giọng (Pitch)</span>
                        <span className="font-extrabold text-fuchsia-300">
                          {ttsPitch >= 0 ? `+${ttsPitch}Hz` : `${ttsPitch}Hz`}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={-10}
                        max={20}
                        value={ttsPitch}
                        onChange={(e) => setTtsPitch(Number(e.target.value))}
                        className="w-full accent-fuchsia-400"
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      sendCommand("tts_config", {
                        voice: ttsVoice,
                        rate: ttsRate,
                        pitch: ttsPitch,
                      })
                    }
                    className="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-white cursor-pointer"
                  >
                    Áp dụng tốc độ &amp; cao độ giọng đọc
                  </button>
                </div>

                {/* Quản lý 50 câu thoại mẫu (CRUD 9 nhóm) */}
                <div className="rounded-2xl bg-slate-950/75 border border-slate-800 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-extrabold text-slate-200">
                      📚 Kho Câu Thoại Mẫu ({activePhrases.length} câu trong nhóm)
                    </span>
                    <select
                      value={selectedPhraseGroup}
                      onChange={(e) => {
                        setSelectedPhraseGroup(e.target.value);
                        setEditingPhrase(null);
                      }}
                      className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-cyan-200 outline-none"
                    >
                      {phraseGroups.map((g) => (
                        <option key={g} value={g}>
                          {PHRASE_GROUP_LABELS[g] ?? g}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
                    {activePhrases.map((text, idx) => (
                      <div
                        key={`${selectedPhraseGroup}-${idx}`}
                        className="rounded-xl bg-slate-900/90 border border-slate-800 px-3.5 py-2.5 text-xs"
                      >
                        {editingPhrase && editingPhrase.index === idx ? (
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={editingPhrase.text}
                              onChange={(e) =>
                                setEditingPhrase({ index: idx, text: e.target.value })
                              }
                              className="flex-1 bg-slate-950 border border-cyan-400 rounded-lg px-2.5 py-1 text-white outline-none"
                            />
                            <button
                              type="button"
                              onClick={handleSaveEditPhrase}
                              className="px-3 py-1 rounded-lg bg-emerald-600 text-white font-bold cursor-pointer"
                            >
                              Lưu
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingPhrase(null)}
                              className="px-3 py-1 rounded-lg bg-slate-700 text-slate-200 cursor-pointer"
                            >
                              Huỷ
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-start justify-between gap-3">
                            <span className="text-slate-200 leading-relaxed">{text}</span>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => setEditingPhrase({ index: idx, text })}
                                className="p-1.5 rounded-lg hover:bg-slate-800 text-cyan-400 cursor-pointer"
                                title="Sửa"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  sendCommand("phrase_delete", {
                                    group: selectedPhraseGroup,
                                    index: idx,
                                  })
                                }
                                className="p-1.5 rounded-lg hover:bg-slate-800 text-rose-400 cursor-pointer"
                                title="Xoá"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-2 pt-1">
                    <input
                      type="text"
                      value={newPhraseText}
                      onChange={(e) => setNewPhraseText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAddPhrase();
                      }}
                      placeholder="Thêm câu thoại mới (biến: {name}, {item}, {points}, {gift}, {level})"
                      className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white outline-none focus:border-cyan-400"
                    />
                    <button
                      type="button"
                      onClick={handleAddPhrase}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-xs font-bold text-white cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      Thêm câu
                    </button>
                  </div>
                </div>
              </section>
            )}

            {/* ======================== TAB 3: PLAYER CRM */}
            {activeTab === "players" && (
              <section className="rounded-3xl bg-slate-900/75 border border-slate-800 p-5 space-y-4 shadow-xl">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-black uppercase tracking-wider text-amber-300 flex items-center gap-2">
                    <Crown className="w-4 h-4" />
                    Quản Lý Người Chơi (CRM · {players.length})
                  </h2>

                  {!confirmResetSeason ? (
                    <button
                      type="button"
                      onClick={() => setConfirmResetSeason(true)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-950/60 border border-rose-500/40 hover:bg-rose-900/60 text-xs font-bold text-rose-300 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Reset Mùa Giải
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 bg-rose-950 border border-rose-500 rounded-xl px-3 py-1.5">
                      <AlertTriangle className="w-4 h-4 text-amber-300" />
                      <span className="text-xs font-bold text-rose-100">
                        Lưu Top 10 &amp; đưa điểm về 0?
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          sendCommand("reset_season", { confirm: true });
                          setConfirmResetSeason(false);
                        }}
                        className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white cursor-pointer"
                      >
                        Xác nhận
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmResetSeason(false)}
                        className="px-2.5 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-xs text-slate-200 cursor-pointer"
                      >
                        Huỷ
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-2.5">
                  <div className="flex-1 min-w-[220px] flex items-center gap-2 bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2">
                    <Search className="w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      value={playerSearch}
                      onChange={(e) => setPlayerSearch(e.target.value)}
                      placeholder="Tìm theo tên hoặc @unique_id..."
                      className="w-full bg-transparent text-xs text-white outline-none placeholder:text-slate-500"
                    />
                  </div>
                  <select
                    value={playerSort}
                    onChange={(e) =>
                      setPlayerSort(e.target.value as "score" | "rod_level" | "nickname")
                    }
                    className="bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white outline-none"
                  >
                    <option value="score">Điểm cao nhất</option>
                    <option value="rod_level">Cấp cần cao nhất</option>
                    <option value="nickname">Tên (A-Z)</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => void fetchPlayers(playerSearch, playerSort)}
                    className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                    title="Làm mới"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>

                <div className="overflow-x-auto max-h-[460px] overflow-y-auto rounded-2xl border border-slate-800">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-950 text-slate-400 sticky top-0 z-10">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Người chơi</th>
                        <th className="px-3 py-3 font-semibold">Điểm</th>
                        <th className="px-3 py-3 font-semibold">Cần câu</th>
                        <th className="px-3 py-3 font-semibold">Xu · Mồi</th>
                        <th className="px-4 py-3 font-semibold text-right">Thao tác nhanh</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80 bg-slate-900/40">
                      {players.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-10 text-center text-slate-500">
                            Chưa có người chơi nào. Hãy chuyển sang tab Điều khiển &amp; Bot để thử Spawn hoặc bật Auto-Bot!
                          </td>
                        </tr>
                      ) : (
                        players.map((p) => (
                          <tr key={p.player_id} className="hover:bg-slate-800/40 transition">
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-2.5">
                                <div className="relative shrink-0">
                                  {p.avatar_url ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                      src={p.avatar_url}
                                      alt={p.nickname}
                                      className="w-8 h-8 rounded-full object-cover border border-slate-700"
                                    />
                                  ) : (
                                    <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center font-bold text-slate-300">
                                      {(p.nickname[0] || "?").toUpperCase()}
                                    </div>
                                  )}
                                  <span
                                    className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-slate-900 ${
                                      p.on_shore ? "bg-emerald-400" : "bg-slate-600"
                                    }`}
                                  />
                                </div>
                                <div className="min-w-0">
                                  <div className="font-bold text-white truncate max-w-[160px] flex items-center gap-1.5">
                                    {p.nickname}
                                    {p.tiktok_unique_id.startsWith("bot_") && (
                                      <span className="px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 text-[9px] font-bold">
                                        BOT
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[11px] text-slate-500 truncate max-w-[160px]">
                                    @{p.tiktok_unique_id}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-2.5 font-black text-amber-300 tabular-nums text-sm">
                              {p.score.toLocaleString("vi-VN")}
                            </td>
                            <td className="px-3 py-2.5">
                              <select
                                value={p.rod_level}
                                onChange={(e) =>
                                  sendCommand("player_adjust", {
                                    player_id: p.player_id,
                                    score_delta: 0,
                                    rod_level: Number(e.target.value),
                                  })
                                }
                                className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs text-cyan-200 outline-none"
                              >
                                <option value={1}>Lv1 · Tre</option>
                                <option value={2}>Lv2 · Sắt</option>
                                <option value={3}>Lv3 · Vàng</option>
                                <option value={4}>Lv4 · Laser</option>
                              </select>
                            </td>
                            <td className="px-3 py-2.5 text-slate-300 tabular-nums">
                              {p.total_gift_coins} xu · {p.lucky_bait_count} mồi
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() =>
                                    sendCommand("player_adjust", {
                                      player_id: p.player_id,
                                      score_delta: 100,
                                    })
                                  }
                                  className="px-2 py-1 rounded-lg bg-emerald-900/60 hover:bg-emerald-700 text-emerald-200 font-bold cursor-pointer"
                                >
                                  +100
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    sendCommand("player_adjust", {
                                      player_id: p.player_id,
                                      score_delta: 1000,
                                    })
                                  }
                                  className="px-2 py-1 rounded-lg bg-emerald-900/60 hover:bg-emerald-700 text-emerald-200 font-bold cursor-pointer"
                                >
                                  +1k
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    sendCommand("player_adjust", {
                                      player_id: p.player_id,
                                      score_delta: -500,
                                    })
                                  }
                                  className="px-2 py-1 rounded-lg bg-rose-900/60 hover:bg-rose-700 text-rose-200 font-bold cursor-pointer"
                                >
                                  -500
                                </button>
                                <button
                                  type="button"
                                  disabled={!p.on_shore}
                                  onClick={() =>
                                    sendCommand("player_kick", { player_id: p.player_id })
                                  }
                                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-700 disabled:opacity-30 text-slate-300 cursor-pointer"
                                  title="Kick khỏi bờ hồ"
                                >
                                  <UserMinus className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* ======================== TAB 4: CÂN BẰNG GAME (GACHA & BOSS) */}
            {activeTab === "balance" && (
              <section className="rounded-3xl bg-slate-900/75 border border-slate-800 p-5 space-y-5 shadow-xl">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-black uppercase tracking-wider text-emerald-300 flex items-center gap-2">
                    <Sliders className="w-4 h-4" />
                    Cân Bằng Game (Áp dụng trực tiếp không cần restart)
                  </h2>
                  <span
                    className={`text-xs font-extrabold px-3 py-1 rounded-full border ${
                      isGachaValid
                        ? "bg-emerald-500/15 border-emerald-400/50 text-emerald-300"
                        : "bg-rose-500/15 border-rose-400/50 text-rose-300"
                    }`}
                  >
                    Tổng Gacha: {gachaTotal}% {isGachaValid ? "✓ Hợp lệ" : "✗ Phải bằng 100%"}
                  </span>
                </div>

                {/* Thanh phân bổ Gacha 4 màu trực quan */}
                <div className="space-y-2">
                  <div className="h-4 w-full rounded-full bg-slate-950 overflow-hidden flex border border-slate-800">
                    <div
                      className="bg-sky-500 transition-all"
                      style={{ width: `${Math.min(100, balanceForm.gacha.normal)}%` }}
                      title={`Cá thường: ${balanceForm.gacha.normal}%`}
                    />
                    <div
                      className="bg-amber-400 transition-all"
                      style={{ width: `${Math.min(100, balanceForm.gacha.rare)}%` }}
                      title={`Cá hiếm: ${balanceForm.gacha.rare}%`}
                    />
                    <div
                      className="bg-emerald-400 transition-all"
                      style={{ width: `${Math.min(100, balanceForm.gacha.chest)}%` }}
                      title={`Rương báu: ${balanceForm.gacha.chest}%`}
                    />
                    <div
                      className="bg-rose-500 transition-all"
                      style={{ width: `${Math.min(100, balanceForm.gacha.troll)}%` }}
                      title={`Đồ troll: ${balanceForm.gacha.troll}%`}
                    />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    {(
                      [
                        ["normal", "Cá thường (%)", "bg-sky-500"],
                        ["rare", "Cá hiếm (%)", "bg-amber-400"],
                        ["chest", "Rương báu (%)", "bg-emerald-400"],
                        ["troll", "Đồ troll (%)", "bg-rose-500"],
                      ] as const
                    ).map(([key, label, dot]) => (
                      <label key={key} className="block bg-slate-950 border border-slate-800 rounded-2xl p-3">
                        <span className="flex items-center gap-1.5 text-[11px] text-slate-400 mb-1.5">
                          <span className={`w-2.5 h-2.5 rounded-full ${dot}`} />
                          {label}
                        </span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={1}
                          value={balanceForm.gacha[key]}
                          onChange={(e) => handleGachaChange(key, Number(e.target.value))}
                          className="w-full bg-transparent text-lg font-black text-white outline-none"
                        />
                      </label>
                    ))}
                  </div>
                </div>

                {/* Thông số Boss & Fever */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                  <label className="block bg-slate-950 border border-slate-800 rounded-2xl p-3">
                    <span className="block text-[11px] text-slate-400 mb-1">Máu Boss Kraken (HP)</span>
                    <input
                      type="number"
                      min={1}
                      value={balanceForm.boss_max_hp}
                      onChange={(e) =>
                        setBalanceForm((p) => ({
                          ...p,
                          boss_max_hp: Math.max(1, Number(e.target.value) || 1),
                        }))
                      }
                      className="w-full bg-transparent text-base font-black text-white outline-none"
                    />
                  </label>

                  <label className="block bg-slate-950 border border-slate-800 rounded-2xl p-3">
                    <span className="block text-[11px] text-slate-400 mb-1">Chu kỳ Boss (phút)</span>
                    <input
                      type="number"
                      min={1}
                      step={0.5}
                      value={balanceForm.boss_interval_minutes}
                      onChange={(e) =>
                        setBalanceForm((p) => ({
                          ...p,
                          boss_interval_minutes: Math.max(1, Number(e.target.value) || 1),
                        }))
                      }
                      className="w-full bg-transparent text-base font-black text-white outline-none"
                    />
                  </label>

                  <label className="block bg-slate-950 border border-slate-800 rounded-2xl p-3">
                    <span className="block text-[11px] text-slate-400 mb-1">Thời gian đánh Boss (s)</span>
                    <input
                      type="number"
                      min={5}
                      value={balanceForm.boss_duration_seconds}
                      onChange={(e) =>
                        setBalanceForm((p) => ({
                          ...p,
                          boss_duration_seconds: Math.max(5, Number(e.target.value) || 5),
                        }))
                      }
                      className="w-full bg-transparent text-base font-black text-white outline-none"
                    />
                  </label>

                  <label className="block bg-slate-950 border border-slate-800 rounded-2xl p-3">
                    <span className="block text-[11px] text-slate-400 mb-1">Ngưỡng xu gọi Boss</span>
                    <input
                      type="number"
                      min={1}
                      value={balanceForm.boss_summon_gift_threshold}
                      onChange={(e) =>
                        setBalanceForm((p) => ({
                          ...p,
                          boss_summon_gift_threshold: Math.max(1, Number(e.target.value) || 1),
                        }))
                      }
                      className="w-full bg-transparent text-base font-black text-white outline-none"
                    />
                  </label>

                  <label className="block bg-slate-950 border border-slate-800 rounded-2xl p-3">
                    <span className="block text-[11px] text-slate-400 mb-1">Ngưỡng tim mở Fever</span>
                    <input
                      type="number"
                      min={1}
                      value={balanceForm.fever_threshold}
                      onChange={(e) =>
                        setBalanceForm((p) => ({
                          ...p,
                          fever_threshold: Math.max(1, Number(e.target.value) || 1),
                        }))
                      }
                      className="w-full bg-transparent text-base font-black text-white outline-none"
                    />
                  </label>

                  <label className="block bg-slate-950 border border-slate-800 rounded-2xl p-3">
                    <span className="block text-[11px] text-slate-400 mb-1">Thời lượng Fever (s)</span>
                    <input
                      type="number"
                      min={1}
                      value={balanceForm.fever_duration_seconds}
                      onChange={(e) =>
                        setBalanceForm((p) => ({
                          ...p,
                          fever_duration_seconds: Math.max(1, Number(e.target.value) || 1),
                        }))
                      }
                      className="w-full bg-transparent text-base font-black text-white outline-none"
                    />
                  </label>
                </div>

                <button
                  type="button"
                  disabled={!isGachaValid || !connected}
                  onClick={handleSaveBalance}
                  className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 disabled:opacity-40 text-sm font-black text-slate-950 shadow-lg shadow-emerald-500/20 transition cursor-pointer"
                >
                  <Save className="w-4 h-4" />
                  Lưu &amp; Áp dụng ngay lập tức
                </button>
              </section>
            )}
          </div>

          {/* CỘT PHẢI (4 CỘT): GIÁM SÁT LIVE THỜI GIAN THỰC (Top 3 + TTS Queue + Live Log) */}
          <div className="xl:col-span-4 space-y-4">
            {/* Top 3 Vua Câu Cá trực tiếp */}
            <section className="rounded-3xl bg-slate-900/75 border border-slate-800 p-4 space-y-3 shadow-xl">
              <h3 className="text-xs font-black uppercase tracking-wider text-amber-300 flex items-center gap-2">
                <Crown className="w-4 h-4" />
                Top 3 Vua Câu Cá
              </h3>
              <div className="space-y-2">
                {[0, 1, 2].map((i) => {
                  const entry = top3[i];
                  return (
                    <div
                      key={i}
                      className="flex items-center justify-between gap-2 rounded-2xl bg-slate-950/80 border border-slate-800/90 px-3 py-2"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black shrink-0 ${
                            i === 0
                              ? "bg-amber-400 text-slate-950"
                              : i === 1
                              ? "bg-slate-300 text-slate-950"
                              : "bg-amber-700 text-white"
                          }`}
                        >
                          {i + 1}
                        </span>
                        <span className="text-xs font-bold text-white truncate">
                          {entry ? entry.nickname : "Chưa có"}
                        </span>
                      </div>
                      <span className="text-xs font-black text-amber-300 tabular-nums shrink-0">
                        {entry ? `${entry.score.toLocaleString("vi-VN")} đ` : "0 đ"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Hàng đợi AI Caster (TTS Queue) */}
            <section className="rounded-3xl bg-slate-900/75 border border-slate-800 p-4 space-y-2.5 shadow-xl">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-black uppercase tracking-wider text-fuchsia-300 flex items-center gap-2">
                  <Mic className="w-4 h-4" />
                  Hàng đợi AI Caster ({ttsQueue.length}/20)
                </h3>
                <button
                  type="button"
                  onClick={() => sendCommand("tts_clear_queue", {})}
                  className="text-[11px] font-bold text-rose-400 hover:text-rose-300 cursor-pointer"
                >
                  Clear Queue
                </button>
              </div>
              <div className="max-h-36 overflow-y-auto rounded-2xl bg-slate-950 border border-slate-800 p-2.5 space-y-1.5 text-xs">
                {ttsQueue.length === 0 ? (
                  <div className="text-slate-500 text-center py-4">
                    Hàng đợi đang trống
                  </div>
                ) : (
                  ttsQueue.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-2 bg-slate-900/90 rounded-xl px-2.5 py-1.5"
                    >
                      <span className="px-1.5 py-0.5 rounded bg-fuchsia-500/20 text-fuchsia-300 font-bold text-[10px]">
                        P{item.priority}
                      </span>
                      <span className="truncate text-slate-200">{item.text}</span>
                    </div>
                  ))
                )}
              </div>
            </section>

            {/* Live Event Log */}
            <section className="rounded-3xl bg-slate-900/75 border border-slate-800 p-4 space-y-2.5 shadow-xl">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-black uppercase tracking-wider text-emerald-300 flex items-center gap-2">
                  <Activity className="w-4 h-4" />
                  Live Event Log ({orderedLogs.length})
                </h3>
                <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoScrollLogs}
                    onChange={(e) => setAutoScrollLogs(e.target.checked)}
                    className="accent-emerald-400"
                  />
                  Tự cuộn
                </label>
              </div>
              <div
                ref={logBoxRef}
                className="h-72 overflow-y-auto rounded-2xl bg-slate-950 border border-slate-800 p-3 space-y-2 font-mono text-[11px]"
              >
                {orderedLogs.length === 0 ? (
                  <div className="text-slate-500 text-center py-16">
                    Đang chờ sự kiện mới...
                  </div>
                ) : (
                  orderedLogs.map((l, idx) => (
                    <div
                      key={`${l.id}-${l.timestamp}-${idx}`}
                      className="flex items-start gap-2 leading-relaxed"
                    >
                      <span className="text-slate-500 shrink-0">
                        {new Date(l.timestamp).toLocaleTimeString("vi-VN")}
                      </span>
                      <span
                        className={`px-1.5 py-0.2 rounded border text-[10px] font-bold shrink-0 ${
                          LOG_BADGE[l.type] ?? "bg-slate-800 text-slate-300 border-slate-700"
                        }`}
                      >
                        {l.type}
                      </span>
                      <span className="text-slate-200 break-words">{l.message}</span>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
