// Seeded pseudo-random number generator. All randomness in game rules goes through here (§21),
// so a seed fully determines a simulation and tests can replay it exactly.

/** One entry for `Rng.weightedPick`: a value and its non-negative relative weight. */
export interface Weighted<T> {
  readonly value: T;
  readonly weight: number;
}

/**
 * Deterministic PRNG based on mulberry32 (32-bit state, period 2^32).
 * Fast and good enough for gameplay; not for cryptography.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    if (!Number.isFinite(seed)) {
      throw new RangeError(`Rng: seed must be a finite number, got ${seed}`);
    }
    this.state = seed >>> 0;
  }

  /** Current internal state. Pass it to `Rng.fromState` to resume the exact same sequence. */
  getState(): number {
    return this.state;
  }

  /** Recreates a generator from a value returned by `getState()`. */
  static fromState(state: number): Rng {
    return new Rng(state);
  }

  /** Next float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in the inclusive range [min, max]. Both bounds must be integers. */
  int(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max)) {
      throw new RangeError(`Rng.int: bounds must be integers, got [${min}, ${max}]`);
    }
    if (min > max) {
      throw new RangeError(`Rng.int: min (${min}) is greater than max (${max})`);
    }
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with probability `p` (0..1). */
  chance(p: number): boolean {
    if (!(p >= 0 && p <= 1)) {
      throw new RangeError(`Rng.chance: probability must be in [0, 1], got ${p}`);
    }
    return this.next() < p;
  }

  /** Uniformly random element of a non-empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new RangeError('Rng.pick: cannot pick from an empty array');
    }
    // Index is in range by construction, so the element exists.
    return items[this.int(0, items.length - 1)] as T;
  }

  /**
   * Random value where each entry's chance is its weight divided by the total weight.
   * Zero-weight entries are never picked. Throws if the list is empty, a weight is negative or
   * not finite, or every weight is zero.
   */
  weightedPick<T>(entries: readonly Weighted<T>[]): T {
    let total = 0;
    for (const entry of entries) {
      if (!Number.isFinite(entry.weight) || entry.weight < 0) {
        throw new RangeError(`Rng.weightedPick: weights must be finite and >= 0, got ${entry.weight}`);
      }
      total += entry.weight;
    }
    if (total <= 0) {
      throw new RangeError('Rng.weightedPick: needs at least one entry with a positive weight');
    }
    let roll = this.next() * total;
    let last: T | undefined;
    for (const entry of entries) {
      if (entry.weight === 0) continue;
      last = entry.value;
      roll -= entry.weight;
      if (roll < 0) return entry.value;
    }
    // Floating-point rounding can leave `roll` a hair above zero; fall back to the last positive entry.
    return last as T;
  }
}

/** Creates a seeded generator. Same seed, same sequence. */
export function createRng(seed: number): Rng {
  return new Rng(seed);
}
