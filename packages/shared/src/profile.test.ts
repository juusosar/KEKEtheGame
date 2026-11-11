import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COLOR,
  DEFAULT_HAT,
  DEFAULT_NICKNAME,
  HAT_IDS,
  PLAYER_COLORS,
  TEAM_COLORS,
  distinctColor,
  sanitizeNickname,
  sanitizeProfile,
  teamColor,
  type PlayerColor,
} from './profile';
import { loadConfig } from './config';

describe('teamColor', () => {
  it('gives teams 1 and 2 their own colours and nothing to anyone else', () => {
    expect(teamColor(1)).toBe(TEAM_COLORS[0]);
    expect(teamColor(2)).toBe(TEAM_COLORS[1]);
    expect(teamColor(0)).toBeUndefined();
    expect(teamColor(3)).toBeUndefined();
    expect(TEAM_COLORS[0]).not.toBe(TEAM_COLORS[1]);
  });
});

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

describe('distinctColor (playtest 1)', () => {
  it('keeps a free colour', () => {
    expect(distinctColor(PLAYER_COLORS[2], [PLAYER_COLORS[0]])).toBe(PLAYER_COLORS[2]);
  });

  it('moves a taken colour to the next free one, ignoring case and wrapping round', () => {
    expect(distinctColor(PLAYER_COLORS[0], [PLAYER_COLORS[0].toLowerCase(), PLAYER_COLORS[1]])).toBe(
      PLAYER_COLORS[2],
    );
    const last = PLAYER_COLORS[PLAYER_COLORS.length - 1] as PlayerColor;
    expect(distinctColor(last, [last])).toBe(PLAYER_COLORS[0]);
  });

  it('gives a full room of default joiners a colour each', () => {
    const max = loadConfig().maxPlayersPerRoom;
    expect(max).toBeGreaterThanOrEqual(16);
    expect(PLAYER_COLORS.length).toBeGreaterThanOrEqual(max);
    const taken: string[] = [];
    for (let i = 0; i < max; i++) taken.push(distinctColor(DEFAULT_COLOR, taken));
    expect(new Set(taken).size).toBe(max);
  });

  it('keeps the wanted colour when the whole palette is taken', () => {
    expect(distinctColor(PLAYER_COLORS[4], PLAYER_COLORS)).toBe(PLAYER_COLORS[4]);
  });
});
