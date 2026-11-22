/**
 * Quản lý toàn bộ thực thể (Entities) và vật lý trong hồ câu trên Canvas 1080x1920.
 * Đảm bảo giới hạn hiệu năng: <= 40 cá, <= 300 hạt particle, <= 60 đạn bắn Boss.
 */

import type {
  BossState,
  ChatBubbleData,
  FishCaughtData,
  PlayerOnShore,
} from "@/lib/types";

export const CANVAS_WIDTH = 1080;
export const CANVAS_HEIGHT = 1920;

// Phân vùng tỷ lệ dọc theo chuẩn 15% Top HUD - 25% Shoreline - 60% Deep Ocean
export const HUD_HEIGHT = Math.round(CANVAS_HEIGHT * 0.15); // 288px
export const SHORE_BOTTOM_Y = Math.round(CANVAS_HEIGHT * 0.4); // 768px
export const WATER_SURFACE_Y = 742;

// Giới hạn thực thể bảo đảm 60FPS
export const MAX_FISH = 40;
export const MAX_PARTICLES = 300;
export const MAX_BOSS_BULLETS = 60;
export const MAX_SHORE_PLAYERS = 15;

export interface AvatarCacheEntry {
  status: "loading" | "loaded" | "error";
  img: HTMLImageElement | null;
}

export class AvatarCache {
  private map = new Map<string, AvatarCacheEntry>();

  public get(url: string): AvatarCacheEntry | null {
    if (!url || typeof window === "undefined") return null;
    const existing = this.map.get(url);
    if (existing) return existing;

    const img = new Image();
    img.crossOrigin = "anonymous";
    const entry: AvatarCacheEntry = { status: "loading", img };
    this.map.set(url, entry);

    img.onload = () => {
      entry.status = "loaded";
    };
    img.onerror = () => {
      entry.status = "error";
      entry.img = null;
    };
    img.src = url;
    return entry;
  }
}

export type OceanLayer = 1 | 2 | 3;

export interface SwimmingFish {
  id: string;
  species: string;
  layer: OceanLayer;
  kind: "normal" | "rare" | "chest";
  x: number;
  y: number;
  baseY: number;
  vx: number;
  size: number;
  bodyColor: string;
  finColor: string;
  tailPhase: number;
  wobbleSpeed: number;
  direction: 1 | -1;
}

export interface WaterBubble {
  x: number;
  y: number;
  radius: number;
  vy: number;
  wobblePhase: number;
  alpha: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  life: number;
  maxLife: number;
  gravity: number;
}

export interface FloatingText {
  x: number;
  y: number;
  vy: number;
  text: string;
  subtext?: string;
  color: string;
  scale: number;
  alpha: number;
  life: number;
  maxLife: number;
}

export interface ReelAnimation {
  itemType: "normal" | "rare" | "chest" | "troll";
  itemName: string;
  points: number;
  isTroll: boolean;
  isChest: boolean;
  chestResult: "DOUBLE" | "BOMB" | null;
  startX: number;
  startY: number;
  progress: number; // 0 -> 1
  duration: number; // giây
}

export interface ChatBubbleEntity {
  text: string;
  expiresAt: number;
}

export interface FisherSlot {
  player: PlayerOnShore;
  seatIndex: number;
  row: 0 | 1; // 0: hàng sau trên cầu cảng, 1: hàng trước sát mép nước
  x: number;
  y: number;
  rodTipX: number;
  rodTipY: number;
  hookBaseX: number;
  hookBaseY: number;
  hookX: number;
  hookY: number;
  swayPhase: number;
  reel: ReelAnimation | null;
  chatBubble: ChatBubbleEntity | null;
  sootUntil: number; // hiệu ứng mặt đen nhọ nồi khi trúng Bom Đen Mặt
}

const LAYER_BOUNDS: Record<OceanLayer, { minY: number; maxY: number }> = {
  1: { minY: WATER_SURFACE_Y + 45, maxY: 1120 },
  2: { minY: 1120, maxY: 1510 },
  3: { minY: 1510, maxY: 1850 },
};

const FISH_PALETTES: Record<
  OceanLayer,
  Array<{ species: string; body: string; fin: string; size: [number, number]; rare?: boolean }>
> = {
  1: [
    { species: "Cá Rô", body: "#38bdf8", fin: "#0284c7", size: [18, 25] },
    { species: "Cá Chép", body: "#fb923c", fin: "#ea580c", size: [20, 28] },
    { species: "Cá Ngừ", body: "#60a5fa", fin: "#1d4ed8", size: [22, 30] },
  ],
  2: [
    { species: "Cá Ngừ Đại Dương", body: "#2dd4bf", fin: "#0f766e", size: [26, 36] },
    { species: "Cá Chép Vàng", body: "#facc15", fin: "#ca8a04", size: [25, 34] },
    { species: "Rùa Vàng", body: "#fde047", fin: "#a16207", size: [32, 42], rare: true },
  ],
  3: [
    { species: "Cá Mập Trắng", body: "#cbd5e1", fin: "#475569", size: [44, 58], rare: true },
    { species: "Cá Voi Xanh", body: "#818cf8", fin: "#3730a3", size: [50, 66], rare: true },
    { species: "Rùa Vàng Cổ Đại", body: "#fbbf24", fin: "#b45309", size: [40, 52], rare: true },
  ],
};

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * Tính vị trí chỗ ngồi trên bờ cho tối đa 15 người chơi.
 * Chia làm 2 hàng so le (hàng sau 8 ghế, hàng trước 7 ghế) để nhân vật không đè nhau.
 */
export function computeSeatPosition(index: number, total: number): {
  row: 0 | 1;
  x: number;
  y: number;
  hookDepth: number;
} {
  const clampedTotal = Math.max(1, Math.min(MAX_SHORE_PLAYERS, total));
  if (clampedTotal <= 8) {
    const step = (CANVAS_WIDTH - 160) / Math.max(1, clampedTotal);
    const x = 80 + step * (index + 0.5);
    return {
      row: 1,
      x,
      y: 660,
      hookDepth: 930 + (index % 3) * 165,
    };
  }

  const backCount = Math.ceil(clampedTotal / 2);
  const frontCount = clampedTotal - backCount;
  if (index < backCount) {
    const step = (CANVAS_WIDTH - 140) / Math.max(1, backCount);
    return {
      row: 0,
      x: 70 + step * (index + 0.5),
      y: 575,
      hookDepth: 880 + (index % 3) * 150,
    };
  }
  const fIdx = index - backCount;
  const step = (CANVAS_WIDTH - 180) / Math.max(1, frontCount);
  return {
    row: 1,
    x: 90 + step * (fIdx + 0.5),
    y: 675,
    hookDepth: 980 + (fIdx % 3) * 170,
  };
}

export class OverlayWorld {
  public avatars = new AvatarCache();
  public fishers: FisherSlot[] = [];
  public fishes: SwimmingFish[] = [];
  public bubbles: WaterBubble[] = [];
  public particles: Particle[] = [];
  public floatingTexts: FloatingText[] = [];

  public feverActive = false;
  public boss: BossState | null = null;
  public waterTime = 0;

  // Đo FPS thực tế cho ?debug=1
  public fps = 60;
  private frameCount = 0;
  private fpsAccum = 0;
  private fishSeq = 1;

  public constructor() {
    this.seedInitialOcean();
  }

  private seedInitialOcean(): void {
    for (let i = 0; i < 32; i++) {
      this.fishes.push(this.createRandomFish(true));
    }
    for (let i = 0; i < 36; i++) {
      this.bubbles.push({
        x: randomRange(40, CANVAS_WIDTH - 40),
        y: randomRange(WATER_SURFACE_Y + 40, CANVAS_HEIGHT - 40),
        radius: randomRange(3, 9),
        vy: randomRange(28, 68),
        wobblePhase: randomRange(0, Math.PI * 2),
        alpha: randomRange(0.2, 0.55),
      });
    }
  }

  private createRandomFish(randomX = false): SwimmingFish {
    const roll = Math.random();
    const layer: OceanLayer = roll < 0.5 ? 1 : roll < 0.82 ? 2 : 3;
    const paletteList = FISH_PALETTES[layer];
    const spec = paletteList[Math.floor(Math.random() * paletteList.length)];
    const bounds = LAYER_BOUNDS[layer];
    const direction: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
    const baseSpeed = layer === 1 ? randomRange(42, 78) : layer === 2 ? randomRange(34, 64) : randomRange(26, 52);
    const speedMult = this.feverActive ? 1.65 : 1.0;
    const size = randomRange(spec.size[0], spec.size[1]);
    const y = randomRange(bounds.minY, bounds.maxY);
    const x = randomX
      ? randomRange(60, CANVAS_WIDTH - 60)
      : direction === 1
      ? -size * 2
      : CANVAS_WIDTH + size * 2;

    return {
      id: `f-${this.fishSeq++}`,
      species: spec.species,
      layer,
      kind: spec.rare ? "rare" : "normal",
      x,
      y,
      baseY: y,
      vx: direction * baseSpeed * speedMult,
      size,
      bodyColor: spec.body,
      finColor: spec.fin,
      tailPhase: randomRange(0, Math.PI * 2),
      wobbleSpeed: randomRange(1.8, 3.4),
      direction,
    };
  }

  // ---------------------------------------------------------------- Đồng bộ người chơi trên bờ
  public syncPlayers(players: PlayerOnShore[]): void {
    const visible = players.slice(0, MAX_SHORE_PLAYERS);
    const existingById = new Map(this.fishers.map((f) => [f.player.player_id, f]));

    this.fishers = visible.map((p, idx) => {
      const seat = computeSeatPosition(idx, visible.length);
      const prev = existingById.get(p.player_id);
      const rodOffsetX = seat.x < CANVAS_WIDTH * 0.5 ? 42 : -42;
      const rodTipX = seat.x + rodOffsetX;
      const rodTipY = seat.y - 54;
      const hookBaseX = rodTipX + (seat.x < CANVAS_WIDTH * 0.5 ? 16 : -16);
      const hookBaseY = seat.hookDepth;

      // Kích hoạt tải trước avatar
      if (p.avatar_url) {
        this.avatars.get(p.avatar_url);
      }

      if (prev) {
        prev.player = p;
        prev.seatIndex = idx;
        prev.row = seat.row;
        prev.x = seat.x;
        prev.y = seat.y;
        prev.rodTipX = rodTipX;
        prev.rodTipY = rodTipY;
        prev.hookBaseX = hookBaseX;
        prev.hookBaseY = hookBaseY;
        return prev;
      }

      return {
        player: p,
        seatIndex: idx,
        row: seat.row,
        x: seat.x,
        y: seat.y,
        rodTipX,
        rodTipY,
        hookBaseX,
        hookBaseY,
        hookX: hookBaseX,
        hookY: hookBaseY,
        swayPhase: idx * 0.9,
        reel: null,
        chatBubble: null,
        sootUntil: 0,
      };
    });
  }

  // ---------------------------------------------------------------- Sự kiện câu cá & bong bóng chat
  public triggerFishCaught(data: FishCaughtData, nowMs: number): FisherSlot | null {
    const slot = this.fishers.find((f) => f.player.player_id === data.player_id) ?? null;
    if (!slot) return null;

    slot.reel = {
      itemType: data.item_type,
      itemName: data.item_name,
      points: data.points,
      isTroll: data.is_troll,
      isChest: data.is_chest,
      chestResult: data.chest_result,
      startX: slot.hookX,
      startY: slot.hookY,
      progress: 0,
      duration: 0.85,
    };

    // Bắn tia nước tại mặt hồ ngay phía trên lưỡi câu
    this.spawnSplash(slot.hookX, WATER_SURFACE_Y, data.item_type === "rare" ? "#facc15" : "#38bdf8", 12);

    if (data.chest_result === "BOMB") {
      slot.sootUntil = nowMs + 4200;
      this.spawnSplash(slot.x, slot.y - 30, "#475569", 18);
      this.addFloatingText(slot.x, slot.y - 95, "BÙM! BOM ĐEN MẶT", "0đ", "#f87171", 1.15);
    } else if (data.is_troll) {
      this.addFloatingText(slot.x, slot.y - 95, data.item_name, "0đ (Đồ Troll)", "#fb923c", 1.05);
    } else if (data.chest_result === "DOUBLE") {
      this.spawnSplash(slot.x, slot.y - 40, "#facc15", 22);
      this.addFloatingText(
        slot.x,
        slot.y - 105,
        `+${data.points}đ`,
        `NỔ RƯƠNG X2!`,
        "#fde047",
        1.35
      );
    } else {
      const color = data.item_type === "rare" ? "#facc15" : "#38bdf8";
      this.addFloatingText(
        slot.x,
        slot.y - 95,
        `+${data.points}đ`,
        data.item_name,
        color,
        data.item_type === "rare" ? 1.25 : 1.0
      );
    }

    // Xoá bớt 1 con cá gần lưỡi câu nhất để tạo cảm giác cá dưới hồ vừa bị bắt lên
    if (!data.is_troll && this.fishes.length > 8) {
      let bestIdx = -1;
      let bestDist = Infinity;
      for (let i = 0; i < this.fishes.length; i++) {
        const f = this.fishes[i];
        const d = Math.hypot(f.x - slot.hookX, f.y - slot.hookY);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0 && bestDist < 360) {
        this.fishes.splice(bestIdx, 1);
      }
    }

    return slot;
  }

  public triggerChatBubble(data: ChatBubbleData, nowMs: number): void {
    const slot = this.fishers.find((f) => f.player.player_id === data.player_id);
    if (!slot) return;
    slot.chatBubble = {
      text: data.text,
      expiresAt: nowMs + 5000,
    };
  }

  public addFloatingText(
    x: number,
    y: number,
    text: string,
    subtext: string | undefined,
    color: string,
    scale = 1
  ): void {
    if (this.floatingTexts.length > 35) {
      this.floatingTexts.shift();
    }
    this.floatingTexts.push({
      x,
      y,
      vy: -62,
      text,
      subtext,
      color,
      scale,
      alpha: 1,
      life: 0,
      maxLife: 1.45,
    });
  }

  public spawnSplash(x: number, y: number, color: string, count: number): void {
    if (typeof document !== "undefined" && document.hidden) return;
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= MAX_PARTICLES) {
        this.particles.shift();
      }
      const angle = randomRange(-Math.PI * 0.9, -Math.PI * 0.1);
      const speed = randomRange(65, 220);
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: randomRange(3.5, 7.5),
        color,
        alpha: 1,
        life: 0,
        maxLife: randomRange(0.45, 0.85),
        gravity: 340,
      });
    }
  }

  // ---------------------------------------------------------------- Cập nhật vật lý theo delta-time
  public update(dt: number, nowMs: number, isTabHidden: boolean): void {
    const safeDt = Math.min(0.05, Math.max(0.001, dt));
    this.waterTime += safeDt * (this.feverActive ? 2.1 : 1.0);

    // Đo FPS mỗi 0.5s
    this.frameCount += 1;
    this.fpsAccum += safeDt;
    if (this.fpsAccum >= 0.5) {
      this.fps = Math.round(this.frameCount / this.fpsAccum);
      this.frameCount = 0;
      this.fpsAccum = 0;
    }

    // 1. Cập nhật người chơi trên bờ & vật lý dây câu
    for (const slot of this.fishers) {
      slot.swayPhase += safeDt * (this.feverActive ? 3.2 : 1.7);
      const swayX = Math.sin(slot.swayPhase) * 18;
      const swayY = Math.cos(slot.swayPhase * 1.3) * 10;

      if (slot.reel) {
        slot.reel.progress += safeDt / slot.reel.duration;
        const t = Math.min(1, slot.reel.progress);
        // Nội suy mượt từ vị trí dưới nước lên đầu cần câu
        const ease = 1 - Math.pow(1 - t, 3);
        slot.hookX = slot.reel.startX + (slot.rodTipX - slot.reel.startX) * ease;
        slot.hookY = slot.reel.startY + (slot.rodTipY + 25 - slot.reel.startY) * ease;
        if (t >= 1) {
          slot.reel = null;
        }
      } else {
        // Khi có Boss, thu dây câu cao lên để tập trung bắn Boss
        const targetY = this.boss ? WATER_SURFACE_Y + 35 : slot.hookBaseY + swayY;
        const targetX = slot.hookBaseX + swayX;
        slot.hookX += (targetX - slot.hookX) * Math.min(1, safeDt * 6);
        slot.hookY += (targetY - slot.hookY) * Math.min(1, safeDt * 6);
      }

      if (slot.chatBubble && nowMs >= slot.chatBubble.expiresAt) {
        slot.chatBubble = null;
      }
    }

    // 2. Cập nhật đàn cá bơi theo 3 tầng (<= 40 con)
    for (let i = this.fishes.length - 1; i >= 0; i--) {
      const f = this.fishes[i];
      const feverBoost = this.feverActive ? 1.55 : 1.0;
      f.x += f.vx * safeDt * feverBoost;
      f.tailPhase += safeDt * (6.5 + Math.abs(f.vx) * 0.05) * feverBoost;
      f.y = f.baseY + Math.sin(this.waterTime * f.wobbleSpeed + f.tailPhase * 0.25) * 14;

      if (
        (f.direction === 1 && f.x > CANVAS_WIDTH + f.size * 3) ||
        (f.direction === -1 && f.x < -f.size * 3)
      ) {
        this.fishes.splice(i, 1);
      }
    }
    while (this.fishes.length < 34 && this.fishes.length < MAX_FISH) {
      this.fishes.push(this.createRandomFish(false));
    }

    // 3. Cập nhật bọt khí
    for (const b of this.bubbles) {
      b.y -= b.vy * safeDt * (this.feverActive ? 1.6 : 1.0);
      b.wobblePhase += safeDt * 2.4;
      b.x += Math.sin(b.wobblePhase) * 16 * safeDt;
      if (b.y < WATER_SURFACE_Y + 12) {
        b.y = CANVAS_HEIGHT - randomRange(10, 60);
        b.x = randomRange(40, CANVAS_WIDTH - 40);
      }
    }

    // 4. Tạm dừng sinh/cập nhật hạt khi tab ẩn
    if (isTabHidden) {
      this.particles.length = 0;
    } else {
      // Sinh hạt ánh kim lấp lánh dưới nước khi đang Fever
      if (this.feverActive && this.particles.length < MAX_PARTICLES - 2 && Math.random() < 0.45) {
        this.particles.push({
          x: randomRange(40, CANVAS_WIDTH - 40),
          y: randomRange(WATER_SURFACE_Y + 20, CANVAS_HEIGHT - 40),
          vx: randomRange(-20, 20),
          vy: randomRange(-55, -20),
          size: randomRange(3, 6),
          color: Math.random() < 0.5 ? "#fde047" : "#f472b6",
          alpha: 0.9,
          life: 0,
          maxLife: randomRange(0.8, 1.4),
          gravity: -10,
        });
      }

      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.life += safeDt;
        if (p.life >= p.maxLife) {
          this.particles.splice(i, 1);
          continue;
        }
        p.vy += p.gravity * safeDt;
        p.x += p.vx * safeDt;
        p.y += p.vy * safeDt;
        p.alpha = Math.max(0, 1 - p.life / p.maxLife);
      }
    }

    // 5. Chữ nổi (+điểm)
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.life += safeDt;
      if (ft.life >= ft.maxLife) {
        this.floatingTexts.splice(i, 1);
        continue;
      }
      ft.y += ft.vy * safeDt;
      ft.alpha = Math.max(0, 1 - Math.pow(ft.life / ft.maxLife, 1.6));
    }
  }
}
