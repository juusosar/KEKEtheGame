// Minimal spray feedback (M4-4): a cone in front of whoever is spraying, and the extinguisher's vision
// cloud (§7 "blocks vision slightly"). Both come from the `attack` broadcasts the server sends once per
// spray tick, so the server keeps no cloud state. Clouds sit above players, items and nameplates, so they
// hide what is inside them. M4-7 owns the proper spray art; this is the placeholder.
import {
  CombatEventMessage,
  sprayCloud,
  type AttackMessage,
  type KoMessage,
  type SprayStats,
  type Vec2,
  type WeaponCatalogue,
} from '@keke/shared';
import type Phaser from 'phaser';
import { swingAngles } from './combatLook';

/** A spray cone being drawn, following its sprayer. */
export interface SprayCone {
  player: string;
  x: number;
  y: number;
  aim: number;
  rangePx: number;
  coneDegrees: number;
  /** Clouds sprays look white (foam), others red (ketchup). */
  foam: boolean;
  /** Scene-clock seconds the cone disappears unless another tick refreshes it. */
  until: number;
}

/** A vision cloud lingering in the world. */
export interface SprayCloudFx {
  x: number;
  y: number;
  radiusPx: number;
  /** Scene-clock seconds it was made and disappears. */
  from: number;
  until: number;
}

/** Spray cones and clouds from `attack` events; no Phaser, so it is unit-tested. */
export class SprayFxModel {
  private cones = new Map<string, SprayCone>();
  private clouds: SprayCloudFx[] = [];

  constructor(private readonly weapons: WeaponCatalogue) {}

  /** Feed every combat broadcast; `now` is the scene clock in seconds. */
  onEvent(type: string, payload: unknown, now: number): void {
    if (type !== CombatEventMessage.attack) return;
    const a = payload as AttackMessage;
    const def = this.weapons.get(a.weapon);
    if (a.mode !== 'spray' || !def || def.behaviour !== 'spray') return;
    const stats: SprayStats = def.spray;
    this.cones.set(a.player, {
      player: a.player,
      x: a.x,
      y: a.y,
      aim: a.aim,
      rangePx: stats.rangePx,
      coneDegrees: stats.coneDegrees,
      foam: stats.visionCloud !== null,
      // Lasts until just after the next tick, so a held spray draws without gaps.
      until: now + stats.tickSeconds * 1.5,
    });
    const cloud = sprayCloud(a, a.aim, stats);
    if (cloud) {
      const fresh = {
        x: cloud.x,
        y: cloud.y,
        radiusPx: cloud.radiusPx,
        from: now,
        until: now + cloud.seconds,
      };
      // A held spray aimed at one spot keeps one cloud alive instead of stacking them into a solid wall.
      const near = this.clouds.find(
        (c) => Math.hypot(c.x - fresh.x, c.y - fresh.y) < Math.min(c.radiusPx, fresh.radiusPx) / 2,
      );
      if (near) Object.assign(near, fresh);
      else this.clouds.push(fresh);
    }
  }

  /** Drops what has expired and returns what to draw now. */
  active(now: number): { cones: SprayCone[]; clouds: SprayCloudFx[] } {
    for (const [id, c] of this.cones) if (c.until <= now) this.cones.delete(id);
    this.clouds = this.clouds.filter((c) => c.until > now);
    return { cones: [...this.cones.values()], clouds: [...this.clouds] };
  }

  /** A player was KO'd or left: stop drawing their cone. */
  stop(player: string): void {
    this.cones.delete(player);
  }
}

/** Opacity of a cloud at `now`: full, then fading to 0 over its last `fadeSeconds`. */
export function cloudOpacity(cloud: SprayCloudFx, now: number, alpha: number, fadeSeconds: number): number {
  const left = cloud.until - now;
  if (left <= 0) return 0;
  if (fadeSeconds <= 0 || left >= fadeSeconds) return alpha;
  return alpha * (left / fadeSeconds);
}

const KETCHUP_COLOR = 0xc62828;
const FOAM_COLOR = 0xeceff1;

export class SprayFx {
  private readonly model: SprayFxModel;
  private readonly coneLayer: Phaser.GameObjects.Graphics;
  private readonly cloudLayer: Phaser.GameObjects.Graphics;

  constructor(
    scene: Phaser.Scene,
    coneDepth: number,
    cloudDepth: number,
    weapons: WeaponCatalogue,
    private readonly look: { sprayFxAlpha: number; sprayCloudAlpha: number; sprayCloudFadeSeconds: number },
  ) {
    this.model = new SprayFxModel(weapons);
    this.coneLayer = scene.add.graphics().setDepth(coneDepth);
    this.cloudLayer = scene.add.graphics().setDepth(cloudDepth);
  }

  onEvent(type: string, payload: unknown, now: number): void {
    if (type === CombatEventMessage.ko) this.model.stop((payload as KoMessage).player);
    this.model.onEvent(type, payload, now);
  }

  /** Clouds in the world now (debug hook). */
  clouds(now: number): { x: number; y: number; radiusPx: number }[] {
    return this.model.active(now).clouds.map(({ x, y, radiusPx }) => ({ x, y, radiusPx }));
  }

  /** Redraws. `positionOf` gives a sprayer's drawn position, so the cone follows them. */
  draw(now: number, positionOf: (id: string) => Vec2 | undefined): void {
    const { cones, clouds } = this.model.active(now);
    const g = this.coneLayer;
    g.clear();
    for (const c of cones) {
      const at = positionOf(c.player) ?? c;
      const [from, to] = swingAngles(c.aim, { arcDegrees: c.coneDegrees });
      g.fillStyle(c.foam ? FOAM_COLOR : KETCHUP_COLOR, this.look.sprayFxAlpha);
      g.slice(at.x, at.y, c.rangePx, from, to, false);
      g.fillPath();
    }
    const k = this.cloudLayer;
    k.clear();
    for (const c of clouds) {
      const alpha = cloudOpacity(c, now, this.look.sprayCloudAlpha, this.look.sprayCloudFadeSeconds);
      // A soft edge: a full disc and a fainter, larger ring around it.
      k.fillStyle(FOAM_COLOR, alpha * 0.5);
      k.fillCircle(c.x, c.y, c.radiusPx);
      k.fillStyle(FOAM_COLOR, alpha * 0.6);
      k.fillCircle(c.x, c.y, c.radiusPx * 0.75);
    }
  }

  destroy(): void {
    this.coneLayer.destroy();
    this.cloudLayer.destroy();
  }
}
