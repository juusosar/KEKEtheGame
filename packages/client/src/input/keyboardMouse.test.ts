import { Button, buttonsOf } from '@keke/shared';
import { describe, expect, it } from 'vitest';
import { readKeyboardMouse, type KeyboardMouseState } from './keyboardMouse';

const state = (over: Partial<KeyboardMouseState> = {}): KeyboardMouseState => ({
  keys: new Set(),
  leftMouse: false,
  rightMouse: false,
  pointer: { x: 0, y: 0 },
  ...over,
});
const origin = { x: 100, y: 100 };

describe('readKeyboardMouse', () => {
  it('maps WASD to move and normalises diagonals', () => {
    expect(readKeyboardMouse(state({ keys: new Set(['KeyD']) }), origin).move).toEqual({ x: 1, y: 0 });
    expect(readKeyboardMouse(state({ keys: new Set(['KeyW']) }), origin).move).toEqual({ x: 0, y: -1 });
    const diag = readKeyboardMouse(state({ keys: new Set(['KeyS', 'KeyA']) }), origin).move;
    expect(diag.x).toBeCloseTo(-Math.SQRT1_2);
    expect(diag.y).toBeCloseTo(Math.SQRT1_2);
  });

  it('cancels opposite keys to zero without negative zero', () => {
    const { move } = readKeyboardMouse(state({ keys: new Set(['KeyA', 'KeyD', 'KeyW', 'KeyS']) }), origin);
    expect(Object.is(move.x, 0) && Object.is(move.y, 0)).toBe(true);
  });

  it('maps mouse buttons and E/Q/Tab/Esc to the §13.3 actions', () => {
    const r = readKeyboardMouse(
      state({ leftMouse: true, rightMouse: true, keys: new Set(['KeyE', 'KeyQ', 'Tab', 'Escape']) }),
      origin,
    );
    expect(r.buttons).toBe(
      buttonsOf(Button.Attack, Button.Block, Button.Interact, Button.Drop, Button.Scoreboard, Button.Menu),
    );
    expect(readKeyboardMouse(state({ keys: new Set(['KeyX']) }), origin).buttons).toBe(0);
  });

  it('aims from the origin to the pointer: 0 = right, π/2 = down (clockwise on screen)', () => {
    expect(readKeyboardMouse(state({ pointer: { x: 200, y: 100 } }), origin).aim).toBeCloseTo(0);
    expect(readKeyboardMouse(state({ pointer: { x: 100, y: 200 } }), origin).aim).toBeCloseTo(Math.PI / 2);
    expect(readKeyboardMouse(state({ pointer: { x: 100, y: 100 } }), origin).aim).toBeNull();
  });
});
