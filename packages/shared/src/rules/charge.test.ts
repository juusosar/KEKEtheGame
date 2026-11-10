import { describe, expect, it } from 'vitest';
import {
  chargeKnockbackDirection,
  distanceToSegment,
  scatterMoves,
  sideOfLine,
  sweepTargets,
} from './charge';
import { gridFrom } from './testGrid';

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing value');
  return value;
}

describe('charge geometry', () => {
  it('distanceToSegment clamps to the ends', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 100, y: 0 };
    expect(distanceToSegment({ x: 50, y: 10 }, a, b)).toBeCloseTo(10);
    expect(distanceToSegment({ x: -30, y: 40 }, a, b)).toBeCloseTo(50);
    expect(distanceToSegment({ x: 3, y: 4 }, a, a)).toBeCloseTo(5);
  });

  it('sweepTargets finds bodies in the band, nearest first', () => {
    const ids = sweepTargets({ x: 0, y: 0 }, { x: 100, y: 0 }, 20, [
      { id: 'far', x: 90, y: 5 },
      { id: 'near', x: 10, y: -15 },
      { id: 'off', x: 50, y: 30 },
      { id: 'behind', x: -30, y: 0 },
    ]);
    expect(ids).toEqual(['near', 'far']);
  });

  it('sideOfLine and the knockback point away from the line, to the body’s side', () => {
    const from = { x: 0, y: 0 };
    const dir = { x: 1, y: 0 };
    expect(sideOfLine(from, dir, { x: 10, y: 5 }).y).toBeCloseTo(1);
    expect(sideOfLine(from, dir, { x: 10, y: -5 }).y).toBeCloseTo(-1);
    const k = chargeKnockbackDirection(from, dir, { x: 10, y: 5 });
    expect(k.x).toBeGreaterThan(0);
    expect(k.y).toBeGreaterThan(0);
    expect(Math.hypot(k.x, k.y)).toBeCloseTo(1);
  });

  it('scatterMoves pushes items in the band out of the line and stops at walls', () => {
    const grid = gridFrom(['#######', '#.....#', '#.....#', '#.....#', '#######']);
    // Line along y = 80 (the middle row), from x 40 to x 180.
    const moves = scatterMoves(grid, { x: 40, y: 80 }, { x: 180, y: 80 }, 14, 48, [
      { id: 1, x: 100, y: 85 }, // below the line: pushed down to the wall
      { id: 2, x: 100, y: 70 }, // above: pushed up
      { id: 3, x: 100, y: 40 }, // outside the band
    ]);
    expect(moves.map((m) => m.id)).toEqual([1, 2]);
    expect(must(moves[0]).y).toBeGreaterThan(85);
    expect(must(moves[0]).y).toBeLessThanOrEqual(128 - 4); // floor ends at the wall row (y 128)
    expect(must(moves[1]).y).toBeLessThan(70);
    expect(must(moves[1]).y).toBeGreaterThanOrEqual(32 + 4);
  });
});
