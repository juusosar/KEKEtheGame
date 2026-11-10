import { getWeaponCatalogue, loadConfig } from '@keke/shared';
import { describe, expect, it } from 'vitest';
import { DEFAULT_COMBAT, blockSpeed, predictionSpeed, readCombat } from './combatView';

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
  it('matches the server: carry × (0 when KO, stunned or charging, else slow)', () => {
    expect(predictionSpeed(DEFAULT_COMBAT, false, config)).toBe(1);
    expect(predictionSpeed(DEFAULT_COMBAT, true, config)).toBe(config.carrySpeedMultiplier);
    expect(predictionSpeed({ ...DEFAULT_COMBAT, stunned: true }, false, config)).toBe(0);
    expect(predictionSpeed({ ...DEFAULT_COMBAT, alive: false }, false, config)).toBe(0);
    expect(predictionSpeed({ ...DEFAULT_COMBAT, slowMultiplier: 0.6 }, true, config)).toBeCloseTo(
      0.6 * config.carrySpeedMultiplier,
    );
    // The block is per frame now (blockSpeed), not from the synced flag (M4 review F7).
    expect(
      predictionSpeed({ ...DEFAULT_COMBAT, weapon: 'cast_iron_pan', blocking: true }, false, config),
    ).toBe(1);
    expect(predictionSpeed({ ...DEFAULT_COMBAT, charging: true }, false, config)).toBe(0);
  });
});

describe('blockSpeed (M4 review F7)', () => {
  it("is the pan's move multiplier while we could raise it, else undefined", () => {
    const pan = { ...DEFAULT_COMBAT, weapon: 'cast_iron_pan' };
    expect(blockSpeed(pan, weapons)).toBe(weapons.require('cast_iron_pan').block?.moveSpeedMultiplier);
    expect(blockSpeed(DEFAULT_COMBAT, weapons)).toBeUndefined();
    expect(blockSpeed({ ...pan, stunned: true }, weapons)).toBeUndefined();
    expect(blockSpeed({ ...pan, alive: false }, weapons)).toBeUndefined();
  });
});
