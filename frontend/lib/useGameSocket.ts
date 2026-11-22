"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AdminAction,
  AdminActionMap,
  BannerData,
  BossState,
  ClientRole,
  CommandResultData,
  FeverState,
  LogEntry,
  ServerMessage,
  StateSyncData,
  TtsQueueItem,
} from "./types";

const MAX_LOGS = 150;
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 5000;

export function getDefaultBackendHttpUrl(): string {
  if (process.env.NEXT_PUBLIC_BACKEND_URL) {
    return process.env.NEXT_PUBLIC_BACKEND_URL.replace(/\/$/, "");
  }
  if (typeof window !== "undefined") {
    const host = window.location.hostname || "127.0.0.1";
    return `http://${host}:8000`;
  }
  return "http://127.0.0.1:8000";
}

export function getDefaultWsUrl(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) {
    return process.env.NEXT_PUBLIC_WS_URL;
  }
  if (typeof window !== "undefined") {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.hostname || "127.0.0.1";
    return `${proto}//${host}:8000/ws/game`;
  }
  return "ws://127.0.0.1:8000/ws/game";
}

export type MessageListener = (msg: ServerMessage) => void;

export interface UseGameSocketReturn {
  connected: boolean;
  reconnecting: boolean;
  state: StateSyncData | null;
  logs: LogEntry[];
  ttsQueue: TtsQueueItem[];
  lastResult: CommandResultData | null;
  activeBanner: BannerData | null;
  clearBanner: () => void;
  sendCommand: <A extends AdminAction>(action: A, params: AdminActionMap[A]) => boolean;
  sendTtsFinished: (id: string) => void;
  subscribe: (listener: MessageListener) => () => void;
}

export function useGameSocket(role: ClientRole): UseGameSocketReturn {
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [state, setState] = useState<StateSyncData | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [ttsQueue, setTtsQueue] = useState<TtsQueueItem[]>([]);
  const [lastResult, setLastResult] = useState<CommandResultData | null>(null);
  const [activeBanner, setActiveBanner] = useState<BannerData | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef<Set<MessageListener>>(new Set());
  const retryRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const bannerTimerRef = useRef<number | null>(null);
  const unmountedRef = useRef(false);

  const subscribe = useCallback((listener: MessageListener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const clearBanner = useCallback(() => {
    setActiveBanner(null);
  }, []);

  const sendRaw = useCallback((type: string, data: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ type, ts: Date.now(), data }));
    return true;
  }, []);

  const sendCommand = useCallback(
    <A extends AdminAction>(action: A, params: AdminActionMap[A]): boolean => {
      return sendRaw("ADMIN_COMMAND", { action, params });
    },
    [sendRaw]
  );

  const sendTtsFinished = useCallback(
    (id: string) => {
      sendRaw("TTS_FINISHED", { id });
    },
    [sendRaw]
  );

  useEffect(() => {
    unmountedRef.current = false;

    const connect = () => {
      if (unmountedRef.current) return;
      const ws = new WebSocket(getDefaultWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        if (unmountedRef.current) {
          ws.close();
          return;
        }
        retryRef.current = 0;
        setConnected(true);
        setReconnecting(false);
        ws.send(JSON.stringify({ type: "CLIENT_HELLO", ts: Date.now(), data: { role } }));
      };

      ws.onmessage = (ev) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(String(ev.data)) as ServerMessage;
        } catch {
          return;
        }

        if (msg.type === "PING") {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "PONG", ts: Date.now(), data: {} }));
          }
          return;
        }

        // Gọi các subscriber tần suất cao (Canvas renderer, sound, caster) trước
        for (const fn of listenersRef.current) {
          fn(msg);
        }

        switch (msg.type) {
          case "STATE_SYNC":
            setState(msg.data);
            break;

          case "FEVER_UPDATE":
            setState((prev) => (prev ? { ...prev, fever: msg.data as FeverState } : prev));
            break;

          case "BOSS_UPDATE": {
            const b = msg.data as BossState;
            setState((prev) => {
              if (!prev) return prev;
              const nextBoss = b.status === "DEFEATED" || b.status === "ESCAPED" ? null : b;
              return { ...prev, boss: nextBoss };
            });
            break;
          }

          case "LEADERBOARD_UPDATE":
            setState((prev) => (prev ? { ...prev, top3: msg.data.top3 } : prev));
            break;

          case "PLAYER_JOINED": {
            const joined = msg.data;
            setState((prev) => {
              if (!prev) return prev;
              const filtered = prev.players_on_shore.filter(
                (p) => p.player_id !== joined.player_id
              );
              const updated = [joined, ...filtered].slice(0, 15);
              return {
                ...prev,
                players_on_shore: updated,
                stats: {
                  ...prev.stats,
                  active_players: Math.max(prev.stats.active_players, updated.length),
                },
              };
            });
            break;
          }

          case "PLAYER_LEFT": {
            const leftId = msg.data.player_id;
            setState((prev) => {
              if (!prev) return prev;
              const nextShore = prev.players_on_shore.filter((p) => p.player_id !== leftId);
              return {
                ...prev,
                players_on_shore: nextShore,
                stats: {
                  ...prev.stats,
                  active_players: Math.max(0, prev.stats.active_players - 1),
                },
              };
            });
            break;
          }

          case "FISH_CAUGHT": {
            const caught = msg.data;
            setState((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                players_on_shore: prev.players_on_shore.map((p) =>
                  p.player_id === caught.player_id
                    ? { ...p, score: p.score + caught.points }
                    : p
                ),
              };
            });
            break;
          }

          case "GIFT_EFFECT": {
            const gift = msg.data;
            setState((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                stats: { ...prev.stats, total_coins: prev.stats.total_coins + gift.coins },
                players_on_shore: prev.players_on_shore.map((p) =>
                  p.player_id === gift.player_id
                    ? {
                        ...p,
                        score: p.score + gift.bonus_points,
                        rod_level: gift.new_rod_level,
                      }
                    : p
                ),
              };
            });
            break;
          }

          case "TIKTOK_STATUS":
            setState((prev) =>
              prev
                ? {
                    ...prev,
                    stats: {
                      ...prev.stats,
                      tiktok_status: msg.data.status,
                      connected_username: msg.data.connected_username,
                    },
                  }
                : prev
            );
            break;

          case "BANNER":
            setActiveBanner(msg.data);
            if (bannerTimerRef.current !== null) {
              window.clearTimeout(bannerTimerRef.current);
            }
            bannerTimerRef.current = window.setTimeout(() => {
              setActiveBanner(null);
            }, 3800);
            break;

          case "TTS_QUEUE_UPDATE":
            setTtsQueue(msg.data.items);
            break;

          case "LOG":
            setLogs((prev) => [msg.data, ...prev].slice(0, MAX_LOGS));
            break;

          case "COMMAND_RESULT":
            setLastResult({ ...msg.data });
            break;

          default:
            break;
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        setConnected(false);
        if (unmountedRef.current) return;
        setReconnecting(true);
        const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * Math.pow(2, retryRef.current));
        retryRef.current += 1;
        reconnectTimerRef.current = window.setTimeout(connect, delay);
      };

      ws.onerror = () => {
        // onclose sẽ tự xử lý reconnect
      };
    };

    connect();

    return () => {
      unmountedRef.current = true;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      if (bannerTimerRef.current !== null) {
        window.clearTimeout(bannerTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [role]);

  return {
    connected,
    reconnecting,
    state,
    logs,
    ttsQueue,
    lastResult,
    activeBanner,
    clearBanner,
    sendCommand,
    sendTtsFinished,
    subscribe,
  };
}
