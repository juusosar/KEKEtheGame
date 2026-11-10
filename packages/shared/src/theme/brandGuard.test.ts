import { describe, expect, it } from 'vitest';
import { findBrandTerms } from './brandGuard';
import { kesproTheme } from './kespro';

const store = kesproTheme.brand.storeName;
const terms = kesproTheme.brand.guardedTerms;

describe('findBrandTerms', () => {
  it('flags a display brand name with its line number', () => {
    const source = `const a = 1;\nthis.add.text(0, 0, 'Welcome to ${store}');\n`;
    expect(findBrandTerms(source, terms)).toEqual([
      { term: store, line: 2, text: `this.add.text(0, 0, 'Welcome to ${store}');` },
    ]);
  });

  it('flags brand names in comments too', () => {
    expect(findBrandTerms(`// walk the ${store} map`, terms)).toHaveLength(1);
  });

  it('allows lower-case ids used in file names and asset keys', () => {
    const id = kesproTheme.id;
    expect(findBrandTerms(`load('items.${id}.json'); const key = '${id}_tiles';`, terms)).toEqual([]);
  });

  it('only matches whole words', () => {
    expect(findBrandTerms(`const x${store} = 1; const ${store}2 = 2; ${store}_tiles`, terms)).toEqual([]);
  });

  it('finds every hit on a line', () => {
    expect(findBrandTerms(`${store} and ${store}`, terms)).toHaveLength(2);
  });

  it('matches hyphenated terms literally', () => {
    expect(findBrandTerms('shop at S-kaupat today', ['S-kaupat'])).toHaveLength(1);
    expect(findBrandTerms('shop at Sxkaupat today', ['S-kaupat'])).toEqual([]);
  });

  it('returns nothing without terms', () => {
    expect(findBrandTerms(store, [])).toEqual([]);
  });
});
