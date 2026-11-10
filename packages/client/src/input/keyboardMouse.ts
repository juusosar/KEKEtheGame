import { Button, type Vec2 } from '@keke/shared';
import { clampLength } from './stick';

/** Keyboard + mouse bindings from §13.3. Values are `KeyboardEvent.code`s. */
export const KEY_BINDINGS = {
  up: 'KeyW',
  left: 'KeyA',
  down: 'KeyS',
  right: 'KeyD',
  interact: 'KeyE',
  drop: 'KeyQ',
  scoreboard: 'Tab',
  menu: 'Escape',
} as const;

/** Raw keyboard + mouse state for one frame, read from Phaser (or a test). */
export interface KeyboardMouseState {
  /** `KeyboardEvent.code`s currently held. */
  keys: ReadonlySet<string>;
  leftMouse: boolean;
  rightMouse: boolean;
  /** Pointer position in world space. */
  pointer: Vec2;
}

export interface DeviceReading {
  move: Vec2;
  /** Aim angle (radians, §InputFrame convention), or null when this device gives no aim. */
  aim: number | null;
  buttons: number;
}

/** WASD → move (diagonals normalised), mouse → aim from `origin`, keys/mouse buttons → bitmask. */
export function readKeyboardMouse(state: KeyboardMouseState, origin: Vec2): DeviceReading {
  const held = (code: string): number => (state.keys.has(code) ? 1 : 0);
  const move = clampLength({
    x: held(KEY_BINDINGS.right) - held(KEY_BINDINGS.left),
    y: held(KEY_BINDINGS.down) - held(KEY_BINDINGS.up),
  });

  let buttons = 0;
  if (state.leftMouse) buttons |= Button.Attack;
  if (state.rightMouse) buttons |= Button.Block;
  if (state.keys.has(KEY_BINDINGS.interact)) buttons |= Button.Interact;
  if (state.keys.has(KEY_BINDINGS.drop)) buttons |= Button.Drop;
  if (state.keys.has(KEY_BINDINGS.scoreboard)) buttons |= Button.Scoreboard;
  if (state.keys.has(KEY_BINDINGS.menu)) buttons |= Button.Menu;

  const dx = state.pointer.x - origin.x;
  const dy = state.pointer.y - origin.y;
  const aim = dx === 0 && dy === 0 ? null : Math.atan2(dy, dx);

  return { move: { x: move.x || 0, y: move.y || 0 }, aim, buttons };
}
