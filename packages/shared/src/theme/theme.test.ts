import { describe, expect, it } from 'vitest';
import { allGuardedTerms, defaultThemeId, getTheme, themes } from './index';

describe('themes', () => {
  it('registers each theme under its own id', () => {
    for (const [id, theme] of Object.entries(themes)) {
      expect(theme.id).toBe(id);
    }
  });

  it('uses #RRGGBB colours everywhere', () => {
    for (const theme of Object.values(themes)) {
      for (const colour of Object.values(theme.colors)) {
        expect(colour).toMatch(/^#[0-9A-F]{6}$/i);
      }
    }
  });

  it('names its assets after its id', () => {
    for (const theme of Object.values(themes)) {
      for (const file of Object.values(theme.assets)) {
        expect(file).toContain(theme.id);
      }
    }
  });

  it('guards its own store name', () => {
    for (const theme of Object.values(themes)) {
      expect(theme.brand.guardedTerms).toContain(theme.brand.storeName);
    }
  });

  it('defaults to an available theme', () => {
    expect(getTheme(defaultThemeId).available).toBe(true);
  });

  it('collects guarded terms from every theme without duplicates', () => {
    const terms = allGuardedTerms();
    expect(new Set(terms).size).toBe(terms.length);
    for (const theme of Object.values(themes)) {
      expect(terms).toEqual(expect.arrayContaining([...theme.brand.guardedTerms]));
    }
  });
});
