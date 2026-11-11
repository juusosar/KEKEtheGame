// The Tiled maps live in the repo-level maps/ folder (§15.2), outside the client's public/ folder, so
// Vite bundles them as raw text. Picking by the theme's file name keeps brand-specific names in the theme.
import type { MapTheme } from '@keke/shared';

const MAP_FILES = import.meta.glob<string>('../../../../maps/*.tmj', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** Parsed Tiled JSON of the theme's map (`theme.assets.map`, e.g. `kespro.tmj`). */
export function rawMapFor(theme: MapTheme): unknown {
  const entry = Object.entries(MAP_FILES).find(([path]) => path.endsWith(`/${theme.assets.map}`));
  if (!entry) throw new Error(`map ${theme.assets.map} is not in maps/`);
  return JSON.parse(entry[1]) as unknown;
}

/** True when the client has the theme's map file (false for a map not built yet). */
export function hasMapFile(theme: MapTheme): boolean {
  return Object.keys(MAP_FILES).some((path) => path.endsWith(`/${theme.assets.map}`));
}
