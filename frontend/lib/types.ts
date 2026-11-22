/**
 * Định nghĩa toàn bộ kiểu dữ liệu giao tiếp giữa Frontend và Backend.
 * Phải khớp hoàn toàn với schemas.py và game_engine.py ở backend.
 */

export type ClientRole = "overlay" | "dashboard";

export type TikTokStatus =
  | "DISCONNECTED"
  | "CONNECTING"
  | "CONNECTED"
  | "OFFLINE_ROOM"
  | "ERROR";

export type TtsVoice = "vi-VN-HoaiMyNeural" | "vi-VN-NamMinhNeural";

export interface GachaRates {
  normal: number;
  rare: number;
  chest: number;
  troll: number;
}

export interface TtsSettings {
  enabled: boolean;
  voice: TtsVoice;
  rate: number;
  pitch: number;
}

export interface PublicGameSettings {
  gacha: GachaRates;
  boss_max_hp: number;
  boss_interval_minutes: number;
  boss_duration_seconds: number;
  boss_summon_gift_threshold: number;
  fever_threshold: number;
  fever_duration_seconds: number;
  auto_bot_enabled: boolean;
  auto_bot_min_players: number;
  auto_bot_action_interval_seconds: number;
}

export interface FullGameSettings extends PublicGameSettings {
  tts: TtsSettings;
  phrases: Record<string, string[]>;
}

export interface PlayerOnShore {
  player_id: number;
  tiktok_unique_id: string;
  nickname: string;
  avatar_url: string;
  score: number;
  rod_level: number;
  rod_name: string;
  lucky_bait_count: number;
}

export interface PlayerRecord extends PlayerOnShore {
  gold: number;
  total_gift_coins: number;
  on_shore: boolean;
}

export interface Top3Entry {
  player_id: number;
  nickname: string;
  avatar_url: string;
  score: number;
  rod_level: number;
}

export interface FeverState {
  heat: number;
  max: number;
  active: boolean;
  ends_at: number | null;
}

export type BossStatus = "SPAWNED" | "HIT" | "DEFEATED" | "ESCAPED";

export interface BossPlayerSummary {
  player_id: number;
  nickname: string;
  damage: number;
}

export interface BossState {
  status: BossStatus;
  current_hp: number;
  max_hp: number;
  ends_at: number;
  attacker_id?: number;
  damage?: number;
  mvp_player?: BossPlayerSummary | null;
  lasthit_player?: BossPlayerSummary | null;
}

export interface StatsState {
  active_players: number;
  total_likes: number;
  total_coins: number;
  tiktok_status: TikTokStatus;
  connected_username: string;
}

export interface StateSyncData {
  players_on_shore: PlayerOnShore[];
  top3: Top3Entry[];
  fever: FeverState;
  boss: BossState | null;
  stats: StatsState;
  tts_settings: TtsSettings;
  game_settings: PublicGameSettings;
}

export interface FishCaughtData {
  player_id: number;
  nickname: string;
  item_type: "normal" | "rare" | "chest" | "troll";
  item_name: string;
  points: number;
  is_troll: boolean;
  is_chest: boolean;
  chest_result: "DOUBLE" | "BOMB" | null;
  rod_level?: number;
}

export type GiftEffectType = "ELECTRIC_NET" | "UPGRADE_ROD" | "TRAWLER_SHIP";

export interface GiftEffectData {
  player_id: number;
  nickname: string;
  gift_name: string;
  coins: number;
  effect_type: GiftEffectType;
  new_rod_level: number;
  bonus_points: number;
  caught_fish_ids: string[];
}

export interface PlayerLeftData {
  player_id: number;
  nickname: string;
  reason: string;
}

export interface ChatBubbleData {
  player_id: number;
  nickname: string;
  score: number;
  rod_name: string;
  text: string;
}

export interface BannerData {
  kind: string;
  title: string;
  subtitle: string;
  player_id: number | null;
  nickname: string | null;
}

export interface TikTokStatusData {
  status: TikTokStatus;
  connected_username: string;
  message: string;
}

export interface TtsSpeakData {
  id: string;
  priority: number;
  text: string;
  audio_base64: string;
  mime: string;
  duration_ms: number;
}

export interface TtsQueueItem {
  id: string;
  priority: number;
  text: string;
  group: string;
  player_id: number | null;
}

export interface TtsQueueUpdateData {
  items: TtsQueueItem[];
}

export interface LogEntry {
  id: number;
  timestamp: string;
  type: string;
  message: string;
  payload: Record<string, unknown>;
}

export interface CommandResultData {
  ok: boolean;
  action: string;
  message?: string | null;
  error?: string | null;
}

// ---------------------------------------------------------------- Envelope & Lệnh Admin
export interface WsEnvelope<T extends string = string, D = Record<string, unknown>> {
  type: T;
  ts: number;
  data: D;
}

export type ServerMessage =
  | WsEnvelope<"STATE_SYNC", StateSyncData>
  | WsEnvelope<"FISH_CAUGHT", FishCaughtData>
  | WsEnvelope<"GIFT_EFFECT", GiftEffectData>
  | WsEnvelope<"BOSS_UPDATE", BossState>
  | WsEnvelope<"FEVER_UPDATE", FeverState>
  | WsEnvelope<"LEADERBOARD_UPDATE", { top3: Top3Entry[] }>
  | WsEnvelope<"PLAYER_JOINED", PlayerOnShore>
  | WsEnvelope<"PLAYER_LEFT", PlayerLeftData>
  | WsEnvelope<"CHAT_BUBBLE", ChatBubbleData>
  | WsEnvelope<"BANNER", BannerData>
  | WsEnvelope<"TIKTOK_STATUS", TikTokStatusData>
  | WsEnvelope<"TTS_SPEAK", TtsSpeakData>
  | WsEnvelope<"TTS_QUEUE_UPDATE", TtsQueueUpdateData>
  | WsEnvelope<"LOG", LogEntry>
  | WsEnvelope<"COMMAND_RESULT", CommandResultData>
  | WsEnvelope<"PING", Record<string, never>>
  | WsEnvelope<"PONG", Record<string, never>>;

export type AdminActionMap = {
  connect_tiktok: { username: string };
  disconnect_tiktok: Record<string, never>;
  spawn_players: { count: number };
  mock_event: {
    kind: "comment" | "like" | "follow" | "gift";
    user_id?: string;
    nickname?: string;
    text?: string;
    count?: number;
    gift?: "rose" | "ice_cream" | "lion" | "universe";
    repeat_count?: number;
    streaking?: boolean;
    group_id?: string;
  };
  summon_boss: Record<string, never>;
  trigger_fever: Record<string, never>;
  reset_lake: Record<string, never>;
  tts_toggle: { enabled?: boolean };
  tts_config: { voice?: TtsVoice; rate?: number; pitch?: number };
  tts_speak_now: { text: string };
  tts_clear_queue: Record<string, never>;
  phrase_upsert: { group: string; text: string; index?: number };
  phrase_delete: { group: string; index: number };
  player_adjust: { player_id: number; score_delta: number; rod_level?: number };
  player_kick: { player_id: number };
  reset_season: { confirm: boolean };
  settings_update: Partial<PublicGameSettings>;
};

export type AdminAction = keyof AdminActionMap;
