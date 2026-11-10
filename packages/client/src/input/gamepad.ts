import { Button } from '@keke/shared';
import type { InputConfig } from './config';
import type { DeviceReading } from './keyboardMouse';
import { applyRadialDeadzone, isZero } from './stick';

/**
 * Indices of the W3C "standard" gamepad mapping (https://w3c.github.io/gamepad/#remapping)
 * used by §13.3.
 */
export const STANDARD = {
  buttons: { a: 0, b: 1, lt: 6, rt: 7, view: 8, start: 9 },
  axes: { leftX: 0, leftY: 1, rightX: 2, rightY: 3 },
} as const;

/** Plain snapshot of one pad, so the mapping is testable without a browser. */
export interface GamepadSnapshot {
  axes: readonly number[];
  buttons: readonly { pressed: boolean; value: number }[];
}

export interface GamepadReading extends DeviceReading {
  /** True when any stick is outside its deadzone or any button/trigger is held. */
  active: boolean;
}

/** Left stick → move, right stick → aim (null while idle), buttons/triggers → bitmask. */
export function readGamepad(pad: GamepadSnapshot, cfg: InputConfig): GamepadReading {
  const axis = (i: number): number => pad.axes[i] ?? 0;
  const button = (i: number): boolean => pad.buttons[i]?.pressed ?? false;
  const trigger = (i: number): boolean => {
    const b = pad.buttons[i];
    return b !== undefined && (b.pressed || b.value >= cfg.triggerThreshold);
  };

  const move = applyRadialDeadzone(axis(STANDARD.axes.leftX), axis(STANDARD.axes.leftY), cfg.stickDeadzone);
  const right = applyRadialDeadzone(
    axis(STANDARD.axes.rightX),
    axis(STANDARD.axes.rightY),
    cfg.aimStickDeadzone,
  );
  const aim = isZero(right) ? null : Math.atan2(right.y, right.x);

  let buttons = 0;
  if (trigger(STANDARD.buttons.rt)) buttons |= Button.Attack;
  if (trigger(STANDARD.buttons.lt)) buttons |= Button.Block;
  if (button(STANDARD.buttons.a)) buttons |= Button.Interact;
  if (button(STANDARD.buttons.b)) buttons |= Button.Drop;
  if (button(STANDARD.buttons.view)) buttons |= Button.Scoreboard;
  if (button(STANDARD.buttons.start)) buttons |= Button.Menu;

  return { move, aim, buttons, active: !isZero(move) || aim !== null || buttons !== 0 };
}
