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

  it('keeps white panel text and minimap walls readable (P1-6: a light secondary hid both)', () => {
    for (const theme of Object.values(themes)) {
      const { secondary, floor } = theme.colors;
      expect(contrast(secondary, '#FFFFFF'), `${theme.id} white text on secondary`).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrast(secondary, floor), `${theme.id} secondary walls on floor`).toBeGreaterThanOrEqual(3);
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

/** WCAG contrast ratio of two #RRGGBB colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string): number => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (bl ?? 0);
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}
