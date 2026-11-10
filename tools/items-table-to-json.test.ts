// The committed item catalogues must be exactly what tools/items-table-to-json.ts makes from the
// Markdown tables, every item needs a sprite in the items atlas, and every item zone needs spawns.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getItemCatalogue, getTheme, loadMap } from '../packages/shared/src';
import { buildItemJson, itemJsonPath } from './items-table-to-json';
import { ItemTableError, itemsToJson, parseItemTables } from './items/table';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string): string => readFileSync(resolve(repoRoot, path), 'utf8');

describe('items-table-to-json', () => {
  it('committed items.kespro.json matches the Markdown tables (run npm run gen:items)', () => {
    expect(read(itemJsonPath('kespro'))).toBe(buildItemJson('kespro'));
  });

  it('reads normal and joke tables, cleaning ticks and escapes', () => {
    const rows = parseItemTables(
      [
        '| id | Name | Zone | Description |',
        '| --- | --- | --- | --- |',
        "| `butter_valio` | Valio voi 2,5 kg | cold\\_room | For the restaurant's croissants. |",
        '',
        '| id | Name | Description |',
        '| --- | --- | --- |',
        '| `kurkkumopo` | Kurkkumopo | A ride-on cucumber \\| really. |',
      ].join('\n'),
    );
    expect(rows).toEqual([
      {
        id: 'butter_valio',
        name: 'Valio voi 2,5 kg',
        desc: "For the restaurant's croissants.",
        zone: 'cold_room',
        sprite: 'butter_valio',
        rarity: 'normal',
      },
      {
        id: 'kurkkumopo',
        name: 'Kurkkumopo',
        desc: 'A ride-on cucumber | really.',
        zone: 'any',
        sprite: 'kurkkumopo',
        rarity: 'joke',
      },
    ]);
    expect(JSON.parse(itemsToJson(rows))).toEqual({ items: rows });
  });

  it('honours Sprite and Rarity columns and skips unrelated tables', () => {
    const rows = parseItemTables(
      [
        '| Key | Default |',
        '| --- | --- |',
        '| tileSize | 32 |',
        '',
        '| id | Name | Zone | Description | Sprite | Rarity |',
        '| :-- | --- | --- | --- | --- | --- |',
        '| a | A | frozen | D | a_icon | joke |',
      ].join('\n'),
    );
    expect(rows).toEqual([
      { id: 'a', name: 'A', desc: 'D', zone: 'frozen', sprite: 'a_icon', rarity: 'joke' },
    ]);
  });

  it('fails clearly on a broken row or no tables', () => {
    expect(() =>
      parseItemTables(['| id | Name | Description |', '| --- | --- | --- |', '| a | A |'].join('\n')),
    ).toThrow(/line 3: expected 3 cells, found 2/);
    expect(() => parseItemTables('# nothing here')).toThrow(ItemTableError);
  });
});

describe('kespro catalogue against the assets and the map', () => {
  const catalogue = getItemCatalogue('kespro');

  it('has an items atlas frame for every sprite, 24×24 normal and 32×32 joke (§11.1)', () => {
    const atlas = JSON.parse(read('packages/client/public/assets/items.json')) as {
      frames: Record<string, { sourceSize: { w: number; h: number } }>;
    };
    for (const item of catalogue.items) {
      const frame = atlas.frames[item.sprite];
      expect(frame, item.sprite).toBeDefined();
      const size = item.rarity === 'joke' ? 32 : 24;
      expect(frame?.sourceSize, item.sprite).toEqual({ w: size, h: size });
    }
    expect(Object.keys(atlas.frames).sort()).toEqual(catalogue.items.map((item) => item.sprite).sort());
  });

  it('has item spawn points on the map for every item zone', () => {
    const map = loadMap(JSON.parse(read(`maps/${getTheme('kespro').assets.map}`)) as unknown);
    const spawnZones = new Set(map.itemSpawns.map((spawn) => spawn.zone));
    for (const zone of catalogue.zones) expect(spawnZones.has(zone), zone).toBe(true);
  });
});
