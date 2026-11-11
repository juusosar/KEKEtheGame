import { describe, expect, it } from 'vitest';
import type { Zone } from '../map/mapModel';
import { hazardAt, hazardTick, hazardZones, type HazardClock } from './hazard';

function rect(id: string, x0: number, y0: number, x1: number, y1: number, damagePerSecond?: number): Zone {
  const polygon = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
  return {
    id,
    polygon,
    bounds: { minX: x0, minY: y0, maxX: x1, maxY: y1 },
    area: (x1 - x0) * (y1 - y0),
    wantedOnEnter: false,
    ...(damagePerSecond !== undefined && { damagePerSecond }),
  };
}

const bakery = rect('bakery', 0, 0, 400, 400);
const oven = rect('oven', 100, 100, 160, 300, 8);
const hazards = hazardZones([bakery, oven]);
const inOven = { id: 'a', x: 130, y: 200 };
const outside = { id: 'b', x: 300, y: 200 };

/** Runs the hazard rule at 20 Hz from `from` for `seconds`, returning every burn. */
function run(bodies: { id: string; x: number; y: number }[], seconds: number, from = 10) {
  let clock: HazardClock = new Map();
  const burns = [];
  for (let i = 0; i <= Math.round(seconds * 20); i++) {
    const now = from + i * 0.05;
    const r = hazardTick(clock, hazards, bodies, now, 0.5);
    clock = r.clock;
    burns.push(...r.burns.map((b) => ({ ...b, now })));
  }
  return burns;
}

describe('floor hazards (P2-2)', () => {
  it('finds only zones that hurt', () => {
    expect(hazards.map((z) => z.id)).toEqual(['oven']);
    expect(hazardAt(hazards, 130, 200)?.id).toBe('oven');
    expect(hazardAt(hazards, 300, 200)).toBeUndefined();
  });

  it('burns at once on entering, then every tick: 8 per second as 4 every 0.5 s', () => {
    const burns = run([inOven, outside], 2);
    expect(burns.every((b) => b.target === 'a' && b.zone === 'oven' && b.damage === 4)).toBe(true);
    expect(burns.map((b) => +(b.now - 10).toFixed(2))).toEqual([0, 0.5, 1, 1.5, 2]);
  });

  it('does not burn faster when stepping out and back in', () => {
    let clock: HazardClock = new Map();
    const at = (now: number, body: { id: string; x: number; y: number }) => {
      const r = hazardTick(clock, hazards, [body], now, 0.5);
      clock = r.clock;
      return r.burns.length;
    };
    expect(at(10, inOven)).toBe(1);
    expect(at(10.1, { ...inOven, x: 300 })).toBe(0);
    expect(at(10.2, inOven)).toBe(0);
    expect(at(10.5, inOven)).toBe(1);
  });

  it('forgets a clock that ran out', () => {
    const r = hazardTick(new Map([['a', 9]]), hazards, [], 10, 0.5);
    expect(r.clock.size).toBe(0);
  });

  it('does nothing on a map without hazards', () => {
    expect(hazardTick(new Map(), [], [inOven], 10, 0.5).burns).toEqual([]);
  });

  it('the strongest overlapping hazard wins', () => {
    const hot = rect('grill', 120, 150, 140, 250, 20);
    expect(hazardAt(hazardZones([oven, hot]), 130, 200)?.id).toBe('grill');
    expect(hazardAt(hazardZones([hot, oven]), 130, 200)?.id).toBe('grill');
  });
});
