// Spray geometry and timing (§7 `spray`, M4-4). Pure, like the rest of rules/: the server finds who a
// spray tick reaches with `sprayTargets`, and both sides place the extinguisher's vision cloud with
// `sprayCloud`, so the client can draw it from the `attack` broadcast alone.
//
// A spray works in damage ticks of `tickSeconds` (ketchup "3 / tick" = 3 damage per 0.25 s, M4-1 log).
// While Attack is held, one tick fires at once and then one every `tickSeconds` of round time; each tick
// spends `tickSeconds` of the weapon's spray seconds, hits everyone in the cone that a wall does not hide,
// and shoves them `pushPxPerSecond × tickSeconds` away from the sprayer.
import type { Vec2 } from '../types';
import type { SprayStats } from '../weapons/catalogue';
import { clearLine, type CollisionGrid } from './collision';
import { inMeleeArc, type MeleeCandidate } from './melee';

/** Small slack for comparing round-clock times that are sums of float steps. */
const TIME_EPSILON = 1e-6;

// clearLine moved to collision.ts (M4 review F3: every hit needs a clear line); re-exported here.
export { clearLine } from './collision';

/**
 * Ids of the candidates one spray tick from `origin` along `aim` reaches, nearest first (ties keep input
 * order): inside the cone (same rule as a melee arc, `coneDegrees` wide, `rangePx` long, a body half
 * inside counts) and, when a grid is given, with a clear line from the sprayer to the body's centre.
 */
export function sprayTargets(
  origin: Vec2,
  aim: number,
  candidates: readonly MeleeCandidate[],
  stats: Pick<SprayStats, 'rangePx' | 'coneDegrees'>,
  targetRadius: number,
  grid?: CollisionGrid,
): string[] {
  const cone = { rangePx: stats.rangePx, arcDegrees: stats.coneDegrees };
  return candidates
    .map((c, i) => ({ c, i, d: Math.hypot(c.x - origin.x, c.y - origin.y) }))
    .filter(({ c }) => inMeleeArc(origin, aim, c, cone, targetRadius))
    .filter(({ c }) => !grid || clearLine(grid, origin, c))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map(({ c }) => c.id);
}

/** True when a spray tick may fire at `now`: the first one at once, then one every `tickSeconds`. */
export function sprayTickDue(nextTickAt: number | undefined, now: number): boolean {
  return nextTickAt === undefined || now + TIME_EPSILON >= nextTickAt;
}

/** How far one spray tick shoves each body it reaches (0 = no push). */
export function sprayPushPx(stats: Pick<SprayStats, 'pushPxPerSecond' | 'tickSeconds'>): number {
  return stats.pushPxPerSecond * stats.tickSeconds;
}

/** A vision cloud one spray tick leaves behind (§7 extinguisher "blocks vision slightly"). */
export interface SprayCloud {
  readonly x: number;
  readonly y: number;
  readonly radiusPx: number;
  /** How long it lingers after the tick that made it. */
  readonly seconds: number;
}

/**
 * The cloud a spray tick from `origin` along `aim` leaves, or null for sprays without one. It sits on
 * the aim line with its far edge at the end of the cone (never closer than its own radius), so it covers
 * the far part of the cone and whoever is standing in it.
 */
export function sprayCloud(
  origin: Vec2,
  aim: number,
  stats: Pick<SprayStats, 'rangePx' | 'visionCloud'>,
): SprayCloud | null {
  const cloud = stats.visionCloud;
  if (!cloud) return null;
  const dist = Math.max(cloud.radiusPx, stats.rangePx - cloud.radiusPx);
  return {
    x: origin.x + Math.cos(aim) * dist,
    y: origin.y + Math.sin(aim) * dist,
    radiusPx: cloud.radiusPx,
    seconds: cloud.seconds,
  };
}
