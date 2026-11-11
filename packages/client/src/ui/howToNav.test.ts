import { describe, expect, it } from 'vitest';
import type { KeyValueStore } from '../profile/storage';
import {
  HOW_TO_PAGES,
  HOW_TO_SEEN_KEY,
  PAD_SHOULDER,
  howToKeyCommand,
  howToPadCommands,
  howToSeen,
  markHowToSeen,
  stepPage,
} from './howToNav';
import { PAD_MENU } from './menuNav';

const memory = (): KeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

describe('howToPadCommands', () => {
  it('pages with the D-pad and the shoulders, A goes on, B and Start close', () => {
    expect(
      howToPadCommands([
        PAD_MENU.left,
        PAD_SHOULDER.lb,
        PAD_MENU.right,
        PAD_SHOULDER.rb,
        PAD_MENU.a,
        PAD_MENU.b,
        PAD_MENU.start,
      ]),
    ).toEqual(['prev', 'prev', 'next', 'next', 'next', 'close', 'close']);
  });

  it('ignores other buttons', () => {
    expect(howToPadCommands([PAD_MENU.up, PAD_MENU.down, 2, 3, 6, 7])).toEqual([]);
  });
});

describe('howToKeyCommand', () => {
  it('maps arrows and Esc, leaves the rest alone', () => {
    expect(howToKeyCommand({ key: 'ArrowLeft', repeat: false })).toBe('prev');
    expect(howToKeyCommand({ key: 'ArrowRight', repeat: true })).toBe('next');
    expect(howToKeyCommand({ key: 'Escape', repeat: false })).toBe('close');
    expect(howToKeyCommand({ key: 'Escape', repeat: true })).toBeNull();
    expect(howToKeyCommand({ key: 'Enter', repeat: false })).toBeNull();
    expect(howToKeyCommand({ key: 'Tab', repeat: false })).toBeNull();
  });
});

describe('stepPage', () => {
  it('clamps at both ends', () => {
    const last = HOW_TO_PAGES.length - 1;
    expect(stepPage(0, 'prev')).toBe(0);
    expect(stepPage(0, 'next')).toBe(1);
    expect(stepPage(last, 'next')).toBe(last);
    expect(stepPage(last, 'prev')).toBe(last - 1);
  });
});

describe('the seen flag', () => {
  it('is unset at first and set after closing', () => {
    const store = memory();
    expect(howToSeen(store)).toBe(false);
    markHowToSeen(store);
    expect(howToSeen(store)).toBe(true);
    expect(store.data.get(HOW_TO_SEEN_KEY)).toBe('1');
  });

  it('counts as seen without storage or when storage throws', () => {
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(howToSeen(undefined)).toBe(true);
    expect(howToSeen(broken)).toBe(true);
    expect(() => markHowToSeen(broken)).not.toThrow();
  });
});
