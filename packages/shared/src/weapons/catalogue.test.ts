import { describe, expect, it } from 'vitest';
import { ConfigError } from '../config';
import weaponsJson from '../data/weapons.json';
import { attackMode, getWeaponCatalogue, loadWeaponCatalogue, WEAPON_BEHAVIOURS } from './catalogue';

const clone = (): { weapons: Record<string, unknown>[] } => JSON.parse(JSON.stringify(weaponsJson));

describe('weapon catalogue', () => {
  const catalogue = getWeaponCatalogue();

  it('loads all 11 weapons plus fists from weapons.json (§7)', () => {
    expect(catalogue.weapons).toHaveLength(12);
    expect(catalogue.fallback.id).toBe('fists');
    expect(catalogue.fallback.uses).toBeNull();
    expect(catalogue.rollable).toHaveLength(11);
    expect(catalogue.rollable.map((w) => w.id)).not.toContain('fists');
  });

  it('covers every behaviour type and has a pan with block', () => {
    const behaviours = new Set(catalogue.weapons.map((w) => w.behaviour));
    expect([...behaviours].sort()).toEqual([...WEAPON_BEHAVIOURS].sort());
    expect(catalogue.require('cast_iron_pan').block).toEqual({
      meleeDamageMultiplier: 0.3,
      moveSpeedMultiplier: 0.5,
      reflectsProjectiles: true,
    });
  });

  it('groups rollable weapons by rarity', () => {
    expect(catalogue.ofRarity('common').map((w) => w.id)).toEqual([
      'baguette',
      'frozen_salmon',
      'ketchup_bottle',
      'egg_carton',
      'banana_peels',
    ]);
    expect(catalogue.ofRarity('rare').map((w) => w.id)).toEqual(['champagne_bottle', 'pallet_jack']);
  });

  it('defaults the sprite to the id and is frozen', () => {
    expect(catalogue.require('baguette').sprite).toBe('baguette');
    expect(Object.isFrozen(catalogue.weapons)).toBe(true);
    expect(Object.isFrozen(catalogue.require('baguette'))).toBe(true);
    expect(() => catalogue.require('nope')).toThrow(RangeError);
    expect(catalogue.get('nope')).toBeUndefined();
  });

  it('switches champagne from shot to melee after the cork', () => {
    const champagne = catalogue.require('champagne_bottle');
    expect(attackMode(champagne, 9)).toBe('shot');
    expect(attackMode(champagne, 8)).toBe('melee');
    expect(attackMode(champagne, 1)).toBe('melee');
    expect(attackMode(catalogue.require('egg_carton'), 3)).toBe('thrown');
    expect(attackMode(catalogue.fallback, null)).toBe('melee');
  });

  describe('validation', () => {
    it('rejects a duplicate id', () => {
      const raw = clone();
      raw.weapons.push({ ...raw.weapons[1] });
      expect(() => loadWeaponCatalogue(raw)).toThrow(/duplicate weapon id "baguette"/);
    });

    it('needs exactly one fallback with unlimited uses', () => {
      const raw = clone();
      raw.weapons[0] = { ...raw.weapons[0], rarity: 'common' };
      expect(() => loadWeaponCatalogue(raw)).toThrow(/exactly one fallback/);
      const limited = clone();
      limited.weapons[0] = { ...limited.weapons[0], uses: 5 };
      expect(() => loadWeaponCatalogue(limited)).toThrow(/unlimited uses/);
    });

    it('needs uses on rolled weapons, whole except for sprays', () => {
      const raw = clone();
      raw.weapons[1] = { ...raw.weapons[1], uses: null };
      expect(() => loadWeaponCatalogue(raw)).toThrow(/needs a number of uses/);
      const fractional = clone();
      fractional.weapons[1] = { ...fractional.weapons[1], uses: 2.5 };
      expect(() => loadWeaponCatalogue(fractional)).toThrow(/uses must be whole/);
      const spray = clone();
      const ketchup = spray.weapons.findIndex((w) => w.id === 'ketchup_bottle');
      spray.weapons[ketchup] = { ...spray.weapons[ketchup], uses: 2.5 };
      expect(() => loadWeaponCatalogue(spray)).not.toThrow();
    });

    it('rejects stats that do not match the behaviour, and unknown keys', () => {
      const raw = clone();
      raw.weapons[1] = { ...raw.weapons[1], behaviour: 'thrown' };
      expect(() => loadWeaponCatalogue(raw)).toThrow(ConfigError);
      const typo = clone();
      typo.weapons[1] = { ...typo.weapons[1], damage: 10 };
      expect(() => loadWeaponCatalogue(typo)).toThrow(ConfigError);
    });

    it('needs a melee use left after the champagne shots', () => {
      const raw = clone();
      const i = raw.weapons.findIndex((w) => w.id === 'champagne_bottle');
      raw.weapons[i] = { ...raw.weapons[i], shotUses: 9 };
      expect(() => loadWeaponCatalogue(raw)).toThrow(/at least one melee use/);
    });
  });
});
