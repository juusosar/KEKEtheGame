// Collision rules (§15.3): axis-aligned boxes against the tile grid, circles against circles.
// Pure and deterministic: no physics engine, no Phaser.
import type { Vec2 } from '../types';

/**
 * The solid-tile view of a map. `MapModel.collision` from shared/src/map satisfies this shape.
 * Tile coordinates are integers; `isSolid` may treat out-of-bounds as solid, and `isSolidTile`
 * below enforces that regardless.
 */
export interface CollisionGrid {
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
  isSolid(tx: number, ty: number): boolean;
}

/** True when tile (tx, ty) blocks movement. Everything outside the grid is solid, so nobody walks off the map. */
export function isSolidTile(grid: CollisionGrid, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= grid.width || ty >= grid.height) return true;
  return grid.isSolid(tx, ty);
}

/** Half extents of an axis-aligned box centred on an entity's position. */
export interface HalfSize {
  readonly hw: number;
  readonly hh: number;
}

/** Result of moving a box through the grid. `hitX`/`hitY` say which axis was stopped by a wall. */
export interface MoveResult {
  x: number;
  y: number;
  hitX: boolean;
  hitY: boolean;
}

/** Inclusive tile index range covered by the open interval (lo, hi): touching an edge is not overlapping. */
function tileSpan(lo: number, hi: number, tileSize: number): [number, number] {
  return [Math.floor(lo / tileSize), Math.ceil(hi / tileSize) - 1];
}

/** True when any tile in column `tx` between rows `ty0..ty1` is solid. */
function columnBlocked(grid: CollisionGrid, tx: number, ty0: number, ty1: number): boolean {
  for (let ty = ty0; ty <= ty1; ty++) if (isSolidTile(grid, tx, ty)) return true;
  return false;
}

/** True when any tile in row `ty` between columns `tx0..tx1` is solid. */
function rowBlocked(grid: CollisionGrid, ty: number, tx0: number, tx1: number): boolean {
  for (let tx = tx0; tx <= tx1; tx++) if (isSolidTile(grid, tx, ty)) return true;
  return false;
}

/** Moves the box along x only, stopping flush against the first solid column. */
function stepX(grid: CollisionGrid, x: number, y: number, half: HalfSize, dx: number): [number, boolean] {
  if (dx === 0) return [x, false];
  const ts = grid.tileSize;
  const [ty0, ty1] = tileSpan(y - half.hh, y + half.hh, ts);
  const nx = x + dx;
  if (dx > 0) {
    const tx = Math.ceil((nx + half.hw) / ts) - 1;
    if (columnBlocked(grid, tx, ty0, ty1)) return [tx * ts - half.hw, true];
  } else {
    const tx = Math.floor((nx - half.hw) / ts);
    if (columnBlocked(grid, tx, ty0, ty1)) return [(tx + 1) * ts + half.hw, true];
  }
  return [nx, false];
}

/** Moves the box along y only, stopping flush against the first solid row. */
function stepY(grid: CollisionGrid, x: number, y: number, half: HalfSize, dy: number): [number, boolean] {
  if (dy === 0) return [y, false];
  const ts = grid.tileSize;
  const [tx0, tx1] = tileSpan(x - half.hw, x + half.hw, ts);
  const ny = y + dy;
  if (dy > 0) {
    const ty = Math.ceil((ny + half.hh) / ts) - 1;
    if (rowBlocked(grid, ty, tx0, tx1)) return [ty * ts - half.hh, true];
  } else {
    const ty = Math.floor((ny - half.hh) / ts);
    if (rowBlocked(grid, ty, tx0, tx1)) return [(ty + 1) * ts + half.hh, true];
  }
  return [ny, false];
}

/**
 * Moves an AABB centred on (x, y) by (dx, dy) through the tile grid.
 *
 * Each sub-step resolves x first, then y, so a box pushed diagonally into a wall slides along it.
 * Sub-steps are at most half a tile long, so fast movers cannot tunnel through a one-tile wall.
 * The box is assumed to start outside solid tiles.
 */
export function moveAabb(grid: CollisionGrid, pos: Vec2, half: HalfSize, delta: Vec2): MoveResult {
  const maxStep = grid.tileSize / 2;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(delta.x), Math.abs(delta.y)) / maxStep));
  const sx = delta.x / steps;
  const sy = delta.y / steps;
  let { x, y } = pos;
  let hitX = false;
  let hitY = false;
  for (let i = 0; i < steps; i++) {
    if (!hitX) {
      const [nx, hx] = stepX(grid, x, y, half, sx);
      x = nx;
      hitX = hx;
    }
    if (!hitY) {
      const [ny, hy] = stepY(grid, x, y, half, sy);
      y = ny;
      hitY = hy;
    }
  }
  return { x, y, hitX, hitY };
}

/** True when the AABB centred on `pos` overlaps any solid tile (or leaves the grid). */
export function aabbOverlapsSolid(grid: CollisionGrid, pos: Vec2, half: HalfSize): boolean {
  const ts = grid.tileSize;
  const [tx0, tx1] = tileSpan(pos.x - half.hw, pos.x + half.hw, ts);
  const [ty0, ty1] = tileSpan(pos.y - half.hh, pos.y + half.hh, ts);
  for (let ty = ty0; ty <= ty1; ty++) if (rowBlocked(grid, ty, tx0, tx1)) return true;
  return false;
}

/** A circle body for entity-vs-entity checks (players, NPCs, items). */
export interface Circle {
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

/** True when the two circles overlap. Touching (distance equal to the radius sum) does not count. */
export function circlesOverlap(a: Circle, b: Circle): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const rr = a.r + b.r;
  return dx * dx + dy * dy < rr * rr;
}

/**
 * The smallest translation that moves circle `a` fully out of circle `b`, or `null` if they do not overlap.
 * Split it between the two bodies (e.g. half each) to separate them symmetrically.
 * Coincident centres push `a` towards −x so the result stays deterministic.
 */
export function circleSeparation(a: Circle, b: Circle): Vec2 | null {
  if (!circlesOverlap(a, b)) return null;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dist = Math.hypot(dx, dy);
  const depth = a.r + b.r - dist;
  if (dist === 0) return { x: -depth, y: 0 };
  return { x: (dx / dist) * depth, y: (dy / dist) * depth };
}
