import { describe, expect, it } from 'vitest';
import {
  advanceAlongPath,
  findPath,
  findTilePath,
  tileCentre,
  tileOf,
  walkableLine,
  type TilePoint,
} from './pathfinding';
import { aabbOverlapsSolid } from './collision';
import { createRng } from '../rng';
import { gridFrom } from './testGrid';

const T = 32;
const c = (t: number): number => t * T + T / 2;
const tp = (tx: number, ty: number): TilePoint => ({ tx, ty });
const key = (p: TilePoint): string => `${p.tx},${p.ty}`;

/** Checks every step of a tile path is one 8-neighbour move onto floor without cutting a wall corner. */
function expectValidTilePath(rows: readonly string[], path: readonly TilePoint[]): void {
  const solid = (x: number, y: number): boolean => rows[y]?.[x] !== '.';
  for (const p of path) expect(solid(p.tx, p.ty), key(p)).toBe(false);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1] as TilePoint;
    const b = path[i] as TilePoint;
    const dx = b.tx - a.tx;
    const dy = b.ty - a.ty;
    expect(Math.max(Math.abs(dx), Math.abs(dy))).toBe(1);
    if (dx !== 0 && dy !== 0) {
      expect(solid(a.tx + dx, a.ty) || solid(a.tx, a.ty + dy), `corner cut at ${key(a)}`).toBe(false);
    }
  }
}

const cost = (path: readonly TilePoint[]): number =>
  path.slice(1).reduce((sum, p, i) => {
    const q = path[i] as TilePoint;
    return sum + (p.tx !== q.tx && p.ty !== q.ty ? Math.SQRT2 : 1);
  }, 0);

describe('tileOf / tileCentre', () => {
  const grid = gridFrom(['...']);
  it('round-trips tiles and pixel centres', () => {
    expect(tileOf(grid, { x: 33, y: 31.9 })).toEqual(tp(1, 0));
    expect(tileCentre(grid, tp(2, 0))).toEqual({ x: 80, y: 16 });
    expect(tileOf(grid, tileCentre(grid, tp(2, 0)))).toEqual(tp(2, 0));
  });
});

describe('findTilePath', () => {
  const open = ['.....', '.....', '.....'];

  it('returns just the start when start is the goal', () => {
    expect(findTilePath(gridFrom(open), tp(1, 1), tp(1, 1))).toEqual([tp(1, 1)]);
  });

  it('walks straight and diagonally on open floor with the octile cost', () => {
    const path = findTilePath(gridFrom(open), tp(0, 0), tp(4, 2)) as TilePoint[];
    expect(path[0]).toEqual(tp(0, 0));
    expect(path.at(-1)).toEqual(tp(4, 2));
    expect(path).toHaveLength(5);
    expect(cost(path)).toBeCloseTo(2 + 2 * Math.SQRT2);
    expectValidTilePath(open, path);
  });

  it('only takes straight steps with diagonal: false', () => {
    const path = findTilePath(gridFrom(open), tp(0, 0), tp(4, 2), { diagonal: false }) as TilePoint[];
    expect(path).toHaveLength(7);
    expect(cost(path)).toBe(6);
  });

  it('goes around a wall through the only gap', () => {
    const rows = ['.....', '.###.', '.#.#.', '.#.#.', '.....'];
    const path = findTilePath(gridFrom(rows), tp(2, 2), tp(2, 0));
    // The pocket at (2,2) opens only to the south.
    expect(path).not.toBeNull();
    expectValidTilePath(rows, path as TilePoint[]);
    expect((path as TilePoint[])[1]).toEqual(tp(2, 3));
  });

  it('never cuts a wall corner', () => {
    const rows = ['.#', '..'];
    const path = findTilePath(gridFrom(rows), tp(0, 0), tp(1, 1)) as TilePoint[];
    expect(path).toEqual([tp(0, 0), tp(0, 1), tp(1, 1)]);
    // Two diagonal walls with a diagonal gap between them: no squeezing through.
    const pinch = ['.#', '#.'];
    expect(findTilePath(gridFrom(pinch), tp(0, 0), tp(1, 1))).toBeNull();
  });

  it('returns null for a wall goal, an off-grid goal or start, and an unreachable goal', () => {
    const rows = ['..#..', '..#..', '..#..'];
    const grid = gridFrom(rows);
    expect(findTilePath(grid, tp(0, 0), tp(2, 1))).toBeNull();
    expect(findTilePath(grid, tp(0, 0), tp(9, 1))).toBeNull();
    expect(findTilePath(grid, tp(-1, 0), tp(1, 1))).toBeNull();
    expect(findTilePath(grid, tp(0, 0), tp(4, 1))).toBeNull();
  });

  it('can start from a solid tile', () => {
    const rows = ['#..'];
    expect(findTilePath(gridFrom(rows), tp(0, 0), tp(2, 0))).toEqual([tp(0, 0), tp(1, 0), tp(2, 0)]);
  });

  it('treats `blocked` tiles as walls, but never the start', () => {
    const rows = ['.....', '.....', '.....'];
    const cart = new Set(['2,0', '2,1']);
    const blocked = (x: number, y: number): boolean => cart.has(`${x},${y}`);
    const path = findTilePath(gridFrom(rows), tp(0, 0), tp(4, 0), { blocked }) as TilePoint[];
    expect(path.some((p) => cart.has(key(p)))).toBe(false);
    expect(path.some((p) => p.ty === 2)).toBe(true);
    expect(findTilePath(gridFrom(rows), tp(2, 0), tp(4, 0), { blocked })).not.toBeNull();
    expect(findTilePath(gridFrom(rows), tp(0, 0), tp(2, 1), { blocked })).toBeNull();
  });

  it('gives up after maxExpanded tiles', () => {
    const wide = Array.from({ length: 30 }, () => '.'.repeat(30));
    const grid = gridFrom(wide);
    expect(findTilePath(grid, tp(0, 0), tp(29, 29), { maxExpanded: 5 })).toBeNull();
    expect(findTilePath(grid, tp(0, 0), tp(29, 29))).not.toBeNull();
  });

  it('is deterministic: the same query always returns the same path', () => {
    const rows = ['........', '..##....', '..#..#..', '.....#..', '........'];
    const grid = gridFrom(rows);
    const first = findTilePath(grid, tp(0, 0), tp(7, 4));
    for (let i = 0; i < 5; i++) expect(findTilePath(grid, tp(0, 0), tp(7, 4))).toEqual(first);
    expectValidTilePath(rows, first as TilePoint[]);
  });

  it('finds the optimal path through a maze', () => {
    const rows = ['.#.......', '.#.#####.', '.#.#...#.', '.#.#.#.#.', '...#.#...', '####.####', '.........'];
    const path = findTilePath(gridFrom(rows), tp(0, 0), tp(0, 6)) as TilePoint[];
    expectValidTilePath(rows, path);
    // Down, right, up the third column, across the top, down the right, back in and down the middle.
    expect(path).toContainEqual(tp(8, 0));
    expect(path).toContainEqual(tp(4, 5));
  });
});

describe('walkableLine', () => {
  const rows = ['.....', '.....', '..#..', '.....'];
  const grid = gridFrom(rows);

  it('is clear in the open and blocked through a wall', () => {
    expect(walkableLine(grid, { x: c(0), y: c(0) }, { x: c(4), y: c(0) })).toBe(true);
    expect(walkableLine(grid, { x: c(0), y: c(2) }, { x: c(4), y: c(2) })).toBe(false);
  });

  it('accounts for the body size', () => {
    const a = { x: c(0), y: c(1) };
    const b = { x: c(4), y: c(1) };
    expect(walkableLine(grid, a, b, 0)).toBe(true);
    expect(walkableLine(grid, a, b, 10)).toBe(true);
    // A 40 px body centred on row 1 reaches into the wall on row 2.
    expect(walkableLine(grid, a, b, 20)).toBe(false);
  });

  it('respects blocked tiles', () => {
    const blocked = (x: number, y: number): boolean => x === 2 && y === 0;
    expect(walkableLine(grid, { x: c(0), y: c(0) }, { x: c(4), y: c(0) }, 0, blocked)).toBe(false);
  });
});

describe('findPath', () => {
  it('goes straight to the goal across open floor', () => {
    const grid = gridFrom(['......', '......', '......']);
    const to = { x: c(5), y: c(2) + 3 };
    expect(findPath(grid, { x: c(0), y: c(0) }, to)).toEqual([to]);
  });

  it('returns [] when already there and null when unreachable', () => {
    const grid = gridFrom(['..#..']);
    const p = { x: 20, y: 10 };
    expect(findPath(grid, p, p)).toEqual([]);
    expect(findPath(grid, p, { x: c(4), y: c(0) })).toBeNull();
  });

  it('bends around a wall with few waypoints that a body can walk straight', () => {
    const rows = ['........', '.######.', '........'];
    const grid = gridFrom(rows);
    const from = { x: c(3), y: c(0) };
    const to = { x: c(3), y: c(2) };
    const radius = 10;
    const path = findPath(grid, from, to, { radius }) as { x: number; y: number }[];
    expect(path.at(-1)).toEqual(to);
    expect(path.length).toBeLessThanOrEqual(3);
    let at = from;
    for (const p of path) {
      expect(walkableLine(grid, at, p, radius), `${at.x},${at.y} -> ${p.x},${p.y}`).toBe(true);
      at = p;
    }
  });

  it('keeps every tile centre with smooth: false', () => {
    const grid = gridFrom(['.....']);
    const to = { x: c(4), y: c(0) };
    expect(findPath(grid, { x: c(0), y: c(0) }, to, { smooth: false })).toEqual([
      { x: c(1), y: c(0) },
      { x: c(2), y: c(0) },
      { x: c(3), y: c(0) },
      to,
    ]);
  });

  it('keeps a body clear of walls on every sampled point of the walk', () => {
    const rows = ['.........', '.#####...', '.....#.#.', '###.##.#.', '.......#.', '.#####...'];
    const grid = gridFrom(rows);
    const from = { x: c(0), y: c(0) };
    const to = { x: c(0), y: c(4) };
    const half = { hw: 10, hh: 10 };
    const path = findPath(grid, from, to, { radius: 10 }) as { x: number; y: number }[];
    expect(path).not.toBeNull();
    let pos = from;
    let left: readonly { x: number; y: number }[] = path;
    while (left.length > 0) {
      const step = advanceAlongPath(pos, left, 4);
      pos = step.position;
      left = step.path;
      expect(aabbOverlapsSolid(grid, pos, half), `${pos.x},${pos.y}`).toBe(false);
    }
    expect(pos).toEqual(to);
  });
});

describe('findPath on random grids', () => {
  it('matches the optimal tile cost and walks clear of walls from tile centre to tile centre', () => {
    const rng = createRng(1234);
    const half = { hw: 10, hh: 10 };
    let checked = 0;
    for (let n = 0; n < 40; n++) {
      const rows = Array.from({ length: 14 }, () =>
        Array.from({ length: 18 }, () => (rng.next() < 0.28 ? '#' : '.')).join(''),
      );
      const grid = gridFrom(rows);
      const floor: TilePoint[] = [];
      rows.forEach((r, ty) => [...r].forEach((ch, tx) => ch === '.' && floor.push(tp(tx, ty))));
      const a = rng.pick(floor);
      const b = rng.pick(floor);
      const tiles = findTilePath(grid, a, b);
      const path = findPath(grid, tileCentre(grid, a), tileCentre(grid, b), { radius: 10 });
      expect(path === null, `grid ${n}`).toBe(tiles === null);
      if (tiles === null || path === null) continue;
      expectValidTilePath(rows, tiles);
      let pos = tileCentre(grid, a);
      let left: readonly { x: number; y: number }[] = path;
      while (left.length > 0) {
        const step = advanceAlongPath(pos, left, 3);
        pos = step.position;
        left = step.path;
        expect(aabbOverlapsSolid(grid, pos, half), `grid ${n} at ${pos.x},${pos.y}`).toBe(false);
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
  });
});

describe('advanceAlongPath', () => {
  const path = [
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ];

  it('moves part way along the first leg', () => {
    expect(advanceAlongPath({ x: 0, y: 0 }, path, 4)).toEqual({
      position: { x: 4, y: 0 },
      path,
      arrived: false,
      moved: 4,
    });
  });

  it('passes through waypoints and keeps the remainder', () => {
    const step = advanceAlongPath({ x: 0, y: 0 }, path, 15);
    expect(step.position).toEqual({ x: 10, y: 5 });
    expect(step.path).toEqual([{ x: 10, y: 10 }]);
    expect(step.arrived).toBe(false);
  });

  it('stops at the end and reports the distance actually moved', () => {
    const step = advanceAlongPath({ x: 0, y: 0 }, path, 100);
    expect(step).toEqual({ position: { x: 10, y: 10 }, path: [], arrived: true, moved: 20 });
  });

  it('treats an empty path as arrived and ignores negative distances', () => {
    expect(advanceAlongPath({ x: 1, y: 2 }, [], 5)).toMatchObject({ arrived: true, moved: 0 });
    expect(advanceAlongPath({ x: 0, y: 0 }, path, -3)).toMatchObject({ position: { x: 0, y: 0 }, moved: 0 });
  });
});
