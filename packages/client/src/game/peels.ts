// Banana peels on the floor (M4-5 state, M4-7 look): the trap weapon's frame from the `weapons` atlas per
// synced trap, faded until it is armed. Without the atlas (tests) a Graphics peel shape stands in.
import type Phaser from 'phaser';
import type { TrapView } from '../net/trapView';

const PEEL = 0xf5d33a;
const PEEL_EDGE = 0x8a6d12;
/** Alpha while the peel is still arming (cannot trip anyone yet). */
const UNARMED_ALPHA = 0.45;
/** Peel sprite scale (32 px frame). */
const PEEL_SCALE = 0.5;

export class PeelRenderer {
  private readonly g: Phaser.GameObjects.Graphics;
  private traps: TrapView[] = [];
  private readonly sprites = new Map<number, Phaser.GameObjects.Sprite>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly depth: number,
    /** Frame in the `weapons` atlas for a weapon id. */
    private readonly frameOf: (weapon: string) => string = (w) => w,
  ) {
    this.g = scene.add.graphics().setDepth(depth);
  }

  /** Redraws from the last patch. */
  sync(traps: TrapView[]): void {
    this.traps = traps;
    const g = this.g;
    g.clear();
    const atlas = this.scene.textures.exists('weapons');
    const seen = new Set<number>();
    for (const t of traps) {
      const alpha = t.armed ? 1 : UNARMED_ALPHA;
      const frame = this.frameOf(t.weapon);
      if (atlas && this.scene.textures.get('weapons').has(frame)) {
        seen.add(t.id);
        let sprite = this.sprites.get(t.id);
        if (!sprite) {
          // A fixed tilt per peel so a row of them does not look stamped.
          sprite = this.scene.add
            .sprite(t.x, t.y, 'weapons', frame)
            .setDepth(this.depth)
            .setScale(PEEL_SCALE)
            .setRotation(((t.id * 2.399) % (Math.PI * 2)) - Math.PI);
          this.sprites.set(t.id, sprite);
        }
        sprite.setPosition(t.x, t.y).setAlpha(alpha);
        continue;
      }
      // Three flaps around a small centre: reads as a peel at 2× zoom.
      g.fillStyle(PEEL, alpha);
      g.lineStyle(1, PEEL_EDGE, alpha);
      for (const angle of [-Math.PI / 2, Math.PI / 6, (5 * Math.PI) / 6]) {
        const fx = t.x + Math.cos(angle) * 4;
        const fy = t.y + Math.sin(angle) * 4;
        g.fillEllipse(fx, fy, 6, 6);
        g.strokeEllipse(fx, fy, 6, 6);
      }
      g.fillCircle(t.x, t.y, 3);
    }
    for (const [id, sprite] of this.sprites) {
      if (seen.has(id)) continue;
      sprite.destroy();
      this.sprites.delete(id);
    }
  }

  /** Peels as last drawn (debug hook). */
  snapshots(): TrapView[] {
    return this.traps.map((t) => ({ ...t }));
  }

  destroy(): void {
    this.g.destroy();
    for (const sprite of this.sprites.values()) sprite.destroy();
    this.sprites.clear();
  }
}
