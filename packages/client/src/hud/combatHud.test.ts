import { getWeaponCatalogue } from '@keke/shared';
import { describe, expect, it } from 'vitest';
import { DEFAULT_COMBAT } from '../net/combatView';
import { formatUses, hpLevel, readCombatHud, weaponName, type CombatHudInput } from './combatHud';

const weapons = getWeaponCatalogue();
const input: CombatHudInput = {
  combat: { ...DEFAULT_COMBAT, hp: 100 },
  phase: 'playing',
  spectator: false,
  maxHp: 100,
  weapons,
  warnFraction: 0.5,
  lowFraction: 0.25,
};

describe('readCombatHud', () => {
  it('shows full HP and unlimited fists', () => {
    const m = readCombatHud(input);
    expect(m).toMatchObject({ show: true, hp: 100, fill: 1, level: 'ok', ko: null });
    expect(m.weapon).toMatchObject({ id: 'fists', name: 'Fists', uses: null, usesText: '∞', seconds: false });
  });

  it('counts swings and spray seconds', () => {
    const pin = readCombatHud({
      ...input,
      combat: { ...DEFAULT_COMBAT, hp: 40, weapon: 'rolling_pin', uses: 7 },
    });
    expect(pin).toMatchObject({ level: 'warn', fill: 0.4 });
    expect(pin.weapon).toMatchObject({ name: 'Rolling pin', usesText: '7', sprite: 'rolling_pin' });
    const ketchup = readCombatHud({
      ...input,
      combat: { ...DEFAULT_COMBAT, hp: 20, weapon: 'ketchup_bottle', uses: 2.33 },
    });
    expect(ketchup.level).toBe('low');
    expect(ketchup.weapon).toMatchObject({ seconds: true, usesText: '2.4 s' });
  });

  it('carries the KO countdown', () => {
    const m = readCombatHud({ ...input, combat: { ...DEFAULT_COMBAT, hp: 0, alive: false, respawnIn: 2 } });
    expect(m.ko).toEqual({ respawnIn: 2 });
  });

  it('hides for spectators, outside a round and before sync', () => {
    expect(readCombatHud({ ...input, spectator: true }).show).toBe(false);
    expect(readCombatHud({ ...input, phase: 'roundResults' }).show).toBe(false);
    expect(readCombatHud({ ...input, combat: null }).show).toBe(false);
    expect(readCombatHud({ ...input, phase: 'countdown' }).show).toBe(true);
  });
});

describe('helpers', () => {
  it('names weapons from i18n, falling back to weapons.json and the id', () => {
    expect(weaponName('soda_bottle', weapons)).toBe('Shaken soda bottle');
    expect(weaponName('mystery', { get: () => undefined })).toBe('mystery');
  });

  it('formats uses', () => {
    expect(formatUses(null, false)).toBe('∞');
    expect(formatUses(0, true)).toBe('0.0 s');
    expect(formatUses(3, false)).toBe('3');
  });

  it('grades HP', () => {
    expect(hpLevel(0.51, 0.5, 0.25)).toBe('ok');
    expect(hpLevel(0.5, 0.5, 0.25)).toBe('warn');
    expect(hpLevel(0.25, 0.5, 0.25)).toBe('low');
  });

  it('has an i18n name for every weapon in the catalogue', async () => {
    const en = (await import('../i18n/en.json')).default as Record<string, string>;
    for (const w of weapons.weapons) expect(en[`weapon.${w.id}`], w.id).toBeTypeOf('string');
  });
});
