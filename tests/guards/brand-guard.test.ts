// Brand guard (§14, §21): brand names may only appear in packages/shared/src/theme/.
// Scans every source file in the repo for the guarded terms each theme declares.

import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { allGuardedTerms, findBrandTerms } from '../../packages/shared/src/theme';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

/** Folders (relative to the repo root, `/`-separated) that are never scanned. */
const SKIPPED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  'playwright-report',
  'test-results',
  'packages/shared/src/theme',
]);

/** Text files that hold code, data, markup or maps. Docs (`*.md`) are not code and stay free-form. */
const SCANNED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.html',
  '.css',
  '.tmj',
  '.tsj',
]);

const SKIPPED_FILES = new Set(['package-lock.json']);

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    const rel = relative(repoRoot, path).split(sep).join('/');
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name) && !SKIPPED_DIRS.has(rel)) files.push(...listSourceFiles(path));
    } else if (
      entry.isFile() &&
      SCANNED_EXTENSIONS.has(extname(entry.name)) &&
      !SKIPPED_FILES.has(entry.name)
    ) {
      files.push(rel);
    }
  }
  return files;
}

describe('brand guard', () => {
  const terms = allGuardedTerms();
  const files = listSourceFiles(repoRoot);

  it('scans the source tree', () => {
    expect(terms.length).toBeGreaterThan(0);
    expect(files).toContain('packages/client/src/scenes/Boot.ts');
    expect(files.some((file) => file.startsWith('packages/shared/src/theme/'))).toBe(false);
  });

  it('finds no brand names outside packages/shared/src/theme/', () => {
    const violations = files.flatMap((file) =>
      findBrandTerms(readFileSync(join(repoRoot, file), 'utf8'), terms).map(
        (hit) => `${file}:${hit.line} "${hit.term}" in: ${hit.text}`,
      ),
    );
    expect(
      violations,
      'Brand names belong in packages/shared/src/theme/*. Read them from the theme instead.',
    ).toEqual([]);
  });
});
