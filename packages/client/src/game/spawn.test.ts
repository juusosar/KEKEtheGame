import type { CollisionGrid } from '@keke/shared';
import { describe, expect, it } from 'vitest';
import { findSpawn } from './spawn';

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
