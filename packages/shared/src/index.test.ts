import { describe, expect, it } from 'vitest';
import { clamp } from './index';

describe('clamp', () => {
  it('keeps values inside the range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('clamps to the bounds', () => {
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(42, 0, 10)).toBe(10);
  });

  it('rejects an inverted range', () => {
    expect(() => clamp(1, 10, 0)).toThrow(RangeError);
  });
});
