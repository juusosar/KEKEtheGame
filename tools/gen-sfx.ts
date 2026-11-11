// Generates the placeholder sound effects and music loops (§12) as WAV files under the client's public
// assets. Run with `npm run gen:sfx`. Output is deterministic; commit the result.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateAudio } from './sfx/generate';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = generateAudio();
for (const [path, contents] of files) {
  const out = resolve(repoRoot, path);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, contents);
}
console.log(`Wrote ${files.size} files.`);
