import { defaultThemeId, getItemCatalogue, getTheme, themes } from '@keke/shared';
import { describe, expect, it } from 'vitest';
import {
  MapFileError,
  MapItemError,
  MapNpcError,
  MapRegistry,
  createMapEntry,
  loadMapRegistry,
  loadThemeMap,
  singleMapRegistry,
} from './maps';
import { FIXTURE_VAN_SLOTS, fixtureEntry, fixtureMap, twoMapRegistry } from './testMaps';

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

describe('map registry (P1-1)', () => {
  it('loads every available theme, checked against the NPC types it spawns', () => {
    const registry = loadMapRegistry();
    const available = Object.values(themes)
      .filter((t) => t.available)
      .map((t) => t.id);
    expect(registry.ids).toEqual(available);
    const kespro = registry.get(defaultThemeId);
    expect(kespro.npcRoster).toEqual(['stocker', 'security', 'forklift', 'butcher']);
    expect(kespro.items.items.length).toBeGreaterThan(0);
    // Cached per theme: a second server in the same process reuses the loaded map.
    expect(loadMapRegistry().get(defaultThemeId)).toBe(kespro);
  });

  it('refuses a map that cannot host the NPCs it spawns', () => {
    const map = loadThemeMap(getTheme(defaultThemeId));
    const broken = { ...map, npcWaypoints: [] };
    expect(() => createMapEntry(getTheme(defaultThemeId), broken)).toThrow(MapNpcError);
    expect(() => createMapEntry(getTheme(defaultThemeId), broken)).toThrow(/walks between npc_waypoints/);
  });

  it('refuses a map without item spawns for a zone its catalogue names', () => {
    const map = loadThemeMap(getTheme(defaultThemeId));
    const other = getItemCatalogue('prisma');
    expect(() => createMapEntry(getTheme(defaultThemeId), map, { items: other })).toThrow(MapItemError);
  });

  it('gives a map only the NPC types it has spawns for', () => {
    const entry = fixtureEntry();
    expect(entry.id).toBe('prisma');
    expect(entry.npcRoster).toEqual(['stocker']);
    expect(entry.map.vanSlots).toHaveLength(FIXTURE_VAN_SLOTS);
  });

  it('loads the real second store map by default (P1-6 switched its theme on)', () => {
    const registry = loadMapRegistry();
    expect(registry.ids).toEqual([defaultThemeId, 'prisma']);
    const entry = registry.get('prisma');
    expect(entry.npcRoster).toEqual(['stocker', 'security', 'forklift', 'butcher']);
    expect(entry.npcs.require('butcher')).toMatchObject({ homeZone: 'deli' });
    expect(entry.map.vanSlots).toHaveLength(16);
    expect(entry.items).toBe(getItemCatalogue('prisma'));
  });

  it('refuses unknown maps and duplicates', () => {
    const registry = twoMapRegistry();
    expect(registry.ids).toEqual(['kespro', 'prisma']);
    expect(registry.has('prisma')).toBe(true);
    expect(registry.has('mall')).toBe(false);
    expect(() => singleMapRegistry(fixtureMap()).get('prisma')).toThrow(/not loaded/);
    const entry = fixtureEntry();
    expect(() => new MapRegistry([entry, entry])).toThrow(/twice/);
    expect(() => new MapRegistry([])).toThrow(/no maps/);
  });
});
