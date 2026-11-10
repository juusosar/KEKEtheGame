// Generates the v1 placeholder art (§11.1): Phaser JSON-hash atlases, the map tileset and an
// asset manifest. Run with `npm run gen:art`. Output is deterministic; commit the result.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateAll } from './art/generate';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = generateAll();
for (const [path, contents] of files) {
  const out = resolve(repoRoot, path);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, contents);
}
console.log(`Wrote ${files.size} files.`);
