// Loads the theme's Tiled map for the server's collision, spawns and zones (§15.1, §15.4).
// The server reads `maps/<theme.assets.map>` from disk at startup. The build copies maps/*.tmj into
// dist/maps, so a built server finds them next to its bundle; from source they come from the repo's maps/.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadMap, type MapModel, type MapTheme } from '@keke/shared';

/**
 * Folders searched for map files, in order: `maps/` next to this module (the bundled dist/), then the
 * repo-level maps/ (both src/ and dist/ sit two levels below the repo root's packages/ folder).
 */
export const MAP_DIRS: readonly string[] = [
  fileURLToPath(new URL('./maps/', import.meta.url)),
  fileURLToPath(new URL('../../../maps/', import.meta.url)),
];

/** Thrown when the theme's map file is missing. `MapError` from shared covers a file that is present but invalid. */
export class MapFileError extends Error {
  constructor(file: string, dirs: readonly string[]) {
    super(`Map file ${file} not found in: ${dirs.join(', ')}`);
    this.name = 'MapFileError';
  }
}

/** Reads and validates the theme's map. Throws `MapFileError` or `MapError` with a readable message. */
export function loadThemeMap(theme: MapTheme, dirs: readonly string[] = MAP_DIRS): MapModel {
  const file = theme.assets.map;
  const dir = dirs.find((d) => existsSync(`${d}${file}`));
  if (dir === undefined) throw new MapFileError(file, dirs);
  const raw = JSON.parse(readFileSync(`${dir}${file}`, 'utf8')) as unknown;
  return loadMap(raw, file);
}
