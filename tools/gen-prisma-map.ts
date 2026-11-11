// Writes maps/prisma.tmj from tools/map/prisma.ts. Run with `npm run gen:map` after changing the
// layout (or after `npm run gen:art` changes the tileset). Output is deterministic; commit it.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serializeMap } from './map/kespro';
import { buildPrismaMap } from './map/prisma';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tileset = JSON.parse(readFileSync(resolve(repoRoot, 'maps/prisma_tiles.tsj'), 'utf8')) as Record<
  string,
  unknown
>;
writeFileSync(resolve(repoRoot, 'maps/prisma.tmj'), serializeMap(buildPrismaMap(tileset)));
console.log('Wrote maps/prisma.tmj');
