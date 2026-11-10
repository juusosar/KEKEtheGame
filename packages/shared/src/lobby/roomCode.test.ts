import { describe, expect, it } from 'vitest';
import { createRng } from '../rng';
import { ROOM_CODE_ALPHABET, generateRoomCode, isRoomCode, normalizeRoomCode } from './roomCode';

describe('room codes', () => {
  it('uses no ambiguous letters', () => {
    for (const letter of ['I', 'L', 'O']) expect(ROOM_CODE_ALPHABET).not.toContain(letter);
    expect(ROOM_CODE_ALPHABET).toHaveLength(23);
  });

  it('generates valid 4-letter codes deterministically for a seed', () => {
    const a = generateRoomCode(createRng(7));
    expect(isRoomCode(a)).toBe(true);
    expect(generateRoomCode(createRng(7))).toBe(a);
    const rng = createRng(1);
    for (let i = 0; i < 500; i++) expect(generateRoomCode(rng)).toMatch(/^[A-HJKMNP-Z]{4}$/);
  });

  it('skips codes already in use', () => {
    const first = generateRoomCode(createRng(3));
    const second = generateRoomCode(createRng(3), new Set([first]));
    expect(second).not.toBe(first);
  });

  it('gives up with a clear error when no code is free', () => {
    const rng = createRng(3);
    const taken = { has: () => true } as unknown as ReadonlySet<string>;
    expect(() => generateRoomCode(rng, taken, 5)).toThrow(/no free code/);
  });

  it('normalises typed input', () => {
    expect(normalizeRoomCode(' kx-bd ')).toBe('KXBD');
    expect(normalizeRoomCode('k x b d')).toBe('KXBD');
    expect(normalizeRoomCode('KXB')).toBeNull();
    expect(normalizeRoomCode('KXBO')).toBeNull();
    expect(normalizeRoomCode(undefined)).toBeNull();
  });
});
