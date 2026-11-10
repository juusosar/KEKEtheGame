import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config';
import { placementPointsFor, rankSession } from './session';

const config = loadConfig();

describe('placementPointsFor (§5)', () => {
  it('gives 10, 7, 5, 3 for the first four places and 1 after that', () => {
    expect([1, 2, 3, 4, 5, 6, 16].map((p) => placementPointsFor(p, config))).toEqual([10, 7, 5, 3, 1, 1, 1]);
  });

  it('gives tied places the higher place points (competition ranking already shares the place)', () => {
    // Places 1, 1, 3 → 10, 10, 5.
    expect([1, 1, 3].map((p) => placementPointsFor(p, config))).toEqual([10, 10, 5]);
  });

  it('follows the config', () => {
    const custom = { placementPoints: [3], placementPointsOther: 0 };
    expect(placementPointsFor(1, custom)).toBe(3);
    expect(placementPointsFor(2, custom)).toBe(0);
  });

  it('rejects places below 1 and fractions', () => {
    expect(() => placementPointsFor(0, config)).toThrow(RangeError);
    expect(() => placementPointsFor(1.5, config)).toThrow(RangeError);
  });
});

describe('rankSession (§5)', () => {
  it('ranks by placement points, highest first', () => {
    const ranked = rankSession([
      { id: 'a', points: 10, itemPoints: 3 },
      { id: 'b', points: 20, itemPoints: 1 },
      { id: 'c', points: 17, itemPoints: 9 },
    ]);
    expect(ranked.map((r) => [r.id, r.place])).toEqual([
      ['b', 1],
      ['c', 2],
      ['a', 3],
    ]);
  });

  it('breaks a points tie on session item points', () => {
    const ranked = rankSession([
      { id: 'a', points: 17, itemPoints: 4 },
      { id: 'b', points: 17, itemPoints: 6 },
    ]);
    expect(ranked.map((r) => [r.id, r.place])).toEqual([
      ['b', 1],
      ['a', 2],
    ]);
  });

  it('shares the higher place when points and item points are both equal, and skips the next', () => {
    const ranked = rankSession([
      { id: 'b', points: 10, itemPoints: 2 },
      { id: 'a', points: 10, itemPoints: 2 },
      { id: 'c', points: 5, itemPoints: 9 },
    ]);
    expect(ranked.map((r) => [r.id, r.place])).toEqual([
      ['a', 1],
      ['b', 1],
      ['c', 3],
    ]);
  });

  it('handles no sides and rejects bad input', () => {
    expect(rankSession([])).toEqual([]);
    expect(() =>
      rankSession([
        { id: 'a', points: 1, itemPoints: 0 },
        { id: 'a', points: 2, itemPoints: 0 },
      ]),
    ).toThrow(RangeError);
    expect(() => rankSession([{ id: 'a', points: -1, itemPoints: 0 }])).toThrow(RangeError);
    expect(() => rankSession([{ id: 'a', points: 1, itemPoints: Number.NaN }])).toThrow(RangeError);
  });
});
