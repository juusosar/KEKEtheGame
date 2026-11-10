// Placeholder projectile drawing (M4-3): a small filled circle for each projectile in flight, carried on
// along its velocity between patches, and a fading ring of the splash / burst radius where one lands.
// M4-7 replaces this with the real sprites and FX (egg splat, fizz burst).
import type Phaser from 'phaser';
import { projectileDrawPosition, type ProjectileView } from '../net/projectileView';
import type { KekeProjectileSnapshot } from './hookTypes';

/** How long a landing ring stays, in seconds. */
const BURST_SECONDS = 0.35;
/** Never draw a projectile more than this far ahead of its last patch, in seconds. */
const MAX_AHEAD_SECONDS = 0.1;
const FILL = 0xfff4d6;
const OUTLINE = 0x3a2a1a;
const RING = 0xffffff;

interface Burst {
  x: number;
  y: number;
  radius: number;
  until: number;
}

export class ProjectileRenderer {
  private readonly g: Phaser.GameObjects.Graphics;
  private flying: ProjectileView[] = [];
  private patchedAt = 0;
  private bursts: Burst[] = [];
  private readonly seenLanded = new Set<number>();

  constructor(scene: Phaser.Scene, depth: number) {
    this.g = scene.add.graphics().setDepth(depth);
  }

  /** The projectiles of the latest patch; `now` is the scene clock in seconds. */
  sync(list: readonly ProjectileView[], now: number): void {
    this.patchedAt = now;
    this.flying = list.filter((p) => !p.landed);
    const ids = new Set(list.map((p) => p.id));
    for (const p of list) {
      if (!p.landed || this.seenLanded.has(p.id)) continue;
      this.seenLanded.add(p.id);
      this.bursts.push({
        x: p.x,
        y: p.y,
        radius: Math.max(p.areaRadius, p.radius * 2),
        until: now + BURST_SECONDS,
      });
    }
    for (const id of this.seenLanded) if (!ids.has(id)) this.seenLanded.delete(id);
  }

  draw(now: number): void {
    const g = this.g;
    g.clear();
    for (const p of this.flying) {
      const at = projectileDrawPosition(p, now - this.patchedAt, MAX_AHEAD_SECONDS);
      g.fillStyle(FILL, 1).fillCircle(at.x, at.y, Math.max(2, p.radius));
      g.lineStyle(1, OUTLINE, 1).strokeCircle(at.x, at.y, Math.max(2, p.radius));
    }
    this.bursts = this.bursts.filter((b) => b.until > now);
    for (const b of this.bursts) {
      const alpha = Math.max(0, (b.until - now) / BURST_SECONDS);
      g.fillStyle(RING, 0.25 * alpha).fillCircle(b.x, b.y, b.radius);
      g.lineStyle(2, RING, alpha).strokeCircle(b.x, b.y, b.radius);
    }
  }

  /** For the debug hook: projectiles in flight as of the last patch. */
  snapshots(): KekeProjectileSnapshot[] {
    return this.flying.map(({ id, weapon, owner, x, y }) => ({ id, weapon, owner, x, y }));
  }

  destroy(): void {
    this.g.destroy();
    this.flying = [];
    this.bursts = [];
    this.seenLanded.clear();
  }
}
