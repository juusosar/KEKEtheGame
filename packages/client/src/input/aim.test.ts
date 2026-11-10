import { describe, expect, it } from 'vitest';
import { angleDelta, coneAimAssist, nearestInCone, noAimAssist, resolveGamepadAim } from './aim';

const origin = { x: 0, y: 0 };

describe('angleDelta', () => {
  it('wraps across ±π', () => {
    expect(angleDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2);
    expect(angleDelta(0.1, -0.1)).toBeCloseTo(-0.2);
  });
});

describe('nearestInCone', () => {
  it('snaps to an enemy inside the 30° cone (15° each side)', () => {
    const enemy = { x: 100, y: 20 }; // ≈11° below the aim line
    expect(nearestInCone(origin, 0, [enemy], 30)).toBeCloseTo(Math.atan2(20, 100));
  });

  it('ignores enemies outside the cone', () => {
    expect(nearestInCone(origin, 0, [{ x: 100, y: 40 }], 30)).toBe(0); // ≈22°
    expect(nearestInCone(origin, 0, [{ x: -100, y: 0 }], 30)).toBe(0);
  });

  it('picks the nearest of several candidates in the cone', () => {
    const near = { x: 50, y: -5 };
    const far = { x: 300, y: 0 };
    expect(nearestInCone(origin, 0, [far, near], 30)).toBeCloseTo(Math.atan2(-5, 50));
  });

  it('works for a cone straddling ±π', () => {
    expect(nearestInCone(origin, Math.PI, [{ x: -100, y: -10 }], 30)).toBeCloseTo(Math.atan2(-10, -100));
  });
});

describe('resolveGamepadAim', () => {
  const assist = coneAimAssist(() => [{ x: 100, y: 10 }], 30);

  it('uses the right stick when it is deflected, without aim assist', () => {
    expect(resolveGamepadAim(1, { x: 1, y: 0 }, 0, origin, assist)).toBe(1);
  });

  it('falls back to the movement direction with aim assist when the right stick is idle', () => {
    expect(resolveGamepadAim(null, { x: 1, y: 0 }, 2, origin, assist)).toBeCloseTo(Math.atan2(10, 100));
    expect(resolveGamepadAim(null, { x: 0, y: 1 }, 2, origin, noAimAssist)).toBeCloseTo(Math.PI / 2);
  });

  it('keeps the previous aim when both sticks are idle', () => {
    expect(resolveGamepadAim(null, { x: 0, y: 0 }, 2, origin, assist)).toBe(2);
  });
});
