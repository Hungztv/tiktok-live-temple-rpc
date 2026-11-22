/**
 * Bộ dựng hình Canvas 2D nâng cao (1080x1920 @ 60FPS) cho màn hình /overlay.
 * Cảnh quan đại dương sống động: bầu trời cực quang/hoàng hôn, đảo hải đăng, mây trôi,
 * cầu cảng gỗ có đèn lồng ấm áp, 3 tầng nước có caustics, rặng san hô & rong biển đáy biển,
 * cá vẽ chi tiết theo từng loài, nhân vật chibi mũ rơm kèm hào quang cần Lv3/Lv4.
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
  1: { stroke: "#eab308", glow: "transparent", badgeBg: "#78350f", badgeText: "#fde68a" },
  2: { stroke: "#e2e8f0", glow: "#94a3b8", badgeBg: "#334155", badgeText: "#f8fafc" },
  3: { stroke: "#fde047", glow: "#facc15", badgeBg: "#a16207", badgeText: "#fef9c3" },
  4: { stroke: "#22d3ee", glow: "#f43f5e", badgeBg: "#0e7490", badgeText: "#cffafe" },
};

const SHIRT_COLORS = ["#0284c7", "#7c3aed", "#059669", "#db2777", "#ea580c", "#0891b2"];
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

  // 1. Bầu trời hoàng hôn nhiệt đới / cực quang Fever + đảo hải đăng & mây trôi
  if (!opts.transparent) {
    drawScenicSky(ctx, world);
  }

  // 2. Ba tầng nước sâu (60% dưới: y = WATER_SURFACE_Y -> 1920)
  drawOceanLayers(ctx, world, opts.transparent);

  // 3. Tia sáng mặt trời & lưới ánh sáng caustics xuyên xuống lòng hồ
  drawSunRaysAndCaustics(ctx, world);

  // 4. Đáy biển: cát vàng, rặng san hô nhiều màu và rong biển uốn lượn
  drawSeabedAndCorals(ctx, world);

  // 5. Bọt khí đại dương
  drawBubbles(ctx, world);

  // 6. Đàn cá bơi chi tiết theo từng loài
  for (const fish of world.fishes) {
    drawDetailedFish(ctx, fish, world.feverActive);
  }

  // Hook cho Boss Kraken, Lưới điện, Tia Laser, Đạn bắn Boss
  if (opts.onDrawDeepOceanExtras) {
    opts.onDrawDeepOceanExtras(ctx);
  }

  // 7. Cầu cảng gỗ 3D có đèn lồng ấm áp & hướng dẫn tương tác
  drawShorelinePier(ctx, world);

  // 8. Nhân vật Chibi ngồi câu cá (vẽ hàng sau trước, hàng trước sau)
  const backRow = world.fishers.filter((f) => f.row === 0);
  const frontRow = world.fishers.filter((f) => f.row === 1);

  for (const slot of backRow) {
    drawFisherAndLine(ctx, world, slot, opts.nowMs);
  }
  for (const slot of frontRow) {
    drawFisherAndLine(ctx, world, slot, opts.nowMs);
  }

  // 9. Sóng nước mặt hồ có bọt trắng lăn tăn
  drawWaterSurfaceWaves(ctx, world);

  // 10. Bong bóng chat (`diem` / `tui`) luôn nổi trên cùng của nhân vật
  for (const slot of world.fishers) {
    if (slot.chatBubble && opts.nowMs < slot.chatBubble.expiresAt) {
      drawChatBubble(ctx, slot, slot.chatBubble.text);
    }
  }

  // 11. Hạt Particle & Chữ nổi (+điểm)
  if (!opts.isTabHidden) {
    drawParticles(ctx, world);
  }
  drawFloatingTexts(ctx, world);

  // Hook cho Tàu đánh cá, Mưa vàng, Viền báo động đỏ, AI Caster
  if (opts.onDrawForegroundExtras) {
    opts.onDrawForegroundExtras(ctx);
  }
}

function drawScenicSky(ctx: CanvasRenderingContext2D, world: OverlayWorld): void {
  const t = world.waterTime;
  const skyGrad = ctx.createLinearGradient(0, 0, 0, WATER_SURFACE_Y);
  if (world.feverActive) {
    skyGrad.addColorStop(0, "#1e1b4b");
    skyGrad.addColorStop(0.45, "#701a75");
    skyGrad.addColorStop(0.8, "#ea580c");
    skyGrad.addColorStop(1, "#fde047");
  } else {
    skyGrad.addColorStop(0, "#020617");
    skyGrad.addColorStop(0.35, "#0c4a6e");
    skyGrad.addColorStop(0.72, "#0284c7");
    skyGrad.addColorStop(1, "#7dd3fc");
  }
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, CANVAS_WIDTH, WATER_SURFACE_Y + 12);

  // Các ngôi sao lấp lánh ở vùng trời trên
  ctx.save();
  for (let i = 0; i < 24; i++) {
    const sx = (i * 97 + 43) % CANVAS_WIDTH;
    const sy = 140 + ((i * 53) % 240);
    const twinkle = 0.25 + Math.abs(Math.sin(t * 1.5 + i)) * 0.65;
    ctx.fillStyle = `rgba(255, 255, 255, ${twinkle})`;
    ctx.beginPath();
    ctx.arc(sx, sy, i % 3 === 0 ? 2.4 : 1.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Vầng mặt trời / mặt trăng phát sáng dịu ở chân trời
  const sunX = CANVAS_WIDTH * 0.78;
  const sunY = 445;
  const sunHalo = ctx.createRadialGradient(sunX, sunY, 18, sunX, sunY, 165);
  if (world.feverActive) {
    sunHalo.addColorStop(0, "rgba(254, 240, 138, 0.95)");
    sunHalo.addColorStop(0.45, "rgba(251, 146, 60, 0.45)");
    sunHalo.addColorStop(1, "rgba(251, 146, 60, 0)");
  } else {
    sunHalo.addColorStop(0, "rgba(254, 249, 195, 0.9)");
    sunHalo.addColorStop(0.4, "rgba(56, 189, 248, 0.3)");
    sunHalo.addColorStop(1, "rgba(56, 189, 248, 0)");
  }
  ctx.fillStyle = sunHalo;
  ctx.beginPath();
  ctx.arc(sunX, sunY, 165, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = world.feverActive ? "#fef08a" : "#fef9c3";
  ctx.beginPath();
  ctx.arc(sunX, sunY, 44, 0, Math.PI * 2);
  ctx.fill();

  // Mây trôi nhẹ trên nền trời
  for (let i = 0; i < 4; i++) {
    const cx = ((t * (12 + i * 3) + i * 310) % (CANVAS_WIDTH + 260)) - 130;
    const cy = 345 + (i % 2) * 58;
    ctx.fillStyle = world.feverActive
      ? "rgba(253, 186, 116, 0.22)"
      : "rgba(224, 242, 254, 0.2)";
    ctx.beginPath();
    ctx.arc(cx, cy, 34, 0, Math.PI * 2);
    ctx.arc(cx + 32, cy - 10, 42, 0, Math.PI * 2);
    ctx.arc(cx + 68, cy, 30, 0, Math.PI * 2);
    ctx.fill();
  }

  // Đảo xa & ngọn hải đăng bên trái chân trời
  ctx.fillStyle = world.feverActive ? "#4c1d95" : "#0f3d5e";
  ctx.beginPath();
  ctx.moveTo(0, 560);
  ctx.quadraticCurveTo(150, 468, 340, 555);
  ctx.quadraticCurveTo(560, 505, 760, 558);
  ctx.quadraticCurveTo(940, 480, CANVAS_WIDTH, 548);
  ctx.lineTo(CANVAS_WIDTH, 590);
  ctx.lineTo(0, 590);
  ctx.closePath();
  ctx.fill();

  // Hải đăng nhỏ phát tia sáng xoay
  const lhX = 148;
  const lhY = 492;
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(lhX - 7, lhY - 38, 14, 40);
  ctx.fillStyle = "#ef4444";
  ctx.fillRect(lhX - 7, lhY - 26, 14, 10);
  ctx.fillStyle = "#fde047";
  ctx.beginPath();
  ctx.arc(lhX, lhY - 40, 5, 0, Math.PI * 2);
  ctx.fill();

  const beamAlpha = 0.14 + Math.abs(Math.sin(t * 1.3)) * 0.18;
  ctx.fillStyle = `rgba(254, 240, 138, ${beamAlpha})`;
  ctx.beginPath();
  ctx.moveTo(lhX, lhY - 40);
  ctx.lineTo(lhX + 190, lhY - 78);
  ctx.lineTo(lhX + 190, lhY - 10);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function drawOceanLayers(
  ctx: CanvasRenderingContext2D,
  world: OverlayWorld,
  transparent: boolean
): void {
  const alphaTop = transparent ? 0.8 : 0.98;
  const alphaBottom = transparent ? 0.94 : 1.0;

  const oceanGrad = ctx.createLinearGradient(0, WATER_SURFACE_Y, 0, CANVAS_HEIGHT);
  if (world.feverActive) {
    oceanGrad.addColorStop(0, `rgba(245, 158, 11, ${alphaTop})`);
    oceanGrad.addColorStop(0.24, `rgba(14, 165, 233, ${alphaTop})`);
    oceanGrad.addColorStop(0.62, `rgba(88, 28, 135, ${alphaBottom})`);
    oceanGrad.addColorStop(1, `rgba(15, 23, 42, ${alphaBottom})`);
  } else {
    oceanGrad.addColorStop(0, `rgba(14, 165, 233, ${alphaTop})`);
    oceanGrad.addColorStop(0.28, `rgba(3, 105, 161, ${alphaTop})`);
    oceanGrad.addColorStop(0.64, `rgba(12, 74, 110, ${alphaBottom})`);
    oceanGrad.addColorStop(1, `rgba(2, 6, 23, ${alphaBottom})`);
  }

  ctx.fillStyle = oceanGrad;
  ctx.fillRect(0, WATER_SURFACE_Y, CANVAS_WIDTH, CANVAS_HEIGHT - WATER_SURFACE_Y);
}

function drawSunRaysAndCaustics(ctx: CanvasRenderingContext2D, world: OverlayWorld): void {
  ctx.save();
  const t = world.waterTime;

  // Tia sáng mặt trời xuyên xuống nước
  for (let i = 0; i < 6; i++) {
    const baseX = 110 + i * 185 + Math.sin(t * 0.55 + i) * 32;
    const rayHeight = 880;
    const grad = ctx.createLinearGradient(
      baseX,
      WATER_SURFACE_Y,
      baseX + 40,
      WATER_SURFACE_Y + rayHeight
    );
    if (world.feverActive) {
      grad.addColorStop(0, "rgba(254, 240, 138, 0.25)");
      grad.addColorStop(1, "rgba(254, 240, 138, 0)");
    } else {
      grad.addColorStop(0, "rgba(186, 230, 253, 0.2)");
      grad.addColorStop(1, "rgba(186, 230, 253, 0)");
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(baseX - 30, WATER_SURFACE_Y);
    ctx.lineTo(baseX + 35, WATER_SURFACE_Y);
    ctx.lineTo(baseX + 125, WATER_SURFACE_Y + rayHeight);
    ctx.lineTo(baseX - 65, WATER_SURFACE_Y + rayHeight);
    ctx.closePath();
    ctx.fill();
  }

  // Vệt caustics gợn sóng dưới mặt nước tầng nông
  ctx.strokeStyle = world.feverActive
    ? "rgba(254, 240, 138, 0.16)"
    : "rgba(186, 230, 253, 0.13)";
  ctx.lineWidth = 2;
  for (let row = 0; row < 3; row++) {
    const yBase = WATER_SURFACE_Y + 42 + row * 48;
    ctx.beginPath();
    for (let x = 0; x <= CANVAS_WIDTH; x += 36) {
      const y = yBase + Math.sin(x * 0.02 + t * 2.2 + row) * 9;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawSeabedAndCorals(ctx: CanvasRenderingContext2D, world: OverlayWorld): void {
  const t = world.waterTime;
  ctx.save();

  // Đồi cát đáy đại dương
  const sandGrad = ctx.createLinearGradient(0, 1810, 0, CANVAS_HEIGHT);
  sandGrad.addColorStop(0, "#1e293b");
  sandGrad.addColorStop(0.45, "#0f172a");
  sandGrad.addColorStop(1, "#020617");
  ctx.fillStyle = sandGrad;
  ctx.beginPath();
  ctx.moveTo(0, 1865);
  ctx.quadraticCurveTo(260, 1815, 540, 1855);
  ctx.quadraticCurveTo(820, 1890, CANVAS_WIDTH, 1835);
  ctx.lineTo(CANVAS_WIDTH, CANVAS_HEIGHT);
  ctx.lineTo(0, CANVAS_HEIGHT);
  ctx.closePath();
  ctx.fill();

  // Rong biển uốn lượn dọc đáy biển
  const kelpPositions = [65, 118, 225, 360, 680, 765, 960, 1025];
  for (let i = 0; i < kelpPositions.length; i++) {
    const kx = kelpPositions[i];
    const kh = 95 + (i % 3) * 42;
    const sway = Math.sin(t * 1.9 + i * 0.8) * 18;
    ctx.strokeStyle = i % 2 === 0 ? "rgba(16, 185, 129, 0.55)" : "rgba(20, 184, 166, 0.45)";
    ctx.lineWidth = 10;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(kx, CANVAS_HEIGHT);
    ctx.quadraticCurveTo(kx + sway, CANVAS_HEIGHT - kh * 0.55, kx - sway * 0.7, CANVAS_HEIGHT - kh);
    ctx.stroke();
  }

  // Rặng san hô phát sáng màu hồng / cam / tím
  const corals = [
    { x: 155, y: 1872, color: "#f43f5e", r: 34 },
    { x: 285, y: 1878, color: "#fb923c", r: 28 },
    { x: 610, y: 1882, color: "#a855f7", r: 32 },
    { x: 840, y: 1878, color: "#ec4899", r: 30 },
  ];
  for (const c of corals) {
    ctx.fillStyle = c.color;
    ctx.globalAlpha = 0.55;
    for (let branch = -2; branch <= 2; branch++) {
      ctx.beginPath();
      ctx.ellipse(
        c.x + branch * (c.r * 0.42),
        c.y - Math.abs(2 - Math.abs(branch)) * 12,
        c.r * 0.28,
        c.r * 0.75,
        branch * 0.25,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
  }

  ctx.restore();
}

function drawBubbles(ctx: CanvasRenderingContext2D, world: OverlayWorld): void {
  ctx.save();
  for (const b of world.bubbles) {
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(224, 242, 254, ${b.alpha * 0.4})`;
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = `rgba(224, 242, 254, ${b.alpha})`;
    ctx.stroke();
    // Điểm sáng phản quang trên bọt khí
    ctx.fillStyle = `rgba(255, 255, 255, ${b.alpha * 0.9})`;
    ctx.beginPath();
    ctx.arc(b.x - b.radius * 0.3, b.y - b.radius * 0.3, b.radius * 0.25, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawDetailedFish(
  ctx: CanvasRenderingContext2D,
  fish: SwimmingFish,
  feverActive: boolean
): void {
  ctx.save();
  ctx.translate(fish.x, fish.y);
  ctx.scale(fish.direction, 1);

  const s = fish.size;
  const tailSwing = Math.sin(fish.tailPhase) * (s * 0.24);
  const isTurtle = fish.species.includes("Rùa");
  const isShark = fish.species.includes("Mập");
  const isWhale = fish.species.includes("Voi");

  if (fish.kind === "rare" || feverActive) {
    ctx.shadowColor = feverActive ? "#fde047" : fish.bodyColor;
    ctx.shadowBlur = 18;
  }

  if (isTurtle) {
    // Rùa Vàng: chân bơi + đầu + mai lục giác vàng kim
    ctx.fillStyle = fish.finColor;
    ctx.beginPath();
    ctx.ellipse(s * 0.2, s * 0.38, s * 0.35, s * 0.14, 0.35 + tailSwing * 0.02, 0, Math.PI * 2);
    ctx.ellipse(-s * 0.32, s * 0.34, s * 0.28, s * 0.12, -0.35, 0, Math.PI * 2);
    ctx.fill();

    // Đầu rùa
    ctx.fillStyle = "#fde047";
    ctx.beginPath();
    ctx.ellipse(s * 0.82, 0, s * 0.28, s * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();

    // Mai rùa
    ctx.fillStyle = fish.bodyColor;
    ctx.beginPath();
    ctx.ellipse(0, -s * 0.04, s * 0.72, s * 0.48, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#92400e";
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Họa tiết mai rùa
    ctx.strokeStyle = "rgba(146, 64, 14, 0.55)";
    ctx.beginPath();
    ctx.arc(0, -s * 0.05, s * 0.3, 0, Math.PI * 2);
    ctx.stroke();

    // Mắt
    ctx.fillStyle = "#0f172a";
    ctx.beginPath();
    ctx.arc(s * 0.92, -s * 0.05, s * 0.06, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  // Đuôi cá lưỡi liềm uyển chuyển
  ctx.fillStyle = fish.finColor;
  ctx.beginPath();
  ctx.moveTo(-s * 0.72, 0);
  ctx.quadraticCurveTo(-s * 1.15, -s * 0.45 + tailSwing, -s * 1.4, -s * 0.58 + tailSwing);
  ctx.quadraticCurveTo(-s * 1.12, tailSwing * 0.25, -s * 1.4, s * 0.58 + tailSwing);
  ctx.quadraticCurveTo(-s * 1.15, s * 0.45 + tailSwing, -s * 0.72, 0);
  ctx.closePath();
  ctx.fill();

  // Vây lưng (Cá mập có vây lưng sắc nhọn đặc trưng)
  ctx.beginPath();
  if (isShark) {
    ctx.moveTo(-s * 0.25, -s * 0.42);
    ctx.lineTo(-s * 0.05, -s * 1.05);
    ctx.lineTo(s * 0.25, -s * 0.4);
  } else {
    ctx.moveTo(-s * 0.3, -s * 0.42);
    ctx.quadraticCurveTo(0, -s * 0.88, s * 0.32, -s * 0.4);
  }
  ctx.closePath();
  ctx.fill();

  // Thân cá gradient bóng bẩy
  const bodyGrad = ctx.createLinearGradient(0, -s * 0.55, 0, s * 0.55);
  bodyGrad.addColorStop(0, fish.bodyColor);
  bodyGrad.addColorStop(0.68, fish.bodyColor);
  bodyGrad.addColorStop(1, "#f8fafc");
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.ellipse(0, 0, s * (isWhale ? 1.15 : 0.96), s * (isWhale ? 0.58 : 0.5), 0, 0, Math.PI * 2);
  ctx.fill();

  // Sọc vằn / vạch mang cá
  ctx.strokeStyle = "rgba(15, 23, 42, 0.28)";
  ctx.lineWidth = Math.max(1.5, s * 0.06);
  if (isShark) {
    for (let g = 0; g < 3; g++) {
      ctx.beginPath();
      ctx.moveTo(s * (0.18 - g * 0.1), -s * 0.16);
      ctx.lineTo(s * (0.15 - g * 0.1), s * 0.16);
      ctx.stroke();
    }
  } else {
    for (let st = -1; st <= 1; st++) {
      ctx.beginPath();
      ctx.arc(st * s * 0.24, 0, s * 0.34, -Math.PI * 0.32, Math.PI * 0.32);
      ctx.stroke();
    }
  }

  // Vây ngực nhỏ vẫy nhẹ
  ctx.fillStyle = fish.finColor;
  ctx.beginPath();
  ctx.ellipse(s * 0.05, s * 0.18, s * 0.24, s * 0.11, 0.45 + Math.sin(fish.tailPhase) * 0.15, 0, Math.PI * 2);
  ctx.fill();

  // Mắt cá long lanh
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(s * 0.52, -s * 0.12, s * 0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#0f172a";
  ctx.beginPath();
  ctx.arc(s * 0.56, -s * 0.12, s * 0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(s * 0.58, -s * 0.15, s * 0.03, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawShorelinePier(ctx: CanvasRenderingContext2D, world: OverlayWorld): void {
  const t = world.waterTime;
  ctx.save();

  // Thảm cỏ ven bờ xanh mượt
  const bankGrad = ctx.createLinearGradient(0, 520, 0, WATER_SURFACE_Y);
  bankGrad.addColorStop(0, "#065f46");
  bankGrad.addColorStop(0.5, "#047857");
  bankGrad.addColorStop(1, "#451a03");
  ctx.fillStyle = bankGrad;
  ctx.beginPath();
  ctx.moveTo(0, 560);
  ctx.quadraticCurveTo(CANVAS_WIDTH * 0.5, 535, CANVAS_WIDTH, 560);
  ctx.lineTo(CANVAS_WIDTH, WATER_SURFACE_Y);
  ctx.lineTo(0, WATER_SURFACE_Y);
  ctx.closePath();
  ctx.fill();

  // Cọc gỗ cắm xuống mặt nước kèm dây thừng
  for (let x = 75; x <= CANVAS_WIDTH - 65; x += 155) {
    const postGrad = ctx.createLinearGradient(x - 12, 0, x + 12, 0);
    postGrad.addColorStop(0, "#451a03");
    postGrad.addColorStop(0.5, "#78350f");
    postGrad.addColorStop(1, "#290f02");
    ctx.fillStyle = postGrad;
    ctx.fillRect(x - 12, 558, 24, WATER_SURFACE_Y - 538);

    // Đèn lồng ấm áp treo trên cọc cầu cảng
    const lanternSway = Math.sin(t * 2 + x) * 3;
    const lx = x + lanternSway;
    const ly = 564;
    const glow = ctx.createRadialGradient(lx, ly, 2, lx, ly, 34);
    glow.addColorStop(0, "rgba(254, 240, 138, 0.85)");
    glow.addColorStop(0.5, "rgba(245, 158, 11, 0.28)");
    glow.addColorStop(1, "rgba(245, 158, 11, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(lx, ly, 34, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#fde047";
    ctx.beginPath();
    ctx.arc(lx, ly, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Sàn cầu cảng tầng sau (row = 0)
  const backDeckGrad = ctx.createLinearGradient(0, 578, 0, 608);
  backDeckGrad.addColorStop(0, "#b45309");
  backDeckGrad.addColorStop(1, "#78350f");
  ctx.fillStyle = backDeckGrad;
  drawRoundedRect(ctx, 26, 578, CANVAS_WIDTH - 52, 28, 8);
  ctx.fill();
  ctx.strokeStyle = "#451a03";
  ctx.lineWidth = 3;
  ctx.stroke();

  // Sàn cầu cảng chính sát mặt nước (row = 1)
  const frontDeckGrad = ctx.createLinearGradient(0, 676, 0, 714);
  frontDeckGrad.addColorStop(0, world.feverActive ? "#d97706" : "#92400e");
  frontDeckGrad.addColorStop(1, "#451a03");
  ctx.fillStyle = frontDeckGrad;
  drawRoundedRect(ctx, 18, 676, CANVAS_WIDTH - 36, 36, 10);
  ctx.fill();
  ctx.strokeStyle = "#290f02";
  ctx.lineWidth = 3;
  ctx.stroke();

  // Vân ván gỗ
  ctx.strokeStyle = "rgba(41, 15, 2, 0.55)";
  ctx.lineWidth = 2;
  for (let x = 56; x < CANVAS_WIDTH - 40; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, 678);
    ctx.lineTo(x, 712);
    ctx.stroke();
  }

  // Thanh hướng dẫn tương tác nổi tinh tế khi ít người hoặc luôn giúp người mới biết cách chơi
  const hintW = 630;
  const hintH = 34;
  const hintX = (CANVAS_WIDTH - hintW) / 2;
  const hintY = 500;
  ctx.fillStyle = "rgba(2, 6, 23, 0.65)";
  drawRoundedRect(ctx, hintX, hintY, hintW, hintH, 17);
  ctx.fill();
  ctx.strokeStyle = world.feverActive
    ? "rgba(253, 224, 71, 0.7)"
    : "rgba(56, 189, 248, 0.45)";
  ctx.lineWidth = 1.8;
  ctx.stroke();

  ctx.fillStyle = "#e0f2fe";
  ctx.font = "bold 17px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(
    world.boss
      ? "⚔️ BOSS KRAKEN XUẤT HIỆN! GÕ COMMENT BẤT KỲ ĐỂ BẮN BOSS!"
      : '🎣 Gõ "cau" hoặc "1" để thả cần · ❤️ Thả tim mở Fever · 💬 Gõ "diem" xem top',
    CANVAS_WIDTH / 2,
    hintY + hintH / 2 + 1
  );

  ctx.restore();
}

function drawWaterSurfaceWaves(ctx: CanvasRenderingContext2D, world: OverlayWorld): void {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, WATER_SURFACE_Y);
  for (let x = 0; x <= CANVAS_WIDTH; x += 22) {
    const wave =
      Math.sin(x * 0.018 + world.waterTime * 2.6) * 6 +
      Math.cos(x * 0.032 - world.waterTime * 1.9) * 4;
    ctx.lineTo(x, WATER_SURFACE_Y + wave);
  }
  ctx.lineTo(CANVAS_WIDTH, WATER_SURFACE_Y + 28);
  ctx.lineTo(0, WATER_SURFACE_Y + 28);
  ctx.closePath();

  const waveGrad = ctx.createLinearGradient(0, WATER_SURFACE_Y - 8, 0, WATER_SURFACE_Y + 28);
  if (world.feverActive) {
    waveGrad.addColorStop(0, "rgba(254, 240, 138, 0.9)");
    waveGrad.addColorStop(1, "rgba(234, 179, 8, 0)");
  } else {
    waveGrad.addColorStop(0, "rgba(224, 242, 254, 0.85)");
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
  const shirtColor = SHIRT_COLORS[player.player_id % SHIRT_COLORS.length];
  const facingRight = x < CANVAS_WIDTH * 0.5;
  const dir = facingRight ? 1 : -1;

  ctx.save();

  // 1. Hào quang dưới chân cho cần cấp 3 (Vàng) & cấp 4 (Pháo Laser)
  if (player.rod_level >= 3) {
    ctx.save();
    ctx.strokeStyle = player.rod_level === 4 ? "rgba(34, 211, 238, 0.65)" : "rgba(250, 204, 21, 0.65)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(x, y + 6, 26 + Math.sin(world.waterTime * 4) * 3, 8, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // 2. Dây câu Bezier từ đầu cần xuống lưỡi câu
  ctx.beginPath();
  ctx.moveTo(rodTipX, rodTipY);
  const ctrlX = (rodTipX + hookX) * 0.5 + Math.sin(slot.swayPhase) * 14;
  const ctrlY = (rodTipY + hookY) * 0.45;
  ctx.quadraticCurveTo(ctrlX, ctrlY, hookX, hookY);
  ctx.strokeStyle =
    player.rod_level === 4
      ? "rgba(34, 211, 238, 0.9)"
      : player.rod_level === 3
      ? "rgba(253, 224, 71, 0.9)"
      : "rgba(241, 245, 249, 0.78)";
  ctx.lineWidth = player.rod_level >= 3 ? 2.5 : 1.8;
  ctx.stroke();

  // Phao câu đỏ-trắng kèm vòng gợn sóng nhỏ tại mặt nước
  if (!slot.reel) {
    const floatY = WATER_SURFACE_Y + Math.sin(slot.swayPhase * 1.6) * 4;
    const floatX = rodTipX + (hookX - rodTipX) * 0.35;
    ctx.strokeStyle = "rgba(224, 242, 254, 0.45)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(floatX, floatY + 2, 11 + Math.sin(slot.swayPhase * 2) * 3, 4, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(floatX, floatY, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#ef4444";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(floatX, floatY - 2, 3.2, 0, Math.PI);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
  }

  // Vật phẩm giật lên hoặc lưỡi câu
  if (slot.reel) {
    drawReeledItem(ctx, hookX, hookY, slot.reel);
  } else {
    ctx.strokeStyle = "#f1f5f9";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(hookX, hookY, 5, 0, Math.PI * 1.3);
    ctx.stroke();
  }

  // 3. Thân nhân vật Chibi + chân đung đưa
  const legSwing = Math.sin(slot.swayPhase * 1.4) * 3;
  ctx.fillStyle = "#1e293b";
  drawRoundedRect(ctx, x - 11, y - 2, 8, 15 + legSwing, 4);
  ctx.fill();
  drawRoundedRect(ctx, x + 3, y - 2, 8, 15 - legSwing, 4);
  ctx.fill();

  ctx.fillStyle = shirtColor;
  drawRoundedRect(ctx, x - 17, y - 28, 34, 30, 11);
  ctx.fill();
  ctx.strokeStyle = "#0f172a";
  ctx.lineWidth = 2.2;
  ctx.stroke();

  // 4. Cần câu cấp 1-4
  ctx.save();
  if (rodStyle.glow !== "transparent") {
    ctx.shadowColor = rodStyle.glow;
    ctx.shadowBlur = player.rod_level === 4 ? 18 : 11;
  }
  ctx.strokeStyle = rodStyle.stroke;
  ctx.lineWidth = player.rod_level === 4 ? 6 : player.rod_level === 3 ? 4.8 : 3.6;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x + dir * 10, y - 14);
  ctx.quadraticCurveTo(x + dir * 28, y - 46, rodTipX, rodTipY);
  ctx.stroke();

  if (player.rod_level === 4) {
    ctx.fillStyle = "#f43f5e";
    ctx.beginPath();
    ctx.arc(rodTipX, rodTipY, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // 5. Đầu tròn + Avatar người chơi + Mũ rơm ngư dân nhỏ xinh
  const avatarRadius = 23;
  const headX = x;
  const headY = y - 50;

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
    ctx.fillStyle = "rgba(15, 23, 42, 0.78)";
    ctx.fillRect(headX - avatarRadius, headY - avatarRadius, avatarRadius * 2, avatarRadius * 2);
  }
  ctx.restore();

  // Viền Avatar phát sáng theo cấp cần
  ctx.beginPath();
  ctx.arc(headX, headY, avatarRadius, 0, Math.PI * 2);
  ctx.lineWidth = player.rod_level >= 3 ? 3.8 : 2.6;
  ctx.strokeStyle = rodStyle.stroke;
  ctx.stroke();

  // Mũ rơm câu cá đội nhẹ trên đầu
  ctx.fillStyle = "#facc15";
  ctx.beginPath();
  ctx.ellipse(headX, headY - 21, 24, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#eab308";
  ctx.beginPath();
  ctx.arc(headX, headY - 22, 13, Math.PI, 0);
  ctx.fill();
  ctx.strokeStyle = "#dc2626";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(headX - 12, headY - 22);
  ctx.lineTo(headX + 12, headY - 22);
  ctx.stroke();

  // 6. Nhãn tên & Cấp cần dưới chân nhân vật
  const label = truncateName(player.nickname, 10);
  ctx.font = "bold 13px sans-serif";
  const textWidth = ctx.measureText(label).width;
  const pillW = Math.max(80, textWidth + 36);
  const pillX = x - pillW / 2;
  const pillY = y + 16;

  ctx.fillStyle = "rgba(2, 6, 23, 0.88)";
  drawRoundedRect(ctx, pillX, pillY, pillW, 23, 8);
  ctx.fill();
  ctx.strokeStyle = player.rod_level >= 3 ? rodStyle.stroke : "rgba(148, 163, 184, 0.4)";
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // Huy hiệu Lv1..4
  ctx.fillStyle = rodStyle.badgeBg;
  drawRoundedRect(ctx, pillX + 3, pillY + 3, 25, 17, 5);
  ctx.fill();
  ctx.fillStyle = rodStyle.badgeText;
  ctx.font = "900 10px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`L${player.rod_level}`, pillX + 15.5, pillY + 11.5);

  // Tên người chơi
  ctx.fillStyle = "#f8fafc";
  ctx.font = "bold 12px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(label, pillX + 31, pillY + 12);

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
      ctx.fillStyle = "#1e293b";
      ctx.beginPath();
      ctx.arc(0, 4, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#f87171";
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.fillStyle = "#facc15";
      ctx.beginPath();
      ctx.arc(0, -14, 5.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.shadowColor = "#facc15";
      ctx.shadowBlur = 18;
      ctx.fillStyle = "#d97706";
      drawRoundedRect(ctx, -18, -13, 36, 26, 6);
      ctx.fill();
      ctx.strokeStyle = "#fef08a";
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = "#fef08a";
      ctx.fillRect(-4, -3, 8, 8);
    }
  } else if (reel.isTroll) {
    ctx.fillStyle = "#facc15";
    drawRoundedRect(ctx, -15, -9, 30, 18, 9);
    ctx.fill();
    ctx.strokeStyle = "#854d0e";
    ctx.lineWidth = 2;
    ctx.stroke();
  } else {
    const color = reel.itemType === "rare" ? "#facc15" : "#38bdf8";
    ctx.shadowColor = color;
    ctx.shadowBlur = reel.itemType === "rare" ? 16 : 6;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(0, 0, 20, 11, -Math.PI * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawChatBubble(ctx: CanvasRenderingContext2D, slot: FisherSlot, text: string): void {
  ctx.save();
  ctx.font = "bold 14px sans-serif";
  const paddingX = 14;
  const w = Math.min(265, Math.max(115, ctx.measureText(text).width + paddingX * 2));
  const h = 34;
  const bx = Math.max(16, Math.min(CANVAS_WIDTH - w - 16, slot.x - w / 2));
  const by = slot.y - 118;

  ctx.shadowColor = "rgba(14, 165, 233, 0.35)";
  ctx.shadowBlur = 12;
  ctx.fillStyle = "rgba(255, 255, 255, 0.96)";
  drawRoundedRect(ctx, bx, by, w, h, 12);
  ctx.fill();
  ctx.strokeStyle = "#0ea5e9";
  ctx.lineWidth = 2.2;
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.beginPath();
  ctx.moveTo(slot.x - 6, by + h);
  ctx.lineTo(slot.x + 6, by + h);
  ctx.lineTo(slot.x, by + h + 8);
  ctx.closePath();
  ctx.fillStyle = "rgba(255, 255, 255, 0.96)";
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

    const fontSize = Math.round(24 * ft.scale);
    ctx.font = `900 ${fontSize}px sans-serif`;
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(2, 6, 23, 0.92)";
    ctx.strokeText(ft.text, ft.x, ft.y);
    ctx.fillStyle = ft.color;
    ctx.fillText(ft.text, ft.x, ft.y);

    if (ft.subtext) {
      ctx.font = "bold 15px sans-serif";
      ctx.lineWidth = 3.5;
      ctx.strokeText(ft.subtext, ft.x, ft.y + 22);
      ctx.fillStyle = "#f8fafc";
      ctx.fillText(ft.subtext, ft.x, ft.y + 22);
    }
  }
  ctx.restore();
}
