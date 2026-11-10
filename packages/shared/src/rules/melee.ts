// Melee geometry and knockback (§7, M4-2). Pure, like the rest of rules/: the server finds who a swing
// reaches with `meleeTargets`, and every behaviour that shoves a body (melee, soda burst, extinguisher,
// pallet jack) moves it with `knockbackStep` through the collision grid, so nobody is pushed into a wall.
import type { GameConfig } from '../config';
import type { Vec2 } from '../types';
import type { MeleeStats } from '../weapons/catalogue';
import { clearLine, moveAabb, type CollisionGrid, type HalfSize } from './collision';

/** Smallest signed difference between two angles in radians, in (-π, π]. */
export function angleDelta(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** A body a swing may reach: centre position and an id. */
export interface MeleeCandidate {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

/**
 * True when a body centred at `target` with radius `targetRadius` is inside the swing: its centre is
 * within `rangePx + targetRadius` of the attacker's centre, and within half the arc of the aim angle
 * (widened by the angle the body's radius covers at that distance, so a body half inside the arc counts).
 * A body overlapping the attacker's centre is always hit.
 */
export function inMeleeArc(
  origin: Vec2,
  aim: number,
  target: Vec2,
  stats: Pick<MeleeStats, 'rangePx' | 'arcDegrees'>,
  targetRadius: number,
): boolean {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const dist = Math.hypot(dx, dy);
  if (dist > stats.rangePx + targetRadius) return false;
  if (dist <= targetRadius) return true;
  const half = (stats.arcDegrees * Math.PI) / 360;
  const slack = Math.asin(Math.min(1, targetRadius / dist));
  return Math.abs(angleDelta(Math.atan2(dy, dx), aim)) <= half + slack;
}

/**
 * Ids of the candidates a swing from `origin` along `aim` reaches, nearest first (ties keep input order).
 * With a grid, a body needs a clear line from the attacker's centre, so a swing does not reach around a
 * wall corner (M4 review F3).
 */
export function meleeTargets(
  origin: Vec2,
  aim: number,
  candidates: readonly MeleeCandidate[],
  stats: Pick<MeleeStats, 'rangePx' | 'arcDegrees'>,
  targetRadius: number,
  grid?: CollisionGrid,
): string[] {
  return candidates
    .map((c, i) => ({ c, i, d: Math.hypot(c.x - origin.x, c.y - origin.y) }))
    .filter(({ c }) => inMeleeArc(origin, aim, c, stats, targetRadius))
    .filter(({ c }) => !grid || clearLine(grid, origin, c))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map(({ c }) => c.id);
}

/** Unit vector from `from` to `to`; along `fallbackAngle` when the two points coincide. */
export function knockbackDirection(from: Vec2, to: Vec2, fallbackAngle: number): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { x: Math.cos(fallbackAngle), y: Math.sin(fallbackAngle) };
  return { x: dx / len, y: dy / len };
}

/** A shove in progress: `remainingPx` still to travel along the unit vector `dir`, at `speedPxPerSecond`. */
export interface Knockback {
  readonly dir: Vec2;
  readonly remainingPx: number;
  readonly speedPxPerSecond: number;
}

/**
 * Starts a shove of `distancePx` along `dir` that plays out over `knockbackSeconds` (config). A shove of
 * 0 px (or 0 s) returns null. Spread over a few ticks rather than a teleport, so other clients see a slide.
 */
export function startKnockback(
  dir: Vec2,
  distancePx: number,
  config: Pick<GameConfig, 'knockbackSeconds'>,
): Knockback | null {
  if (!(distancePx > 0)) return null;
  const len = Math.hypot(dir.x, dir.y);
  if (!(len > 0)) return null;
  const unit = { x: dir.x / len, y: dir.y / len };
  const seconds = config.knockbackSeconds;
  // 0 s means "all at once": one step moves the full distance.
  const speed = seconds > 0 ? distancePx / seconds : Number.POSITIVE_INFINITY;
  return { dir: unit, remainingPx: distancePx, speedPxPerSecond: speed };
}

/**
 * Moves a body along its shove for `dt` seconds through the collision grid. Returns the new position
 * and the shove left, or null when it has finished or ran into a wall (a wall stops the shove).
 */
export function knockbackStep(
  grid: CollisionGrid,
  pos: Vec2,
  half: HalfSize,
  knockback: Knockback,
  dt: number,
): { pos: Vec2; knockback: Knockback | null } {
  const px = Math.min(knockback.remainingPx, knockback.speedPxPerSecond * Math.max(0, dt));
  const moved = moveAabb(grid, pos, half, { x: knockback.dir.x * px, y: knockback.dir.y * px });
  const remainingPx = knockback.remainingPx - px;
  // Pinned against a wall (nothing moved although it should have): the shove ends.
  const stuck = px > 0 && Math.hypot(moved.x - pos.x, moved.y - pos.y) < 1e-6;
  const done = remainingPx <= 1e-6 || stuck;
  return {
    pos: { x: moved.x, y: moved.y },
    knockback: done ? null : { ...knockback, remainingPx },
  };
}

/**
 * The combat part of a player's movement speed from synced state (§3.3, §7), so server and client
 * prediction use the same numbers (M2 review H1): 0 while KO'd, stunned or charging, else the slow multiplier
 * times the block multiplier (pan, M4-6; pass 1 when not blocking). Multiply by `carryMultiplier`.
 */
export function syncedCombatSpeed(state: {
  readonly alive: boolean;
  readonly stunned: boolean;
  readonly slowMultiplier: number;
  readonly blockSpeedMultiplier?: number;
  /** Dashing with a pallet jack (M4-6): the dash moves the body, input does not. */
  readonly charging?: boolean;
}): number {
  if (!state.alive || state.stunned || state.charging) return 0;
  return state.slowMultiplier * (state.blockSpeedMultiplier ?? 1);
}
