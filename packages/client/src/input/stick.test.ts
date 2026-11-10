import { describe, expect, it } from 'vitest';
import { applyRadialDeadzone, clampLength } from './stick';

describe('applyRadialDeadzone', () => {
  it('reads zero inside the deadzone, including stick drift on both axes', () => {
    expect(applyRadialDeadzone(0.1, -0.1, 0.2)).toEqual({ x: 0, y: 0 });
    expect(applyRadialDeadzone(0.2, 0, 0.2)).toEqual({ x: 0, y: 0 });
  });

  it('rescales so movement starts at 0 just outside the deadzone and reaches 1 at full tilt', () => {
    expect(applyRadialDeadzone(0.6, 0, 0.2).x).toBeCloseTo(0.5);
    expect(applyRadialDeadzone(1, 0, 0.2)).toEqual({ x: 1, y: 0 });
    expect(applyRadialDeadzone(0, -1, 0.2).y).toBeCloseTo(-1);
  });

  it('keeps direction and caps the length at 1 for corner values above 1', () => {
    const v = applyRadialDeadzone(1, 1, 0.2);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1);
    expect(v.x).toBeCloseTo(v.y);
  });

  it('treats NaN axes as centred', () => {
    expect(applyRadialDeadzone(Number.NaN, 0, 0.2)).toEqual({ x: 0, y: 0 });
  });
});

describe('clampLength', () => {
  it('normalises long vectors and keeps short ones', () => {
    const v = clampLength({ x: 1, y: 1 });
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1);
    expect(clampLength({ x: 0.3, y: 0 })).toEqual({ x: 0.3, y: 0 });
  });
});
