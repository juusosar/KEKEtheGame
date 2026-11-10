import { describe, expect, it } from 'vitest';
import { DEFAULT_COMBAT } from '../net/combatView';
import { NEUTRAL_LOOK, combatLook, hpBarFill, swingAngles } from './combatLook';

const cfg = { koAlpha: 0.45, protectedBlinkHz: 8 };
const alive = { ...DEFAULT_COMBAT, hp: 100 };

describe('combatLook', () => {
  it('is neutral for a healthy player', () => {
    expect(combatLook(alive, 5, 0, cfg)).toBe(NEUTRAL_LOOK);
  });
  it('KO lies down and fades', () => {
    expect(combatLook({ ...alive, alive: false, hp: 0 }, 5, 0, cfg)).toEqual({
      alpha: 0.45,
      angle: 90,
      flash: false,
    });
  });
  it('flashes until flashUntil', () => {
    expect(combatLook(alive, 1, 1.1, cfg).flash).toBe(true);
    expect(combatLook(alive, 1.2, 1.1, cfg).flash).toBe(false);
  });
  it('blinks while protected', () => {
    const a = combatLook({ ...alive, protected: true }, 0, 0, cfg).alpha;
    const b = combatLook({ ...alive, protected: true }, 1 / 16 + 0.001, 0, cfg).alpha;
    expect(a).not.toBe(b);
  });
});

describe('hpBarFill', () => {
  it('shows only when hurt and alive', () => {
    expect(hpBarFill(alive, 100)).toBeNull();
    expect(hpBarFill({ ...alive, hp: 25 }, 100)).toBe(0.25);
    expect(hpBarFill({ ...alive, hp: 0, alive: false }, 100)).toBeNull();
  });
});

describe('swingAngles', () => {
  it('centres the arc on the aim', () => {
    const [a, b] = swingAngles(1, { arcDegrees: 90 });
    expect(a).toBeCloseTo(1 - Math.PI / 4);
    expect(b).toBeCloseTo(1 + Math.PI / 4);
  });
});
