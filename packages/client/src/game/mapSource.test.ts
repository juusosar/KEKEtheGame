import { loadMap, themes } from '@keke/shared';
import { describe, expect, it } from 'vitest';
import { hasMapFile, rawMapFor } from './mapSource';

// P1 review F8: the client used to draw the default map under another theme's name when that theme's
// .tmj was missing from the bundle, which would hide a server running a map the client cannot draw.
describe('client map files', () => {
  it('bundles a loadable map for every available theme', () => {
    const available = Object.values(themes).filter((t) => t.available);
    expect(available.length).toBeGreaterThanOrEqual(2);
    for (const theme of available) {
      expect(hasMapFile(theme), theme.id).toBe(true);
      expect(() => loadMap(rawMapFor(theme), theme.assets.map), theme.id).not.toThrow();
    }
  });
});
