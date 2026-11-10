import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config';
import { getWeaponCatalogue } from '../weapons/catalogue';
import {
  angleDelta,
  inMeleeArc,
  knockbackDirection,
  knockbackStep,
  meleeTargets,
  startKnockback,
  syncedCombatSpeed,
} from './melee';
import { gridFrom } from './testGrid';

const config = loadConfig();
const weapons = getWeaponCatalogue();
const melee = (id: string) => {
  const def = weapons.require(id);
  if (!('melee' in def)) throw new Error(`${id} has no melee stats`);
  return def.melee;
};
const R = config.playerHitboxSize / 2;
const origin = { x: 100, y: 100 };

describe('angleDelta', () => {
  it('wraps to (-π, π]', () => {
    expect(angleDelta(0.1, -0.1)).toBeCloseTo(0.2);
    expect(angleDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(-0.2);
    expect(angleDelta(4 * Math.PI, 0)).toBeCloseTo(0);
  });
});

describe('inMeleeArc', () => {
  const fists = melee('fists'); // 28 px, 90°

  it('hits a body straight ahead within reach plus body radius', () => {
    expect(inMeleeArc(origin, 0, { x: 100 + fists.rangePx + R, y: 100 }, fists, R)).toBe(true);
    expect(inMeleeArc(origin, 0, { x: 100 + fists.rangePx + R + 1, y: 100 }, fists, R)).toBe(false);
  });

  it('misses bodies behind or beside the arc and hits ones half inside its edge', () => {
    expect(inMeleeArc(origin, 0, { x: 80, y: 100 }, fists, R)).toBe(false); // behind, 20 px
    expect(inMeleeArc(origin, 0, { x: 100, y: 130 }, fists, R)).toBe(false); // 90° off a 90° arc (half = 45°) + slack ~19°
    // 55° off: outside 45° by centre, but the body's radius covers the gap.
    const at = (deg: number) => ({
      x: 100 + 30 * Math.cos((deg * Math.PI) / 180),
      y: 100 + 30 * Math.sin((deg * Math.PI) / 180),
    });
    expect(inMeleeArc(origin, 0, at(55), fists, R)).toBe(true);
    expect(inMeleeArc(origin, 0, at(70), fists, R)).toBe(false);
  });

  it('always hits a body on top of the attacker', () => {
    expect(inMeleeArc(origin, 0, { x: 95, y: 100 }, fists, R)).toBe(true);
  });

  it('the baguette arc (140°) reaches wider than fists (90°)', () => {
    const side = { x: 100 + 30 * Math.cos(1.15), y: 100 + 30 * Math.sin(1.15) }; // ~66°
    expect(inMeleeArc(origin, 0, side, melee('fists'), R)).toBe(false);
    expect(inMeleeArc(origin, 0, side, melee('baguette'), R)).toBe(true);
  });
});

describe('meleeTargets', () => {
  it('returns everyone in the arc, nearest first', () => {
    const stats = melee('baguette');
    const ids = meleeTargets(
      origin,
      Math.PI / 2, // aiming down
      [
        { id: 'far', x: 100, y: 145 },
        { id: 'behind', x: 100, y: 70 },
        { id: 'near', x: 104, y: 120 },
      ],
      stats,
      R,
    );
    expect(ids).toEqual(['near', 'far']);
  });
});

describe('knockback', () => {
  it('points away from the attacker, or along the aim when on top of them', () => {
    expect(knockbackDirection({ x: 0, y: 0 }, { x: 3, y: 4 }, 0)).toEqual({ x: 0.6, y: 0.8 });
    const d = knockbackDirection({ x: 5, y: 5 }, { x: 5, y: 5 }, Math.PI / 2);
    expect(d.x).toBeCloseTo(0);
    expect(d.y).toBeCloseTo(1);
  });

  it('spreads the distance over knockbackSeconds and stops when done', () => {
    const grid = gridFrom(['..........', '..........', '..........']);
    const half = { hw: R, hh: R };
    let kb = startKnockback({ x: 1, y: 0 }, 96, { knockbackSeconds: 0.15 });
    expect(kb).not.toBeNull();
    let pos = { x: 40, y: 48 };
    let steps = 0;
    while (kb) {
      const next = knockbackStep(grid, pos, half, kb, 0.05);
      pos = next.pos;
      kb = next.knockback;
      steps++;
    }
    expect(steps).toBe(3);
    expect(pos.x).toBeCloseTo(136);
    expect(pos.y).toBe(48);
  });

  it('a wall stops the shove early', () => {
    const grid = gridFrom(['....#', '....#', '....#']);
    const half = { hw: R, hh: R };
    let kb = startKnockback({ x: 1, y: 0 }, 96, { knockbackSeconds: 0.15 });
    let pos = { x: 40, y: 48 };
    for (let i = 0; i < 10 && kb; i++) {
      const next = knockbackStep(grid, pos, half, kb, 0.05);
      pos = next.pos;
      kb = next.knockback;
    }
    expect(kb).toBeNull();
    expect(pos.x).toBe(128 - R); // flush with the wall tile at x = 128
  });

  it('0 px or no direction starts nothing; 0 s moves everything in one step', () => {
    expect(startKnockback({ x: 1, y: 0 }, 0, { knockbackSeconds: 0.15 })).toBeNull();
    expect(startKnockback({ x: 0, y: 0 }, 10, { knockbackSeconds: 0.15 })).toBeNull();
    const kb = startKnockback({ x: 0, y: 2 }, 10, { knockbackSeconds: 0 });
    if (!kb) throw new Error('no knockback');
    const next = knockbackStep(
      gridFrom(['....', '....', '....']),
      { x: 48, y: 20 },
      { hw: R, hh: R },
      kb,
      0.05,
    );
    expect(next.pos).toEqual({ x: 48, y: 30 });
    expect(next.knockback).toBeNull();
  });
});

describe('syncedCombatSpeed', () => {
  it('is 0 when KO or stunned, else slow × block', () => {
    expect(syncedCombatSpeed({ alive: false, stunned: false, slowMultiplier: 1 })).toBe(0);
    expect(syncedCombatSpeed({ alive: true, stunned: true, slowMultiplier: 1 })).toBe(0);
    expect(syncedCombatSpeed({ alive: true, stunned: false, slowMultiplier: 0.6 })).toBe(0.6);
    expect(
      syncedCombatSpeed({ alive: true, stunned: false, slowMultiplier: 0.6, blockSpeedMultiplier: 0.5 }),
    ).toBeCloseTo(0.3);
  });
});

describe('meleeTargets with a grid (M4 review F3)', () => {
  const wall = gridFrom(['....', '.#..', '....']);
  const open = gridFrom(['....', '....', '....']);
  const stats = { rangePx: 50, arcDegrees: 360 };
  const origin = { x: 28, y: 28 };
  // Diagonally past the wall tile's corner: 48 px away, the straight line crosses tile (1, 1).
  const body = { id: 'b', x: 52, y: 70 };

  it('does not reach around a wall corner', () => {
    expect(meleeTargets(origin, 0, [body], stats, 10)).toEqual(['b']);
    expect(meleeTargets(origin, 0, [body], stats, 10, wall)).toEqual([]);
  });

  it('hits the same body with the wall gone', () => {
    expect(meleeTargets(origin, 0, [body], stats, 10, open)).toEqual(['b']);
  });
});
