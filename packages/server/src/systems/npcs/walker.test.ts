// Walker (M5-3): follows A* paths around walls and searches again only on events.
import type { CollisionGrid } from '@keke/shared';
import { describe, expect, it } from 'vitest';
import { Walker } from './walker';

function gridFrom(
  rows: readonly string[],
  blocked: (tx: number, ty: number) => boolean = () => false,
): CollisionGrid {
  return {
    width: rows[0]?.length ?? 0,
    height: rows.length,
    tileSize: 32,
    isSolid: (tx, ty) => rows[ty]?.[tx] === '#' || blocked(tx, ty),
  };
}

const rows = ['##########', '#........#', '#.######.#', '#........#', '##########'];
const half = { hw: 10, hh: 10 };
const centre = (tx: number, ty: number) => ({ x: tx * 32 + 16, y: ty * 32 + 16 });
const dt = 0.05;

function walk(
  w: Walker,
  grid: CollisionGrid,
  from: { x: number; y: number },
  goal: { x: number; y: number },
  ticks: number,
  version = 0,
) {
  let pos = from;
  let result = 'walking';
  for (let i = 0; i < ticks && result !== 'arrived'; i++) {
    const step = w.step(grid, pos, half, goal, 100 * dt, dt, i * dt, version);
    pos = step.position;
    result = step.result;
  }
  return { pos, result };
}

describe('Walker', () => {
  it('walks around a wall to the goal with one search', () => {
    const w = new Walker();
    const grid = gridFrom(rows);
    const { pos, result } = walk(w, grid, centre(1, 1), centre(1, 3), 200);
    expect(result).toBe('arrived');
    expect(pos).toEqual(centre(1, 3));
    expect(w.searches).toBe(1);
  });

  it('a goal that moves less than a tile keeps the path; more than a tile searches again', () => {
    const w = new Walker();
    const grid = gridFrom(rows);
    const from = centre(1, 1);
    w.step(grid, from, half, centre(8, 3), 5, dt, 0, 0);
    expect(w.searches).toBe(1);
    w.step(grid, from, half, { x: centre(8, 3).x - 10, y: centre(8, 3).y }, 5, dt, dt, 0);
    expect(w.searches).toBe(1);
    w.step(grid, from, half, centre(4, 3), 5, dt, 2 * dt, 0);
    expect(w.searches).toBe(2);
  });

  it('a cart change searches again; an unreachable goal is retried only after a second', () => {
    const w = new Walker();
    let cart = false;
    const grid = gridFrom(rows, (tx, ty) => cart && tx === 1 && ty === 2);
    const from = centre(1, 1);
    w.step(grid, from, half, centre(1, 3), 5, dt, 0, 0);
    expect(w.searches).toBe(1);
    cart = true;
    w.step(grid, from, half, centre(1, 3), 5, dt, dt, 1);
    expect(w.searches).toBe(2);
    // Sealed off: the corridor is blocked at (1,2) and the long way round is open, so it still finds one.
    // Seal the long way too.
    const sealed = gridFrom(rows, (tx, ty) => (tx === 1 && ty === 2) || (tx === 8 && ty === 2));
    const v = new Walker();
    expect(v.step(sealed, from, half, centre(1, 3), 5, dt, 0, 0).result).toBe('unreachable');
    expect(v.step(sealed, from, half, centre(1, 3), 5, dt, 0.5, 0).result).toBe('unreachable');
    expect(v.searches).toBe(1);
    v.step(sealed, from, half, centre(1, 3), 5, dt, 1.2, 0);
    expect(v.searches).toBe(2);
  });
});
