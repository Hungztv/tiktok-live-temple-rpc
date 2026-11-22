"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, MonitorPlay, Settings2, Sparkles, Volume2 } from "lucide-react";
import { getDefaultBackendHttpUrl } from "@/lib/useGameSocket";

export default function HomePage() {
  const [backendOk, setBackendOk] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const res = await fetch(`${getDefaultBackendHttpUrl()}/health`, { cache: "no-store" });
        if (!active) return;
        setBackendOk(res.ok);
      } catch {
        if (active) setBackendOk(false);
      }
    };
    void check();
    const timer = window.setInterval(check, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-950 via-sky-950/40 to-slate-950 flex items-center justify-center p-6">
      <div className="max-w-4xl w-full space-y-8">
        <div className="text-center space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs font-medium">
            <Sparkles className="w-3.5 h-3.5" />
            TikTok Interactive Live Fishing Game &amp; AI Caster
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight bg-gradient-to-r from-cyan-300 via-sky-200 to-amber-300 bg-clip-text text-transparent">
            Đại Chiến Thủy Cung
          </h1>
          <p className="text-slate-400 max-w-xl mx-auto text-sm">
            Chọn màn hình hiển thị livestream cho OBS Studio (9:16) hoặc bảng điều khiển quản trị cho Host (16:9).
          </p>
          <div className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800">
            <Activity
              className={`w-3.5 h-3.5 ${
                backendOk === true
                  ? "text-emerald-400"
                  : backendOk === false
                  ? "text-rose-400"
                  : "text-amber-400 animate-pulse"
              }`}
            />
            <span className="text-slate-300">
              Backend API:{" "}
              {backendOk === true
                ? "Đang hoạt động (127.0.0.1:8000)"
                : backendOk === false
                ? "Chưa kết nối được — hãy khởi động backend"
                : "Đang kiểm tra..."}
            </span>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <Link
            href="/overlay"
            className="group rounded-2xl bg-slate-900/80 border border-slate-800 hover:border-cyan-500/60 p-6 transition-all hover:-translate-y-0.5 flex flex-col justify-between gap-4"
          >
            <div className="space-y-3">
              <div className="w-11 h-11 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-300">
                <MonitorPlay className="w-6 h-6" />
              </div>
              <h2 className="text-xl font-bold text-white group-hover:text-cyan-300 transition-colors">
                Màn Hình Overlay (9:16)
              </h2>
              <p className="text-sm text-slate-400">
                Khung game Canvas 1080×1920 sắc nét, Boss Kraken, hiệu ứng quà tặng và AI Caster nhép miệng thời gian thực.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-slate-400 pt-2 border-t border-slate-800/80">
              <span className="px-2 py-0.5 rounded bg-slate-800 text-cyan-300">/overlay</span>
              <span className="px-2 py-0.5 rounded bg-slate-800">?transparent=1 (OBS)</span>
              <span className="px-2 py-0.5 rounded bg-slate-800">?debug=1</span>
            </div>
          </Link>

          <Link
            href="/dashboard"
            className="group rounded-2xl bg-slate-900/80 border border-slate-800 hover:border-amber-500/60 p-6 transition-all hover:-translate-y-0.5 flex flex-col justify-between gap-4"
          >
            <div className="space-y-3">
              <div className="w-11 h-11 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-300">
                <Settings2 className="w-6 h-6" />
              </div>
              <h2 className="text-xl font-bold text-white group-hover:text-amber-300 transition-colors">
                Bảng Điều Khiển Admin (16:9)
              </h2>
              <p className="text-sm text-slate-400">
                Kết nối TikTok Live, God-Mode giả lập sự kiện, Studio giọng đọc AI Caster, quản lý người chơi &amp; cân bằng Gacha.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-slate-400 pt-2 border-t border-slate-800/80">
              <span className="px-2 py-0.5 rounded bg-slate-800 text-amber-300">/dashboard</span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800">
                <Volume2 className="w-3 h-3" /> Web Audio + Edge TTS
              </span>
            </div>
          </Link>
        </div>
      </div>
    </main>
  );
}
