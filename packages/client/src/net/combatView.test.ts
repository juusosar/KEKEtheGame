import { getWeaponCatalogue, loadConfig } from '@keke/shared';
import { describe, expect, it } from 'vitest';
import { DEFAULT_COMBAT, predictionSpeed, readCombat } from './combatView';

const config = loadConfig();
const weapons = getWeaponCatalogue();

describe('readCombat', () => {
  it('reads the combat fields, with -1 uses as unlimited', () => {
    const state = {
      players: new Map([
        [
          'a',
          {
            sessionId: 'a',
            hp: 82,
            alive: true,
            weapon: 'baguette',
            weaponUses: 19,
            stunned: true,
            slowMultiplier: 0.6,
            protected: false,
            blocking: false,
            respawnIn: 0,
          },
        ],
        ['b', { sessionId: 'b', hp: 0, alive: false, weapon: 'fists', weaponUses: -1, respawnIn: 3 }],
      ]),
    };
    const view = readCombat(state);
    expect(view.get('a')).toMatchObject({
      hp: 82,
      weapon: 'baguette',
      uses: 19,
      stunned: true,
      slowMultiplier: 0.6,
    });
    expect(view.get('b')).toMatchObject({ alive: false, uses: null, respawnIn: 3, slowMultiplier: 1 });
    expect(readCombat(null).size).toBe(0);
  });
});

describe('predictionSpeed', () => {
  it('matches the server: carry × (0 when KO or stunned, else slow × block)', () => {
    expect(predictionSpeed(DEFAULT_COMBAT, false, config, weapons)).toBe(1);
    expect(predictionSpeed(DEFAULT_COMBAT, true, config, weapons)).toBe(config.carrySpeedMultiplier);
    expect(predictionSpeed({ ...DEFAULT_COMBAT, stunned: true }, false, config, weapons)).toBe(0);
    expect(predictionSpeed({ ...DEFAULT_COMBAT, alive: false }, false, config, weapons)).toBe(0);
    expect(predictionSpeed({ ...DEFAULT_COMBAT, slowMultiplier: 0.6 }, true, config, weapons)).toBeCloseTo(
      0.6 * config.carrySpeedMultiplier,
    );
    const pan = { ...DEFAULT_COMBAT, weapon: 'cast_iron_pan', blocking: true };
    expect(predictionSpeed(pan, false, config, weapons)).toBe(
      weapons.require('cast_iron_pan').block?.moveSpeedMultiplier,
    );
  });
});
