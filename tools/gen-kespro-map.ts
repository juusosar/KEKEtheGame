// Writes maps/kespro.tmj from tools/map/kespro.ts. Run with `npm run gen:map` after changing the
// layout (or after `npm run gen:art` changes the tileset). Output is deterministic; commit it.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildKesproMap, serializeMap } from './map/kespro';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(repoRoot, path), 'utf8')) as Record<string, unknown>;

const config = read('packages/shared/src/data/config.json') as {
  coldRoomFriction: number;
  coldRoomSpeedMultiplier: number;
};
const map = buildKesproMap(config, read('maps/kespro_tiles.tsj'));
writeFileSync(resolve(repoRoot, 'maps/kespro.tmj'), serializeMap(map));
console.log('Wrote maps/kespro.tmj');
