// Types shared by client and server.

/** 2D vector in pixels (positions) or a unit-ish direction (input). */
export interface Vec2 {
  x: number;
  y: number;
}

/**
 * Button bit flags packed into `InputFrame.buttons`. One bit per action from §13.3,
 * so a frame stays a single small number on the wire.
 */
export const Button = {
  Attack: 1 << 0,
  Block: 1 << 1,
  Interact: 1 << 2,
  Drop: 1 << 3,
  Scoreboard: 1 << 4,
  Menu: 1 << 5,
} as const;

export type ButtonName = keyof typeof Button;

/**
 * One frame of player input, produced by the client's InputManager and sent to the server (§15.3).
 * The game logic never knows which device produced it.
 */
export interface InputFrame {
  /** Monotonically increasing sequence number; the server acks the last one it processed. */
  seq: number;
  /** Movement direction, each axis in [-1, 1]. Length is at most 1 after normalisation. */
  move: Vec2;
  /** Aim angle in radians, 0 = right (+x), increasing clockwise in screen space (+y is down). */
  aim: number;
  /** Bitmask of held buttons, see `Button`. */
  buttons: number;
}

/** True when `button` is held in `buttons`. */
export function isPressed(buttons: number, button: number): boolean {
  return (buttons & button) !== 0;
}

/** Combines button flags into one bitmask. */
export function buttonsOf(...pressed: readonly number[]): number {
  let mask = 0;
  for (const b of pressed) mask |= b;
  return mask;
}
