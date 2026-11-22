"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Coins,
  Crown,
  Edit3,
  ExternalLink,
  Flame,
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
  Wand2,
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
    bg: "bg-amber-950/50 border-amber-500/40",
  },
  CONNECTED: {
    label: "Đang Live",
    dot: "bg-emerald-400 animate-pulse",
    text: "text-emerald-300",
    bg: "bg-emerald-950/50 border-emerald-500/40",
  },
  OFFLINE_ROOM: {
    label: "Phòng Offline",
    dot: "bg-orange-400",
    text: "text-orange-300",
    bg: "bg-orange-950/50 border-orange-500/40",
  },
  ERROR: {
    label: "Lỗi kết nối",
    dot: "bg-rose-500",
    text: "text-rose-300",
    bg: "bg-rose-950/50 border-rose-500/40",
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
};

export default function DashboardPage() {
  const { connected, reconnecting, state, logs, ttsQueue, sendCommand, subscribe } =
    useGameSocket("dashboard");

  // ---------------------------------------------------------------- Toast thông báo
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const pushToast = useCallback((res: CommandResultData) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const text = res.ok
      ? res.message || "Thực hiện thành công"
      : res.error || "Thao tác thất bại";
    setToasts((prev) => [{ id, ok: res.ok, action: res.action, text }, ...prev].slice(0, 5));
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  // ---------------------------------------------------------------- Phân khu 1: TikTok Live
  const [usernameInput, setUsernameInput] = useState("");
  const [tiktokNote, setTiktokNote] = useState("");

  // ---------------------------------------------------------------- Phân khu 2: Simulator
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [customNickname, setCustomNickname] = useState("");
  const [commentText, setCommentText] = useState("cau");
  const [giftRepeat, setGiftRepeat] = useState(1);
  const [giftStreaking, setGiftStreaking] = useState(false);

  // ---------------------------------------------------------------- Phân khu 3: AI Caster & Phrases
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

  // ---------------------------------------------------------------- Phân khu 4: Player CRM
  const [players, setPlayers] = useState<PlayerRecord[]>([]);
  const [playerSearch, setPlayerSearch] = useState("");
  const [playerSort, setPlayerSort] = useState<"score" | "rod_level" | "nickname">("score");
  const [confirmResetSeason, setConfirmResetSeason] = useState(false);

  // ---------------------------------------------------------------- Phân khu 5: Game Balance
  const [balanceForm, setBalanceForm] = useState<PublicGameSettings>(DEFAULT_PUBLIC_SETTINGS);

  // Live Event Log scroll ref
  const logBoxRef = useRef<HTMLDivElement | null>(null);
  const [autoScrollLogs, setAutoScrollLogs] = useState(true);

  // ---------------------------------------------------------------- REST fetch helpers
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
      // Mạng tạm thời lỗi: giữ nguyên danh sách cũ
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
      // Giữ nguyên state hiện tại nếu backend tạm thời chưa sẵn sàng
    }
  }, []);

  // Nạp cấu hình & bộ câu thoại ban đầu từ REST API
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
        });
      } catch {
        // Sẽ tự đồng bộ qua STATE_SYNC của WS
      }
    };
    void loadInitialSettings();
    return () => {
      active = false;
    };
  }, []);

  // Nạp lại bảng Player CRM khi từ khóa tìm kiếm hoặc sắp xếp thay đổi
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchPlayers(playerSearch, playerSort);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [playerSearch, playerSort, fetchPlayers]);

  // Đồng bộ trực tiếp các sự kiện WS vào form, toast và danh sách CRM
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

  // Tự động cuộn Live Event Log xuống dòng mới nhất (thao tác DOM ref)
  useEffect(() => {
    if (autoScrollLogs && logBoxRef.current) {
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
    }
  }, [logs, autoScrollLogs]);

  // ---------------------------------------------------------------- Tính toán phụ
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

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 lg:p-5">
      {/* Toast thông báo COMMAND_RESULT */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-80 max-w-[90vw] pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 shadow-2xl backdrop-blur-md text-xs ${
              t.ok
                ? "bg-emerald-950/90 border-emerald-500/50 text-emerald-100"
                : "bg-rose-950/90 border-rose-500/50 text-rose-100"
            }`}
          >
            {t.ok ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            )}
            <div className="min-w-0">
              <div className="font-bold uppercase tracking-wider text-[10px] opacity-80">
                {t.action}
              </div>
              <div className="font-medium break-words">{t.text}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="max-w-[1680px] mx-auto space-y-4">
        {/* ============================================================ PHÂN KHU 1: STATUS BAR */}
        <header className="rounded-2xl bg-slate-900/90 border border-slate-800 p-4 shadow-lg space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-4">
            {/* Thương hiệu + Kết nối WS & TikTok */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center font-black text-white shadow">
                  🐟
                </div>
                <div>
                  <h1 className="text-base font-extrabold tracking-tight text-white">
                    Đại Chiến Thủy Cung — Admin Studio
                  </h1>
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="inline-flex items-center gap-1">
                      {connected ? (
                        <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <WifiOff className="w-3.5 h-3.5 text-rose-400 animate-pulse" />
                      )}
                      <span className={connected ? "text-emerald-400" : "text-rose-400"}>
                        WS: {connected ? "Đã kết nối" : reconnecting ? "Đang nối lại..." : "Mất kết nối"}
                      </span>
                    </span>
                    <span className="text-slate-600">|</span>
                    <span
                      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] font-medium ${badge.bg} ${badge.text}`}
                    >
                      <span className={`w-2 h-2 rounded-full ${badge.dot}`} />
                      TikTok: {badge.label}
                      {stats?.connected_username ? ` (@${stats.connected_username})` : ""}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Ô nhập @username + Connect / Disconnect + Link Overlay */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center bg-slate-950 border border-slate-700 rounded-xl overflow-hidden focus-within:border-cyan-500">
                <span className="pl-3 text-slate-400 text-sm font-bold">@</span>
                <input
                  type="text"
                  value={usernameInput}
                  onChange={(e) => setUsernameInput(e.target.value.replace(/@/g, ""))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleConnectTiktok();
                  }}
                  placeholder="username_tiktok"
                  className="bg-transparent px-2 py-1.5 text-sm text-white placeholder:text-slate-500 outline-none w-44"
                />
              </div>
              <button
                type="button"
                onClick={handleConnectTiktok}
                disabled={!connected}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-xs font-bold text-white transition cursor-pointer"
              >
                <Link2 className="w-3.5 h-3.5" />
                Kết nối Live
              </button>
              <button
                type="button"
                onClick={() => sendCommand("disconnect_tiktok", {})}
                disabled={!connected || tiktokStatus === "DISCONNECTED"}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-rose-600/80 disabled:opacity-40 text-xs font-semibold text-slate-200 transition cursor-pointer"
              >
                <Link2Off className="w-3.5 h-3.5" />
                Ngắt
              </button>

              <Link
                href="/overlay"
                target="_blank"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-cyan-600/20 border border-cyan-500/40 hover:bg-cyan-600/30 text-cyan-300 text-xs font-bold transition"
              >
                Mở Overlay <ExternalLink className="w-3.5 h-3.5" />
              </Link>
              <Link
                href="/overlay?transparent=1"
                target="_blank"
                className="inline-flex items-center gap-1 px-2.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition"
                title="Mở link nền trong suốt dùng cho OBS Browser Source"
              >
                OBS Transparent <ExternalLink className="w-3 h-3" />
              </Link>
            </div>
          </div>

          {/* Thông số trực tiếp + Trạng thái phòng TikTok */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 pt-2 border-t border-slate-800/80">
            <div className="flex items-center gap-2.5 bg-slate-950/70 border border-slate-800 rounded-xl px-3 py-2">
              <Users className="w-4 h-4 text-cyan-400 shrink-0" />
              <div>
                <div className="text-[10px] text-slate-400 uppercase font-semibold">Trên bờ</div>
                <div className="text-sm font-extrabold tabular-nums">
                  {stats?.active_players ?? 0}{" "}
                  <span className="text-[11px] font-normal text-slate-400">
                    (hiển thị {state?.players_on_shore.length ?? 0}/15)
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2.5 bg-slate-950/70 border border-slate-800 rounded-xl px-3 py-2">
              <Heart className="w-4 h-4 text-rose-400 shrink-0" />
              <div>
                <div className="text-[10px] text-slate-400 uppercase font-semibold">Tổng Tim</div>
                <div className="text-sm font-extrabold tabular-nums">
                  {(stats?.total_likes ?? 0).toLocaleString("vi-VN")}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2.5 bg-slate-950/70 border border-slate-800 rounded-xl px-3 py-2">
              <Coins className="w-4 h-4 text-amber-400 shrink-0" />
              <div>
                <div className="text-[10px] text-slate-400 uppercase font-semibold">Tổng Xu Quà</div>
                <div className="text-sm font-extrabold tabular-nums text-amber-300">
                  {(stats?.total_coins ?? 0).toLocaleString("vi-VN")}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2.5 bg-slate-950/70 border border-slate-800 rounded-xl px-3 py-2">
              <Flame className="w-4 h-4 text-orange-400 shrink-0" />
              <div>
                <div className="text-[10px] text-slate-400 uppercase font-semibold">Nhiệt Độ Hồ</div>
                <div className="text-sm font-extrabold tabular-nums">
                  {state?.fever.active
                    ? "ĐANG FEVER 🔥"
                    : `${state?.fever.heat ?? 0} / ${state?.fever.max ?? 1000}`}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2.5 bg-slate-950/70 border border-slate-800 rounded-xl px-3 py-2">
              <Skull className="w-4 h-4 text-fuchsia-400 shrink-0" />
              <div>
                <div className="text-[10px] text-slate-400 uppercase font-semibold">Boss Kraken</div>
                <div className="text-sm font-extrabold tabular-nums">
                  {state?.boss
                    ? `${state.boss.current_hp.toLocaleString("vi-VN")} HP`
                    : "Chưa xuất hiện"}
                </div>
              </div>
            </div>
          </div>

          {tiktokNote && (
            <div className="text-xs text-slate-300 bg-slate-950/80 border border-slate-800 rounded-lg px-3 py-1.5">
              Thông báo TikTok: <span className="text-cyan-300 font-medium">{tiktokNote}</span>
            </div>
          )}
        </header>

        {/* LƯỚI CHÍNH 16:9 (12 CỘT) */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
          {/* CỘT TRÁI (7 CỘT): God-Mode Simulator + Player CRM + Live Event Log */}
          <div className="xl:col-span-7 space-y-4">
            {/* ======================================================== PHÂN KHU 2: GOD-MODE & SIMULATOR */}
            <section className="rounded-2xl bg-slate-900/90 border border-slate-800 p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-extrabold uppercase tracking-wider text-cyan-300 flex items-center gap-2">
                  <Wand2 className="w-4 h-4" />
                  2. God-Mode &amp; Mock Simulator
                </h2>
                <button
                  type="button"
                  onClick={() => sendCommand("spawn_players", { count: 5 })}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-xs font-bold text-white transition cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Spawn 5 Random Players
                </button>
              </div>

              {/* Chọn người chơi mục tiêu hoặc nhập mới */}
              <div className="grid sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                    Chọn người chơi có sẵn (để trống = ngẫu nhiên)
                  </label>
                  <select
                    value={selectedPlayerId}
                    onChange={(e) => setSelectedPlayerId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-cyan-500"
                  >
                    <option value="">-- Ngẫu nhiên / Người mới --</option>
                    {players.map((p) => (
                      <option key={p.player_id} value={p.tiktok_unique_id}>
                        {p.nickname} ({p.score}đ · {ROD_NAMES[p.rod_level] ?? `Lv${p.rod_level}`})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                    Hoặc nhập tên người chơi mới
                  </label>
                  <input
                    type="text"
                    value={customNickname}
                    onChange={(e) => setCustomNickname(e.target.value)}
                    disabled={selectedPlayerId !== ""}
                    placeholder="VD: Thánh Câu Cá..."
                    className="w-full bg-slate-950 border border-slate-700 disabled:opacity-45 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-600 outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              {/* Giả lập Comment + Like + Follow */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex-1 min-w-[200px] flex gap-1.5">
                  <input
                    type="text"
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleMockComment();
                    }}
                    placeholder="Nội dung comment..."
                    className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white outline-none focus:border-cyan-500"
                  />
                  <button
                    type="button"
                    onClick={() => handleMockComment()}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-cyan-300 cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Gửi Comment
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => handleMockComment("cau")}
                  className="px-2.5 py-1.5 rounded-xl bg-sky-950/70 border border-sky-500/40 hover:bg-sky-900/70 text-xs font-semibold text-sky-200 cursor-pointer"
                >
                  &quot;cau&quot;
                </button>
                <button
                  type="button"
                  onClick={() => handleMockComment("diem")}
                  className="px-2.5 py-1.5 rounded-xl bg-sky-950/70 border border-sky-500/40 hover:bg-sky-900/70 text-xs font-semibold text-sky-200 cursor-pointer"
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
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-rose-600/20 border border-rose-500/40 hover:bg-rose-600/35 text-xs font-bold text-rose-300 cursor-pointer"
                >
                  <Heart className="w-3.5 h-3.5" />
                  Bơm +200 Tim
                </button>
                <button
                  type="button"
                  onClick={() =>
                    sendCommand("mock_event", {
                      kind: "follow",
                      ...buildMockTarget(),
                    })
                  }
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-600/20 border border-emerald-500/40 hover:bg-emerald-600/35 text-xs font-bold text-emerald-300 cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Giả lập Follow
                </button>
              </div>

              {/* Giả lập Quà tặng 1-click */}
              <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-3 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-bold text-amber-300">Tặng Quà Nhanh (1-Click):</span>
                  <div className="flex items-center gap-3">
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
                        className="w-16 bg-slate-900 border border-slate-700 rounded-lg px-2 py-0.5 text-xs text-white text-center"
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

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <button
                    type="button"
                    onClick={() => handleMockGift("rose")}
                    className="rounded-xl bg-slate-900 hover:bg-sky-950/80 border border-slate-700 hover:border-sky-500/50 p-2 text-left transition cursor-pointer"
                  >
                    <div className="text-xs font-bold text-white">🌹 Hoa Hồng</div>
                    <div className="text-[10px] text-sky-300">1 xu · Lưới điện</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMockGift("ice_cream")}
                    className="rounded-xl bg-slate-900 hover:bg-amber-950/80 border border-slate-700 hover:border-amber-500/50 p-2 text-left transition cursor-pointer"
                  >
                    <div className="text-xs font-bold text-white">🍦 Kem</div>
                    <div className="text-[10px] text-amber-300">10 xu · Nâng cấp cần</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMockGift("lion")}
                    className="rounded-xl bg-slate-900 hover:bg-indigo-950/80 border border-slate-700 hover:border-indigo-500/50 p-2 text-left transition cursor-pointer"
                  >
                    <div className="text-xs font-bold text-white">🦁 Sư Tử</div>
                    <div className="text-[10px] text-indigo-300">100 xu · Tàu đánh cá</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMockGift("universe")}
                    className="rounded-xl bg-slate-900 hover:bg-rose-950/80 border border-slate-700 hover:border-rose-500/50 p-2 text-left transition cursor-pointer"
                  >
                    <div className="text-xs font-bold text-white">🌌 Universe</div>
                    <div className="text-[10px] text-rose-300">1000 xu · Gọi Boss</div>
                  </button>
                </div>
              </div>

              {/* Quyền năng điều khiển hồ câu */}
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => sendCommand("summon_boss", {})}
                  className="inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-rose-600/25 border border-rose-500/50 hover:bg-rose-600/40 text-xs font-bold text-rose-200 cursor-pointer"
                >
                  <Skull className="w-4 h-4" />
                  Triệu hồi Boss ngay
                </button>
                <button
                  type="button"
                  onClick={() => sendCommand("trigger_fever", {})}
                  className="inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-amber-500/20 border border-amber-500/50 hover:bg-amber-500/35 text-xs font-bold text-amber-200 cursor-pointer"
                >
                  <Flame className="w-4 h-4" />
                  Kích hoạt Fever Time
                </button>
                <button
                  type="button"
                  onClick={() => sendCommand("reset_lake", {})}
                  className="inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-slate-800 border border-slate-700 hover:bg-slate-700 text-xs font-bold text-slate-200 cursor-pointer"
                >
                  <Ship className="w-4 h-4" />
                  Làm sạch hồ
                </button>
              </div>
            </section>

            {/* ======================================================== PHÂN KHU 4: PLAYER CRM */}
            <section className="rounded-2xl bg-slate-900/90 border border-slate-800 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-extrabold uppercase tracking-wider text-amber-300 flex items-center gap-2">
                  <Crown className="w-4 h-4" />
                  4. Player CRM ({players.length} người chơi)
                </h2>

                <div className="flex items-center gap-2">
                  {!confirmResetSeason ? (
                    <button
                      type="button"
                      onClick={() => setConfirmResetSeason(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-950/60 border border-rose-500/40 hover:bg-rose-900/60 text-xs font-bold text-rose-300 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Reset Mùa Giải
                    </button>
                  ) : (
                    <div className="flex items-center gap-1.5 bg-rose-950 border border-rose-500 rounded-xl px-2.5 py-1">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-300" />
                      <span className="text-[11px] font-bold text-rose-100">
                        Lưu Top 10 &amp; đưa điểm về 0?
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          sendCommand("reset_season", { confirm: true });
                          setConfirmResetSeason(false);
                        }}
                        className="px-2 py-0.5 rounded bg-rose-600 hover:bg-rose-500 text-[11px] font-bold text-white cursor-pointer"
                      >
                        Xác nhận
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmResetSeason(false)}
                        className="px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-[11px] text-slate-200 cursor-pointer"
                      >
                        Huỷ
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Thanh tìm kiếm + sắp xếp */}
              <div className="flex flex-wrap gap-2">
                <div className="flex-1 min-w-[200px] flex items-center gap-2 bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5">
                  <Search className="w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    value={playerSearch}
                    onChange={(e) => setPlayerSearch(e.target.value)}
                    placeholder="Tìm theo tên hoặc TikTok ID..."
                    className="w-full bg-transparent text-xs text-white outline-none placeholder:text-slate-500"
                  />
                </div>
                <select
                  value={playerSort}
                  onChange={(e) =>
                    setPlayerSort(e.target.value as "score" | "rod_level" | "nickname")
                  }
                  className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white outline-none"
                >
                  <option value="score">Sắp xếp: Điểm cao nhất</option>
                  <option value="rod_level">Sắp xếp: Cấp cần</option>
                  <option value="nickname">Sắp xếp: Tên (A-Z)</option>
                </select>
                <button
                  type="button"
                  onClick={() => void fetchPlayers(playerSearch, playerSort)}
                  className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                  title="Tải lại danh sách"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>

              {/* Bảng người chơi */}
              <div className="overflow-x-auto max-h-[310px] overflow-y-auto rounded-xl border border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950 text-slate-400 sticky top-0 z-10">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Người chơi</th>
                      <th className="px-2 py-2 font-semibold">Điểm</th>
                      <th className="px-2 py-2 font-semibold">Cần câu</th>
                      <th className="px-2 py-2 font-semibold">Xu / Mồi</th>
                      <th className="px-3 py-2 font-semibold text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 bg-slate-900/40">
                    {players.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                          Chưa có người chơi nào. Hãy bấm &quot;Spawn 5 Random Players&quot; để thử ngay!
                        </td>
                      </tr>
                    ) : (
                      players.map((p) => (
                        <tr key={p.player_id} className="hover:bg-slate-800/40">
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <span
                                className={`w-2 h-2 rounded-full shrink-0 ${
                                  p.on_shore ? "bg-emerald-400" : "bg-slate-600"
                                }`}
                                title={p.on_shore ? "Đang ngồi trên bờ" : "Đang offline/rời bờ"}
                              />
                              <div className="min-w-0">
                                <div className="font-bold text-white truncate max-w-[140px]">
                                  {p.nickname}
                                </div>
                                <div className="text-[10px] text-slate-500 truncate max-w-[140px]">
                                  @{p.tiktok_unique_id}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-2 py-2 font-extrabold text-amber-300 tabular-nums">
                            {p.score.toLocaleString("vi-VN")}
                          </td>
                          <td className="px-2 py-2">
                            <select
                              value={p.rod_level}
                              onChange={(e) =>
                                sendCommand("player_adjust", {
                                  player_id: p.player_id,
                                  score_delta: 0,
                                  rod_level: Number(e.target.value),
                                })
                              }
                              className="bg-slate-950 border border-slate-700 rounded-lg px-1.5 py-1 text-[11px] text-cyan-200 outline-none"
                            >
                              <option value={1}>Lv1 · Tre</option>
                              <option value={2}>Lv2 · Sắt</option>
                              <option value={3}>Lv3 · Vàng</option>
                              <option value={4}>Lv4 · Laser</option>
                            </select>
                          </td>
                          <td className="px-2 py-2 text-[11px] text-slate-300 tabular-nums">
                            {p.total_gift_coins} xu · {p.lucky_bait_count} mồi
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() =>
                                  sendCommand("player_adjust", {
                                    player_id: p.player_id,
                                    score_delta: 100,
                                  })
                                }
                                className="px-1.5 py-0.5 rounded bg-emerald-900/60 hover:bg-emerald-700 text-emerald-200 font-bold cursor-pointer"
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
                                className="px-1.5 py-0.5 rounded bg-emerald-900/60 hover:bg-emerald-700 text-emerald-200 font-bold cursor-pointer"
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
                                className="px-1.5 py-0.5 rounded bg-rose-900/60 hover:bg-rose-700 text-rose-200 font-bold cursor-pointer"
                              >
                                -500
                              </button>
                              <button
                                type="button"
                                disabled={!p.on_shore}
                                onClick={() =>
                                  sendCommand("player_kick", { player_id: p.player_id })
                                }
                                className="p-1 rounded bg-slate-800 hover:bg-rose-700 disabled:opacity-30 text-slate-300 cursor-pointer"
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

            {/* ======================================================== LIVE EVENT LOG */}
            <section className="rounded-2xl bg-slate-900/90 border border-slate-800 p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300 flex items-center gap-2">
                  <Activity className="w-4 h-4" />
                  Live Event Log ({orderedLogs.length})
                </h2>
                <label className="inline-flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoScrollLogs}
                    onChange={(e) => setAutoScrollLogs(e.target.checked)}
                    className="accent-emerald-400"
                  />
                  Tự cuộn mới nhất
                </label>
              </div>
              <div
                ref={logBoxRef}
                className="h-48 overflow-y-auto rounded-xl bg-slate-950 border border-slate-800 p-2.5 space-y-1.5 font-mono text-[11px]"
              >
                {orderedLogs.length === 0 ? (
                  <div className="text-slate-500 text-center py-12">
                    Chưa có log sự kiện trong phiên này...
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

          {/* CỘT PHẢI (5 CỘT): AI Caster Studio + Game Balance */}
          <div className="xl:col-span-5 space-y-4">
            {/* ======================================================== PHÂN KHU 3: AI CASTER & VOICE STUDIO */}
            <section className="rounded-2xl bg-slate-900/90 border border-slate-800 p-4 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-extrabold uppercase tracking-wider text-fuchsia-300 flex items-center gap-2">
                  <Mic className="w-4 h-4" />
                  3. AI Caster &amp; Voice Studio
                </h2>
                <button
                  type="button"
                  onClick={() => sendCommand("tts_toggle", { enabled: !ttsEnabled })}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition cursor-pointer ${
                    ttsEnabled
                      ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-300"
                      : "bg-slate-800 border-slate-700 text-slate-400"
                  }`}
                >
                  {ttsEnabled ? (
                    <Volume2 className="w-3.5 h-3.5" />
                  ) : (
                    <VolumeX className="w-3.5 h-3.5" />
                  )}
                  TTS: {ttsEnabled ? "ĐANG BẬT" : "ĐÃ TẮT"}
                </button>
              </div>

              {/* Đọc ngay (Instant Broadcast - Ưu tiên 0) */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={instantSpeakText}
                  onChange={(e) => setInstantSpeakText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSpeakNow();
                  }}
                  placeholder="Đọc ngay (Instant Broadcast) — gõ rồi nhấn Enter..."
                  className="flex-1 bg-slate-950 border border-fuchsia-500/40 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-500 outline-none focus:border-fuchsia-400"
                />
                <button
                  type="button"
                  onClick={handleSpeakNow}
                  className="px-3.5 py-2 rounded-xl bg-fuchsia-600 hover:bg-fuchsia-500 text-xs font-bold text-white cursor-pointer"
                >
                  Phát ngay
                </button>
              </div>

              {/* Giọng đọc + Rate + Pitch */}
              <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-3 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setTtsVoice("vi-VN-HoaiMyNeural");
                      sendCommand("tts_config", { voice: "vi-VN-HoaiMyNeural" });
                    }}
                    className={`py-1.5 px-3 rounded-lg border text-xs font-bold cursor-pointer ${
                      ttsVoice === "vi-VN-HoaiMyNeural"
                        ? "bg-fuchsia-500/25 border-fuchsia-400 text-fuchsia-200"
                        : "bg-slate-900 border-slate-700 text-slate-400"
                    }`}
                  >
                    👩 Hoài My (Nữ)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTtsVoice("vi-VN-NamMinhNeural");
                      sendCommand("tts_config", { voice: "vi-VN-NamMinhNeural" });
                    }}
                    className={`py-1.5 px-3 rounded-lg border text-xs font-bold cursor-pointer ${
                      ttsVoice === "vi-VN-NamMinhNeural"
                        ? "bg-cyan-500/25 border-cyan-400 text-cyan-200"
                        : "bg-slate-900 border-slate-700 text-slate-400"
                    }`}
                  >
                    👨 Nam Minh (Nam)
                  </button>
                </div>

                <div className="grid sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <div className="flex justify-between text-slate-300 mb-1">
                      <span>Tốc độ (Rate)</span>
                      <span className="font-bold text-cyan-300">
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
                    <div className="flex justify-between text-slate-300 mb-1">
                      <span>Cao độ (Pitch)</span>
                      <span className="font-bold text-fuchsia-300">
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
                  className="w-full py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 cursor-pointer"
                >
                  Áp dụng cấu hình giọng đọc
                </button>
              </div>

              {/* Hàng đợi TTS Queue */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-300">
                    Hàng đợi TTS ({ttsQueue.length}/20)
                  </span>
                  <button
                    type="button"
                    onClick={() => sendCommand("tts_clear_queue", {})}
                    className="text-[11px] font-bold text-rose-400 hover:text-rose-300 cursor-pointer"
                  >
                    Clear Queue
                  </button>
                </div>
                <div className="max-h-28 overflow-y-auto rounded-xl bg-slate-950 border border-slate-800 p-2 space-y-1 text-xs">
                  {ttsQueue.length === 0 ? (
                    <div className="text-slate-500 text-center py-3">
                      Hàng đợi đang trống
                    </div>
                  ) : (
                    ttsQueue.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-2 bg-slate-900/80 rounded-lg px-2 py-1"
                      >
                        <span className="px-1.5 py-0.5 rounded bg-fuchsia-500/20 text-fuchsia-300 font-bold text-[10px]">
                          P{item.priority}
                        </span>
                        <span className="truncate text-slate-200">{item.text}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Quản lý câu thoại mẫu (CRUD 9 nhóm) */}
              <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-3 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-200">
                    Kho câu thoại mẫu ({activePhrases.length} câu)
                  </span>
                  <select
                    value={selectedPhraseGroup}
                    onChange={(e) => {
                      setSelectedPhraseGroup(e.target.value);
                      setEditingPhrase(null);
                    }}
                    className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-[11px] text-cyan-200 outline-none max-w-[230px]"
                  >
                    {phraseGroups.map((g) => (
                      <option key={g} value={g}>
                        {PHRASE_GROUP_LABELS[g] ?? g}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                  {activePhrases.map((text, idx) => (
                    <div
                      key={`${selectedPhraseGroup}-${idx}`}
                      className="rounded-lg bg-slate-900 border border-slate-800 px-2.5 py-1.5 text-[11px]"
                    >
                      {editingPhrase && editingPhrase.index === idx ? (
                        <div className="flex gap-1.5">
                          <input
                            type="text"
                            value={editingPhrase.text}
                            onChange={(e) =>
                              setEditingPhrase({ index: idx, text: e.target.value })
                            }
                            className="flex-1 bg-slate-950 border border-cyan-500 rounded px-2 py-1 text-white outline-none"
                          />
                          <button
                            type="button"
                            onClick={handleSaveEditPhrase}
                            className="px-2 py-1 rounded bg-emerald-600 text-white font-bold cursor-pointer"
                          >
                            Lưu
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingPhrase(null)}
                            className="px-2 py-1 rounded bg-slate-700 text-slate-200 cursor-pointer"
                          >
                            Huỷ
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-slate-200 leading-snug">{text}</span>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => setEditingPhrase({ index: idx, text })}
                              className="p-1 rounded hover:bg-slate-800 text-cyan-400 cursor-pointer"
                              title="Sửa câu"
                            >
                              <Edit3 className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                sendCommand("phrase_delete", {
                                  group: selectedPhraseGroup,
                                  index: idx,
                                })
                              }
                              className="p-1 rounded hover:bg-slate-800 text-rose-400 cursor-pointer"
                              title="Xoá câu"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={newPhraseText}
                    onChange={(e) => setNewPhraseText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddPhrase();
                    }}
                    placeholder="Thêm câu thoại mới (dùng {name}, {item}, {points}...)"
                    className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none focus:border-cyan-500"
                  />
                  <button
                    type="button"
                    onClick={handleAddPhrase}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-xs font-bold text-white cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Thêm
                  </button>
                </div>
              </div>
            </section>

            {/* ======================================================== PHÂN KHU 5: GAME BALANCE */}
            <section className="rounded-2xl bg-slate-900/90 border border-slate-800 p-4 space-y-3.5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-extrabold uppercase tracking-wider text-sky-300 flex items-center gap-2">
                  <Sliders className="w-4 h-4" />
                  5. Game Balance (Áp dụng tức thì)
                </h2>
                <span
                  className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${
                    isGachaValid
                      ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                      : "bg-rose-500/15 border-rose-500/40 text-rose-300"
                  }`}
                >
                  Tổng Gacha: {gachaTotal}% {isGachaValid ? "✓" : "(Phải = 100%)"}
                </span>
              </div>

              {/* 4 tỷ lệ Gacha */}
              <div className="grid grid-cols-4 gap-2 text-xs">
                {(
                  [
                    ["normal", "Cá thường (%)"],
                    ["rare", "Cá hiếm (%)"],
                    ["chest", "Rương (%)"],
                    ["troll", "Đồ troll (%)"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="block bg-slate-950 border border-slate-800 rounded-xl p-2">
                    <span className="block text-[10px] text-slate-400 mb-1">{label}</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={balanceForm.gacha[key]}
                      onChange={(e) => handleGachaChange(key, Number(e.target.value))}
                      className="w-full bg-transparent text-sm font-bold text-white outline-none"
                    />
                  </label>
                ))}
              </div>

              {/* Thông số Boss & Fever */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                <label className="block bg-slate-950 border border-slate-800 rounded-xl p-2">
                  <span className="block text-[10px] text-slate-400 mb-1">Máu Boss (HP)</span>
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
                    className="w-full bg-transparent text-sm font-bold text-white outline-none"
                  />
                </label>

                <label className="block bg-slate-950 border border-slate-800 rounded-xl p-2">
                  <span className="block text-[10px] text-slate-400 mb-1">Chu kỳ Boss (phút)</span>
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
                    className="w-full bg-transparent text-sm font-bold text-white outline-none"
                  />
                </label>

                <label className="block bg-slate-950 border border-slate-800 rounded-xl p-2">
                  <span className="block text-[10px] text-slate-400 mb-1">Thời gian Boss (s)</span>
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
                    className="w-full bg-transparent text-sm font-bold text-white outline-none"
                  />
                </label>

                <label className="block bg-slate-950 border border-slate-800 rounded-xl p-2">
                  <span className="block text-[10px] text-slate-400 mb-1">Ngưỡng xu gọi Boss</span>
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
                    className="w-full bg-transparent text-sm font-bold text-white outline-none"
                  />
                </label>

                <label className="block bg-slate-950 border border-slate-800 rounded-xl p-2">
                  <span className="block text-[10px] text-slate-400 mb-1">Ngưỡng tim Fever</span>
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
                    className="w-full bg-transparent text-sm font-bold text-white outline-none"
                  />
                </label>

                <label className="block bg-slate-950 border border-slate-800 rounded-xl p-2">
                  <span className="block text-[10px] text-slate-400 mb-1">Thời lượng Fever (s)</span>
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
                    className="w-full bg-transparent text-sm font-bold text-white outline-none"
                  />
                </label>
              </div>

              <button
                type="button"
                disabled={!isGachaValid || !connected}
                onClick={handleSaveBalance}
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-xs font-extrabold text-white transition cursor-pointer"
              >
                <Save className="w-4 h-4" />
                Lưu &amp; Áp dụng ngay lập tức
              </button>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
