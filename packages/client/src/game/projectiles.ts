// Projectiles (M4-3 state, M4-7 look): each one in flight is its weapon's frame from the `weapons` atlas,
// small and spinning, carried on along its velocity between patches. Where one lands its impact frame
// (fxPlan HIT_FRAMES: egg splat, fizz burst) pops at the size of the splash, with a fading ring of the
// splash / burst radius. Without the atlases (tests) it falls back to circles.
import type Phaser from 'phaser';
import { projectileDrawPosition, type ProjectileView } from '../net/projectileView';
import { hitFrame } from './fxPlan';
import type { KekeProjectileSnapshot } from './hookTypes';
import { renderConfig } from './renderConfig';

/** How long a landing ring stays, in seconds. */
const BURST_SECONDS = 0.35;
/** Never draw a projectile more than this far ahead of its last patch, in seconds. */
const MAX_AHEAD_SECONDS = 0.1;
const FILL = 0xfff4d6;
const OUTLINE = 0x3a2a1a;
const RING = 0xffffff;

/** Spin of a thrown object, turns per second. */
const SPIN_HZ = 2.5;
/** Size of a projectile sprite relative to its 32 px frame, at the smallest collision radius. */
const FRAME_PX = 32;

interface Burst {
  x: number;
  y: number;
  radius: number;
  until: number;
  sprite: Phaser.GameObjects.Sprite | null;
}

export class ProjectileRenderer {
  private readonly g: Phaser.GameObjects.Graphics;
  private flying: ProjectileView[] = [];
  private patchedAt = 0;
  private bursts: Burst[] = [];
  private readonly seenLanded = new Set<number>();
  private readonly sprites = new Map<number, Phaser.GameObjects.Sprite>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly depth: number,
    /** Frame in the `weapons` atlas for a weapon id. */
    private readonly frameOf: (weapon: string) => string = (w) => w,
  ) {
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
      const radius = Math.max(p.areaRadius, p.radius * 2);
      let sprite: Phaser.GameObjects.Sprite | null = null;
      if (this.scene.textures.exists('fx')) {
        sprite = this.scene.add
          .sprite(p.x, p.y, 'fx', hitFrame(p.weapon))
          .setDepth(this.depth + 1)
          .setScale((radius * 2) / FRAME_PX);
      }
      this.bursts.push({ x: p.x, y: p.y, radius, until: now + BURST_SECONDS, sprite });
    }
    for (const id of this.seenLanded) if (!ids.has(id)) this.seenLanded.delete(id);
    const flyingIds = new Set(this.flying.map((p) => p.id));
    for (const [id, sprite] of this.sprites) {
      if (flyingIds.has(id)) continue;
      sprite.destroy();
      this.sprites.delete(id);
    }
  }

  draw(now: number): void {
    const g = this.g;
    g.clear();
    const atlas = this.scene.textures.exists('weapons');
    for (const p of this.flying) {
      const at = projectileDrawPosition(p, now - this.patchedAt, MAX_AHEAD_SECONDS);
      if (!atlas) {
        g.fillStyle(FILL, 1).fillCircle(at.x, at.y, Math.max(2, p.radius));
        g.lineStyle(1, OUTLINE, 1).strokeCircle(at.x, at.y, Math.max(2, p.radius));
        continue;
      }
      let sprite = this.sprites.get(p.id);
      if (!sprite) {
        sprite = this.scene.add
          .sprite(at.x, at.y, 'weapons', this.frameOf(p.weapon))
          .setDepth(this.depth)
          .setScale(Math.max(renderConfig.heldWeaponScale * 0.75, (p.radius * 4) / FRAME_PX));
        this.sprites.set(p.id, sprite);
      }
      // Drawn at hand height, like the held weapon it left.
      sprite.setPosition(at.x, at.y - renderConfig.heldWeaponLiftPx).setRotation(now * SPIN_HZ * Math.PI * 2);
    }
    this.bursts = this.bursts.filter((b) => {
      if (b.until > now) return true;
      b.sprite?.destroy();
      return false;
    });
    for (const b of this.bursts) {
      const alpha = Math.max(0, (b.until - now) / BURST_SECONDS);
      b.sprite?.setAlpha(Math.min(1, alpha * 2));
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
    for (const sprite of this.sprites.values()) sprite.destroy();
    this.sprites.clear();
    for (const b of this.bursts) b.sprite?.destroy();
    this.flying = [];
    this.bursts = [];
    this.seenLanded.clear();
  }
}
