// Pure matcher behind the brand guard (§14, §21: no brand strings outside the theme files).
// The repo scan that feeds it lives in tests/guards/brand-guard.test.ts.

export interface BrandHit {
  term: string;
  /** 1-based line number. */
  line: number;
  /** The offending line, trimmed. */
  text: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Finds every guarded term in `source`. Terms match case-sensitively as whole words, so lower-case ids
 * such as `kespro` in `items.kespro.json` or a theme id stay allowed, while a display name does not.
 */
export function findBrandTerms(source: string, terms: readonly string[]): BrandHit[] {
  if (terms.length === 0) return [];
  // Whole-word edges: the term must not touch a letter, digit or underscore on either side.
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}_])(${terms.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}_])`,
    'gu',
  );
  const hits: BrandHit[] = [];
  source.split(/\r?\n/).forEach((text, index) => {
    for (const match of text.matchAll(pattern)) {
      hits.push({ term: match[1] ?? match[0], line: index + 1, text: text.trim() });
    }
  });
  return hits;
}
