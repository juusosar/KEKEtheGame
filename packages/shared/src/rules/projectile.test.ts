import { describe, expect, it } from 'vitest';
import {
  aimDirection,
  areaTargets,
  reflectFlight,
  stepProjectile,
  sweepHitTime,
  wallHitTime,
  type ProjectileFlight,
} from './projectile';
import { gridFrom } from './testGrid';

// 10 × 5 tiles of 32 px; a wall column at tile x = 7.
const grid = gridFrom(['##########', '#......#.#', '#......#.#', '#......#.#', '##########']);
const R = 12;

function flight(over: Partial<ProjectileFlight> = {}): ProjectileFlight {
  return {
    x: 48,
    y: 80,
    dir: { x: 1, y: 0 },
    speedPxPerSecond: 400,
    rangePx: 320,
    travelledPx: 0,
    radiusPx: 6,
    ...over,
  };
}

describe('aimDirection', () => {
  it('is a unit vector along the angle (y down)', () => {
    expect(aimDirection(0)).toEqual({ x: 1, y: 0 });
    const down = aimDirection(Math.PI / 2);
    expect(down.x).toBeCloseTo(0);
    expect(down.y).toBeCloseTo(1);
  });
});

describe('sweepHitTime', () => {
  it('finds when a moving circle first touches a point', () => {
    expect(sweepHitTime({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 0 }, 10)).toBeCloseTo(0.4);
  });
  it('is 0 when it starts touching and null when it passes wide or falls short', () => {
    expect(sweepHitTime({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 5, y: 0 }, 10)).toBe(0);
    expect(sweepHitTime({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 11 }, 10)).toBeNull();
    expect(sweepHitTime({ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 50, y: 0 }, 10)).toBeNull();
    expect(sweepHitTime({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: -50, y: 0 }, 10)).toBeNull();
  });
});

describe('wallHitTime', () => {
  it('stops before the first solid tile and is null over open floor', () => {
    // From x = 48 to x = 268: the wall starts at x = 224.
    const t = wallHitTime(grid, { x: 48, y: 80 }, { x: 220, y: 0 });
    expect(t).not.toBeNull();
    expect(48 + 220 * (t ?? 1)).toBeLessThan(224);
    expect(48 + 220 * (t ?? 1)).toBeGreaterThan(224 - 9);
    expect(wallHitTime(grid, { x: 48, y: 80 }, { x: 100, y: 0 })).toBeNull();
  });
  it('cannot skip a one-tile wall however fast it goes', () => {
    expect(wallHitTime(grid, { x: 200, y: 80 }, { x: 80, y: 0 })).not.toBeNull();
  });
});

describe('stepProjectile', () => {
  it('flies speed × dt along its direction', () => {
    const step = stepProjectile(grid, flight(), 0.05, [], R);
    expect(step.impact).toBeNull();
    expect(step.flight.x).toBeCloseTo(68);
    expect(step.flight.travelledPx).toBeCloseTo(20);
  });

  it('hits the nearest body on its path and stops where it touches it', () => {
    const bodies = [
      { id: 'far', x: 120, y: 80 },
      { id: 'near', x: 90, y: 84 },
      { id: 'wide', x: 70, y: 120 },
    ];
    const step = stepProjectile(grid, flight(), 0.25, bodies, R);
    expect(step.impact).toEqual({ kind: 'body', id: 'near' });
    expect(Math.hypot(step.flight.x - 90, step.flight.y - 84)).toBeCloseTo(R + 6);
  });

  it('stops at a wall', () => {
    const step = stepProjectile(grid, flight({ x: 180 }), 0.25, [], R);
    expect(step.impact).toEqual({ kind: 'wall' });
    expect(step.flight.x).toBeLessThan(224);
  });

  it('prefers a body flush against the wall over the wall', () => {
    const step = stepProjectile(grid, flight({ x: 180 }), 0.25, [{ id: 'b', x: 210, y: 80 }], R);
    expect(step.impact).toEqual({ kind: 'body', id: 'b' });
  });

  it('lands at the end of its range', () => {
    const step = stepProjectile(grid, flight({ rangePx: 30 }), 0.25, [], R);
    expect(step.impact).toEqual({ kind: 'range' });
    expect(step.flight.x).toBeCloseTo(78);
    expect(step.flight.travelledPx).toBeCloseTo(30);
  });
});

describe('areaTargets', () => {
  it('reaches bodies overlapping the radius, nearest first', () => {
    const ids = areaTargets(
      { x: 0, y: 0 },
      32,
      [
        { id: 'edge', x: 32 + R, y: 0 },
        { id: 'out', x: 32 + R + 1, y: 0 },
        { id: 'centre', x: 1, y: 0 },
      ],
      R,
    );
    expect(ids).toEqual(['centre', 'edge']);
  });
});

describe('reflectFlight', () => {
  it('turns the projectile around with its full range again', () => {
    const back = reflectFlight(flight({ travelledPx: 100 }));
    expect(back.dir).toEqual({ x: -1, y: -0 });
    expect(back.travelledPx).toBe(0);
  });
});

describe('areaTargets with a grid (M4 review F3)', () => {
  const wall = gridFrom(['....', '.#..', '....']);
  const open = gridFrom(['....', '....', '....']);
  // A soda bursting just before the wall tile (1, 1); the body is in the next aisle, 52 px away.
  const centre = { x: 24, y: 48 };
  const body = { id: 'b', x: 76, y: 48 };

  it('does not splash through a wall', () => {
    expect(areaTargets(centre, 64, [body], 10)).toEqual(['b']);
    expect(areaTargets(centre, 64, [body], 10, wall)).toEqual([]);
  });

  it('splashes the same body with the wall gone', () => {
    expect(areaTargets(centre, 64, [body], 10, open)).toEqual(['b']);
  });
});
