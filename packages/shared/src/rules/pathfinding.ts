// Grid A* over the collision layer (§8 "Pathfinding: grid A* over the collision layer").
// Pure and deterministic: the same grid, start and goal always give the same path (ties break on
// insertion order, never on object identity or Math.random).
import type { Vec2 } from '../types';
import { aabbOverlapsSolid, isSolidTile, type CollisionGrid } from './collision';

/** A tile coordinate (integer column and row). */
export interface TilePoint {
  readonly tx: number;
  readonly ty: number;
}

export interface TilePathOptions {
  /**
   * Extra tiles to treat as walls on top of the grid, e.g. a parked stock cart or a tile another NPC
   * stands on. The start tile is never checked; the goal is (a blocked goal has no path).
   */
  readonly blocked?: (tx: number, ty: number) => boolean;
  /** Allow diagonal steps (default true). Diagonals never cut a wall corner. */
  readonly diagonal?: boolean;
  /**
   * Give up after expanding this many tiles and return null. Defaults to every tile on the grid, so a
   * search always finishes. Lower it to cap the cost of a search for an unreachable goal.
   */
  readonly maxExpanded?: number;
}

export interface PathOptions extends TilePathOptions {
  /**
   * Half size of the walker's square hitbox in pixels, used when straightening the path so shortcuts
   * never clip a wall. Defaults to 0 (a point). Tile-by-tile paths are clear for any body up to one
   * tile wide, because diagonals never cut corners.
   */
  readonly radius?: number;
  /** Straighten the tile path into as few waypoints as possible (default true). */
  readonly smooth?: boolean;
}

const SQRT2 = Math.SQRT2;
/** Neighbour order: E, S, W, N, then diagonals. Fixed so the search is deterministic. */
const STEPS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
];

/** The tile containing pixel position `p`. */
export function tileOf(grid: Pick<CollisionGrid, 'tileSize'>, p: Vec2): TilePoint {
  return { tx: Math.floor(p.x / grid.tileSize), ty: Math.floor(p.y / grid.tileSize) };
}

/** Pixel centre of tile `t`. */
export function tileCentre(grid: Pick<CollisionGrid, 'tileSize'>, t: TilePoint): Vec2 {
  return { x: (t.tx + 0.5) * grid.tileSize, y: (t.ty + 0.5) * grid.tileSize };
}

/** True when a walker may stand on tile (tx, ty): inside the grid, not a wall, not `blocked`. */
export function isWalkableTile(
  grid: CollisionGrid,
  tx: number,
  ty: number,
  blocked?: (tx: number, ty: number) => boolean,
): boolean {
  return !isSolidTile(grid, tx, ty) && !(blocked?.(tx, ty) ?? false);
}

/** Octile distance: the exact cost between two tiles on an open 8-connected grid. */
function octile(dx: number, dy: number): number {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  return Math.max(ax, ay) + (SQRT2 - 1) * Math.min(ax, ay);
}

/** Binary min-heap of node indices ordered by (f, h, insertion order). */
class OpenHeap {
  private readonly items: number[] = [];

  constructor(
    private readonly f: Float64Array,
    private readonly h: Float64Array,
    private readonly order: Uint32Array,
  ) {}

  get size(): number {
    return this.items.length;
  }

  private less(a: number, b: number): boolean {
    const fa = this.f[a] as number;
    const fb = this.f[b] as number;
    if (fa !== fb) return fa < fb;
    const ha = this.h[a] as number;
    const hb = this.h[b] as number;
    if (ha !== hb) return ha < hb;
    return (this.order[a] as number) < (this.order[b] as number);
  }

  push(node: number): void {
    const items = this.items;
    items.push(node);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(items[i] as number, items[parent] as number)) break;
      [items[i], items[parent]] = [items[parent] as number, items[i] as number];
      i = parent;
    }
  }

  pop(): number {
    const items = this.items;
    const top = items[0] as number;
    const last = items.pop() as number;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && this.less(items[l] as number, items[m] as number)) m = l;
        if (r < items.length && this.less(items[r] as number, items[m] as number)) m = r;
        if (m === i) break;
        [items[i], items[m]] = [items[m] as number, items[i] as number];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Shortest tile path from `start` to `goal` by A* (8-connected unless `diagonal: false`; straight
 * steps cost 1, diagonals √2 and are only allowed when both side tiles are walkable, so no corner
 * cutting). Returns every tile from `start` to `goal` inclusive, `[start]` when they are the same
 * tile, or null when the goal is a wall, blocked, off the grid, unreachable, or `maxExpanded` runs out.
 * The start tile itself may be solid (a body pushed into a wall still finds its way out).
 */
export function findTilePath(
  grid: CollisionGrid,
  start: TilePoint,
  goal: TilePoint,
  options: TilePathOptions = {},
): TilePoint[] | null {
  const { width, height } = grid;
  const { blocked, diagonal = true } = options;
  const maxExpanded = options.maxExpanded ?? width * height;
  const inside = (tx: number, ty: number): boolean => tx >= 0 && ty >= 0 && tx < width && ty < height;
  if (!inside(start.tx, start.ty) || !isWalkableTile(grid, goal.tx, goal.ty, blocked)) return null;
  if (start.tx === goal.tx && start.ty === goal.ty) return [{ tx: start.tx, ty: start.ty }];

  const count = width * height;
  const g = new Float64Array(count).fill(Infinity);
  const f = new Float64Array(count);
  const h = new Float64Array(count);
  const order = new Uint32Array(count);
  const parent = new Int32Array(count).fill(-1);
  const closed = new Uint8Array(count);
  const open = new OpenHeap(f, h, order);
  let pushes = 0;

  const startIdx = start.ty * width + start.tx;
  const goalIdx = goal.ty * width + goal.tx;
  g[startIdx] = 0;
  h[startIdx] = octile(goal.tx - start.tx, goal.ty - start.ty);
  f[startIdx] = h[startIdx] as number;
  order[startIdx] = pushes++;
  open.push(startIdx);

  const walkable = (tx: number, ty: number): boolean => isWalkableTile(grid, tx, ty, blocked);
  let expanded = 0;
  while (open.size > 0) {
    const current = open.pop();
    if (closed[current] === 1) continue; // stale heap entry
    if (current === goalIdx) return rebuild(parent, current, width);
    closed[current] = 1;
    if (++expanded > maxExpanded) return null;
    const cx = current % width;
    const cy = (current - cx) / width;
    const gc = g[current] as number;
    for (let s = 0; s < (diagonal ? 8 : 4); s++) {
      const [dx, dy] = STEPS[s] as readonly [number, number];
      const nx = cx + dx;
      const ny = cy + dy;
      if (!walkable(nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (!walkable(cx + dx, cy) || !walkable(cx, cy + dy))) continue;
      const next = ny * width + nx;
      if (closed[next] === 1) continue;
      const cost = gc + (dx !== 0 && dy !== 0 ? SQRT2 : 1);
      if (cost >= (g[next] as number)) continue;
      g[next] = cost;
      parent[next] = current;
      const hn = octile(goal.tx - nx, goal.ty - ny);
      h[next] = hn;
      f[next] = cost + hn;
      order[next] = pushes++;
      open.push(next);
    }
  }
  return null;
}

function rebuild(parent: Int32Array, end: number, width: number): TilePoint[] {
  const path: TilePoint[] = [];
  for (let i = end; i !== -1; i = parent[i] as number) {
    const tx = i % width;
    path.push({ tx, ty: (i - tx) / width });
  }
  return path.reverse();
}

/**
 * True when a square body of half size `radius` can slide in a straight line from `a` to `b` without
 * touching a wall or a `blocked` tile. Conservative: the line is cut into quarter-tile steps and each
 * step's whole swept box is checked, so it never misses a corner but may refuse a line that would
 * just graze one. `radius` 0 checks the line itself.
 */
export function walkableLine(
  grid: CollisionGrid,
  a: Vec2,
  b: Vec2,
  radius = 0,
  blocked?: (tx: number, ty: number) => boolean,
): boolean {
  const ts = grid.tileSize;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (ts / 4)));
  const sx = dx / steps;
  const sy = dy / steps;
  // Bounding box of one step's sweep: centred between the two samples, grown by half the step.
  // A tiny floor keeps a zero-size box on an exact tile edge from covering no tile at all.
  const half = {
    hw: Math.max(radius + Math.abs(sx) / 2, 1e-6),
    hh: Math.max(radius + Math.abs(sy) / 2, 1e-6),
  };
  for (let i = 0; i < steps; i++) {
    const p = { x: a.x + sx * (i + 0.5), y: a.y + sy * (i + 0.5) };
    if (aabbOverlapsSolid(grid, p, half)) return false;
    if (blocked && touchesBlocked(p, half.hw, half.hh, ts, blocked)) return false;
  }
  return true;
}

function touchesBlocked(
  p: Vec2,
  hw: number,
  hh: number,
  ts: number,
  blocked: (tx: number, ty: number) => boolean,
): boolean {
  // Same open-interval rule as the collision code: touching a tile edge is not overlapping.
  const x0 = Math.floor((p.x - hw) / ts);
  const x1 = Math.max(x0, Math.ceil((p.x + hw) / ts) - 1);
  const y0 = Math.floor((p.y - hh) / ts);
  const y1 = Math.max(y0, Math.ceil((p.y + hh) / ts) - 1);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) if (blocked(tx, ty)) return true;
  }
  return false;
}

/**
 * Pixel path from `from` to `to` for a walker: A* on tiles, then (unless `smooth: false`) straightened
 * by skipping every waypoint the body can reach in a straight line. The result does not include `from`
 * and ends exactly at `to`. Returns `[]` when `from` equals `to`, null when there is no path (`to` must be
 * on a walkable tile). Every leg after the first is clear for a body of half size `radius` (up to half a
 * tile); the first leg starts wherever the walker stands, so a walker hugging a wall may still graze a
 * corner on it, which the server's `moveAabb` slides along.
 */
export function findPath(
  grid: CollisionGrid,
  from: Vec2,
  to: Vec2,
  options: PathOptions = {},
): Vec2[] | null {
  const { radius = 0, smooth = true, blocked } = options;
  const tiles = findTilePath(grid, tileOf(grid, from), tileOf(grid, to), options);
  if (tiles === null) return null;
  if (from.x === to.x && from.y === to.y) return [];
  // Interior tile centres, then the exact goal. The start tile is where we already are.
  const points: Vec2[] = tiles.slice(1, -1).map((t) => tileCentre(grid, t));
  points.push({ x: to.x, y: to.y });
  if (!smooth) return points;
  const out: Vec2[] = [];
  let at = from;
  let i = 0;
  while (i < points.length) {
    // Furthest point reachable straight from `at`; at worst the next one (A* made it adjacent).
    let j = points.length - 1;
    while (j > i && !walkableLine(grid, at, points[j] as Vec2, radius, blocked)) j--;
    const p = points[j] as Vec2;
    out.push(p);
    at = p;
    i = j + 1;
  }
  return out;
}

export interface PathStep {
  /** New position after moving. */
  readonly position: Vec2;
  /** Waypoints still ahead (the first one reached is dropped). */
  readonly path: readonly Vec2[];
  /** True when the last waypoint was reached this step. */
  readonly arrived: boolean;
  /** Distance moved, at most `distance`. */
  readonly moved: number;
}

/**
 * Moves from `position` along `path` by up to `distance` pixels, passing through waypoints in order.
 * Pure: it does not check walls (a path from `findPath` is already clear; the server may still run the
 * result through `moveAabb`). An empty path means already arrived.
 */
export function advanceAlongPath(position: Vec2, path: readonly Vec2[], distance: number): PathStep {
  let { x, y } = position;
  let left = Math.max(0, distance);
  let i = 0;
  while (i < path.length) {
    const wp = path[i] as Vec2;
    const d = Math.hypot(wp.x - x, wp.y - y);
    if (d > left) {
      x += ((wp.x - x) / d) * left;
      y += ((wp.y - y) / d) * left;
      left = 0;
      break;
    }
    x = wp.x;
    y = wp.y;
    left -= d;
    i++;
  }
  const moved = Math.max(0, distance) - left;
  return { position: { x, y }, path: path.slice(i), arrived: i === path.length, moved };
}
