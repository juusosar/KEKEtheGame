// One-way gates on the map (P2-1, phase 2 decision 9): the self-checkout gate sprites (P1-2 `gate`
// sheet: `closed_<dir>` / `open_<dir>`, one 32 × 32 frame per tile, drawn over the gate_lane floor),
// the "unexpected item in bagging area" bubble and the beep. The rules live in shared/rules/gates.ts;
// this file only draws. The entrance doors are gates too but keep their sliding-door tiles.
import type Phaser from 'phaser';
import type { Gate, GateStopMessage, Vec2 } from '@keke/shared';
import { gateFrame, gateLook, gateTileCentres, type GateBody } from './gateLook';

export type { GateBody } from './gateLook';

export interface GateLayerOptions {
  /** Atlas key of the theme's gate sheet (`themeAtlasKey(manifest, theme, 'gate')`). */
  readonly atlas: string;
  readonly tileSize: number;
  /** Player body half size in pixels (overlap test for the open look). */
  readonly halfSize: number;
  /** Gate sprites, over the floor and decor, under characters. */
  readonly depth: number;
  /** Speech bubbles, over everything in the world. */
  readonly bubbleDepth: number;
}

interface DrawnGate {
  readonly gate: Gate;
  readonly images: Phaser.GameObjects.Image[];
  look: 'open' | 'closed';
}

interface Bubble {
  readonly text: Phaser.GameObjects.Text;
  readonly until: number;
}

/** Draws the map's checkout gates and the stop bubbles. */
export class GateLayer {
  private readonly drawn: DrawnGate[] = [];
  private readonly bubbles = new Map<string, Bubble>();
  private stops: GateStopMessage[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    gates: readonly Gate[],
    private readonly options: GateLayerOptions,
  ) {
    const hasSheet = scene.textures.exists(options.atlas);
    for (const gate of gates) {
      if (gate.kind !== 'checkout' || !hasSheet) continue;
      const images = gateTileCentres(gate, options.tileSize).map((c) =>
        scene.add.image(c.x, c.y, options.atlas, gateFrame(gate, 'closed')).setDepth(options.depth),
      );
      this.drawn.push({ gate, images, look: 'closed' });
    }
  }

  /** Opens the gates someone is walking through; call once per render frame. */
  update(bodies: readonly GateBody[], nowSeconds: number): void {
    for (const d of this.drawn) {
      const look = gateLook(d.gate, bodies, this.options.halfSize);
      if (look === d.look) continue;
      d.look = look;
      for (const image of d.images) image.setFrame(gateFrame(d.gate, look));
    }
    for (const [id, bubble] of this.bubbles) {
      if (nowSeconds < bubble.until) continue;
      bubble.text.destroy();
      this.bubbles.delete(id);
    }
  }

  /**
   * A gate stopped `message.player`, standing at `at`: shows `text` above them for the stop
   * (carriers get the bagging-area line). Remembered for the debug hook.
   */
  stopped(message: GateStopMessage, at: Vec2, text: string, nowSeconds: number): void {
    this.stops.push(message);
    if (this.stops.length > 20) this.stops.shift();
    this.bubbles.get(message.player)?.text.destroy();
    const bubble = this.scene.add
      .text(at.x, at.y - 34, text, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '11px',
        color: '#1b1b1b',
        backgroundColor: '#fffbe6',
        padding: { x: 5, y: 3 },
        align: 'center',
        wordWrap: { width: 150 },
      })
      .setOrigin(0.5, 1)
      .setDepth(this.options.bubbleDepth);
    this.bubbles.set(message.player, { text: bubble, until: nowSeconds + Math.max(0.8, message.seconds) });
  }

  /** Recent stop events and the gates' looks (debug hook). */
  snapshot(): {
    stops: GateStopMessage[];
    looks: { index: number; look: 'open' | 'closed' }[];
    bubbles: string[];
  } {
    return {
      stops: this.stops.map((s) => ({ ...s })),
      looks: this.drawn.map((d) => ({ index: d.gate.index, look: d.look })),
      bubbles: [...this.bubbles.values()].map((b) => b.text.text),
    };
  }

  destroy(): void {
    for (const d of this.drawn) for (const image of d.images) image.destroy();
    this.drawn.length = 0;
    for (const b of this.bubbles.values()) b.text.destroy();
    this.bubbles.clear();
  }
}
