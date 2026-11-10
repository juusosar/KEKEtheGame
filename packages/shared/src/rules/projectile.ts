// Projectile flight and splash geometry (§7 thrown, §15.3; M4-3). Pure, like the rest of rules/: the
// server moves each projectile one step per tick with `stepProjectile`, which reports the first thing the
// step ran into (a body, a wall, or the end of its range), and finds who a splash or burst reaches with
// `areaTargets`. Eggs, the shaken soda bottle and (M4-6) the champagne cork all fly through here.
import type { Vec2 } from '../types';
import { isSolidTile, type CollisionGrid } from './collision';

/** A body a projectile or an area may reach: centre position and an id. */
export interface ProjectileCandidate {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

/** A projectile in flight. `dir` is a unit vector; `travelledPx` counts towards `rangePx`. */
export interface ProjectileFlight {
  readonly x: number;
  readonly y: number;
  readonly dir: Vec2;
  readonly speedPxPerSecond: number;
  readonly rangePx: number;
  readonly travelledPx: number;
  /** Collision radius of the projectile itself. */
  readonly radiusPx: number;
}

/** What ended a step: a body (its id), a wall, or the end of the range. */
export type ProjectileImpact =
  { readonly kind: 'body'; readonly id: string } | { readonly kind: 'wall' } | { readonly kind: 'range' };

export interface ProjectileStep {
  /** The projectile after the step (at the impact point when it hit something). */
  readonly flight: ProjectileFlight;
  /** Null while it is still flying. */
  readonly impact: ProjectileImpact | null;
}

/** Unit vector along `angle` (radians, 0 = right, y grows downwards like the map). */
export function aimDirection(angle: number): Vec2 {
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

/**
 * Smallest t in [0, 1] at which a circle of radius `r` moving from `from` by `delta` touches the point
 * `centre` (i.e. the segment comes within `r` of it), or null when it never does. A start already within
 * `r` gives 0.
 */
export function sweepHitTime(from: Vec2, delta: Vec2, centre: Vec2, r: number): number | null {
  const fx = from.x - centre.x;
  const fy = from.y - centre.y;
  const c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0;
  const a = delta.x * delta.x + delta.y * delta.y;
  if (a < 1e-12) return null;
  const b = 2 * (fx * delta.x + fy * delta.y);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

/**
 * Fraction t in (0, 1] of the segment `from` → `from + delta` at which its centre first enters a solid tile
 * (or leaves the map), or null when the whole segment is open floor. Sampled every quarter tile at most,
 * so even a fast projectile cannot skip a one-tile wall.
 */
export function wallHitTime(grid: CollisionGrid, from: Vec2, delta: Vec2): number | null {
  const len = Math.hypot(delta.x, delta.y);
  if (len < 1e-9) return null;
  const step = grid.tileSize / 4;
  const n = Math.max(1, Math.ceil(len / step));
  const ts = grid.tileSize;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const x = from.x + delta.x * t;
    const y = from.y + delta.y * t;
    if (isSolidTile(grid, Math.floor(x / ts), Math.floor(y / ts))) return (i - 1) / n;
  }
  return null;
}

/**
 * Moves a projectile for `dt` seconds. It stops at the first of: a body in `candidates` (its circle of
 * `bodyRadius` touching the projectile's circle; nearest along the path, ties keep input order), a wall
 * (stops at the last open spot before it), or the end of its range. Callers filter `candidates` first
 * (teammates, the thrower, KO'd and protected bodies pass through; §3.3).
 */
export function stepProjectile(
  grid: CollisionGrid,
  flight: ProjectileFlight,
  dt: number,
  candidates: readonly ProjectileCandidate[],
  bodyRadius: number,
): ProjectileStep {
  const left = Math.max(0, flight.rangePx - flight.travelledPx);
  const dist = Math.min(left, flight.speedPxPerSecond * Math.max(0, dt));
  const from = { x: flight.x, y: flight.y };
  const delta = { x: flight.dir.x * dist, y: flight.dir.y * dist };

  let impact: ProjectileImpact | null = null;
  let t = 1;
  const wall = wallHitTime(grid, from, delta);
  if (wall !== null) {
    impact = { kind: 'wall' };
    t = wall;
  }
  const reach = bodyRadius + flight.radiusPx;
  for (const c of candidates) {
    const ct = sweepHitTime(from, delta, c, reach);
    // Strictly earlier than a wall or an earlier body: a body flush against a wall still gets hit.
    if (ct !== null && (ct < t || (ct <= t && impact?.kind !== 'body'))) {
      impact = { kind: 'body', id: c.id };
      t = ct;
    }
  }
  if (impact === null && left - dist <= 1e-6) impact = { kind: 'range' };

  const moved = dist * t;
  return {
    flight: {
      ...flight,
      x: from.x + delta.x * t,
      y: from.y + delta.y * t,
      travelledPx: flight.travelledPx + moved,
    },
    impact,
  };
}

/**
 * Ids of the candidates an area of `radiusPx` around `centre` reaches (a body counts when its circle of
 * `bodyRadius` overlaps the area), nearest first (ties keep input order).
 */
export function areaTargets(
  centre: Vec2,
  radiusPx: number,
  candidates: readonly ProjectileCandidate[],
  bodyRadius: number,
): string[] {
  return candidates
    .map((c, i) => ({ c, i, d: Math.hypot(c.x - centre.x, c.y - centre.y) }))
    .filter(({ d }) => d <= radiusPx + bodyRadius)
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map(({ c }) => c.id);
}

/** A projectile turned back the way it came by a new owner (pan block, M4-6): full range again. */
export function reflectFlight(flight: ProjectileFlight): ProjectileFlight {
  return { ...flight, dir: { x: -flight.dir.x, y: -flight.dir.y }, travelledPx: 0 };
}
