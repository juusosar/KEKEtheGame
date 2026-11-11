import { describe, expect, it } from 'vitest';
import { CONTROL_ACTIONS, buttonName, keyName } from './controls';

describe('controls names (§13.3)', () => {
  it('names keys the way a player reads them', () => {
    expect(keyName('KeyE')).toBe('E');
    expect(keyName('Escape')).toBe('Esc');
    expect(keyName('Tab')).toBe('Tab');
    expect(keyName('Digit3')).toBe('3');
    expect(keyName('F13')).toBe('F13');
  });

  it('matches the §13.3 table for both devices', () => {
    const kbm = CONTROL_ACTIONS.map((a) => buttonName(a, 'keyboardMouse'));
    expect(kbm).toEqual(['WASD', 'Mouse', 'Left mouse', 'Right mouse', 'E', 'Q', 'Tab', 'Esc']);
    const pad = CONTROL_ACTIONS.map((a) => buttonName(a, 'gamepad'));
    expect(pad).toEqual(['Left stick', 'Right stick', 'RT', 'LT', 'A', 'B', 'View', 'Start']);
  });
});
