import { getWeaponCatalogue } from '@keke/shared';
import { describe, expect, it } from 'vitest';
import { predictedSwingMode } from './swingPrediction';

const weapons = getWeaponCatalogue();
const ready = { alive: true, stunned: false, uses: null };

describe('predictedSwingMode', () => {
  it('swings fists and melee weapons on the press', () => {
    expect(predictedSwingMode(ready, weapons.get('fists'), 1, 0)).toBe('melee');
    expect(predictedSwingMode({ ...ready, uses: 20 }, weapons.get('baguette'), 1, 0)).toBe('melee');
  });

  it('uses the mode the server will use: throw, peel, cork then melee', () => {
    expect(predictedSwingMode({ ...ready, uses: 6 }, weapons.get('egg_carton'), 1, 0)).toBe('thrown');
    expect(predictedSwingMode({ ...ready, uses: 3 }, weapons.get('banana_peels'), 1, 0)).toBe('trap');
    expect(predictedSwingMode({ ...ready, uses: 9 }, weapons.get('champagne_bottle'), 1, 0)).toBe('shot');
    expect(predictedSwingMode({ ...ready, uses: 8 }, weapons.get('champagne_bottle'), 1, 0)).toBe('melee');
  });

  it('does not swing when the server would refuse the attack', () => {
    expect(predictedSwingMode({ ...ready, alive: false }, weapons.get('fists'), 1, 0)).toBeNull();
    expect(predictedSwingMode({ ...ready, stunned: true }, weapons.get('fists'), 1, 0)).toBeNull();
    expect(predictedSwingMode(ready, weapons.get('fists'), 1, 1.2), 'in cooldown').toBeNull();
    expect(predictedSwingMode(ready, undefined, 1, 0), 'unknown weapon').toBeNull();
  });

  it('leaves sprays to the server events', () => {
    expect(predictedSwingMode({ ...ready, uses: 3 }, weapons.get('ketchup_bottle'), 1, 0)).toBeNull();
  });
});
