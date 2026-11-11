// Pure helpers for drawing one-way gates (P2-1): no Phaser, so they are unit-tested.
import type { Gate, Vec2 } from '@keke/shared';

/** A body near a gate: drawn centre and whether it stands stopped at a gate now. */
export interface GateBody {
  readonly x: number;
  readonly y: number;
  readonly stopped: boolean;
}

/**
 * How a gate looks now: `open` (green) while a body that is not stopped is inside its rectangle (a
 * shopper walking through), else `closed` (red, also while someone waits at it).
 */
export function gateLook(gate: Gate, bodies: readonly GateBody[], halfSize: number): 'open' | 'closed' {
  for (const b of bodies) {
    if (b.stopped) continue;
    const inX = Math.abs(b.x - (gate.x + gate.width / 2)) < gate.width / 2 + halfSize;
    const inY = Math.abs(b.y - (gate.y + gate.height / 2)) < gate.height / 2 + halfSize;
    if (inX && inY) return 'open';
  }
  return 'closed';
}

/** Centres of the tiles a gate covers, row by row. */
export function gateTileCentres(gate: Gate, tileSize: number): Vec2[] {
  const out: Vec2[] = [];
  for (let y = gate.y; y < gate.y + gate.height; y += tileSize) {
    for (let x = gate.x; x < gate.x + gate.width; x += tileSize) {
      out.push({ x: x + tileSize / 2, y: y + tileSize / 2 });
    }
  }
  return out;
}

/** The atlas frame for a gate in a look. */
export function gateFrame(gate: Gate, look: 'open' | 'closed'): string {
  return `${look}_${gate.dir}`;
}
