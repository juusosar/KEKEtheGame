import { defaultThemeId, getTheme } from '@keke/shared';
import { describe, expect, it } from 'vitest';
import { MapFileError, loadThemeMap } from './maps';

describe('loadThemeMap', () => {
  it('loads the default theme map from the repo maps/ folder', () => {
    const map = loadThemeMap(getTheme(defaultThemeId));
    expect(map.vanSlots.length).toBeGreaterThan(0);
    expect(map.collision.tileSize).toBe(32);
  });

  it('throws MapFileError naming the file when it is missing', () => {
    const theme = getTheme(defaultThemeId);
    const missing = { ...theme, assets: { ...theme.assets, map: 'nope.tmj' } };
    expect(() => loadThemeMap(missing, ['/nonexistent/'])).toThrow(MapFileError);
    expect(() => loadThemeMap(missing, ['/nonexistent/'])).toThrow(/nope\.tmj/);
  });
});
