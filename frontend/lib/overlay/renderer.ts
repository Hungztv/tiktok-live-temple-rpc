/**
 * Bộ dựng hình Canvas 2D (1080x1920 @ 60FPS) cho màn hình /overlay.
 * Vẽ 3 tầng đại dương, tia nắng, sóng nước, bọt khí, đàn cá, cầu cảng,
 * nhân vật chibi + avatar tròn, cần câu Lv1-4, dây câu Bezier, vật phẩm giật lên và bong bóng chat.
 */

import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  type FisherSlot,
  type OverlayWorld,
  type ReelAnimation,
  type SwimmingFish,
  WATER_SURFACE_Y,
} from "./entities";

const ROD_COLORS: Record<
  number,
  { stroke: string; glow: string; badgeBg: string; badgeText: string }
> = {
  1: { stroke: "#d97706", glow: "transparent", badgeBg: "#78350f", badgeText: "#fde68a" },
  2: { stroke: "#cbd5e1", glow: "#94a3b8", badgeBg: "#334155", badgeText: "#f1f5f9" },
  3: { stroke: "#facc15", glow: "#fde047", badgeBg: "#854d0e", badgeText: "#fef08a" },
  4: { stroke: "#22d3ee", glow: "#f43f5e", badgeBg: "#0e7490", badgeText: "#cffafe" },
};

const AVATAR_FALLBACK_COLORS = [
  "#f43f5e",
  "#8b5cf6",
  "#06b6d4",
  "#10b981",
  "#f59e0b",
  "#ec4899",
];

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function truncateName(name: string, maxChars = 11): string {
  const clean = name.trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars - 1)}…`;
}

export interface RenderOptions {
  transparent: boolean;
  nowMs: number;
  isTabHidden: boolean;
  onDrawDeepOceanExtras?: (ctx: CanvasRenderingContext2D) => void;
  onDrawForegroundExtras?: (ctx: CanvasRenderingContext2D) => void;
}

export function renderOverlayFrame(
  ctx: CanvasRenderingContext2D,
  world: OverlayWorld,
  opts: RenderOptions
): void {
  ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  // 1. Bầu trời & vùng Shoreline phía trên mặt nước
  if (!opts.transparent) {
    const skyGrad = ctx.createLinearGradient(0, 0, 0, WATER_SURFACE_Y);
    if (world.feverActive) {
      skyGrad.addColorStop(0, "#3b0764");
      skyGrad.addColorStop(0.55, "#701a75");
      skyGrad.addColorStop(1, "#f59e0b");
    } else {
      skyGrad.addColorStop(0, "#082f49");
      skyGrad.addColorStop(0.6, "#0369a1");
      skyGrad.addColorStop(1, "#38bdf8");
    }
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, CANVAS_WIDTH, WATER_SURFACE_Y + 10);
  }

  // 2. Ba tầng nước sâu (60% dưới: y = WATER_SURFACE_Y -> 1920)
  drawOceanLayers(ctx, world, opts.transparent);

  // 3. Tia sáng mặt trời chiếu xuống lòng hồ
  drawSunRays(ctx, world);

  // 4. Bọt khí đại dương
  drawBubbles(ctx, world);

  // 5. Đàn cá bơi theo 3 tầng
  for (const fish of world.fishes) {
    drawSwimmingFish(ctx, fish, world.feverActive);
  }

  // Hook cho Phase 5B (Boss Kraken ở đáy biển, Lưới điện, Tia Laser...)
  if (opts.onDrawDeepOceanExtras) {
    opts.onDrawDeepOceanExtras(ctx);
  }

  // 6. Cầu cảng / bờ hồ gỗ (Shoreline)
  drawShorelinePier(ctx, world);

  // 7. Nhân vật Chibi ngồi câu cá (vẽ hàng sau row=0 trước, hàng trước row=1 sau)
  const backRow = world.fishers.filter((f) => f.row === 0);
  const frontRow = world.fishers.filter((f) => f.row === 1);

  for (const slot of backRow) {
    drawFisherAndLine(ctx, world, slot, opts.nowMs);
  }
  for (const slot of frontRow) {
    drawFisherAndLine(ctx, world, slot, opts.nowMs);
  }

  // 8. Sóng nước mặt hồ phủ nhẹ lên dây câu tại giao điểm mặt nước
  drawWaterSurfaceWaves(ctx, world);

  // 9. Bong bóng chat (`diem` / `tui`) luôn nổi trên cùng của nhân vật
  for (const slot of world.fishers) {
    if (slot.chatBubble && opts.nowMs < slot.chatBubble.expiresAt) {
      drawChatBubble(ctx, slot, slot.chatBubble.text);
    }
  }

  // 10. Hạt Particle (nếu tab đang hiển thị) & Chữ nổi (+điểm)
  if (!opts.isTabHidden) {
    drawParticles(ctx, world);
  }
  drawFloatingTexts(ctx, world);

  // Hook cho Phase 5B (Tàu đánh cá, mưa vàng, viền báo động đỏ, AI Caster...)
  if (opts.onDrawForegroundExtras) {
    opts.onDrawForegroundExtras(ctx);
  }
}

function drawOceanLayers(
  ctx: CanvasRenderingContext2D,
  world: OverlayWorld,
  transparent: boolean
): void {
  const alphaTop = transparent ? 0.78 : 0.96;
  const alphaBottom = transparent ? 0.92 : 1.0;

  const oceanGrad = ctx.createLinearGradient(0, WATER_SURFACE_Y, 0, CANVAS_HEIGHT);
  if (world.feverActive) {
    // Nước ánh kim rực rỡ khi Fever Time
    oceanGrad.addColorStop(0, `rgba(234, 179, 8, ${alphaTop})`);
    oceanGrad.addColorStop(0.28, `rgba(14, 165, 233, ${alphaTop})`);
    oceanGrad.addColorStop(0.65, `rgba(88, 28, 135, ${alphaBottom})`);
    oceanGrad.addColorStop(1, `rgba(30, 27, 75, ${alphaBottom})`);
  } else {
    // Tầng 1 (Sunlight) -> Tầng 2 (Twilight) -> Tầng 3 (Abyssal)
    oceanGrad.addColorStop(0, `rgba(14, 165, 233, ${alphaTop})`);
    oceanGrad.addColorStop(0.32, `rgba(3, 105, 161, ${alphaTop})`);
    oceanGrad.addColorStop(0.66, `rgba(12, 74, 110, ${alphaBottom})`);
    oceanGrad.addColorStop(1, `rgba(2, 6, 23, ${alphaBottom})`);
  }

  ctx.fillStyle = oceanGrad;
  ctx.fillRect(0, WATER_SURFACE_Y, CANVAS_WIDTH, CANVAS_HEIGHT - WATER_SURFACE_Y);

  // Đường phân tầng mờ giữa 3 tầng nước
  ctx.save();
  ctx.strokeStyle = world.feverActive ? "rgba(253, 224, 71, 0.16)" : "rgba(125, 211, 252, 0.1)";
  ctx.lineWidth = 2;
  ctx.setLineDash([14, 14]);
  for (const y of [1120, 1510]) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(CANVAS_WIDTH, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSunRays(ctx: CanvasRenderingContext2D, world: OverlayWorld): void {
  ctx.save();
  const rayCount = 5;
  for (let i = 0; i < rayCount; i++) {
    const baseX = 140 + i * 210 + Math.sin(world.waterTime * 0.6 + i) * 35;
    const topWidth = 65;
    const bottomWidth = 175;
    const rayHeight = 820;

    const grad = ctx.createLinearGradient(
      baseX,
      WATER_SURFACE_Y,
      baseX,
      WATER_SURFACE_Y + rayHeight
    );
    if (world.feverActive) {
      grad.addColorStop(0, "rgba(254, 240, 138, 0.24)");
      grad.addColorStop(1, "rgba(254, 240, 138, 0)");
    } else {
      grad.addColorStop(0, "rgba(186, 230, 253, 0.18)");
      grad.addColorStop(1, "rgba(186, 230, 253, 0)");
    }

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(baseX - topWidth / 2, WATER_SURFACE_Y);
    ctx.lineTo(baseX + topWidth / 2, WATER_SURFACE_Y);
    ctx.lineTo(baseX + bottomWidth / 2 + 45, WATER_SURFACE_Y + rayHeight);
    ctx.lineTo(baseX - bottomWidth / 2 + 45, WATER_SURFACE_Y + rayHeight);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawBubbles(ctx: CanvasRenderingContext2D, world: OverlayWorld): void {
  ctx.save();
  for (const b of world.bubbles) {
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(224, 242, 254, ${b.alpha * 0.45})`;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = `rgba(224, 242, 254, ${b.alpha})`;
    ctx.stroke();
  }
  ctx.restore();
}

function drawSwimmingFish(
  ctx: CanvasRenderingContext2D,
  fish: SwimmingFish,
  feverActive: boolean
): void {
  ctx.save();
  ctx.translate(fish.x, fish.y);
  ctx.scale(fish.direction, 1);

  const s = fish.size;
  const tailSwing = Math.sin(fish.tailPhase) * (s * 0.22);

  if (fish.kind === "rare" || feverActive) {
    ctx.shadowColor = feverActive ? "#fde047" : fish.bodyColor;
    ctx.shadowBlur = 14;
  }

  // Đuôi cá vẫy
  ctx.fillStyle = fish.finColor;
  ctx.beginPath();
  ctx.moveTo(-s * 0.75, 0);
  ctx.lineTo(-s * 1.35, -s * 0.55 + tailSwing);
  ctx.lineTo(-s * 1.15, tailSwing * 0.3);
  ctx.lineTo(-s * 1.35, s * 0.55 + tailSwing);
  ctx.closePath();
  ctx.fill();

  // Vây lưng & vây bụng
  ctx.beginPath();
  ctx.moveTo(-s * 0.2, -s * 0.45);
  ctx.quadraticCurveTo(0, -s * 0.85, s * 0.25, -s * 0.42);
  ctx.closePath();
  ctx.fill();

  // Thân cá
  ctx.fillStyle = fish.bodyColor;
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.95, s * 0.52, 0, 0, Math.PI * 2);
  ctx.fill();

  // Bụng sáng
  ctx.fillStyle = "rgba(255,255,255,0.28)";
  ctx.beginPath();
  ctx.ellipse(s * 0.05, s * 0.16, s * 0.65, s * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();

  // Mắt cá
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(s * 0.48, -s * 0.12, s * 0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#0f172a";
  ctx.beginPath();
  ctx.arc(s * 0.52, -s * 0.12, s * 0.08, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawShorelinePier(ctx: CanvasRenderingContext2D, world: OverlayWorld): void {
  ctx.save();

  // Bờ cỏ xa phía sau cầu cảng
  const bankGrad = ctx.createLinearGradient(0, 520, 0, WATER_SURFACE_Y);
  bankGrad.addColorStop(0, "#064e3b");
  bankGrad.addColorStop(0.45, "#047857");
  bankGrad.addColorStop(1, "#78350f");
  ctx.fillStyle = bankGrad;
  ctx.beginPath();
  ctx.moveTo(0, 560);
  ctx.quadraticCurveTo(CANVAS_WIDTH * 0.5, 535, CANVAS_WIDTH, 560);
  ctx.lineTo(CANVAS_WIDTH, WATER_SURFACE_Y);
  ctx.lineTo(0, WATER_SURFACE_Y);
  ctx.closePath();
  ctx.fill();

  // Cọc gỗ cắm xuống mặt nước
  ctx.fillStyle = "#451a03";
  for (let x = 75; x <= CANVAS_WIDTH - 65; x += 155) {
    ctx.fillRect(x - 12, 565, 24, WATER_SURFACE_Y - 545);
  }

  // Sàn cầu cảng tầng sau (cho hàng ghế row = 0)
  ctx.fillStyle = "#92400e";
  drawRoundedRect(ctx, 30, 580, CANVAS_WIDTH - 60, 26, 8);
  ctx.fill();
  ctx.strokeStyle = "#451a03";
  ctx.lineWidth = 3;
  ctx.stroke();

  // Sàn cầu cảng chính sát mặt nước (cho hàng ghế row = 1)
  ctx.fillStyle = world.feverActive ? "#b45309" : "#78350f";
  drawRoundedRect(ctx, 20, 678, CANVAS_WIDTH - 40, 34, 10);
  ctx.fill();
  ctx.strokeStyle = "#451a03";
  ctx.lineWidth = 3;
  ctx.stroke();

  // Vân ván gỗ trên cầu cảng
  ctx.strokeStyle = "rgba(69, 26, 3, 0.55)";
  ctx.lineWidth = 2;
  for (let x = 60; x < CANVAS_WIDTH - 40; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, 678);
    ctx.lineTo(x, 712);
    ctx.stroke();
  }

  ctx.restore();
}

function drawWaterSurfaceWaves(ctx: CanvasRenderingContext2D, world: OverlayWorld): void {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, WATER_SURFACE_Y);
  for (let x = 0; x <= CANVAS_WIDTH; x += 24) {
    const wave =
      Math.sin(x * 0.018 + world.waterTime * 2.5) * 6 +
      Math.cos(x * 0.032 - world.waterTime * 1.8) * 4;
    ctx.lineTo(x, WATER_SURFACE_Y + wave);
  }
  ctx.lineTo(CANVAS_WIDTH, WATER_SURFACE_Y + 26);
  ctx.lineTo(0, WATER_SURFACE_Y + 26);
  ctx.closePath();

  const waveGrad = ctx.createLinearGradient(0, WATER_SURFACE_Y - 8, 0, WATER_SURFACE_Y + 26);
  if (world.feverActive) {
    waveGrad.addColorStop(0, "rgba(254, 240, 138, 0.85)");
    waveGrad.addColorStop(1, "rgba(234, 179, 8, 0)");
  } else {
    waveGrad.addColorStop(0, "rgba(186, 230, 253, 0.78)");
    waveGrad.addColorStop(1, "rgba(14, 165, 233, 0)");
  }
  ctx.fillStyle = waveGrad;
  ctx.fill();
  ctx.restore();
}

function drawFisherAndLine(
  ctx: CanvasRenderingContext2D,
  world: OverlayWorld,
  slot: FisherSlot,
  nowMs: number
): void {
  const { player, x, y, rodTipX, rodTipY, hookX, hookY } = slot;
  const rodStyle = ROD_COLORS[player.rod_level] ?? ROD_COLORS[1];
  const facingRight = x < CANVAS_WIDTH * 0.5;
  const dir = facingRight ? 1 : -1;

  ctx.save();

  // 1. Dây câu Bezier từ đầu cần xuống lưỡi câu
  ctx.beginPath();
  ctx.moveTo(rodTipX, rodTipY);
  const ctrlX = (rodTipX + hookX) * 0.5 + Math.sin(slot.swayPhase) * 14;
  const ctrlY = (rodTipY + hookY) * 0.45;
  ctx.quadraticCurveTo(ctrlX, ctrlY, hookX, hookY);
  ctx.strokeStyle =
    player.rod_level === 4
      ? "rgba(34, 211, 238, 0.85)"
      : player.rod_level === 3
      ? "rgba(253, 224, 71, 0.85)"
      : "rgba(226, 232, 240, 0.72)";
  ctx.lineWidth = player.rod_level >= 3 ? 2.4 : 1.7;
  ctx.stroke();

  // Phao câu đỏ-trắng gần mặt nước (khi không đang kéo cá)
  if (!slot.reel) {
    const floatY = WATER_SURFACE_Y + Math.sin(slot.swayPhase * 1.6) * 4;
    const floatX = rodTipX + (hookX - rodTipX) * 0.35;
    ctx.beginPath();
    ctx.arc(floatX, floatY, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = "#ef4444";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(floatX, floatY - 2, 3, 0, Math.PI);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
  }

  // Lưỡi câu hoặc vật phẩm đang giật lên
  if (slot.reel) {
    drawReeledItem(ctx, hookX, hookY, slot.reel);
  } else {
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(hookX, hookY, 5, 0, Math.PI * 1.3);
    ctx.stroke();
  }

  // 2. Thân nhân vật Chibi ngồi trên cầu cảng
  ctx.fillStyle = "#0284c7";
  drawRoundedRect(ctx, x - 16, y - 26, 32, 28, 10);
  ctx.fill();
  ctx.strokeStyle = "#0f172a";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Chân đung đưa
  const legSwing = Math.sin(slot.swayPhase * 1.4) * 3;
  ctx.fillStyle = "#1e293b";
  ctx.fillRect(x - 11, y, 8, 13 + legSwing);
  ctx.fillRect(x + 3, y, 8, 13 - legSwing);

  // 3. Cần câu cấp 1-4
  ctx.save();
  if (rodStyle.glow !== "transparent") {
    ctx.shadowColor = rodStyle.glow;
    ctx.shadowBlur = player.rod_level === 4 ? 16 : 10;
  }
  ctx.strokeStyle = rodStyle.stroke;
  ctx.lineWidth = player.rod_level === 4 ? 5.5 : player.rod_level === 3 ? 4.5 : 3.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x + dir * 10, y - 14);
  ctx.quadraticCurveTo(x + dir * 26, y - 44, rodTipX, rodTipY);
  ctx.stroke();

  if (player.rod_level === 4) {
    // Đầu súng Pháo Laser phát sáng đỏ/cyan
    ctx.fillStyle = "#f43f5e";
    ctx.beginPath();
    ctx.arc(rodTipX, rodTipY, 5.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // 4. Đầu tròn + Avatar người chơi
  const avatarRadius = 22;
  const headX = x;
  const headY = y - 48;

  ctx.save();
  ctx.beginPath();
  ctx.arc(headX, headY, avatarRadius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  const cached = player.avatar_url ? world.avatars.get(player.avatar_url) : null;
  if (cached && cached.status === "loaded" && cached.img) {
    ctx.drawImage(
      cached.img,
      headX - avatarRadius,
      headY - avatarRadius,
      avatarRadius * 2,
      avatarRadius * 2
    );
  } else {
    // Fallback vẽ chữ cái đầu trên nền màu nổi
    const bg = AVATAR_FALLBACK_COLORS[player.player_id % AVATAR_FALLBACK_COLORS.length];
    ctx.fillStyle = bg;
    ctx.fillRect(headX - avatarRadius, headY - avatarRadius, avatarRadius * 2, avatarRadius * 2);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 20px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const initial = (player.nickname.trim()[0] || "?").toUpperCase();
    ctx.fillText(initial, headX, headY + 1);
  }

  // Hiệu ứng nhọ nồi đen mặt khi nổ Bom Đen Mặt
  if (slot.sootUntil > nowMs) {
    ctx.fillStyle = "rgba(15, 23, 42, 0.72)";
    ctx.fillRect(headX - avatarRadius, headY - avatarRadius, avatarRadius * 2, avatarRadius * 2);
  }
  ctx.restore();

  // Viền Avatar theo cấp cần câu
  ctx.beginPath();
  ctx.arc(headX, headY, avatarRadius, 0, Math.PI * 2);
  ctx.lineWidth = player.rod_level >= 3 ? 3.5 : 2.5;
  ctx.strokeStyle = rodStyle.stroke;
  ctx.stroke();

  // 5. Nhãn tên rút gọn & Cấp cần dưới chân nhân vật
  const label = truncateName(player.nickname, 10);
  ctx.font = "bold 13px sans-serif";
  const textWidth = ctx.measureText(label).width;
  const pillW = Math.max(76, textWidth + 34);
  const pillX = x - pillW / 2;
  const pillY = y + 15;

  ctx.fillStyle = "rgba(2, 6, 23, 0.82)";
  drawRoundedRect(ctx, pillX, pillY, pillW, 22, 7);
  ctx.fill();
  ctx.strokeStyle = "rgba(148, 163, 184, 0.35)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // Huy hiệu Lv1..4
  ctx.fillStyle = rodStyle.badgeBg;
  drawRoundedRect(ctx, pillX + 3, pillY + 3, 24, 16, 5);
  ctx.fill();
  ctx.fillStyle = rodStyle.badgeText;
  ctx.font = "bold 10px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`L${player.rod_level}`, pillX + 15, pillY + 11);

  // Tên người chơi
  ctx.fillStyle = "#f8fafc";
  ctx.font = "bold 12px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(label, pillX + 30, pillY + 11.5);

  ctx.restore();
}

function drawReeledItem(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  reel: ReelAnimation
): void {
  ctx.save();
  ctx.translate(x, y);

  if (reel.isChest) {
    if (reel.chestResult === "BOMB") {
      // Quả bom đen
      ctx.fillStyle = "#1e293b";
      ctx.beginPath();
      ctx.arc(0, 4, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#f87171";
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.fillStyle = "#facc15";
      ctx.beginPath();
      ctx.arc(0, -13, 5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Rương báu vàng phát sáng
      ctx.shadowColor = "#facc15";
      ctx.shadowBlur = 14;
      ctx.fillStyle = "#d97706";
      drawRoundedRect(ctx, -16, -12, 32, 24, 5);
      ctx.fill();
      ctx.strokeStyle = "#fef08a";
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
  } else if (reel.isTroll) {
    // Đồ troll (dép tổ ong / xương cá)
    ctx.fillStyle = "#facc15";
    drawRoundedRect(ctx, -14, -8, 28, 16, 8);
    ctx.fill();
    ctx.strokeStyle = "#854d0e";
    ctx.lineWidth = 2;
    ctx.stroke();
  } else {
    // Cá vừa câu dính
    const color = reel.itemType === "rare" ? "#facc15" : "#38bdf8";
    ctx.shadowColor = color;
    ctx.shadowBlur = reel.itemType === "rare" ? 12 : 4;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(0, 0, 18, 10, -Math.PI * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawChatBubble(ctx: CanvasRenderingContext2D, slot: FisherSlot, text: string): void {
  ctx.save();
  ctx.font = "bold 14px sans-serif";
  const paddingX = 14;
  const w = Math.min(260, Math.max(110, ctx.measureText(text).width + paddingX * 2));
  const h = 32;
  const bx = Math.max(16, Math.min(CANVAS_WIDTH - w - 16, slot.x - w / 2));
  const by = slot.y - 108;

  ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
  drawRoundedRect(ctx, bx, by, w, h, 10);
  ctx.fill();
  ctx.strokeStyle = "#0ea5e9";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Mũi tên trỏ xuống đầu nhân vật
  ctx.beginPath();
  ctx.moveTo(slot.x - 6, by + h);
  ctx.lineTo(slot.x + 6, by + h);
  ctx.lineTo(slot.x, by + h + 8);
  ctx.closePath();
  ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
  ctx.fill();

  ctx.fillStyle = "#0f172a";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, bx + w / 2, by + h / 2 + 1);
  ctx.restore();
}

function drawParticles(ctx: CanvasRenderingContext2D, world: OverlayWorld): void {
  ctx.save();
  for (const p of world.particles) {
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawFloatingTexts(ctx: CanvasRenderingContext2D, world: OverlayWorld): void {
  ctx.save();
  for (const ft of world.floatingTexts) {
    ctx.globalAlpha = ft.alpha;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const fontSize = Math.round(22 * ft.scale);
    ctx.font = `900 ${fontSize}px sans-serif`;
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(2, 6, 23, 0.9)";
    ctx.strokeText(ft.text, ft.x, ft.y);
    ctx.fillStyle = ft.color;
    ctx.fillText(ft.text, ft.x, ft.y);

    if (ft.subtext) {
      ctx.font = "bold 14px sans-serif";
      ctx.strokeText(ft.subtext, ft.x, ft.y + 20);
      ctx.fillStyle = "#f8fafc";
      ctx.fillText(ft.subtext, ft.x, ft.y + 20);
    }
  }
  ctx.restore();
}
