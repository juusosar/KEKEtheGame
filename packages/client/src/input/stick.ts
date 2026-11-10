import type { Vec2 } from '@keke/shared';

export const ZERO: Vec2 = { x: 0, y: 0 };

/**
 * Radial deadzone with rescaling: inside `deadzone` the stick reads as zero, and the remaining
 * range is stretched back to 0..1 so movement starts smoothly at the edge of the deadzone.
 * The result never has a length above 1.
 */
export function applyRadialDeadzone(x: number, y: number, deadzone: number): Vec2 {
  const length = Math.hypot(x, y);
  if (!Number.isFinite(length) || length <= deadzone) return ZERO;
  const clamped = Math.min(length, 1);
  const scaled = deadzone >= 1 ? 0 : (clamped - deadzone) / (1 - deadzone);
  if (scaled === 0) return ZERO;
  return { x: (x / length) * scaled, y: (y / length) * scaled };
}

/** Scales `v` down to length 1 if it is longer; shorter vectors are kept (analog walk). */
export function clampLength(v: Vec2): Vec2 {
  const length = Math.hypot(v.x, v.y);
  return length > 1 ? { x: v.x / length, y: v.y / length } : v;
}

export function isZero(v: Vec2): boolean {
  return v.x === 0 && v.y === 0;
}
