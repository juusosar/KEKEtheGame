import { describe, expect, it } from 'vitest';
import { themes, type ThemeId } from '../theme';
import { MAP_CHOICES, isMapChoice, mapChoiceAvailable, mapForRound, mapRotation } from './maps';
import { totalRounds } from './phases';

describe('map choice', () => {
  it('offers every theme alone plus both', () => {
    const ids = Object.keys(themes) as ThemeId[];
    for (const id of ids) expect(MAP_CHOICES).toContain(id);
    expect(MAP_CHOICES).toContain('both');
  });

  it('plays kespro first, then prisma, with both', () => {
    expect(mapRotation('both')).toEqual(['kespro', 'prisma']);
    expect(mapRotation('prisma')).toEqual(['prisma']);
    expect(totalRounds(3, mapRotation('both').length)).toBe(6);
  });

  it('gives each map roundsPerMap rounds in order', () => {
    const rounds = [1, 2, 3, 4, 5, 6].map((r) => mapForRound('both', r, 3));
    expect(rounds).toEqual(['kespro', 'kespro', 'kespro', 'prisma', 'prisma', 'prisma']);
    expect(mapForRound('prisma', 2, 1)).toBe('prisma');
    // Lobby (round 0) and past the end clamp to the first and last map.
    expect(mapForRound('both', 0, 2)).toBe('kespro');
    expect(mapForRound('both', 9, 1)).toBe('prisma');
  });

  it('is available only when every map of the choice is loaded', () => {
    expect(mapChoiceAvailable('kespro', ['kespro'])).toBe(true);
    expect(mapChoiceAvailable('prisma', ['kespro'])).toBe(false);
    expect(mapChoiceAvailable('both', ['kespro'])).toBe(false);
    expect(mapChoiceAvailable('both', ['prisma', 'kespro'])).toBe(true);
  });

  it('recognises choices from the wire', () => {
    expect(isMapChoice('both')).toBe(true);
    expect(isMapChoice('mall')).toBe(false);
    expect(isMapChoice(3)).toBe(false);
  });
});
