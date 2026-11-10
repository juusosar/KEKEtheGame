import { getWeaponCatalogue, sprayCloud, type AttackMessage } from '@keke/shared';
import { describe, expect, it } from 'vitest';
import { cloudOpacity, SprayFxModel } from './sprayFx';

const weapons = getWeaponCatalogue();
const ext = weapons.require('fire_extinguisher');
if (ext.behaviour !== 'spray') throw new Error('fire_extinguisher is not a spray');

function attack(
  weapon: string,
  x = 100,
  y = 100,
  aim = 0,
  mode: AttackMessage['mode'] = 'spray',
): AttackMessage {
  return { player: 'p1', weapon, mode, x, y, aim };
}

describe('SprayFxModel', () => {
  it('ketchup draws a red cone that follows its ticks and leaves no cloud', () => {
    const m = new SprayFxModel(weapons);
    m.onEvent('attack', attack('ketchup_bottle'), 1);
    const { cones, clouds } = m.active(1.1);
    expect(cones).toHaveLength(1);
    expect(cones[0]).toMatchObject({ player: 'p1', foam: false, rangePx: 80, coneDegrees: 30 });
    expect(clouds).toHaveLength(0);
    // Gone once no tick refreshes it.
    expect(m.active(1.5).cones).toHaveLength(0);
  });

  it('the extinguisher leaves a vision cloud that lasts its seconds', () => {
    const m = new SprayFxModel(weapons);
    m.onEvent('attack', attack('fire_extinguisher'), 1);
    const [cloud] = m.active(1.2).clouds;
    const expected = sprayCloud({ x: 100, y: 100 }, 0, ext.spray);
    if (!expected) throw new Error('expected a cloud');
    expect(cloud).toMatchObject({ x: expected.x, y: expected.y, radiusPx: expected.radiusPx });
    expect(m.active(1 + expected.seconds + 0.01).clouds).toHaveLength(0);
  });

  it('a held spray on one spot refreshes one cloud; sweeping leaves several', () => {
    const m = new SprayFxModel(weapons);
    m.onEvent('attack', attack('fire_extinguisher'), 1);
    m.onEvent('attack', attack('fire_extinguisher', 102), 1.25);
    expect(m.active(1.3).clouds).toHaveLength(1);
    m.onEvent('attack', attack('fire_extinguisher', 100, 100, Math.PI / 2), 1.5);
    expect(m.active(1.6).clouds).toHaveLength(2);
  });

  it('ignores melee attacks and other events', () => {
    const m = new SprayFxModel(weapons);
    m.onEvent('attack', attack('baguette', 0, 0, 0, 'melee'), 1);
    m.onEvent('hit', { target: 'p2' }, 1);
    expect(m.active(1)).toEqual({ cones: [], clouds: [] });
  });
});

describe('cloudOpacity', () => {
  it('is full until the fade, then falls to 0', () => {
    const c = { x: 0, y: 0, radiusPx: 48, from: 0, until: 1.5 };
    expect(cloudOpacity(c, 0.5, 0.8, 0.5)).toBe(0.8);
    expect(cloudOpacity(c, 1.25, 0.8, 0.5)).toBeCloseTo(0.4, 6);
    expect(cloudOpacity(c, 1.5, 0.8, 0.5)).toBe(0);
  });
});
