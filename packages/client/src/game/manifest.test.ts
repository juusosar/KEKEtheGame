import { describe, expect, it } from 'vitest';
import manifest from '../../public/assets/manifest.json';
import { themeAtlasKey, type AssetManifest } from './manifest';

describe('themeAtlasKey (P1-5)', () => {
  const real = manifest as AssetManifest;

  it('gives every theme its own van and order box sheets from the manifest', () => {
    expect(themeAtlasKey(real, 'kespro', 'van')).toBe('van');
    expect(themeAtlasKey(real, 'prisma', 'van')).toBe('van_prisma');
    expect(themeAtlasKey(real, 'prisma', 'order_box')).toBe('order_box_prisma');
    // Every sheet the manifest names is an atlas it loads.
    const atlases = new Set(real.atlases.map((a) => a.key));
    for (const theme of Object.values(real.themes)) {
      for (const key of Object.values(theme.atlases)) expect(atlases.has(key)).toBe(true);
    }
  });

  it('falls back to the bare sheet name', () => {
    expect(themeAtlasKey(undefined, 'prisma', 'van')).toBe('van');
    expect(themeAtlasKey({ themes: {} }, 'prisma', 'gate')).toBe('gate');
  });
});
