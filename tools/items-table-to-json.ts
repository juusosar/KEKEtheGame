// Regenerates an item catalogue JSON from its Markdown tables (§10: "the harness should regenerate the
// JSON from it"). Run with `npm run gen:items` to rebuild every tools/items/items.<theme>.md, or pass
// theme ids: `npm run gen:items -- prisma`.
// The output is validated with the shared schema before it is written; commit both files.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadItemCatalogue } from '../packages/shared/src/items';
import { itemsToJson, parseItemTables } from './items/table';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const itemTablePath = (theme: string): string => `tools/items/items.${theme}.md`;
export const itemJsonPath = (theme: string): string => `packages/shared/src/data/items.${theme}.json`;

/** Theme ids that have an item table file, `tools/items/items.<theme>.md`, sorted. */
export function itemTableThemes(): string[] {
  return readdirSync(resolve(repoRoot, 'tools/items'))
    .map((name) => /^items\.([a-z][a-z0-9_]*)\.md$/.exec(name)?.[1])
    .filter((theme): theme is string => theme !== undefined)
    .sort();
}

/** Builds the JSON text for a theme from its Markdown tables, validating it on the way. */
export function buildItemJson(theme: string): string {
  const rows = parseItemTables(readFileSync(resolve(repoRoot, itemTablePath(theme)), 'utf8'));
  const json = itemsToJson(rows);
  loadItemCatalogue(JSON.parse(json), itemTablePath(theme));
  return json;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const requested = process.argv.slice(2);
  for (const theme of requested.length > 0 ? requested : itemTableThemes()) {
    writeFileSync(resolve(repoRoot, itemJsonPath(theme)), buildItemJson(theme));
    console.log(`Wrote ${itemJsonPath(theme)}`);
  }
}
