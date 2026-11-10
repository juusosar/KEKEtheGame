import type { Vec2 } from '@keke/shared';
import { isZero } from './stick';

/**
 * Aim-assist hook (§13.3). Given the player position and the raw fallback aim angle, returns the
 * angle to use. The Game scene installs one that knows where enemies are; until then aim is unchanged.
 */
export type AimAssist = (origin: Vec2, angle: number) => number;

export const noAimAssist: AimAssist = (_origin, angle) => angle;

/** Smallest signed difference `b - a` between two angles, in (-π, π]. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * Light aim assist: snaps to the nearest candidate whose direction is within the cone
 * (`coneDegrees` wide, centred on `angle`). Returns `angle` when nothing is in the cone.
 */
export function nearestInCone(
  origin: Vec2,
  angle: number,
  candidates: readonly Vec2[],
  coneDegrees: number,
): number {
  const halfCone = ((coneDegrees / 2) * Math.PI) / 180;
  let best = angle;
  let bestDist = Infinity;
  for (const c of candidates) {
    const dx = c.x - origin.x;
    const dy = c.y - origin.y;
    const dist = Math.hypot(dx, dy);
    if (dist === 0 || dist >= bestDist) continue;
    const toTarget = Math.atan2(dy, dx);
    if (Math.abs(angleDelta(angle, toTarget)) <= halfCone) {
      best = toTarget;
      bestDist = dist;
    }
  }
  return best;
}

/** Builds an AimAssist from a provider of enemy positions (e.g. other players, hostile NPCs). */
export function coneAimAssist(enemies: () => readonly Vec2[], coneDegrees: number): AimAssist {
  return (origin, angle) => nearestInCone(origin, angle, enemies(), coneDegrees);
}

/**
 * Gamepad aim (§13.3): the right stick wins. If it is idle, aim in the movement direction with aim
 * assist. If the player is also standing still, keep the previous aim.
 */
export function resolveGamepadAim(
  stickAim: number | null,
  move: Vec2,
  previousAim: number,
  origin: Vec2,
  assist: AimAssist,
): number {
  if (stickAim !== null) return stickAim;
  if (isZero(move)) return previousAim;
  return assist(origin, Math.atan2(move.y, move.x));
}
