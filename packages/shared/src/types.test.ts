import { describe, expect, it } from 'vitest';
import { Button, buttonsOf, isPressed, type InputFrame } from './types';

describe('InputFrame buttons', () => {
  it('uses one distinct bit per button', () => {
    const values = Object.values(Button);
    expect(new Set(values).size).toBe(values.length);
    for (const v of values) expect(v & (v - 1)).toBe(0);
  });

  it('packs and reads button state', () => {
    const frame: InputFrame = {
      seq: 1,
      move: { x: 1, y: 0 },
      aim: 0,
      buttons: buttonsOf(Button.Attack, Button.Drop),
    };
    expect(isPressed(frame.buttons, Button.Attack)).toBe(true);
    expect(isPressed(frame.buttons, Button.Drop)).toBe(true);
    expect(isPressed(frame.buttons, Button.Block)).toBe(false);
  });
});
