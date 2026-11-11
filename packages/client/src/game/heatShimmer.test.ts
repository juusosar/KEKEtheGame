import { describe, expect, it } from 'vitest';
import type { Zone } from '@keke/shared';
import { glowAlpha, heatWaves } from './heatShimmer';

const oven: Zone = {
  id: 'oven',
  polygon: [
    { x: 128, y: 512 },
    { x: 192, y: 512 },
    { x: 192, y: 704 },
    { x: 128, y: 704 },
  ],
  bounds: { minX: 128, minY: 512, maxX: 192, maxY: 704 },
  area: 64 * 192,
  wantedOnEnter: false,
  damagePerSecond: 8,
};

describe('heat shimmer (P2-2)', () => {
  it('pulses the glow between its bounds', () => {
    for (let s = 0; s < 4; s += 0.1) {
      expect(glowAlpha(s)).toBeGreaterThanOrEqual(0.12 - 1e-9);
      expect(glowAlpha(s)).toBeLessThanOrEqual(0.28 + 1e-9);
    }
  });

  it('keeps every heat line inside the hot floor, and the lines rise', () => {
    for (let s = 0; s < 10; s += 0.37) {
      for (const w of heatWaves(oven, s)) {
        expect(w.x).toBeGreaterThan(128);
        expect(w.x).toBeLessThan(192);
        expect(w.y0).toBeGreaterThanOrEqual(512);
        expect(w.y1).toBeLessThanOrEqual(704);
        expect(w.y0).toBeLessThanOrEqual(w.y1);
      }
    }
    const a = heatWaves(oven, 1)[0];
    const b = heatWaves(oven, 1.1)[0];
    expect(b?.y1 ?? 0).toBeLessThan(a?.y1 ?? 0);
  });
});
