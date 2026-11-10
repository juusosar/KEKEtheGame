// Pure geometry for the charge behaviour (pallet jack, §7; M4-6): a dash sweeps a straight band along
// the ground; bodies in the band are knocked down and flung aside, lying items scatter out of it.
import { moveAabb, type CollisionGrid, type HalfSize } from './collision';
import type { Vec2 } from '../types';

/** Distance from `p` to the segment a→b (to `a` when the segment has no length). */
export function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Ids of the points within `reach` of the swept segment from→to (a body counts when its centre is
 * within half the band width plus its radius), nearest to `from` first.
 */
export function sweepTargets(
  from: Vec2,
  to: Vec2,
  reach: number,
  candidates: readonly { readonly id: string; readonly x: number; readonly y: number }[],
): string[] {
  return candidates
    .filter((c) => distanceToSegment(c, from, to) <= reach)
    .map((c) => ({ id: c.id, d: Math.hypot(c.x - from.x, c.y - from.y) }))
    .sort((a, b) => a.d - b.d)
    .map((c) => c.id);
}

/**
 * Unit vector perpendicular to the dash direction `dir`, pointing to the side of the line through
 * `from` that `point` is on. A point right on the line goes to the dash's left (y up on screen: -dir.y).
 */
export function sideOfLine(from: Vec2, dir: Vec2, point: Vec2): Vec2 {
  const len = Math.hypot(dir.x, dir.y) || 1;
  const ux = dir.x / len;
  const uy = dir.y / len;
  // Left-hand normal in screen space (y down): (uy, -ux).
  const nx = uy;
  const ny = -ux;
  const side = (point.x - from.x) * nx + (point.y - from.y) * ny;
  return side < 0 ? { x: -nx, y: -ny } : { x: nx, y: ny };
}

/** Where a body hit by a dash is flung: half forward, half aside, away from the line (unit vector). */
export function chargeKnockbackDirection(from: Vec2, dir: Vec2, point: Vec2): Vec2 {
  const len = Math.hypot(dir.x, dir.y) || 1;
  const side = sideOfLine(from, dir, point);
  const x = side.x + dir.x / len;
  const y = side.y + dir.y / len;
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
}

/** Half size of a lying item when it is scattered through the collision grid. */
export const SCATTER_ITEM_HALF: HalfSize = { hw: 4, hh: 4 };

/**
 * New positions for the lying items in the band from→to (within `halfWidth` of the segment): each is
 * pushed `px` pixels straight out of the line, to its own side, stopping at walls.
 */
export function scatterMoves(
  grid: CollisionGrid,
  from: Vec2,
  to: Vec2,
  halfWidth: number,
  px: number,
  items: readonly { readonly id: number; readonly x: number; readonly y: number }[],
): { id: number; x: number; y: number }[] {
  const dir = { x: to.x - from.x, y: to.y - from.y };
  if (!(px > 0) || Math.hypot(dir.x, dir.y) < 1e-6) return [];
  const out: { id: number; x: number; y: number }[] = [];
  for (const item of items) {
    if (distanceToSegment(item, from, to) > halfWidth) continue;
    const side = sideOfLine(from, dir, item);
    const moved = moveAabb(grid, item, SCATTER_ITEM_HALF, { x: side.x * px, y: side.y * px });
    if (moved.x !== item.x || moved.y !== item.y) out.push({ id: item.id, x: moved.x, y: moved.y });
  }
  return out;
}
