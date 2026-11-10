import { describe, expect, it } from 'vitest';
import { getWeaponCatalogue } from '../weapons';
import {
  peelArmed,
  peelExpired,
  peelSpares,
  peelTrips,
  placePeel,
  slipDirection,
  startSlide,
  trippingPeel,
  type Peel,
} from './trap';

const def = getWeaponCatalogue().require('banana_peels');
if (def.behaviour !== 'trap') throw new Error('banana_peels is not a trap');
const stats = def.trap;

function peel(id = 1, owner = 'a', team = 0, at = { x: 100, y: 100 }, now = 10): Peel {
  return placePeel(id, 'banana_peels', { id: owner, team }, at, now, stats);
}

describe('banana peel rules', () => {
  it('uses the §7 numbers: 0 damage, 1 s slide, drops the carried item, 45 s lifetime', () => {
    expect(def.uses).toBe(3);
    expect(def.cooldownSeconds).toBe(0.5);
    expect(stats.damage).toBe(0);
    expect(stats.slideSeconds).toBe(1);
    expect(stats.dropsCarried).toBe(true);
    expect(stats.lifetimeSeconds).toBe(45);
  });

  it('arms after armSeconds and expires lifetimeSeconds after the drop', () => {
    const p = peel();
    expect(peelArmed(p, 10)).toBe(false);
    expect(peelArmed(p, 10 + stats.armSeconds)).toBe(true);
    expect(peelExpired(p, 10 + stats.lifetimeSeconds - 0.01)).toBe(false);
    expect(peelExpired(p, 10 + stats.lifetimeSeconds)).toBe(true);
  });

  it('trips a body whose centre is within the trigger radius, only while armed', () => {
    const p = peel();
    const armed = 10 + stats.armSeconds;
    const on = { id: 'b', team: 0, x: 100 + stats.triggerRadiusPx, y: 100 };
    const off = { id: 'b', team: 0, x: 100 + stats.triggerRadiusPx + 1, y: 100 };
    expect(peelTrips(p, on, 10, stats)).toBe(false);
    expect(peelTrips(p, on, armed, stats)).toBe(true);
    expect(peelTrips(p, off, armed, stats)).toBe(false);
    expect(peelTrips(p, on, 10 + stats.lifetimeSeconds, stats)).toBe(false);
  });

  it('spares the owner and, with teams on, the owner team; free-for-all team 0 spares nobody else', () => {
    expect(peelSpares(peel(1, 'a', 0), { id: 'a', team: 0 })).toBe(true);
    expect(peelSpares(peel(1, 'a', 0), { id: 'b', team: 0 })).toBe(false);
    expect(peelSpares(peel(1, 'a', 1), { id: 'b', team: 1 })).toBe(true);
    expect(peelSpares(peel(1, 'a', 1), { id: 'b', team: 2 })).toBe(false);
  });

  it('picks the oldest peel a body stands on', () => {
    const peels = [peel(3), peel(2), peel(5, 'a', 0, { x: 400, y: 400 })];
    const body = { id: 'b', team: 0, x: 100, y: 100 };
    expect(trippingPeel(peels, body, 20, () => stats)?.id).toBe(2);
    expect(trippingPeel(peels, { ...body, x: 300 }, 20, () => stats)).toBeNull();
  });

  it('slides along the velocity, or the aim when standing still', () => {
    const moving = slipDirection({ x: 0, y: -50 }, 0);
    expect(moving.x).toBeCloseTo(0);
    expect(moving.y).toBeCloseTo(-1);
    const still = slipDirection({ x: 0, y: 0 }, Math.PI);
    expect(still.x).toBeCloseTo(-1);
    expect(still.y).toBeCloseTo(0);
  });

  it('a slide covers slideSeconds × slideSpeed at slide speed', () => {
    const slide = startSlide({ x: 2, y: 0 }, stats);
    expect(slide).toEqual({
      dir: { x: 1, y: 0 },
      remainingPx: stats.slideSeconds * stats.slideSpeedPxPerSecond,
      speedPxPerSecond: stats.slideSpeedPxPerSecond,
    });
    expect(startSlide({ x: 0, y: 0 }, stats)).toBeNull();
    expect(startSlide({ x: 1, y: 0 }, { ...stats, slideSeconds: 0 })).toBeNull();
  });
});
