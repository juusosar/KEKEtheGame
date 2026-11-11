// What each §13.3 action is called on each device, for the controls table in the in-game menu and the
// HUD button prompts. Pure (no DOM, no Phaser). Keyboard names come from KEY_BINDINGS, so a rebinding
// shows up in the prompts without touching this file.
import type { InputDevice } from './device';
import { KEY_BINDINGS } from './keyboardMouse';

/** The §13.3 actions, in the order the controls table lists them. */
export const CONTROL_ACTIONS = [
  'move',
  'aim',
  'attack',
  'block',
  'interact',
  'drop',
  'scoreboard',
  'menu',
] as const;
export type ControlAction = (typeof CONTROL_ACTIONS)[number];

/** Short, readable name of a `KeyboardEvent.code`: KeyE → E, Escape → Esc, Digit1 → 1. */
export function keyName(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  const named: Record<string, string> = {
    Escape: 'Esc',
    Tab: 'Tab',
    Space: 'Space',
    Enter: 'Enter',
    ShiftLeft: 'Shift',
    ShiftRight: 'Shift',
  };
  return named[code] ?? code;
}

const KEYBOARD_MOUSE: Readonly<Record<ControlAction, string>> = {
  move: [KEY_BINDINGS.up, KEY_BINDINGS.left, KEY_BINDINGS.down, KEY_BINDINGS.right].map(keyName).join(''),
  aim: 'Mouse',
  attack: 'Left mouse',
  block: 'Right mouse',
  interact: keyName(KEY_BINDINGS.interact),
  drop: keyName(KEY_BINDINGS.drop),
  scoreboard: keyName(KEY_BINDINGS.scoreboard),
  menu: keyName(KEY_BINDINGS.menu),
};

/** Standard-mapping names (§13.3); gamepad.ts reads the same buttons. */
const GAMEPAD: Readonly<Record<ControlAction, string>> = {
  move: 'Left stick',
  aim: 'Right stick',
  attack: 'RT',
  block: 'LT',
  interact: 'A',
  drop: 'B',
  scoreboard: 'View',
  menu: 'Start',
};

/** The button or key that does `action` on `device`, e.g. ('interact', 'gamepad') → 'A'. */
export function buttonName(action: ControlAction, device: InputDevice): string {
  return device === 'gamepad' ? GAMEPAD[action] : KEYBOARD_MOUSE[action];
}
