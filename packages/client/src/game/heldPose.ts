// Pure rules for the held weapon sprite (§11.1: one 32 × 32 frame per weapon, rotated to the aim angle at
// runtime). Where it sits relative to the body, how it swings, thrusts or raises for a block, and when it
// is hidden. combatFx.ts / HeldWeapons draw what this returns.
import type { AttackMode } from '@keke/shared';

export interface HeldPoseConfig {
  /** Hand distance from the body centre along the aim, px. */
  heldWeaponReachPx: number;
  /** Hand height above the player's position, px. */
  heldWeaponLiftPx: number;
  /** Seconds one swing or use animation lasts. */
  heldSwingSeconds: number;
  /** How far a non-melee use (throw, spray, peel, cork, charge) pushes the hand forward, px. */
  heldUseKickPx: number;
}

/** An attack being animated on the held weapon. */
export interface HeldSwing {
  mode: AttackMode;
  /** Scene clock seconds the attack started. */
  start: number;
  /** Aim of the attack (radians); a swing sweeps around it. */
  aim: number;
  /** Full swing width for melee, degrees. */
  arcDegrees: number;
}

export interface HeldInput {
  /** Body position (the player's position, centre of the hitbox). */
  x: number;
  y: number;
  /** Aim radians, 0 = +x, clockwise on screen. */
  aim: number;
  weapon: string;
  alive: boolean;
  /** Body drawn at all (on the map, not hidden). */
  visible: boolean;
  blocking: boolean;
  /** Dashing with the pallet jack (M4-6 `charging`): pushed out in front. */
  charging: boolean;
  swing: HeldSwing | null;
  /** Scene clock seconds. */
  now: number;
}

export interface HeldPose {
  visible: boolean;
  x: number;
  y: number;
  /** Radians the frame is rotated by. */
  angle: number;
  /** Mirror vertically so a weapon aimed left is not drawn upside down. */
  flipY: boolean;
  /** True when the weapon goes behind the body (aiming up). */
  behind: boolean;
  /** 0..1 progress of the attack animation, or null when idle. */
  swingProgress: number | null;
  blocking: boolean;
}

const HIDDEN: Omit<HeldPose, 'x' | 'y'> = {
  visible: false,
  angle: 0,
  flipY: false,
  behind: false,
  swingProgress: null,
  blocking: false,
};

/** 0..1 progress of `swing` at `now`, or null when it is over (or none). */
export function swingProgress(swing: HeldSwing | null, now: number, seconds: number): number | null {
  if (swing === null || seconds <= 0) return null;
  const p = (now - swing.start) / seconds;
  return p < 0 || p >= 1 ? null : p;
}

/** Eases the swing so it starts fast and settles (ease-out cubic). */
function easeOut(p: number): number {
  return 1 - (1 - p) ** 3;
}

/**
 * Where and how the held weapon is drawn this frame. Fists are drawn only while punching; KO'd or
 * hidden bodies hold nothing.
 */
export function heldPose(input: HeldInput, cfg: HeldPoseConfig): HeldPose {
  const base = { x: input.x, y: input.y };
  if (!input.visible || !input.alive) return { ...HIDDEN, ...base };
  const progress = swingProgress(input.swing, input.now, cfg.heldSwingSeconds);
  const swing = progress === null ? null : input.swing;
  if (input.weapon === 'fists' && swing === null) return { ...HIDDEN, ...base };

  let angle = input.aim;
  let reach = cfg.heldWeaponReachPx;
  if (swing !== null && progress !== null) {
    if (swing.mode === 'melee') {
      if (input.weapon === 'fists') {
        // A punch: straight jab out and back.
        angle = swing.aim;
        reach += cfg.heldUseKickPx * 2 * Math.sin(Math.PI * progress);
      } else {
        // Sweep across the arc, from one edge to the other.
        const half = (swing.arcDegrees * Math.PI) / 360;
        angle = swing.aim - half + 2 * half * easeOut(progress);
      }
    } else {
      // Throw, spray, peel, cork or charge: the hand kicks forward along the aim and comes back.
      angle = swing.aim;
      reach += cfg.heldUseKickPx * Math.sin(Math.PI * progress);
    }
  } else if (input.charging) {
    reach += cfg.heldUseKickPx * 2;
  } else if (input.blocking) {
    // Raised in front of the body as a shield.
    reach += cfg.heldUseKickPx / 2;
  }

  const handY = input.y - cfg.heldWeaponLiftPx;
  return {
    visible: true,
    x: input.x + Math.cos(angle) * reach,
    y: handY + Math.sin(angle) * reach,
    angle,
    flipY: Math.cos(angle) < 0,
    behind: Math.sin(angle) < -0.2,
    swingProgress: progress,
    blocking: input.blocking && swing === null,
  };
}

/** Moves `from` toward `to` along the shortest way round, by at most `maxStep` radians. */
export function turnToward(from: number, to: number, maxStep: number): number {
  let d = (to - from) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d <= -Math.PI) d += 2 * Math.PI;
  if (Math.abs(d) <= maxStep) return to;
  return from + Math.sign(d) * maxStep;
}
