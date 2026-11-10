import { describe, expect, it } from 'vitest';
import { heldPose, swingProgress, turnToward, type HeldInput } from './heldPose';

const cfg = { heldWeaponReachPx: 10, heldWeaponLiftPx: 5, heldSwingSeconds: 0.2, heldUseKickPx: 4 };
const base: HeldInput = {
  x: 100,
  y: 100,
  aim: 0,
  weapon: 'baguette',
  alive: true,
  visible: true,
  blocking: false,
  charging: false,
  swing: null,
  now: 1,
};

describe('heldPose', () => {
  it('holds the weapon at the hand along the aim', () => {
    const p = heldPose(base, cfg);
    expect(p).toMatchObject({ visible: true, angle: 0, flipY: false, swingProgress: null });
    expect(p.x).toBeCloseTo(110);
    expect(p.y).toBeCloseTo(95);
  });

  it('mirrors a weapon aimed left and puts one aimed up behind the body', () => {
    expect(heldPose({ ...base, aim: Math.PI }, cfg).flipY).toBe(true);
    expect(heldPose({ ...base, aim: -Math.PI / 2 }, cfg).behind).toBe(true);
    expect(heldPose({ ...base, aim: Math.PI / 2 }, cfg).behind).toBe(false);
  });

  it('holds nothing while KO, hidden, or with idle fists', () => {
    expect(heldPose({ ...base, alive: false }, cfg).visible).toBe(false);
    expect(heldPose({ ...base, visible: false }, cfg).visible).toBe(false);
    expect(heldPose({ ...base, weapon: 'fists' }, cfg).visible).toBe(false);
  });

  it('sweeps a melee swing across the arc', () => {
    const swing = { mode: 'melee' as const, start: 1, aim: 0, arcDegrees: 90 };
    const start = heldPose({ ...base, swing, now: 1 }, cfg);
    const end = heldPose({ ...base, swing, now: 1.199 }, cfg);
    expect(start.angle).toBeCloseTo(-Math.PI / 4);
    expect(end.angle).toBeGreaterThan(Math.PI / 4 - 0.01);
    expect(start.swingProgress).toBe(0);
    expect(heldPose({ ...base, swing, now: 1.25 }, cfg).swingProgress).toBeNull();
  });

  it('shows fists only while punching, jabbing straight out', () => {
    const swing = { mode: 'melee' as const, start: 1, aim: 0, arcDegrees: 120 };
    const mid = heldPose({ ...base, weapon: 'fists', swing, now: 1.1 }, cfg);
    expect(mid.visible).toBe(true);
    expect(mid.angle).toBe(0);
    expect(mid.x).toBeCloseTo(100 + 10 + 8);
  });

  it('kicks the hand forward for a throw and raises it for a block', () => {
    const swing = { mode: 'thrown' as const, start: 1, aim: 0, arcDegrees: 0 };
    expect(heldPose({ ...base, swing, now: 1.1 }, cfg).x).toBeCloseTo(114);
    const block = heldPose({ ...base, blocking: true }, cfg);
    expect(block.blocking).toBe(true);
    expect(block.x).toBeCloseTo(112);
    expect(heldPose({ ...base, weapon: 'pallet_jack', charging: true }, cfg).x).toBeCloseTo(118);
  });
});

describe('swingProgress', () => {
  it('is null before, after and without a swing', () => {
    const swing = { mode: 'melee' as const, start: 2, aim: 0, arcDegrees: 90 };
    expect(swingProgress(null, 2, 0.2)).toBeNull();
    expect(swingProgress(swing, 1.9, 0.2)).toBeNull();
    expect(swingProgress(swing, 2.1, 0.2)).toBeCloseTo(0.5);
    expect(swingProgress(swing, 2.2, 0.2)).toBeNull();
  });
});

describe('turnToward', () => {
  it('turns the short way round and stops on the target', () => {
    expect(turnToward(3, -3, 0.1)).toBeCloseTo(3.1);
    expect(turnToward(0, 0.05, 0.1)).toBe(0.05);
    expect(turnToward(0, -1, 0.1)).toBeCloseTo(-0.1);
  });
});
