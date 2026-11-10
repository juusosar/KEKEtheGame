// Target assignment (§3.1) on the real kespro map with the real item catalogue: every item can be
// placed, targets keep their distance from the vans, and a full room of players all get a target.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../packages/shared/src/config';
import { getItemCatalogue } from '../packages/shared/src/items';
import { loadMap } from '../packages/shared/src/map';
import { createRng } from '../packages/shared/src/rng';
import { addCarryPlayer, assignTargets, createItemWorld } from '../packages/shared/src/rules/carry';
import { eligibleSpawns, spawnsForItem } from '../packages/shared/src/rules/targets';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const map = loadMap(
  JSON.parse(readFileSync(resolve(repoRoot, 'maps/kespro.tmj'), 'utf8')),
  'maps/kespro.tmj',
);
const catalogue = getItemCatalogue('kespro');
const config = loadConfig();

describe('target assignment on the kespro map', () => {
  it('every catalogue item has at least one eligible spawn', () => {
    const free = eligibleSpawns(map, [], config);
    for (const item of catalogue.items) {
      expect(spawnsForItem(item, free).length, item.id).toBeGreaterThan(0);
    }
  });

  it('gives all maxPlayersPerRoom players a target far enough from every van', () => {
    let world = createItemWorld();
    for (let i = 0; i < config.maxPlayersPerRoom; i++) world = addCarryPlayer(world, `p${i}`, i + 1);
    world = assignTargets(world, { catalogue: catalogue.items, map, rng: createRng(2026), config }).world;
    expect(world.players.every((p) => p.target !== null)).toBe(true);
    const minDist = config.targetMinDistanceFromVanTiles * map.tileSize;
    for (const item of world.items) {
      for (const van of map.vanSlots)
        expect(Math.hypot(item.x - van.x, item.y - van.y)).toBeGreaterThanOrEqual(minDist);
    }
  });
});
