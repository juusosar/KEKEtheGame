import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COLOR,
  DEFAULT_HAT,
  DEFAULT_NICKNAME,
  HAT_IDS,
  PLAYER_COLORS,
  sanitizeNickname,
  sanitizeProfile,
} from './profile';

describe('sanitizeProfile', () => {
  it('keeps a valid profile', () => {
    expect(sanitizeProfile({ nickname: 'Mikko', color: PLAYER_COLORS[2], hat: 'chef' }, 16)).toEqual({
      nickname: 'Mikko',
      color: PLAYER_COLORS[2],
      hat: 'chef',
    });
  });

  it('falls back field by field', () => {
    expect(sanitizeProfile({ nickname: 'Juuso', color: '#123456', hat: 'crown' }, 16)).toEqual({
      nickname: 'Juuso',
      color: DEFAULT_COLOR,
      hat: DEFAULT_HAT,
    });
    expect(sanitizeProfile(null, 16)).toEqual({
      nickname: DEFAULT_NICKNAME,
      color: DEFAULT_COLOR,
      hat: DEFAULT_HAT,
    });
    expect(sanitizeProfile('nope', 16).nickname).toBe(DEFAULT_NICKNAME);
  });

  it('accepts palette colours in any case and returns them uppercase', () => {
    expect(sanitizeProfile({ color: PLAYER_COLORS[1].toLowerCase() }, 16).color).toBe(PLAYER_COLORS[1]);
  });

  it('knows every hat from the sprite spec', () => {
    expect(HAT_IDS).toEqual(['chef', 'cap', 'beanie', 'hairnet', 'hardhat']);
  });
});

describe('sanitizeNickname', () => {
  it('trims, collapses whitespace and strips control characters', () => {
    expect(sanitizeNickname('  Big \t  Boss\u0007 ', 16)).toBe('Big Boss');
  });

  it('cuts to the max length without splitting emoji', () => {
    expect(sanitizeNickname('abcdefghijklmnopqrstuvwxyz', 16)).toBe('abcdefghijklmnop');
    expect(sanitizeNickname('🥒🥒🥒', 2)).toBe('🥒🥒');
  });

  it('falls back when nothing is left', () => {
    expect(sanitizeNickname('   ', 16)).toBe(DEFAULT_NICKNAME);
    expect(sanitizeNickname(42, 16)).toBe(DEFAULT_NICKNAME);
    expect(sanitizeNickname('\u200b\u200b', 16)).toBe(DEFAULT_NICKNAME);
    expect(sanitizeNickname('\u200d \u0301', 16)).toBe(DEFAULT_NICKNAME);
  });

  it.each([
    ['C1 controls', 'Bob\u0085\u009b', 'Bob'],
    ['zero-width characters', 'B\u200bo\u200cb\ufeff', 'Bob'],
    ['direction marks', '\u200eBob\u200f', 'Bob'],
    ['bidi overrides', 'Bob\u202e', 'Bob'],
    ['bidi embeddings and pops', '\u202aB\u202bo\u202cb\u202d', 'Bob'],
    ['bidi isolates', '\u2066B\u2067o\u2068b\u2069', 'Bob'],
  ])('strips %s (M2 review F4)', (_name, raw, expected) => {
    expect(sanitizeNickname(raw, 16)).toBe(expected);
  });

  it('keeps the zero width joiner inside emoji sequences', () => {
    const family = '👩\u200d👩\u200d👧';
    expect(sanitizeNickname(family, 16)).toBe(family);
  });
});
