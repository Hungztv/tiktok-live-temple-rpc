/**
 * Hệ thống hiệu ứng đặc biệt (Effects) trên Canvas 1080x1920:
 * - Lưới điện phóng sét (ELECTRIC_NET)
 * - Tia Laser khóa mục tiêu của cần Lv4 (Pháo Laser)
 * - Hào quang nâng cấp cần câu (UPGRADE_ROD)
 * - Tàu Đánh Cá Đại Gia chạy ngang mặt hồ (TRAWLER_SHIP)
 * - Boss Kraken khổng lồ vẫy 8 xúc tu ở đáy biển + Đạn bắn Boss (<= 60) + Mưa đồng vàng + Viền nháy đỏ
 */

import type { BossState, GiftEffectData } from "@/lib/types";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  type FisherSlot,
  MAX_BOSS_BULLETS,
  type OverlayWorld,
  WATER_SURFACE_Y,
} from "./entities";

export interface ElectricNetEffect {
  centerX: number;
  centerY: number;
  targets: Array<{ x: number; y: number }>;
  nickname: string;
  bonusPoints: number;
  elapsed: number;
  duration: number;
}

export interface LaserBeamEffect {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  color: string;
  elapsed: number;
  duration: number;
}

export interface UpgradeAuraEffect {
  x: number;
  y: number;
  newLevel: number;
  elapsed: number;
  duration: number;
}

export interface TrawlerShipEffect {
  x: number;
  y: number;
  vx: number;
  nickname: string;
  giftName: string;
  bonusPoints: number;
  elapsed: number;
  duration: number;
}

export interface BossBullet {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  vx: number;
  vy: number;
  color: string;
  isLaser: boolean;
  damage: number;
}

export interface GoldCoin {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  spinPhase: number;
  spinSpeed: number;
  alpha: number;
}

export const BOSS_CENTER_X = CANVAS_WIDTH * 0.5;
export const BOSS_CENTER_Y = 1600;

export class EffectsManager {
  public electricNets: ElectricNetEffect[] = [];
  public lasers: LaserBeamEffect[] = [];
  public upgradeAuras: UpgradeAuraEffect[] = [];
  public trawlers: TrawlerShipEffect[] = [];
  public bullets: BossBullet[] = [];
  public goldCoins: GoldCoin[] = [];

  private bossFlashTimer = 0;
  private ambientFireCooldown = 0;

  // ---------------------------------------------------------------- Kích hoạt hiệu ứng
  public triggerLaser(fromX: number, fromY: number, toX: number, toY: number, color = "#22d3ee"): void {
    if (this.lasers.length > 20) {
      this.lasers.shift();
    }
    this.lasers.push({
      fromX,
      fromY,
      toX,
      toY,
      color,
      elapsed: 0,
      duration: 0.42,
    });
  }

  public triggerGiftEffect(world: OverlayWorld, data: GiftEffectData): void {
    const slot = world.fishers.find((f) => f.player.player_id === data.player_id) ?? null;
    const originX = slot ? slot.x : CANVAS_WIDTH * 0.5;
    const originY = slot ? slot.y : 660;

    if (data.effect_type === "ELECTRIC_NET") {
      const netCenterX = slot ? slot.hookX : CANVAS_WIDTH * 0.5;
      const netCenterY = slot ? Math.max(WATER_SURFACE_Y + 140, slot.hookY) : 1080;

      // Chọn 3-5 vị trí cá gần lưới điện để phóng tia sét
      const count = Math.max(3, Math.min(5, data.caught_fish_ids.length || 4));
      const sortedFishes = [...world.fishes].sort(
        (a, b) =>
          Math.hypot(a.x - netCenterX, a.y - netCenterY) -
          Math.hypot(b.x - netCenterX, b.y - netCenterY)
      );
      const targets = sortedFishes.slice(0, count).map((f) => ({ x: f.x, y: f.y }));
      while (targets.length < count) {
        const angle = (targets.length / count) * Math.PI * 2;
        targets.push({
          x: netCenterX + Math.cos(angle) * 140,
          y: netCenterY + Math.sin(angle) * 95,
        });
      }

      this.electricNets.push({
        centerX: netCenterX,
        centerY: netCenterY,
        targets,
        nickname: data.nickname,
        bonusPoints: data.bonus_points,
        elapsed: 0,
        duration: 1.35,
      });

      world.spawnSplash(netCenterX, netCenterY, "#38bdf8", 18);
      world.addFloatingText(
        netCenterX,
        netCenterY - 40,
        `⚡ LƯỚI ĐIỆN +${data.bonus_points}đ`,
        data.nickname,
        "#38bdf8",
        1.25
      );
      return;
    }

    if (data.effect_type === "UPGRADE_ROD") {
      this.upgradeAuras.push({
        x: originX,
        y: originY - 24,
        newLevel: data.new_rod_level,
        elapsed: 0,
        duration: 1.5,
      });
      world.spawnSplash(originX, originY - 30, "#facc15", 20);
      world.addFloatingText(
        originX,
        originY - 105,
        data.bonus_points > 0 ? `+${data.bonus_points}đ (MAX CẦN)` : `LÊN CẦN CẤP ${data.new_rod_level}!`,
        data.nickname,
        "#facc15",
        1.3
      );
      return;
    }

    if (data.effect_type === "TRAWLER_SHIP") {
      this.trawlers.push({
        x: -260,
        y: WATER_SURFACE_Y - 12,
        vx: 410,
        nickname: data.nickname,
        giftName: data.gift_name,
        bonusPoints: data.bonus_points,
        elapsed: 0,
        duration: 3.4,
      });
      world.addFloatingText(
        CANVAS_WIDTH * 0.5,
        WATER_SURFACE_Y - 90,
        `🚢 TÀU ĐÁNH CÁ +${data.bonus_points}đ`,
        `${data.nickname} (${data.gift_name})`,
        "#fde047",
        1.45
      );
    }
  }

  public triggerBossUpdate(world: OverlayWorld, boss: BossState): void {
    if (boss.status === "HIT") {
      this.bossFlashTimer = 0.22;
      const attackerSlot = boss.attacker_id
        ? world.fishers.find((f) => f.player.player_id === boss.attacker_id) ?? null
        : null;
      this.spawnBossBullet(attackerSlot, boss.damage ?? 20);

      const dmgX = BOSS_CENTER_X + (Math.random() - 0.5) * 180;
      const dmgY = BOSS_CENTER_Y - 90 + (Math.random() - 0.5) * 60;
      world.addFloatingText(
        dmgX,
        dmgY,
        `-${boss.damage ?? 20} HP`,
        attackerSlot?.player.nickname,
        "#fb7185",
        1.15
      );
      world.spawnSplash(dmgX, dmgY, "#f43f5e", 8);
    } else if (boss.status === "DEFEATED") {
      this.triggerGoldRain(world);
    }
  }

  public spawnBossBullet(slot: FisherSlot | null, damage: number): void {
    if (this.bullets.length >= MAX_BOSS_BULLETS) {
      this.bullets.shift();
    }
    const startX = slot ? slot.rodTipX : 180 + Math.random() * (CANVAS_WIDTH - 360);
    const startY = slot ? slot.rodTipY : 640;
    const targetX = BOSS_CENTER_X + (Math.random() - 0.5) * 150;
    const targetY = BOSS_CENTER_Y - 20 + (Math.random() - 0.5) * 70;

    const dx = targetX - startX;
    const dy = targetY - startY;
    const dist = Math.max(1, Math.hypot(dx, dy));
    const speed = 1350;
    const isLaser = (slot?.player.rod_level ?? 1) === 4;

    if (isLaser) {
      this.triggerLaser(startX, startY, targetX, targetY, "#f43f5e");
    }

    this.bullets.push({
      x: startX,
      y: startY,
      targetX,
      targetY,
      vx: (dx / dist) * speed,
      vy: (dy / dist) * speed,
      color: isLaser ? "#22d3ee" : damage >= 100 ? "#facc15" : "#fb7185",
      isLaser,
      damage,
    });
  }

  public triggerGoldRain(world: OverlayWorld): void {
    this.goldCoins = [];
    for (let i = 0; i < 85; i++) {
      this.goldCoins.push({
        x: 40 + Math.random() * (CANVAS_WIDTH - 80),
        y: -40 - Math.random() * 750,
        vx: (Math.random() - 0.5) * 45,
        vy: 280 + Math.random() * 240,
        radius: 10 + Math.random() * 7,
        spinPhase: Math.random() * Math.PI * 2,
        spinSpeed: 5 + Math.random() * 5,
        alpha: 1,
      });
    }
    world.spawnSplash(BOSS_CENTER_X, BOSS_CENTER_Y, "#facc15", 35);
  }

  // ---------------------------------------------------------------- Cập nhật theo delta-time
  public update(world: OverlayWorld, dt: number, isTabHidden: boolean): void {
    const safeDt = Math.min(0.05, Math.max(0.001, dt));
    if (this.bossFlashTimer > 0) {
      this.bossFlashTimer = Math.max(0, this.bossFlashTimer - safeDt);
    }

    // Khi đang có Boss, các cần thủ trên bờ tự động bắn đạn hỗ trợ trực quan
    if (world.boss && world.fishers.length > 0 && !isTabHidden) {
      this.ambientFireCooldown -= safeDt;
      if (this.ambientFireCooldown <= 0) {
        this.ambientFireCooldown = 0.22;
        const randomShooter =
          world.fishers[Math.floor(Math.random() * world.fishers.length)] ?? null;
        this.spawnBossBullet(randomShooter, 20);
      }
    }

    // 1. Lưới điện
    for (let i = this.electricNets.length - 1; i >= 0; i--) {
      const net = this.electricNets[i];
      net.elapsed += safeDt;
      if (net.elapsed >= net.duration) {
        this.electricNets.splice(i, 1);
      }
    }

    // 2. Tia laser Lv4
    for (let i = this.lasers.length - 1; i >= 0; i--) {
      const l = this.lasers[i];
      l.elapsed += safeDt;
      if (l.elapsed >= l.duration) {
        this.lasers.splice(i, 1);
      }
    }

    // 3. Hào quang nâng cấp cần
    for (let i = this.upgradeAuras.length - 1; i >= 0; i--) {
      const a = this.upgradeAuras[i];
      a.elapsed += safeDt;
      if (a.elapsed >= a.duration) {
        this.upgradeAuras.splice(i, 1);
      }
    }

    // 4. Tàu đánh cá chạy ngang mặt hồ
    for (let i = this.trawlers.length - 1; i >= 0; i--) {
      const ship = this.trawlers[i];
      ship.elapsed += safeDt;
      ship.x += ship.vx * safeDt;

      // Quét cá nằm trong vùng lưới kéo dưới bụng tàu
      for (let fIdx = world.fishes.length - 1; fIdx >= 0; fIdx--) {
        const f = world.fishes[fIdx];
        if (Math.abs(f.x - ship.x) < 110 && f.y < 1380) {
          world.spawnSplash(f.x, f.y, "#fde047", 4);
          world.fishes.splice(fIdx, 1);
        }
      }

      if (ship.x > CANVAS_WIDTH + 300 || ship.elapsed >= ship.duration) {
        this.trawlers.splice(i, 1);
      }
    }

    // 5. Đạn bắn Boss (<= 60)
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.x += b.vx * safeDt;
      b.y += b.vy * safeDt;
      if (b.y >= b.targetY || Math.hypot(b.x - b.targetX, b.y - b.targetY) < 28) {
        world.spawnSplash(b.targetX, b.targetY, b.color, 4);
        this.bullets.splice(i, 1);
      }
    }

    // 6. Mưa đồng vàng khi hạ Boss
    for (let i = this.goldCoins.length - 1; i >= 0; i--) {
      const c = this.goldCoins[i];
      c.x += c.vx * safeDt;
      c.y += c.vy * safeDt;
      c.spinPhase += c.spinSpeed * safeDt;
      if (c.y > CANVAS_HEIGHT - 120) {
        c.alpha -= safeDt * 1.8;
      }
      if (c.y > CANVAS_HEIGHT + 40 || c.alpha <= 0) {
        this.goldCoins.splice(i, 1);
      }
    }
  }

  // ---------------------------------------------------------------- Vẽ lớp dưới nước (Boss, Lưới điện, Laser)
  public drawDeepOceanEffects(ctx: CanvasRenderingContext2D, world: OverlayWorld): void {
    // 1. Boss Kraken ở đáy biển sâu
    if (world.boss) {
      this.drawBossKraken(ctx, world);
    }

    // 2. Lưới điện phóng sét
    for (const net of this.electricNets) {
      this.drawElectricNet(ctx, net);
    }

    // 3. Tia Laser khóa mục tiêu của cần Lv4
    for (const laser of this.lasers) {
      this.drawLaserBeam(ctx, laser);
    }

    // 4. Đạn bắn Boss
    for (const b of this.bullets) {
      ctx.save();
      ctx.shadowColor = b.color;
      ctx.shadowBlur = 12;
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.isLaser ? 7 : 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------- Vẽ lớp tiền cảnh (Tàu, Hào quang, Mưa vàng, Viền đỏ)
  public drawForegroundEffects(ctx: CanvasRenderingContext2D, world: OverlayWorld): void {
    // 1. Hào quang nâng cấp cần
    for (const aura of this.upgradeAuras) {
      const p = aura.elapsed / aura.duration;
      const radius = 26 + p * 75;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - p);
      ctx.strokeStyle = aura.newLevel === 4 ? "#22d3ee" : "#facc15";
      ctx.lineWidth = 5;
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.arc(aura.x, aura.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 2. Tàu đánh cá đại gia chạy ngang mặt hồ
    for (const ship of this.trawlers) {
      this.drawTrawlerShip(ctx, ship, world.waterTime);
    }

    // 3. Mưa đồng vàng khi hạ Boss
    for (const c of this.goldCoins) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, c.alpha);
      const scaleX = Math.max(0.22, Math.abs(Math.cos(c.spinPhase)));
      ctx.translate(c.x, c.y);
      ctx.scale(scaleX, 1);

      ctx.shadowColor = "#facc15";
      ctx.shadowBlur = 10;
      ctx.fillStyle = "#facc15";
      ctx.beginPath();
      ctx.arc(0, 0, c.radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "#ca8a04";
      ctx.lineWidth = 2.5;
      ctx.stroke();

      ctx.fillStyle = "#fef08a";
      ctx.fillRect(-2, -c.radius * 0.45, 4, c.radius * 0.9);
      ctx.restore();
    }

    // 4. Viền màn hình nháy đỏ cảnh báo khi có Boss Kraken
    if (world.boss) {
      const pulse = 0.35 + Math.abs(Math.sin(world.waterTime * 3.8)) * 0.45;
      ctx.save();
      ctx.strokeStyle = `rgba(244, 63, 94, ${pulse})`;
      ctx.lineWidth = 18;
      ctx.shadowColor = "#f43f5e";
      ctx.shadowBlur = 32;
      ctx.strokeRect(9, 9, CANVAS_WIDTH - 18, CANVAS_HEIGHT - 18);
      ctx.restore();
    }
  }

  private drawBossKraken(ctx: CanvasRenderingContext2D, world: OverlayWorld): void {
    const t = world.waterTime;
    const cx = BOSS_CENTER_X + Math.sin(t * 1.4) * 28;
    const cy = BOSS_CENTER_Y + Math.cos(t * 1.8) * 14;
    const isHit = this.bossFlashTimer > 0;

    ctx.save();
    ctx.translate(cx, cy);

    ctx.shadowColor = isHit ? "#ffffff" : "#f43f5e";
    ctx.shadowBlur = isHit ? 34 : 24;

    // 8 xúc tu uốn lượn quanh thân Kraken
    const tentacleCount = 8;
    for (let i = 0; i < tentacleCount; i++) {
      const side = i < 4 ? -1 : 1;
      const idx = i % 4;
      const baseAngle = side * (0.35 + idx * 0.32);
      const wave1 = Math.sin(t * 3.2 + i * 0.9) * 38;
      const wave2 = Math.cos(t * 2.6 + i * 1.2) * 52;

      const startX = side * (45 + idx * 24);
      const startY = 35;
      const endX = startX + Math.sin(baseAngle) * 195 + wave2;
      const endY = startY - 95 + idx * 38 + Math.abs(wave1) * 0.5;

      ctx.strokeStyle = isHit ? "#fecdd3" : "#9f1239";
      ctx.lineWidth = 22 - idx * 2.5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.quadraticCurveTo(startX + side * 85 + wave1, startY - 40, endX, endY);
      ctx.stroke();

      // Giác hút trên xúc tu
      ctx.fillStyle = "#fda4af";
      ctx.beginPath();
      ctx.arc((startX + endX) * 0.55, (startY + endY) * 0.5, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Đầu / thân chính của Boss Kraken
    const bodyGrad = ctx.createRadialGradient(0, -35, 20, 0, 0, 135);
    if (isHit) {
      bodyGrad.addColorStop(0, "#fff1f2");
      bodyGrad.addColorStop(0.5, "#fb7185");
      bodyGrad.addColorStop(1, "#be123c");
    } else {
      bodyGrad.addColorStop(0, "#e11d48");
      bodyGrad.addColorStop(0.65, "#881337");
      bodyGrad.addColorStop(1, "#4c0519");
    }
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.ellipse(0, -18, 118, 96, 0, 0, Math.PI * 2);
    ctx.fill();

    // Vương miện gai hải vương trên đầu Kraken
    ctx.fillStyle = "#facc15";
    ctx.beginPath();
    ctx.moveTo(-48, -102);
    ctx.lineTo(-28, -138);
    ctx.lineTo(-8, -108);
    ctx.lineTo(0, -148);
    ctx.lineTo(8, -108);
    ctx.lineTo(28, -138);
    ctx.lineTo(48, -102);
    ctx.closePath();
    ctx.fill();

    // Hai mắt hung dữ phát sáng vàng-đỏ
    for (const eyeDir of [-1, 1]) {
      ctx.fillStyle = "#fef08a";
      ctx.beginPath();
      ctx.ellipse(eyeDir * 42, -12, 22, 15, eyeDir * 0.22, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#020617";
      ctx.beginPath();
      ctx.ellipse(eyeDir * 42, -12, 6, 13, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Miệng răng nanh
    ctx.fillStyle = "#1e1b4b";
    ctx.beginPath();
    ctx.arc(0, 32, 34, 0, Math.PI);
    ctx.fill();

    ctx.restore();
  }

  private drawElectricNet(ctx: CanvasRenderingContext2D, net: ElectricNetEffect): void {
    const progress = net.elapsed / net.duration;
    const alpha = Math.max(0, 1 - progress * 0.85);
    const radius = 85 + Math.sin(net.elapsed * 18) * 8;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = "#38bdf8";
    ctx.shadowColor = "#22d3ee";
    ctx.shadowBlur = 18;
    ctx.lineWidth = 3;

    // Vòng lưới điện trung tâm
    ctx.beginPath();
    ctx.arc(net.centerX, net.centerY, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Các tia sét ziczac phóng tới cá xung quanh
    for (const target of net.targets) {
      ctx.beginPath();
      ctx.moveTo(net.centerX, net.centerY);
      const segments = 5;
      for (let s = 1; s < segments; s++) {
        const ratio = s / segments;
        const jitterX = (Math.random() - 0.5) * 32;
        const jitterY = (Math.random() - 0.5) * 32;
        ctx.lineTo(
          net.centerX + (target.x - net.centerX) * ratio + jitterX,
          net.centerY + (target.y - net.centerY) * ratio + jitterY
        );
      }
      ctx.lineTo(target.x, target.y);
      ctx.strokeStyle = "#e0f2fe";
      ctx.lineWidth = 2.8;
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawLaserBeam(ctx: CanvasRenderingContext2D, laser: LaserBeamEffect): void {
    const alpha = Math.max(0, 1 - laser.elapsed / laser.duration);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = "round";

    // Tia ngoài phát sáng
    ctx.shadowColor = laser.color;
    ctx.shadowBlur = 20;
    ctx.strokeStyle = laser.color;
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(laser.fromX, laser.fromY);
    ctx.lineTo(laser.toX, laser.toY);
    ctx.stroke();

    // Lõi trắng năng lượng cao
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(laser.fromX, laser.fromY);
    ctx.lineTo(laser.toX, laser.toY);
    ctx.stroke();

    // Vòng tâm ngắm khóa mục tiêu ở điểm cuối
    ctx.strokeStyle = "#f43f5e";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(laser.toX, laser.toY, 20, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  private drawTrawlerShip(
    ctx: CanvasRenderingContext2D,
    ship: TrawlerShipEffect,
    waterTime: number
  ): void {
    const bob = Math.sin(waterTime * 4) * 5;
    const x = ship.x;
    const y = ship.y + bob;

    ctx.save();

    // Lưới kéo khổng lồ quét dưới mặt nước phía sau tàu
    ctx.strokeStyle = "rgba(253, 224, 71, 0.55)";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(x - 95, y + 10);
    ctx.lineTo(x - 240, y + 380);
    ctx.lineTo(x + 30, y + 340);
    ctx.closePath();
    ctx.fillStyle = "rgba(250, 204, 21, 0.14)";
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.translate(x, y);

    // Cabin & Ống khói tàu
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(-55, -62, 85, 42);
    ctx.fillStyle = "#0284c7";
    ctx.fillRect(-42, -50, 24, 16);
    ctx.fillRect(-8, -50, 24, 16);

    ctx.fillStyle = "#dc2626";
    ctx.fillRect(-35, -92, 22, 30);

    // Thân tàu đánh cá đại gia
    ctx.shadowColor = "#facc15";
    ctx.shadowBlur = 16;
    ctx.fillStyle = "#b91c1c";
    ctx.beginPath();
    ctx.moveTo(-115, -20);
    ctx.lineTo(125, -26);
    ctx.lineTo(95, 22);
    ctx.lineTo(-98, 22);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "#facc15";
    ctx.lineWidth = 4;
    ctx.stroke();

    // Tên đại gia trên thân tàu
    ctx.fillStyle = "#fef08a";
    ctx.font = "900 15px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`VIP: ${ship.nickname.slice(0, 14)}`, 4, 4);

    ctx.restore();
  }
}
