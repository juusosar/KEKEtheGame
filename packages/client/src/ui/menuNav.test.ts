import { describe, expect, it } from 'vitest';
import { PAD_MENU, PadEdges, keyCommand, padCommands, stepIndex } from './menuNav';

const pressed = (...indices: number[]): boolean[] => {
  const out = new Array<boolean>(17).fill(false);
  for (const i of indices) out[i] = true;
  return out;
};

describe('PadEdges', () => {
  it('reports a button once per press', () => {
    const edges = new PadEdges();
    expect(edges.update(pressed(PAD_MENU.start))).toEqual([PAD_MENU.start]);
    expect(edges.update(pressed(PAD_MENU.start))).toEqual([]);
    expect(edges.update(pressed())).toEqual([]);
    expect(edges.update(pressed(PAD_MENU.start, PAD_MENU.down))).toEqual([PAD_MENU.start, PAD_MENU.down]);
  });

  it('reset makes a held button count again', () => {
    const edges = new PadEdges();
    edges.update(pressed(PAD_MENU.a));
    edges.reset();
    expect(edges.update(pressed(PAD_MENU.a))).toEqual([PAD_MENU.a]);
  });
});

describe('padCommands', () => {
  it('only Start counts while the menu is closed', () => {
    expect(padCommands([PAD_MENU.a, PAD_MENU.b, PAD_MENU.up, PAD_MENU.start], false)).toEqual(['menu']);
  });

  it('maps A, B and the D-pad while open', () => {
    expect(
      padCommands([PAD_MENU.a, PAD_MENU.b, PAD_MENU.up, PAD_MENU.down, PAD_MENU.left, PAD_MENU.right], true),
    ).toEqual(['activate', 'back', 'prev', 'next', 'dec', 'inc']);
  });
});

describe('keyCommand', () => {
  const key = (k: string, over: Partial<{ shiftKey: boolean; repeat: boolean }> = {}) => ({
    key: k,
    shiftKey: false,
    repeat: false,
    ...over,
  });

  it('Esc toggles, but not on key repeat', () => {
    expect(keyCommand(key('Escape'), false)).toBe('menu');
    expect(keyCommand(key('Escape'), true)).toBe('menu');
    expect(keyCommand(key('Escape', { repeat: true }), true)).toBeNull();
  });

  it('moves focus with Tab and the arrows only while open', () => {
    expect(keyCommand(key('Tab'), false)).toBeNull();
    expect(keyCommand(key('Tab'), true)).toBe('next');
    expect(keyCommand(key('Tab', { shiftKey: true }), true)).toBe('prev');
    expect(keyCommand(key('ArrowUp'), true)).toBe('prev');
    expect(keyCommand(key('ArrowDown'), true)).toBe('next');
    expect(keyCommand(key('KeyW'), true)).toBeNull();
  });
});

describe('stepIndex', () => {
  it('wraps both ways and starts from either end', () => {
    expect(stepIndex(0, 3, 1)).toBe(1);
    expect(stepIndex(2, 3, 1)).toBe(0);
    expect(stepIndex(0, 3, -1)).toBe(2);
    expect(stepIndex(-1, 3, 1)).toBe(0);
    expect(stepIndex(-1, 3, -1)).toBe(2);
    expect(stepIndex(0, 0, 1)).toBe(-1);
  });
});
