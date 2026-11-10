// Placeholder banana peels on the floor (M4-5): a yellow peel shape per synced trap, faded until it is
// armed. Drawn with Graphics so it needs no atlas frame; M4-7 may swap in the weapon sprite and slip FX.
import type Phaser from 'phaser';
import type { TrapView } from '../net/trapView';

const PEEL = 0xf5d33a;
const PEEL_EDGE = 0x8a6d12;
/** Alpha while the peel is still arming (cannot trip anyone yet). */
const UNARMED_ALPHA = 0.45;

export class PeelRenderer {
  private readonly g: Phaser.GameObjects.Graphics;
  private traps: TrapView[] = [];

  constructor(scene: Phaser.Scene, depth: number) {
    this.g = scene.add.graphics().setDepth(depth);
  }

  /** Redraws from the last patch. */
  sync(traps: TrapView[]): void {
    this.traps = traps;
    const g = this.g;
    g.clear();
    for (const t of traps) {
      const alpha = t.armed ? 1 : UNARMED_ALPHA;
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
  }

  /** Peels as last drawn (debug hook). */
  snapshots(): TrapView[] {
    return this.traps.map((t) => ({ ...t }));
  }

  destroy(): void {
    this.g.destroy();
  }
}
