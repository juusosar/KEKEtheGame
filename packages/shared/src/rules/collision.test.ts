import { describe, expect, it } from 'vitest';
import { aabbOverlapsSolid, circleSeparation, circlesOverlap, isSolidTile, moveAabb } from './collision';
import { gridFrom } from './testGrid';

// 32 px tiles. Interior floor spans x,y in [32, 160) for the 6×6 room.
const room = gridFrom(['######', '#....#', '#....#', '#....#', '#....#', '######']);
const half = { hw: 10, hh: 10 };

describe('isSolidTile', () => {
  it('treats tiles outside the grid as solid', () => {
    const open = gridFrom(['..', '..']);
    expect(isSolidTile(open, 0, 0)).toBe(false);
    expect(isSolidTile(open, -1, 0)).toBe(true);
    expect(isSolidTile(open, 2, 0)).toBe(true);
    expect(isSolidTile(open, 0, 2)).toBe(true);
  });
});

describe('moveAabb', () => {
  it('moves freely in open space', () => {
    expect(moveAabb(room, { x: 80, y: 80 }, half, { x: 12, y: -7 })).toEqual({
      x: 92,
      y: 73,
      hitX: false,
      hitY: false,
    });
  });

  it('stops flush against a wall on each side', () => {
    expect(moveAabb(room, { x: 80, y: 80 }, half, { x: 500, y: 0 })).toMatchObject({ x: 150, hitX: true });
    expect(moveAabb(room, { x: 80, y: 80 }, half, { x: -500, y: 0 })).toMatchObject({ x: 42, hitX: true });
    expect(moveAabb(room, { x: 80, y: 80 }, half, { x: 0, y: 500 })).toMatchObject({ y: 150, hitY: true });
    expect(moveAabb(room, { x: 80, y: 80 }, half, { x: 0, y: -500 })).toMatchObject({ y: 42, hitY: true });
  });

  it('slides along a wall when pushed diagonally into it', () => {
    // Flush against the right wall, pushing right and down: x stays, y keeps going.
    const r = moveAabb(room, { x: 150, y: 80 }, half, { x: 8, y: 8 });
    expect(r).toEqual({ x: 150, y: 88, hitX: true, hitY: false });
  });

  it('stops in a room corner on both axes', () => {
    const r = moveAabb(room, { x: 145, y: 145 }, half, { x: 20, y: 20 });
    expect(r).toEqual({ x: 150, y: 150, hitX: true, hitY: true });
  });

  it('does not count touching a wall as overlapping, so a flush box can move away and along it', () => {
    expect(aabbOverlapsSolid(room, { x: 150, y: 80 }, half)).toBe(false);
    expect(moveAabb(room, { x: 150, y: 80 }, half, { x: -5, y: 0 })).toMatchObject({ x: 145, hitX: false });
    expect(moveAabb(room, { x: 150, y: 80 }, half, { x: 0, y: 5 })).toMatchObject({ y: 85, hitY: false });
  });

  it('does not snag on the seam between two wall tiles while sliding', () => {
    // Flush against the top wall, sliding right across tile boundaries.
    const r = moveAabb(room, { x: 42, y: 42 }, half, { x: 60, y: -3 });
    expect(r).toEqual({ x: 102, y: 42, hitX: false, hitY: true });
  });

  it('fits through a one-tile gap only when aligned with it', () => {
    const gap = gridFrom(['#######', '#.....#', '###.###', '#.....#', '#######']);
    // Gap column is x in [96, 128). Centred under it, moving up passes through.
    expect(moveAabb(gap, { x: 112, y: 112 }, half, { x: 0, y: -64 })).toMatchObject({ y: 48, hitY: false });
    // Offset so the box straddles the gap edge: blocked by the wall row (bottom at y = 96).
    expect(moveAabb(gap, { x: 90, y: 112 }, half, { x: 0, y: -64 })).toMatchObject({ y: 106, hitY: true });
  });

  it('handles an outside corner: diagonal into a lone block slides on the free axis', () => {
    const pillar = gridFrom(['######', '#....#', '#.#..#', '#....#', '######']);
    // Pillar tile is [64,96)×[64,96). Box above-left of it, moving down-right into its top-left corner.
    const r = moveAabb(pillar, { x: 50, y: 50 }, half, { x: 10, y: 10 });
    expect(aabbOverlapsSolid(pillar, r, half)).toBe(false);
    expect(r.hitX !== r.hitY).toBe(true);
  });

  it('does not tunnel through a one-tile wall with a huge delta', () => {
    const wall = gridFrom(['#######', '#..#..#', '#######']);
    const r = moveAabb(wall, { x: 48, y: 48 }, half, { x: 10_000, y: 0 });
    expect(r).toMatchObject({ x: 86, hitX: true });
  });

  it('never leaves the map edge even without border walls', () => {
    const open = gridFrom(['...', '...', '...']);
    const r = moveAabb(open, { x: 48, y: 48 }, half, { x: -1000, y: 1000 });
    expect(r).toEqual({ x: 10, y: 86, hitX: true, hitY: true });
  });
});

describe('circles', () => {
  it('detects overlap but not touching', () => {
    expect(circlesOverlap({ x: 0, y: 0, r: 10 }, { x: 15, y: 0, r: 10 })).toBe(true);
    expect(circlesOverlap({ x: 0, y: 0, r: 10 }, { x: 20, y: 0, r: 10 })).toBe(false);
    expect(circleSeparation({ x: 0, y: 0, r: 10 }, { x: 30, y: 0, r: 10 })).toBeNull();
  });

  it('separation pushes a fully out of b along the centre line', () => {
    const a = { x: 0, y: 0, r: 10 };
    const c = { x: 9, y: 12, r: 10 }; // distance 15, so depth 5
    const sep = circleSeparation(a, c);
    expect(sep?.x).toBeCloseTo(-3);
    expect(sep?.y).toBeCloseTo(-4);
    expect(circlesOverlap({ x: a.x + (sep?.x ?? 0), y: a.y + (sep?.y ?? 0), r: 10 }, c)).toBe(false);
  });

  it('separates coincident circles deterministically', () => {
    expect(circleSeparation({ x: 5, y: 5, r: 8 }, { x: 5, y: 5, r: 4 })).toEqual({ x: -12, y: 0 });
  });
});
