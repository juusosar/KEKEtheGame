import { describe, expect, it } from 'vitest';
import { Rng, createRng } from './rng';

const take = (rng: Rng, n: number): number[] => Array.from({ length: n }, () => rng.next());

describe('Rng', () => {
  it('produces the same sequence for the same seed', () => {
    expect(take(createRng(42), 100)).toEqual(take(createRng(42), 100));
  });

  it('produces a known sequence (guards against accidental algorithm changes)', () => {
    const rng = createRng(1);
    expect(take(rng, 3).map((v) => v.toFixed(10))).toMatchInlineSnapshot(`
      [
        "0.6270739406",
        "0.0027357212",
        "0.5274470400",
      ]
    `);
  });

  it('produces different sequences for different seeds', () => {
    expect(take(createRng(1), 10)).not.toEqual(take(createRng(2), 10));
  });

  it('resumes exactly from a saved state', () => {
    const a = createRng(7);
    take(a, 13);
    const b = Rng.fromState(a.getState());
    expect(take(b, 20)).toEqual(take(a, 20));
  });

  it('next() stays in [0, 1)', () => {
    for (const v of take(createRng(123), 10_000)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('int() covers the inclusive range and nothing else', () => {
    const rng = createRng(5);
    const seen = new Set<number>();
    for (let i = 0; i < 2_000; i++) seen.add(rng.int(-2, 3));
    expect([...seen].sort((a, b) => a - b)).toEqual([-2, -1, 0, 1, 2, 3]);
    expect(rng.int(4, 4)).toBe(4);
  });

  it('int() rejects bad bounds', () => {
    const rng = createRng(5);
    expect(() => rng.int(3, 1)).toThrow(RangeError);
    expect(() => rng.int(0.5, 2)).toThrow(RangeError);
  });

  it('chance() honours 0 and 1 and rejects out-of-range probabilities', () => {
    const rng = createRng(9);
    for (let i = 0; i < 100; i++) {
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(1)).toBe(true);
    }
    expect(() => rng.chance(1.5)).toThrow(RangeError);
  });

  it('pick() returns array elements and rejects an empty array', () => {
    const rng = createRng(11);
    const items = ['a', 'b', 'c'] as const;
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) seen.add(rng.pick(items));
    expect(seen).toEqual(new Set(items));
    expect(() => rng.pick([])).toThrow(RangeError);
  });

  it('rejects a non-finite seed', () => {
    expect(() => createRng(Number.NaN)).toThrow(RangeError);
  });
});

describe('Rng.weightedPick', () => {
  // Rarity weights from §7: common 55, uncommon 33, rare 12.
  const rarities = [
    { value: 'common', weight: 55 },
    { value: 'uncommon', weight: 33 },
    { value: 'rare', weight: 12 },
  ] as const;

  it('matches the weight distribution', () => {
    const rng = createRng(2026);
    const n = 100_000;
    const counts: Record<string, number> = { common: 0, uncommon: 0, rare: 0 };
    for (let i = 0; i < n; i++) {
      const r = rng.weightedPick(rarities);
      counts[r] = (counts[r] ?? 0) + 1;
    }
    expect((counts.common ?? 0) / n).toBeCloseTo(0.55, 2);
    expect((counts.uncommon ?? 0) / n).toBeCloseTo(0.33, 2);
    expect((counts.rare ?? 0) / n).toBeCloseTo(0.12, 2);
  });

  it('is deterministic for a seed', () => {
    const roll = (seed: number) => {
      const rng = createRng(seed);
      return Array.from({ length: 50 }, () => rng.weightedPick(rarities));
    };
    expect(roll(99)).toEqual(roll(99));
  });

  it('never picks zero-weight entries', () => {
    const rng = createRng(3);
    const entries = [
      { value: 'never', weight: 0 },
      { value: 'always', weight: 1 },
      { value: 'never2', weight: 0 },
    ];
    for (let i = 0; i < 1_000; i++) expect(rng.weightedPick(entries)).toBe('always');
  });

  it('rejects empty, all-zero and negative weights', () => {
    const rng = createRng(3);
    expect(() => rng.weightedPick([])).toThrow(RangeError);
    expect(() => rng.weightedPick([{ value: 1, weight: 0 }])).toThrow(RangeError);
    expect(() => rng.weightedPick([{ value: 1, weight: -1 }])).toThrow(RangeError);
  });
});
