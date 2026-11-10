import { getWeaponCatalogue, type AttackMessage, type AttackMode } from '@keke/shared';
import { describe, expect, it } from 'vitest';
import { ATTACK_FX, attackFx, hitFrame, hitFx, koFx, type FxConfig } from './fxPlan';

const weapons = getWeaponCatalogue();
const cfg: FxConfig = {
  swingFxSeconds: 0.15,
  fxBurstSeconds: 0.35,
  damageNumberSeconds: 0.7,
  heldWeaponReachPx: 9,
  heldWeaponLiftPx: 7,
  tileSize: 32,
};
const attack = (weapon: string, mode: AttackMode): AttackMessage => ({
  player: 'a',
  weapon,
  mode,
  x: 100,
  y: 100,
  aim: 0,
});

describe('attackFx', () => {
  it('has a handler for every attack mode', () => {
    expect(Object.keys(ATTACK_FX).sort()).toEqual(['charge', 'melee', 'shot', 'spray', 'thrown', 'trap']);
  });

  it('draws a melee swing as a wedge of the weapon arc and reach', () => {
    const [wedge] = attackFx(attack('baguette', 'melee'), weapons.get('baguette'), cfg);
    const def = weapons.require('baguette');
    expect(wedge).toMatchObject({ kind: 'wedge', x: 100, y: 100, aim: 0 });
    if (wedge?.kind !== 'wedge' || !('melee' in def)) throw new Error('no wedge');
    expect(wedge.rangePx).toBe(def.melee.rangePx);
    expect(wedge.arcDegrees).toBe(def.melee.arcDegrees);
  });

  it('leaves spray cones to sprayFx', () => {
    expect(attackFx(attack('ketchup_bottle', 'spray'), weapons.get('ketchup_bottle'), cfg)).toEqual([]);
  });

  it('lays a dust lane along a charge', () => {
    const [lane] = attackFx(attack('pallet_jack', 'charge'), weapons.get('pallet_jack'), cfg);
    const def = weapons.require('pallet_jack');
    if (def.behaviour !== 'charge') throw new Error('not a charge');
    expect(lane).toMatchObject({ kind: 'trail', lengthPx: def.charge.distanceTiles * 32 });
  });

  it('returns nothing for an unknown weapon', () => {
    expect(attackFx(attack('nope', 'melee'), undefined, cfg)).toEqual([]);
  });
});

describe('hitFx', () => {
  const hit = {
    source: { kind: 'player' as const, id: 'a' },
    target: 'b',
    damage: 10,
    weapon: 'egg_carton',
    hp: 90,
  };

  it('splats the weapon frame on the target and floats the damage', () => {
    const fx = hitFx(hit, 'a', cfg);
    expect(fx[0]).toMatchObject({ kind: 'sprite', frame: 'egg_splat', follow: 'b' });
    expect(fx[1]).toMatchObject({ kind: 'number', target: 'b', text: '-10', color: '#ffe14d' });
  });

  it('numbers hits on us in red and skips numbers for 0 damage', () => {
    expect(hitFx(hit, 'b', cfg)[1]).toMatchObject({ color: '#ff5a4f' });
    expect(hitFx({ ...hit, damage: 0 }, 'a', cfg)).toHaveLength(1);
  });

  it('falls back to the hit spark', () => {
    expect(hitFrame('baguette')).toBe('hit_spark');
    expect(hitFrame(null)).toBe('hit_spark');
  });
});

describe('koFx', () => {
  it('bursts KO stars on the body', () => {
    expect(koFx('b', cfg)).toEqual([expect.objectContaining({ frame: 'ko_stars', follow: 'b' })]);
  });
});
