// NPC catalogue (§8): schema, validation, lookups and the count scaling rules. Every NPC number lives
// in data/npcs.json (§15.4, §21); the respawn time is `npcRespawnSeconds` in config.json because §6
// lists it there. Adding an NPC of an existing behaviour needs no code; a new behaviour type needs a
// schema branch here and its server system.
import { z } from 'zod';
import { ConfigError, formatIssues } from '../config';
import npcsJson from '../data/npcs.json';
import { meleeStatsSchema } from '../weapons/catalogue';

/** Behaviour types from §8. Each one is a server system (M5-3 to M5-6). */
export const NPC_BEHAVIOURS = ['stocker', 'security', 'forklift', 'butcher'] as const;
export type NpcBehaviour = (typeof NPC_BEHAVIOURS)[number];

const idPattern = /^[a-z][a-z0-9_]*$/;
const nonNegative = z.number().nonnegative();
const positive = z.number().positive();
const fraction = z.number().min(0).max(1);
const count = z.number().int().nonnegative();

/** A random duration picked between min and max (inclusive), e.g. how long a wanderer pauses at a waypoint. */
const rangeSchema = z
  .object({ min: nonNegative, max: nonNegative })
  .strict()
  .refine((r) => r.min <= r.max, { message: 'min must not be greater than max' });

/**
 * How many of this NPC a round has for `players` players (§8 "Count (default)"):
 * max(min, base + add × floor(players / per.players)), then capped at `max` when set.
 */
const countSchema = z
  .object({
    base: count,
    per: z.object({ players: z.number().int().positive(), add: count }).strict().optional(),
    min: count,
    max: count.optional(),
  })
  .strict()
  .refine((c) => c.max === undefined || c.max >= c.min, { message: 'max must not be less than min' });

/** A melee attack an NPC makes: the same stats as a weapon swing (weapons.json) plus its own cooldown. */
const npcAttackSchema = z.object({ cooldownSeconds: positive, melee: meleeStatsSchema }).strict();

const base = {
  id: z.string().regex(idPattern, 'must be snake_case (a-z, 0-9, _), starting with a letter'),
  /** English display name (NPC names are game text, not store brands). */
  name: z.string().trim().min(1),
  /** Atlas key (§11.1, one atlas per NPC sheet). Defaults to the id. */
  sprite: z.string().regex(idPattern, 'must be a snake_case atlas key').optional(),
  /** Starting HP; null = invulnerable (forklift). */
  hp: z.number().int().positive().nullable(),
  /** Side of the square hitbox in pixels, centred on the position (like `playerHitboxSize`). */
  hitboxPx: positive,
  /** Normal walking speed. */
  speedPxPerSecond: positive,
  count: countSchema,
  /**
   * Per-map count overrides (Phase 2 decision 7), keyed by theme id, e.g. `{ "prisma": {...} }`. A map
   * without an entry uses `count`. Which types a map has at all comes from its `npc_spawns`.
   */
  mapCounts: z.record(z.string().regex(idPattern), countSchema).optional(),
};

export const npcSchema = z.discriminatedUnion('behaviour', [
  z
    .object({
      ...base,
      behaviour: z.literal('stocker'),
      /** Walks between random `npc_waypoints`, pausing at each to restock. */
      wander: z.object({ pauseSeconds: rangeSchema }).strict(),
      /** If hit, fights the attacker for `seconds`, then goes back to work (§8). */
      retaliation: z
        .object({
          seconds: positive,
          speedPxPerSecond: positive,
          cooldownSeconds: positive,
          melee: meleeStatsSchema,
        })
        .strict(),
      /** "Occasionally blocks aisles with a stock cart": chance at each waypoint stop, how long it stays, its length. */
      stockCart: z
        .object({ chancePerStop: fraction, seconds: positive, lengthTiles: z.number().int().positive() })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      behaviour: z.literal('security'),
      /** Guards without a post walk between `npc_waypoints`; a guard on a post stands there. */
      patrol: z.object({ pauseSeconds: rangeSchema }).strict(),
      /** Chasing a Wanted player: speed, how far it notices them, how long it searches after losing sight. */
      chase: z
        .object({ speedPxPerSecond: positive, sightRangeTiles: positive, loseSightSeconds: nonNegative })
        .strict(),
      attack: npcAttackSchema,
    })
    .strict(),
  z
    .object({
      ...base,
      behaviour: z.literal('forklift'),
      /** Pause at each route corner (§8 "brief stop at route corners"). */
      cornerStopSeconds: nonNegative,
      /** Driving into someone (§8): damage, knockdown (stun), push, and whether it drops their item. */
      contact: z
        .object({
          damage: nonNegative,
          knockdownSeconds: nonNegative,
          knockbackPx: nonNegative,
          dropsCarried: z.boolean(),
          /** The same player cannot be hit again by this forklift for this long. */
          hitCooldownSeconds: nonNegative,
        })
        .strict(),
      /** Beep and warning light (§8): beep period while driving, and the light's radius for the client. */
      warning: z.object({ beepIntervalSeconds: positive, lightRadiusPx: positive }).strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      behaviour: z.literal('butcher'),
      /** Zone id where anyone gets attacked (§8 `behind_counter`). */
      guardZone: z.string().regex(idPattern),
      /** Zone id the butcher never leaves (§8 "stays in the meat & fish counter area"). */
      homeZone: z.string().regex(idPattern),
      attack: npcAttackSchema,
    })
    .strict(),
]);

export const npcCatalogueSchema = z
  .object({ npcs: z.array(npcSchema).min(1) })
  .strict()
  .superRefine((data, ctx) => {
    const seen = new Set<string>();
    data.npcs.forEach((n, index) => {
      if (seen.has(n.id)) {
        ctx.addIssue({ code: 'custom', path: ['npcs', index, 'id'], message: `duplicate NPC id "${n.id}"` });
      }
      seen.add(n.id);
      if (n.hp === null && n.behaviour !== 'forklift') {
        ctx.addIssue({
          code: 'custom',
          path: ['npcs', index, 'hp'],
          message: 'only forklifts may be invulnerable (hp null)',
        });
      }
    });
  });

type RawNpc = z.infer<typeof npcSchema>;
/** An NPC definition, discriminated on `behaviour`. `sprite` is always filled in. Frozen at load. */
export type NpcDef = Readonly<RawNpc> & { readonly sprite: string };
/** The NPC definition for one behaviour type, e.g. `NpcOf<'security'>`. */
export type NpcOf<B extends NpcBehaviour> = Extract<NpcDef, { behaviour: B }>;
export type NpcCount = z.infer<typeof countSchema>;
export type NpcAttack = z.infer<typeof npcAttackSchema>;
export type NpcRange = z.infer<typeof rangeSchema>;

export interface NpcCatalogue {
  /** Every NPC type, in file order. */
  readonly npcs: readonly NpcDef[];
  get(id: string): NpcDef | undefined;
  /** Throws for an unknown id. */
  require(id: string): NpcDef;
  /** NPC types with one behaviour, in file order. */
  ofBehaviour<B extends NpcBehaviour>(behaviour: B): readonly NpcOf<B>[];
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Validates raw NPC data and returns a frozen catalogue. Throws `ConfigError` on bad data (§15.4). */
export function loadNpcCatalogue(raw: unknown, source = 'npcs.json'): NpcCatalogue {
  const result = npcCatalogueSchema.safeParse(raw);
  if (!result.success) throw new ConfigError(source, formatIssues(result.error));
  const npcs = deepFreeze(
    result.data.npcs.map((n) => ({ ...n, sprite: n.sprite ?? n.id })),
  ) as readonly NpcDef[];
  return buildCatalogue(npcs, source);
}

function buildCatalogue(npcs: readonly NpcDef[], source: string): NpcCatalogue {
  const byId = new Map(npcs.map((n) => [n.id, n]));
  return Object.freeze({
    npcs,
    get: (id: string) => byId.get(id),
    require: (id: string) => {
      const n = byId.get(id);
      if (!n) throw new RangeError(`Unknown NPC id "${id}" in ${source}`);
      return n;
    },
    ofBehaviour: <B extends NpcBehaviour>(behaviour: B) =>
      npcs.filter((n): n is NpcOf<B> => n.behaviour === behaviour),
  });
}

/**
 * The catalogue as one map sees it: each type's `count` replaced by its `mapCounts[mapId]` override
 * when it has one. Everything else is shared. The server builds one per loaded map (P1-1).
 */
export function npcCatalogueForMap(catalogue: NpcCatalogue, mapId: string): NpcCatalogue {
  if (!catalogue.npcs.some((n) => n.mapCounts?.[mapId] !== undefined)) return catalogue;
  const npcs = catalogue.npcs.map((n) => {
    const override = n.mapCounts?.[mapId];
    return override === undefined ? n : deepFreeze({ ...n, count: override });
  }) as readonly NpcDef[];
  return buildCatalogue(Object.freeze(npcs), `npcs.json (map ${mapId})`);
}

let cached: NpcCatalogue | undefined;

/** The validated, bundled NPC catalogue (data/npcs.json). */
export function getNpcCatalogue(): NpcCatalogue {
  cached ??= loadNpcCatalogue(npcsJson, 'npcs.json');
  return cached;
}

/**
 * How many of an NPC type a round has with `players` players in it (spectators do not count):
 * max(min, base + add × floor(players / per.players)), capped at `max` when set. §8 defaults:
 * stocker max(3, players / 2), security 2 + 1 per 6 players, forklift 2, butcher 1.
 */
export function npcCount(count: NpcCount, players: number): number {
  const n = Math.max(0, Math.floor(players));
  const scaled = count.base + (count.per ? count.per.add * Math.floor(n / count.per.players) : 0);
  const atLeast = Math.max(count.min, scaled);
  return count.max === undefined ? atLeast : Math.min(count.max, atLeast);
}
