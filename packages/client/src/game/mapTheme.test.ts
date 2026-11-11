import { defaultThemeId, getTheme } from '@keke/shared';
import { describe, expect, it } from 'vitest';
import { assetTheme, isThemeId, stateMapId, themeFor, themeFromQuery } from './mapTheme';

describe('map theme (P1-5)', () => {
  it('picks the theme by id and falls back to the default', () => {
    expect(themeFor('prisma').id).toBe('prisma');
    expect(themeFor('kespro').id).toBe('kespro');
    expect(themeFor('').id).toBe(defaultThemeId);
    expect(themeFor('toString').id).toBe(defaultThemeId);
    expect(themeFor(undefined).id).toBe(defaultThemeId);
    expect(isThemeId('both')).toBe(false);
  });

  it('reads ?map= for the offline walk', () => {
    expect(themeFromQuery('?scene=game&map=prisma').id).toBe('prisma');
    expect(themeFromQuery('?scene=game').id).toBe(defaultThemeId);
    expect(themeFromQuery('?map=nowhere').id).toBe(defaultThemeId);
  });

  it('loads the default map for a theme whose map file is missing', () => {
    const prisma = getTheme('prisma');
    expect(assetTheme(prisma, () => true)).toBe(prisma);
    expect(assetTheme(prisma, () => false).id).toBe(defaultThemeId);
  });

  it('reads mapId from a state', () => {
    expect(stateMapId({ mapId: 'prisma' })).toBe('prisma');
    expect(stateMapId({})).toBe('');
    expect(stateMapId(null)).toBe('');
  });
});
