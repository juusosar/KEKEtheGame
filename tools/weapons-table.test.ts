// weapons.json must agree with the §7 table (copied in tools/weapons/weapons.md), and every weapon
// needs a frame in the weapons atlas.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getWeaponCatalogue, type WeaponDef } from '../packages/shared/src/weapons';
import { loadConfig } from '../packages/shared/src/config';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string): string => readFileSync(resolve(repoRoot, path), 'utf8');

interface DocRow {
  id: string;
  name: string;
  behaviour: string;
  damage: string;
  uses: string;
  cooldown: string;
  rarity: string;
}

function docRows(): DocRow[] {
  return read('tools/weapons/weapons.md')
    .split(/\r?\n/)
    .filter((line) => line.startsWith('| `'))
    .map((line) => {
      const cells = line
        .slice(1, -1)
        .split(/(?<!\\)\|/)
        .map((c) => c.trim().replace(/`/g, '').replace(/\\_/g, '_'));
      const [id = '', name = '', behaviour = '', damage = '', uses = '', cooldown = '', , rarity = ''] =
        cells;
      return { id, name, behaviour, damage, uses, cooldown, rarity };
    });
}

const numbers = (text: string): number[] => (text.match(/\d+(\.\d+)?/g) ?? []).map(Number);

function damages(w: WeaponDef): number[] {
  switch (w.behaviour) {
    case 'melee':
      return [w.melee.damage];
    case 'spray':
      return [w.spray.damagePerTick];
    case 'thrown':
      return [w.projectile.damage];
    case 'trap':
      return [w.trap.damage];
    case 'shot_then_melee':
      return [w.shot.damage, w.melee.damage];
    case 'charge':
      return [w.charge.damage];
  }
}

describe('weapons.json vs the §7 table', () => {
  const catalogue = getWeaponCatalogue();
  const rows = docRows();

  it('has the same weapons in the same order', () => {
    expect(rows.map((r) => r.id)).toEqual(catalogue.weapons.map((w) => w.id));
  });

  for (const row of rows) {
    it(`${row.id} matches name, behaviour, damage, uses, cooldown and rarity`, () => {
      const w = catalogue.require(row.id);
      expect(w.name).toBe(row.name);
      expect(row.behaviour.startsWith(w.behaviour)).toBe(true);
      expect(Boolean(w.block)).toBe(row.behaviour.includes('block'));
      expect(damages(w)).toEqual(numbers(row.damage).slice(0, damages(w).length));
      if (row.uses === '∞') expect(w.uses).toBeNull();
      else expect(w.uses).toBe(numbers(row.uses).reduce((a, b) => a + b, 0));
      if (w.behaviour === 'shot_then_melee') expect(w.shotUses).toBe(numbers(row.uses)[0]);
      expect(w.cooldownSeconds).toBe(row.cooldown === '—' ? 0 : numbers(row.cooldown)[0]);
      expect(row.rarity.includes('fallback') ? 'fallback' : row.rarity).toBe(w.rarity);
    });
  }

  it('uses the doc rarity weights', () => {
    expect(loadConfig().weaponRarityWeights).toEqual({ common: 55, uncommon: 33, rare: 12 });
  });

  it('has a weapons atlas frame for every sprite', () => {
    const atlas = JSON.parse(read('packages/client/public/assets/weapons.json')) as {
      frames: Record<string, unknown>;
    };
    for (const w of catalogue.weapons) expect(atlas.frames[w.sprite], w.sprite).toBeDefined();
  });
});
