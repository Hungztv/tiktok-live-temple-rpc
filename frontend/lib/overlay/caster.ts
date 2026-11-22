/**
 * AI Caster (góc dưới phải Canvas 1080x1920):
 * - Nhân vật chibi đeo tai nghe cầm micro ngồi ở bàn bình luận.
 * - Nhép miệng theo biên độ thực tế từ AnalyserNode (khi phát MP3)
 *   hoặc nhép miệng theo hàm sóng sin giả lập trong thời gian duration_ms (khi fallback).
 * - Hộp phụ đề (Subtitle) nổi bật tự động ngắt dòng tiếng Việt.
 */

import type { TtsSpeakData } from "@/lib/types";
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "./entities";

export interface ActiveBroadcast {
  id: string;
  priority: number;
  text: string;
  durationMs: number;
  elapsedMs: number;
  isFallback: boolean;
}

function drawRoundedBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function wrapVietnameseText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const w of words) {
    const test = current ? `${current} ${w}` : w;
    if (ctx.measureText(test).width <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 3);
}

export class AICasterController {
  public current: ActiveBroadcast | null = null;
  public mouthOpen = 0; // 0 (đóng) -> 1 (mở to)
  private animTime = 0;

  public startSpeech(data: TtsSpeakData, isFallback: boolean): void {
    this.current = {
      id: data.id,
      priority: data.priority,
      text: data.text,
      durationMs: Math.max(1500, data.duration_ms),
      elapsedMs: 0,
      isFallback,
    };
  }

  public stopSpeech(id?: string): void {
    if (!id || (this.current && this.current.id === id)) {
      this.current = null;
      this.mouthOpen = 0;
    }
  }

  public update(dt: number, analyserAmplitude: number): void {
    const safeDt = Math.min(0.05, Math.max(0.001, dt));
    this.animTime += safeDt;

    if (!this.current) {
      this.mouthOpen = Math.max(0, this.mouthOpen - safeDt * 6);
      return;
    }

    this.current.elapsedMs += safeDt * 1000;

    if (this.current.isFallback || analyserAmplitude <= 0.01) {
      // Nhép miệng bằng hàm sóng sin giả lập trong suốt duration_ms
      const t = this.animTime;
      const wave =
        Math.abs(Math.sin(t * 15.5)) * 0.65 +
        Math.abs(Math.cos(t * 9.2)) * 0.35;
      this.mouthOpen = Math.min(1, Math.max(0.08, wave));
    } else {
      // Nhép miệng theo biên độ thực tế của AnalyserNode
      const target = Math.min(1, analyserAmplitude * 1.45);
      this.mouthOpen += (target - this.mouthOpen) * Math.min(1, safeDt * 22);
    }

    if (this.current.elapsedMs >= this.current.durationMs + 400) {
      this.current = null;
      this.mouthOpen = 0;
    }
  }

  public draw(ctx: CanvasRenderingContext2D): void {
    const casterX = CANVAS_WIDTH - 135;
    const casterY = CANVAS_HEIGHT - 135;
    const speaking = this.current !== null;
    const bounce = speaking ? Math.sin(this.animTime * 9) * 4 : Math.sin(this.animTime * 2.2) * 2;

    ctx.save();

    // 1. Hộp phụ đề nổi bật bên trái bàn bình luận khi đang nói
    if (this.current) {
      this.drawSubtitleBox(ctx, casterX, casterY);
    }

    // 2. Nhân vật Chibi AI Caster cầm micro ở bàn bình luận
    ctx.translate(casterX, casterY + bounce);

    // Vòng hào quang phát sóng phía sau Caster
    if (speaking) {
      ctx.strokeStyle = "rgba(34, 211, 238, 0.45)";
      ctx.lineWidth = 3;
      const ringRadius = 72 + (this.animTime * 40) % 28;
      ctx.beginPath();
      ctx.arc(0, -25, ringRadius, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Thân áo vest studio
    ctx.fillStyle = "#1e1b4b";
    drawRoundedBox(ctx, -44, -22, 88, 62, 18);
    ctx.fill();
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Cà vạt phát sáng
    ctx.fillStyle = "#f43f5e";
    ctx.beginPath();
    ctx.moveTo(0, -18);
    ctx.lineTo(-8, 12);
    ctx.lineTo(0, 22);
    ctx.lineTo(8, 12);
    ctx.closePath();
    ctx.fill();

    // Vòng cung tai nghe Headphone
    ctx.strokeStyle = "#22d3ee";
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(0, -58, 48, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();

    // Chụp tai nghe 2 bên
    ctx.fillStyle = "#06b6d4";
    drawRoundedBox(ctx, -56, -68, 14, 28, 6);
    ctx.fill();
    drawRoundedBox(ctx, 42, -68, 14, 28, 6);
    ctx.fill();

    // Khuôn mặt Chibi
    ctx.fillStyle = "#fde68a";
    ctx.beginPath();
    ctx.arc(0, -55, 42, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 3;
    ctx.stroke();

    // Tóc mái chibi
    ctx.fillStyle = "#0284c7";
    ctx.beginPath();
    ctx.arc(0, -65, 41, Math.PI * 1.08, Math.PI * 1.92);
    ctx.closePath();
    ctx.fill();

    // Đôi mắt biểu cảm (chớp mắt tự nhiên)
    const blink = Math.sin(this.animTime * 1.7) > 0.96;
    ctx.fillStyle = "#0f172a";
    for (const ex of [-15, 15]) {
      if (blink) {
        ctx.fillRect(ex - 7, -58, 14, 3);
      } else {
        ctx.beginPath();
        ctx.arc(ex, -58, 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(ex - 1.5, -60, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#0f172a";
      }
    }

    // Má hồng
    ctx.fillStyle = "rgba(244, 63, 94, 0.45)";
    ctx.beginPath();
    ctx.ellipse(-24, -47, 7, 4, 0, 0, Math.PI * 2);
    ctx.ellipse(24, -47, 7, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Miệng nhép theo biên độ âm thanh (mouthOpen: 0..1)
    const openH = 3 + this.mouthOpen * 16;
    const openW = 10 + this.mouthOpen * 8;
    ctx.fillStyle = "#881337";
    ctx.beginPath();
    ctx.ellipse(0, -39, openW, openH, 0, 0, Math.PI * 2);
    ctx.fill();
    if (this.mouthOpen > 0.25) {
      ctx.fillStyle = "#fb7185";
      ctx.beginPath();
      ctx.ellipse(0, -35, openW * 0.6, openH * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Tay cầm Micro thu âm chuyên nghiệp
    ctx.save();
    ctx.translate(-34, -18);
    ctx.rotate(-0.35);
    ctx.fillStyle = "#334155";
    drawRoundedBox(ctx, -5, -18, 10, 26, 4);
    ctx.fill();
    ctx.fillStyle = speaking ? "#facc15" : "#94a3b8";
    ctx.beginPath();
    ctx.arc(0, -22, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Bàn bình luận Studio phía trước
    ctx.fillStyle = "#0f172a";
    drawRoundedBox(ctx, -78, 22, 156, 36, 10);
    ctx.fill();
    ctx.strokeStyle = speaking ? "#facc15" : "#38bdf8";
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.fillStyle = speaking ? "#fde047" : "#38bdf8";
    ctx.font = "900 13px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(speaking ? "🎙️ ON AIR · AI CASTER" : "🎙️ AI CASTER", 0, 40);

    ctx.restore();
  }

  private drawSubtitleBox(
    ctx: CanvasRenderingContext2D,
    casterX: number,
    casterY: number
  ): void {
    const cur = this.current;
    if (!cur) return;

    const boxX = 28;
    const boxW = casterX - 115;
    const boxH = 128;
    const boxY = casterY - 72;

    const borderColor =
      cur.priority <= 1 ? "#f43f5e" : cur.priority === 2 ? "#facc15" : "#22d3ee";
    const badgeLabel =
      cur.priority === 0
        ? "📢 THÔNG BÁO ADMIN"
        : cur.priority === 1
        ? "🔥 CHIẾN BÁO BOSS KRAKEN"
        : cur.priority === 2
        ? "💎 VINH DANH ĐẠI GIA"
        : "🎙️ BÌNH LUẬN VIÊN AI";

    ctx.save();
    ctx.shadowColor = borderColor;
    ctx.shadowBlur = 18;
    ctx.fillStyle = "rgba(2, 6, 23, 0.92)";
    drawRoundedBox(ctx, boxX, boxY, boxW, boxH, 18);
    ctx.fill();

    ctx.lineWidth = 3;
    ctx.strokeStyle = borderColor;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Nhãn tiêu đề phụ đề
    ctx.fillStyle = borderColor;
    ctx.font = "900 15px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(badgeLabel, boxX + 20, boxY + 14);

    // Các cột sóng âm nhảy nhót ở góc phải hộp phụ đề
    for (let i = 0; i < 6; i++) {
      const barH = 6 + Math.abs(Math.sin(this.animTime * 14 + i * 1.1)) * (6 + this.mouthOpen * 14);
      ctx.fillStyle = borderColor;
      ctx.fillRect(boxX + boxW - 68 + i * 8, boxY + 28 - barH, 5, barH);
    }

    // Nội dung phụ đề tiếng Việt tự động xuống dòng
    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 22px sans-serif";
    const lines = wrapVietnameseText(ctx, cur.text, boxW - 40);
    lines.forEach((line, idx) => {
      ctx.fillText(line, boxX + 20, boxY + 42 + idx * 26);
    });

    // Thanh tiến trình thời gian đọc ở đáy hộp phụ đề
    const progress = Math.min(1, cur.elapsedMs / Math.max(1, cur.durationMs));
    ctx.fillStyle = "rgba(51, 65, 85, 0.7)";
    drawRoundedBox(ctx, boxX + 18, boxY + boxH - 10, boxW - 36, 5, 3);
    ctx.fill();

    ctx.fillStyle = borderColor;
    drawRoundedBox(ctx, boxX + 18, boxY + boxH - 10, (boxW - 36) * (1 - progress), 5, 3);
    ctx.fill();

    ctx.restore();
  }
}
