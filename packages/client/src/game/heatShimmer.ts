// Heat shimmer over floor hazards (Phase 2 P2-2, the bakery oven): a pulsing orange glow on the hot floor
// and wavy heat lines rising across it, so the danger reads before the first burn. Drawn under players.
import type Phaser from 'phaser';
import { hazardZones, type Zone } from '@keke/shared';

const GLOW = 0xff6a00;
const WAVE = 0xffc266;
/** Glow alpha swings between these values once per `PULSE_SECONDS`. */
const GLOW_ALPHA: readonly [number, number] = [0.12, 0.28];
const PULSE_SECONDS = 1.6;
/** Rising heat lines: one per this many pixels of zone width, rising at this speed (px/s). */
const WAVE_SPACING_PX = 14;
const WAVE_RISE_PX_PER_S = 22;
const WAVE_LENGTH_PX = 18;
const WAVE_AMPLITUDE_PX = 2.5;

export interface HeatWave {
  /** Wave centre x, px. */
  readonly x: number;
  /** Top and bottom of the wave segment, px (inside the zone's bounds). */
  readonly y0: number;
  readonly y1: number;
  /** Horizontal sway at the segment's top, px. */
  readonly sway: number;
  readonly alpha: number;
}

/** Glow alpha at `seconds` (pure, for tests). */
export function glowAlpha(seconds: number): number {
  const [lo, hi] = GLOW_ALPHA;
  return lo + ((hi - lo) * (1 + Math.sin((seconds / PULSE_SECONDS) * Math.PI * 2))) / 2;
}

/** The heat lines over one hazard zone at `seconds` (pure, for tests). Lines stay inside the zone bounds. */
export function heatWaves(zone: Zone, seconds: number): HeatWave[] {
  const b = zone.bounds;
  const height = b.maxY - b.minY;
  const count = Math.max(1, Math.floor((b.maxX - b.minX) / WAVE_SPACING_PX));
  const step = (b.maxX - b.minX) / count;
  const waves: HeatWave[] = [];
  for (let i = 0; i < count; i++) {
    // Each column starts at its own height so the lines do not rise in step.
    const offset = (i * 37) % height;
    const travelled = (offset + seconds * WAVE_RISE_PX_PER_S) % height;
    const y1 = b.maxY - travelled;
    const y0 = Math.max(b.minY, y1 - WAVE_LENGTH_PX);
    // Fade in at the bottom, out at the top.
    const progress = travelled / height;
    waves.push({
      x: b.minX + step * (i + 0.5),
      y0,
      y1,
      sway: Math.sin(seconds * 5 + i) * WAVE_AMPLITUDE_PX,
      alpha: 0.55 * Math.sin(progress * Math.PI),
    });
  }
  return waves;
}

export class HeatShimmer {
  private readonly g: Phaser.GameObjects.Graphics;
  readonly zones: readonly Zone[];

  constructor(scene: Phaser.Scene, zones: readonly Zone[], depth: number) {
    this.zones = hazardZones(zones);
    this.g = scene.add.graphics().setDepth(depth);
  }

  /** Every frame. */
  draw(seconds: number): void {
    const g = this.g;
    g.clear();
    if (this.zones.length === 0) return;
    for (const zone of this.zones) {
      g.fillStyle(GLOW, glowAlpha(seconds));
      g.fillPoints(
        zone.polygon.map((p) => ({ x: p.x, y: p.y })),
        true,
      );
      for (const w of heatWaves(zone, seconds)) {
        if (w.alpha <= 0.02) continue;
        g.lineStyle(1.5, WAVE, w.alpha);
        g.beginPath();
        g.moveTo(w.x, w.y1);
        g.lineTo(w.x - w.sway, (w.y0 + w.y1) / 2);
        g.lineTo(w.x + w.sway, w.y0);
        g.strokePath();
      }
    }
  }

  destroy(): void {
    this.g.destroy();
  }
}
