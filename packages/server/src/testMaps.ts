// A small second map for multi-map tests (P1-1), so they do not wait for the real second store map (P1-4).
// It is the default map with fewer, different van slots and stockers as its only store workers, under
// the 'prisma' theme id (switched on here only). Items use the default catalogue, whose zones it has.
import {
  defaultThemeId,
  getItemCatalogue,
  getTheme,
  prismaTheme,
  type MapModel,
  type MapTheme,
} from '@keke/shared';
import { MapRegistry, createMapEntry, loadMapRegistry, type MapEntry } from './maps';

/** Van slots the fixture keeps: the default map's last ones, in reverse, renumbered from 1. */
export const FIXTURE_VAN_SLOTS = 4;

/** The fixture map, built from the default theme's map. */
export function fixtureMap(
  base: MapModel = loadMapRegistry([getTheme(defaultThemeId)]).get(defaultThemeId).map,
): MapModel {
  const vanSlots = base.vanSlots
    .slice(-FIXTURE_VAN_SLOTS)
    .reverse()
    .map((slot, i) => ({ ...slot, index: i + 1 }));
  return {
    ...base,
    vanSlots,
    npcSpawns: base.npcSpawns.filter((s) => s.type === 'stocker'),
    forkliftRoutes: [],
  };
}

/** The fixture theme: the 'prisma' theme switched on. */
export const fixtureTheme: MapTheme = { ...prismaTheme, available: true };

/** The fixture map's registry entry (id 'prisma'). */
export function fixtureEntry(): MapEntry {
  return createMapEntry(fixtureTheme, fixtureMap(), { items: getItemCatalogue(defaultThemeId) });
}

/** The real default map plus the fixture map: a server where `prisma` and `both` can be picked. */
export function twoMapRegistry(): MapRegistry {
  return new MapRegistry([loadMapRegistry([getTheme(defaultThemeId)]).get(defaultThemeId), fixtureEntry()]);
}

/**
 * `registry` plus the fixture map when it has no 'prisma' map yet (P1-5): the e2e server
 * (`KEKE_TEST_MAPS=1`, debug only) uses it so browser specs can pick a second map before the real one
 * is switched on. Once the real map loads, this returns the registry unchanged.
 */
export function withFixtureMap(registry: MapRegistry): MapRegistry {
  if (registry.has(fixtureTheme.id)) return registry;
  return new MapRegistry([...registry.ids.map((id) => registry.get(id)), fixtureEntry()]);
}
