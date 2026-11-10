// Item catalogue (§10, §10.1): schema, validation and lookups. The data lives in
// data/items.<theme>.json, generated from the design doc's tables by tools/items-table-to-json.ts.
import { z } from 'zod';
import { ConfigError, formatIssues } from '../config';
import kesproItemsJson from '../data/items.kespro.json';
import type { ThemeId } from '../theme/types';

/** Map zones that normal items spawn in (§9.1). Ids match the Tiled `zones` and `item_spawns` layers. */
export const ITEM_ZONES = ['dry_goods', 'beverages', 'cold_room', 'frozen', 'meat_fish'] as const;
export type ItemZoneId = (typeof ITEM_ZONES)[number];

/** Joke items use this instead of a zone: they may spawn at any item spawn point (§10.1). */
export const ANY_ZONE = 'any';
export type ItemZone = ItemZoneId | typeof ANY_ZONE;

export const ITEM_RARITIES = ['normal', 'joke'] as const;
export type ItemRarity = (typeof ITEM_RARITIES)[number];

const idPattern = /^[a-z][a-z0-9_]*$/;
const text = z.string().trim().min(1);

export const itemSchema = z
  .object({
    /** Stable snake_case id, used on the wire and as the key in events. */
    id: z.string().regex(idPattern, 'must be snake_case (a-z, 0-9, _), starting with a letter'),
    /** Finnish product name, shown as is (product names are not translated, §14). */
    name: text,
    /** English one-liner for the target card. */
    desc: text,
    zone: z.enum([...ITEM_ZONES, ANY_ZONE]),
    /** Frame name in the `items` atlas (§11.1). */
    sprite: z.string().regex(idPattern, 'must be a snake_case frame name'),
    rarity: z.enum(ITEM_RARITIES),
  })
  .strict();

export const itemCatalogueSchema = z
  .object({ items: z.array(itemSchema).min(1) })
  .strict()
  .superRefine((data, ctx) => {
    const seen = new Set<string>();
    data.items.forEach((item, index) => {
      if (seen.has(item.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', index, 'id'],
          message: `duplicate item id "${item.id}"`,
        });
      }
      seen.add(item.id);
      if (item.rarity === 'joke' && item.zone !== ANY_ZONE) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', index, 'zone'],
          message: `joke item "${item.id}" must use zone "${ANY_ZONE}"`,
        });
      }
      if (item.rarity === 'normal' && item.zone === ANY_ZONE) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', index, 'zone'],
          message: `normal item "${item.id}" needs a real zone, not "${ANY_ZONE}"`,
        });
      }
    });
    if (!data.items.some((item) => item.rarity === 'normal')) {
      ctx.addIssue({ code: 'custom', path: ['items'], message: 'needs at least one normal item' });
    }
  });

export interface ItemDef {
  readonly id: string;
  readonly name: string;
  readonly desc: string;
  readonly zone: ItemZone;
  readonly sprite: string;
  readonly rarity: ItemRarity;
}

/** A validated, read-only item catalogue with lookups. */
export interface ItemCatalogue {
  /** Every item, in file order. */
  readonly items: readonly ItemDef[];
  /** Normal items (rarity `normal`), in file order. */
  readonly normal: readonly ItemDef[];
  /** Joke items (rarity `joke`), in file order. */
  readonly joke: readonly ItemDef[];
  /** Zones that have at least one normal item, in `ITEM_ZONES` order. */
  readonly zones: readonly ItemZoneId[];
  /** The item with this id, or undefined. */
  get(id: string): ItemDef | undefined;
  /** The item with this id; throws if the id is unknown. */
  require(id: string): ItemDef;
  /** Normal items of one zone, in file order (empty for a zone without items). */
  inZone(zone: ItemZoneId): readonly ItemDef[];
}

/**
 * Validates raw catalogue data and returns a frozen catalogue.
 * Throws `ConfigError` listing every problem, so the server refuses to start on bad data (§15.4).
 */
export function loadItemCatalogue(raw: unknown, source = 'item catalogue'): ItemCatalogue {
  const result = itemCatalogueSchema.safeParse(raw);
  if (!result.success) throw new ConfigError(source, formatIssues(result.error));

  const items: readonly ItemDef[] = Object.freeze(
    result.data.items.map((item) => Object.freeze({ ...item })),
  );
  const byId = new Map(items.map((item) => [item.id, item]));
  const normal = Object.freeze(items.filter((item) => item.rarity === 'normal'));
  const joke = Object.freeze(items.filter((item) => item.rarity === 'joke'));
  const byZone = new Map<ItemZoneId, readonly ItemDef[]>(
    ITEM_ZONES.map((zone) => [zone, Object.freeze(normal.filter((item) => item.zone === zone))]),
  );
  const zones = Object.freeze(ITEM_ZONES.filter((zone) => (byZone.get(zone)?.length ?? 0) > 0));

  return Object.freeze({
    items,
    normal,
    joke,
    zones,
    get: (id: string) => byId.get(id),
    require: (id: string) => {
      const item = byId.get(id);
      if (!item) throw new RangeError(`Unknown item id "${id}" in ${source}`);
      return item;
    },
    inZone: (zone: ItemZoneId) => byZone.get(zone) ?? [],
  });
}

/** Bundled catalogue data per theme. A theme without one (the phase 2 map until it is built) is missing here. */
const BUNDLED: Partial<Record<ThemeId, { raw: unknown; source: string }>> = {
  kespro: { raw: kesproItemsJson, source: 'items.kespro.json' },
};

const cache = new Map<ThemeId, ItemCatalogue>();

/** The validated, bundled item catalogue of a theme. Throws if the theme has none yet. */
export function getItemCatalogue(themeId: ThemeId): ItemCatalogue {
  const cached = cache.get(themeId);
  if (cached) return cached;
  const bundled = BUNDLED[themeId];
  if (!bundled) throw new RangeError(`No item catalogue for theme "${themeId}" yet`);
  const catalogue = loadItemCatalogue(bundled.raw, bundled.source);
  cache.set(themeId, catalogue);
  return catalogue;
}

/** True if the item counts as a joke item (§10.1). */
export function isJokeItem(item: Pick<ItemDef, 'rarity'>): boolean {
  return item.rarity === 'joke';
}
