// Banana peel traps (§7, M4-5). Pure, like the rest of rules/: the server keeps a list of peels, asks
// which body steps on an armed one, and moves the victim with the shared knockback step for the slide.
//
// Rules:
// - A press of Attack drops a peel at the thrower's feet. It arms `armSeconds` later and lies there for
//   `lifetimeSeconds` from the drop (45 s) unless someone slips on it first.
// - A body whose centre comes within `triggerRadiusPx` of an armed peel slips. The peel is used up.
// - Peels never trip their owner or the owner's teammates (team > 0 only, M3 review H5), so the owner
//   standing on a fresh peel is safe. Spawn protection and KO also skip a body (the combat `hit` rules).
// - The slip: `slideSeconds` without control (a stun of that length), sliding at `slideSpeedPxPerSecond`
//   in the direction the victim was moving (else where they aimed), stopped by walls; the carried item
//   drops where they slipped when `dropsCarried` is set.
import type { Vec2 } from '../types';
import type { TrapStats } from '../weapons/catalogue';
import type { Knockback } from './melee';

export interface Peel {
  /** Unique within the round, from 1. */
  readonly id: number;
  /** Weapon id that dropped it ('banana_peels'). */
  readonly weapon: string;
  /** Session id of the thrower. */
  readonly owner: string;
  /** The thrower's team when dropped (0 = no teams); kept so the peel still spares them after they leave. */
  readonly team: number;
  readonly x: number;
  readonly y: number;
  /** Round clock (s) when it can first trigger. */
  readonly armedAt: number;
  /** Round clock (s) when it disappears untouched. */
  readonly expiresAt: number;
}

/** A body that may step on a peel. `team` is 0 when teams are off. */
export interface PeelCandidate {
  readonly id: string;
  readonly team: number;
  readonly x: number;
  readonly y: number;
}

/** A new peel dropped at `pos` at round time `now`. */
export function placePeel(
  id: number,
  weapon: string,
  owner: { id: string; team: number },
  pos: Vec2,
  now: number,
  stats: Pick<TrapStats, 'armSeconds' | 'lifetimeSeconds'>,
): Peel {
  return {
    id,
    weapon,
    owner: owner.id,
    team: owner.team,
    x: pos.x,
    y: pos.y,
    armedAt: now + stats.armSeconds,
    expiresAt: now + stats.lifetimeSeconds,
  };
}

export function peelArmed(peel: Peel, now: number): boolean {
  return now >= peel.armedAt;
}

export function peelExpired(peel: Peel, now: number): boolean {
  return now >= peel.expiresAt;
}

/** The owner and the owner's teammates never slip on it (team 0 = free-for-all, nobody is a teammate). */
export function peelSpares(peel: Peel, body: Pick<PeelCandidate, 'id' | 'team'>): boolean {
  return body.id === peel.owner || (peel.team > 0 && body.team === peel.team);
}

/** True when `body` steps on the armed peel: its centre is within the trigger radius. */
export function peelTrips(
  peel: Peel,
  body: PeelCandidate,
  now: number,
  stats: Pick<TrapStats, 'triggerRadiusPx'>,
): boolean {
  if (!peelArmed(peel, now) || peelExpired(peel, now) || peelSpares(peel, body)) return false;
  return Math.hypot(body.x - peel.x, body.y - peel.y) <= stats.triggerRadiusPx;
}

/**
 * The first armed peel (lowest id) `body` steps on, or null. One peel per slip: overlapping peels are not
 * all used up at once.
 */
export function trippingPeel(
  peels: readonly Peel[],
  body: PeelCandidate,
  now: number,
  stats: (peel: Peel) => Pick<TrapStats, 'triggerRadiusPx'> | null,
): Peel | null {
  let best: Peel | null = null;
  for (const peel of peels) {
    const s = stats(peel);
    if (!s || !peelTrips(peel, body, now, s)) continue;
    if (best === null || peel.id < best.id) best = peel;
  }
  return best;
}

/** Below this speed (px/s) a body counts as standing still, and slides where it aims. */
const STILL_SPEED = 1;

/** Unit direction of a slip: along the velocity when moving, else along `aim` (radians). */
export function slipDirection(velocity: Vec2, aim: number): Vec2 {
  const speed = Math.hypot(velocity.x, velocity.y);
  if (speed >= STILL_SPEED) return { x: velocity.x / speed, y: velocity.y / speed };
  return { x: Math.cos(aim), y: Math.sin(aim) };
}

/**
 * The slide as a shove for `knockbackStep`: `slideSeconds` at `slideSpeedPxPerSecond` along `dir`.
 * Null when it would not move (zero speed, time or direction).
 */
export function startSlide(
  dir: Vec2,
  stats: Pick<TrapStats, 'slideSeconds' | 'slideSpeedPxPerSecond'>,
): Knockback | null {
  const len = Math.hypot(dir.x, dir.y);
  const distance = stats.slideSeconds * stats.slideSpeedPxPerSecond;
  if (!(len > 0) || !(distance > 0)) return null;
  return {
    dir: { x: dir.x / len, y: dir.y / len },
    remainingPx: distance,
    speedPxPerSecond: stats.slideSpeedPxPerSecond,
  };
}
