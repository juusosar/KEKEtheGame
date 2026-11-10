import type { CollisionGrid } from './collision';
import { describe, expect, it } from 'vitest';
import { findSpawn, vanSpawn } from './spawn';

function grid(rows: string[]): CollisionGrid {
  return {
    width: rows[0]?.length ?? 0,
    height: rows.length,
    tileSize: 32,
    isSolid: (tx, ty) => rows[ty]?.[tx] === '#',
  };
}

const half = { hw: 10, hh: 10 };

describe('findSpawn', () => {
  it('keeps a free preferred position', () => {
    const g = grid(['....', '....']);
    expect(findSpawn(g, { x: 50, y: 40 }, half)).toEqual({ x: 50, y: 40 });
  });

  it('moves to the nearest free tile centre when the preferred spot is in a wall', () => {
    const g = grid(['####', '.##.', '####']);
    expect(findSpawn(g, { x: 48, y: 48 }, half)).toEqual({ x: 16, y: 48 });
  });

  it('throws when nothing is free', () => {
    expect(() => findSpawn(grid(['##', '##']), { x: 16, y: 16 }, half)).toThrow();
  });
});

describe('vanSpawn', () => {
  const g = grid(['......', '......']);
  const map = {
    collision: g,
    widthPx: 192,
    heightPx: 64,
    vanSlots: [
      { x: 16, y: 16 },
      { x: 80, y: 16 },
    ],
  };

  it('uses the van slot for the given order and wraps past the last van', () => {
    expect(vanSpawn(map, 0, half)).toEqual({ x: 16, y: 16 });
    expect(vanSpawn(map, 1, half)).toEqual({ x: 80, y: 16 });
    expect(vanSpawn(map, 2, half)).toEqual({ x: 16, y: 16 });
  });

  it('falls back to the map centre without vans', () => {
    expect(vanSpawn({ ...map, vanSlots: [] }, 0, half)).toEqual({ x: 96, y: 32 });
  });
});
