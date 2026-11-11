// Loads the theme's Tiled map for the server's collision, spawns and zones (§15.1, §15.4).
// The server reads `maps/<theme.assets.map>` from disk at startup. The build copies maps/*.tmj into
// dist/maps, so a built server finds them next to its bundle; from source they come from the repo's maps/.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  checkItemMap,
  checkNpcMap,
  defaultThemeId,
  getItemCatalogue,
  getNpcCatalogue,
  getTheme,
  loadMap,
  npcCatalogueForMap,
  npcRoster,
  themes,
  type ItemCatalogue,
  type MapModel,
  type MapTheme,
  type NpcCatalogue,
  type ThemeId,
} from '@keke/shared';

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

/** One map the server can run rounds on: its theme, the loaded map and the catalogues it uses. */
export interface MapEntry {
  readonly id: ThemeId;
  readonly theme: MapTheme;
  readonly map: MapModel;
  /** The theme's item catalogue. */
  readonly items: ItemCatalogue;
  /** The NPC catalogue with this map's count overrides (`npcCatalogueForMap`). */
  readonly npcs: NpcCatalogue;
  /** NPC types this map spawns (`npcRoster`); other types are absent from it. */
  readonly npcRoster: readonly string[];
}

/** Thrown when a map cannot host the NPC types it spawns (`checkNpcMap`). */
export class MapNpcError extends Error {
  constructor(id: string, problems: readonly string[]) {
    super(`The ${id} map cannot host its store workers:\n${problems.join('\n')}`);
    this.name = 'MapNpcError';
  }
}

/** Thrown when a map has no item spawns for a zone its item catalogue names (`checkItemMap`). */
export class MapItemError extends Error {
  constructor(id: string, problems: readonly string[]) {
    super(`The ${id} map cannot host its item catalogue:\n${problems.join('\n')}`);
    this.name = 'MapItemError';
  }
}

/**
 * Checks a loaded map against its NPC and item catalogues and bundles it with them. Throws `MapNpcError`
 * or `MapItemError`.
 * `items` defaults to the theme's bundled catalogue; tests pass their own for fixture themes.
 */
export function createMapEntry(
  theme: MapTheme,
  map: MapModel,
  {
    items = getItemCatalogue(theme.id),
    npcs = getNpcCatalogue(),
  }: { items?: ItemCatalogue; npcs?: NpcCatalogue } = {},
): MapEntry {
  const forMap = npcCatalogueForMap(npcs, theme.id);
  const problems = checkNpcMap(forMap, map);
  if (problems.length > 0) throw new MapNpcError(theme.id, problems);
  const itemProblems = checkItemMap(items, map);
  if (itemProblems.length > 0) throw new MapItemError(theme.id, itemProblems);
  return Object.freeze({
    id: theme.id,
    theme,
    map,
    items,
    npcs: forMap,
    npcRoster: Object.freeze(npcRoster(forMap, map)),
  });
}

/** The maps this server runs, by theme id (Phase 2, P1-1). Rooms pick the round's map from it. */
export class MapRegistry {
  private readonly byId: ReadonlyMap<ThemeId, MapEntry>;

  constructor(entries: readonly MapEntry[]) {
    if (entries.length === 0) throw new Error('MapRegistry: no maps');
    const byId = new Map<ThemeId, MapEntry>();
    for (const entry of entries) {
      if (byId.has(entry.id)) throw new Error(`MapRegistry: map "${entry.id}" twice`);
      byId.set(entry.id, entry);
    }
    this.byId = byId;
  }

  /** Theme ids of the loaded maps, in registration order. */
  get ids(): ThemeId[] {
    return [...this.byId.keys()];
  }

  has(id: string): id is ThemeId {
    return this.byId.has(id as ThemeId);
  }

  /** The entry for a loaded map. Throws for a map this server did not load. */
  get(id: ThemeId): MapEntry {
    const entry = this.byId.get(id);
    if (!entry) throw new RangeError(`Map "${id}" is not loaded on this server`);
    return entry;
  }
}

const registryCache = new Map<ThemeId, MapEntry>();

/**
 * Loads and checks the map of every `available` theme (or the given ones). Throws `MapFileError`,
 * `MapError`, `MapNpcError` or `MapItemError` with a readable message, so the server refuses to start on a bad map.
 * Maps from the default folders are cached per theme: every server in a process (tests) shares them.
 */
export function loadMapRegistry(
  list: readonly MapTheme[] = Object.values(themes).filter((t) => t.available),
  dirs: readonly string[] = MAP_DIRS,
): MapRegistry {
  const cache = dirs === MAP_DIRS;
  return new MapRegistry(
    list.map((theme) => {
      const cached = cache ? registryCache.get(theme.id) : undefined;
      if (cached) return cached;
      const entry = createMapEntry(theme, loadThemeMap(theme, dirs));
      if (cache) registryCache.set(theme.id, entry);
      return entry;
    }),
  );
}

/** A registry with one already-loaded map under the default theme: tests and tools that build their own map. */
export function singleMapRegistry(map: MapModel, theme: MapTheme = getTheme(defaultThemeId)): MapRegistry {
  return new MapRegistry([createMapEntry(theme, map)]);
}
