import { describe, expect, it } from 'vitest';
import { anyInReach, pickPrompts, promptsKey, type PromptState } from './prompts';

const state = (over: Partial<PromptState> = {}): PromptState => ({
  phase: 'playing',
  playing: true,
  alive: true,
  controlling: true,
  carrying: false,
  itemInReach: false,
  canBlock: false,
  menuOpen: false,
  ...over,
});
const shown = (s: PromptState, device: 'keyboardMouse' | 'gamepad' = 'keyboardMouse') =>
  pickPrompts(s, device).map((p) => `${p.button} ${p.label}`);

describe('pickPrompts (§13.3, M7 review F6)', () => {
  it('shows nothing in a plain moment of the round', () => {
    expect(shown(state())).toEqual([]);
  });

  it('offers pick up when an item is in reach and the hands are empty', () => {
    expect(shown(state({ itemInReach: true }))).toEqual(['E prompt.pickup']);
    expect(shown(state({ itemInReach: true }), 'gamepad')).toEqual(['A prompt.pickup']);
  });

  it('offers drop instead while carrying', () => {
    expect(shown(state({ carrying: true, itemInReach: true }))).toEqual(['Q prompt.drop']);
    expect(shown(state({ carrying: true }), 'gamepad')).toEqual(['B prompt.drop']);
  });

  it('adds block while holding the pan', () => {
    expect(shown(state({ canBlock: true, itemInReach: true }))).toEqual([
      'E prompt.pickup',
      'Right mouse prompt.block',
    ]);
    expect(shown(state({ canBlock: true }), 'gamepad')).toEqual(['LT prompt.block']);
  });

  it('teaches move, scores and menu on the round intro', () => {
    expect(shown(state({ phase: 'countdown', controlling: false }))).toEqual([
      'WASD prompt.move',
      'Tab prompt.scoreboard',
      'Esc prompt.menu',
    ]);
    expect(shown(state({ phase: 'countdown' }), 'gamepad')).toEqual([
      'Left stick prompt.move',
      'View prompt.scoreboard',
      'Start prompt.menu',
    ]);
  });

  it('stays quiet behind the menu, when KO, spectating or after the round', () => {
    expect(shown(state({ itemInReach: true, menuOpen: true }))).toEqual([]);
    expect(shown(state({ itemInReach: true, alive: false }))).toEqual([]);
    expect(shown(state({ itemInReach: true, controlling: false }))).toEqual([]);
    expect(shown(state({ phase: 'countdown', playing: false }))).toEqual([]);
    expect(shown(state({ itemInReach: true, phase: 'roundResults' }))).toEqual([]);
    expect(shown(state({ carrying: true, phase: 'podium' }))).toEqual([]);
  });
});

describe('anyInReach', () => {
  const reach = { tileSize: 32, pickupRangeTiles: 1, depositRangeTiles: 2 };
  it('uses the pickup range from the config', () => {
    expect(anyInReach({ x: 0, y: 0 }, [{ x: 32, y: 0 }], reach)).toBe(true);
    expect(
      anyInReach(
        { x: 0, y: 0 },
        [
          { x: 33, y: 0 },
          { x: 0, y: 40 },
        ],
        reach,
      ),
    ).toBe(false);
  });
});

describe('promptsKey', () => {
  it('changes when the device changes', () => {
    const s = state({ itemInReach: true });
    expect(promptsKey(pickPrompts(s, 'keyboardMouse'))).not.toBe(promptsKey(pickPrompts(s, 'gamepad')));
  });
});
