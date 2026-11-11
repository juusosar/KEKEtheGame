// Game config (§6): schema, validation and the default values from data/config.json.
import { z } from 'zod';
import defaultConfigJson from './data/config.json';
import { themes } from './theme';

const positiveInt = z.number().int().positive();
const nonNegative = z.number().nonnegative();
const positive = z.number().positive();
const fraction = z.number().min(0).max(1);

const configShape = {
  tileSize: positiveInt,
  maxPlayersPerRoom: positiveInt,
  serverTickHz: positiveInt,
  inputHz: positiveInt,
  maxInputsPerTick: positiveInt,
  maxQueuedInputs: positiveInt,
  maxInputCreditSeconds: nonNegative,
  inputQueueTargetDepth: positiveInt,
  inputQueueTrimSeconds: positive,
  playerSpeed: positive,
  playerHitboxSize: positive,
  carrySpeedMultiplier: positive,
  gateStopSeconds: nonNegative,
  gateCarryStopSeconds: nonNegative,
  gateCooldownSeconds: nonNegative,
  maxHp: positiveInt,
  respawnSeconds: nonNegative,
  spawnProtectionSeconds: nonNegative,
  looseItemDespawnSeconds: positive,
  pickupRangeTiles: positive,
  depositRangeTiles: positive,
  targetMinDistanceFromVanTiles: nonNegative,
  timedRoundSeconds: positive,
  raceRoundSeconds: positive,
  raceQuota: positiveInt,
  raceTeamQuotaPerMember: z.number().int().nonnegative(),
  placementPoints: z.array(z.number().int().nonnegative()).min(1),
  placementPointsOther: z.number().int().nonnegative(),
  wantedSeconds: positive,
  wantedGuardRangeTiles: positive,
  npcRespawnSeconds: nonNegative,
  reconnectWindowSeconds: nonNegative,
  coldRoomFriction: fraction,
  coldRoomSpeedMultiplier: positive,
  cartSizePx: positive,
  cartPushSpeedMultiplier: positive,
  cartFriction: fraction,
  cartPushGraceSeconds: nonNegative,
  cartShoveTiles: nonNegative,
  jokeItemChance: fraction,
  jokeItemValue: positiveInt,
  hpRegenPerSec: nonNegative,
  hazardTickSeconds: positive,
  knockbackSeconds: nonNegative,
  weaponRarityWeights: z.object({ common: nonNegative, uncommon: nonNegative, rare: nonNegative }).strict(),
  nicknameMaxLength: positiveInt,
  maxRoundsPerMap: positiveInt,
  countdownSeconds: nonNegative,
  roundResultsSeconds: nonNegative,
  podiumSeconds: nonNegative,
};

/**
 * Keys a map cannot override (P4-1): the network and input pipeline, room and profile limits, the
 * session scoring and the player's body, which must stay the same for every round of a session.
 * Every other key, including keys added later, can be overridden per map under `maps.<themeId>`.
 */
const GLOBAL_KEY_MASK = {
  tileSize: true,
  maxPlayersPerRoom: true,
  serverTickHz: true,
  inputHz: true,
  maxInputsPerTick: true,
  maxQueuedInputs: true,
  maxInputCreditSeconds: true,
  inputQueueTargetDepth: true,
  inputQueueTrimSeconds: true,
  playerHitboxSize: true,
  maxHp: true,
  placementPoints: true,
  placementPointsOther: true,
  reconnectWindowSeconds: true,
  nicknameMaxLength: true,
  maxRoundsPerMap: true,
  podiumSeconds: true,
} as const satisfies Partial<Record<keyof typeof configShape, true>>;

/** Config keys that stay the same on every map (see `GLOBAL_KEY_MASK`). */
export const GLOBAL_CONFIG_KEYS: readonly string[] = Object.freeze(Object.keys(GLOBAL_KEY_MASK));

/** Config keys a map may override. */
export type MapConfigKey = Exclude<keyof typeof configShape, keyof typeof GLOBAL_KEY_MASK>;

const baseSchema = z.object(configShape).strict();

/** One map's overrides: any subset of the overridable keys, each validated like the top-level key. */
export const mapConfigOverrideSchema = baseSchema.omit(GLOBAL_KEY_MASK).partial().strict();

export const configSchema = baseSchema
  .extend({
    /**
     * Per-map overrides (P4-1), keyed by theme id: `"maps": { "prisma": { "raceQuota": 8 } }`. A map
     * without an entry plays the top-level values. Optional; absent means `{}`.
     */
    maps: z
      .record(z.string(), mapConfigOverrideSchema)
      .superRefine((maps, ctx) => {
        for (const id of Object.keys(maps)) {
          if (!(id in themes)) {
            ctx.addIssue({
              code: 'custom',
              path: [id],
              message: `unknown map "${id}" (known: ${Object.keys(themes).join(', ')})`,
            });
          }
        }
      })
      .optional(),
  })
  .strict();

type RawConfig = z.infer<typeof baseSchema>;

/** One map's validated overrides. */
export type MapConfigOverride = Readonly<z.infer<typeof mapConfigOverrideSchema>>;

/** Validated, read-only game config. */
export type GameConfig = Readonly<Omit<RawConfig, 'placementPoints' | 'weaponRarityWeights'>> & {
  readonly placementPoints: readonly number[];
  readonly weaponRarityWeights: Readonly<RawConfig['weaponRarityWeights']>;
  /** Per-map overrides (P4-1); resolve a map's config with `configForMap`. */
  readonly maps: Readonly<Record<string, MapConfigOverride>>;
};

/** Thrown by `loadConfig` when the data is invalid. The message lists every problem, one per line. */
export class ConfigError extends Error {
  readonly issues: readonly string[];

  constructor(source: string, issues: readonly string[]) {
    super(`Invalid ${source}:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

/** Formats zod issues as `path: message` lines, e.g. `playerSpeed: expected number, received string`. */
export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `${path}: ${issue.message}`;
  });
}

/**
 * Validates raw config data and returns a typed, frozen config.
 * Throws `ConfigError` with a readable message if anything is missing, mistyped or unknown.
 * Called with no argument it validates the bundled data/config.json.
 */
export function loadConfig(raw: unknown = defaultConfigJson, source = 'config.json'): GameConfig {
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(source, formatIssues(result.error));
  }
  return freezeConfig(result.data);
}

function freezeConfig(data: z.infer<typeof configSchema>): GameConfig {
  const maps: Record<string, MapConfigOverride> = {};
  for (const [id, override] of Object.entries(data.maps ?? {})) {
    maps[id] = Object.freeze({
      ...override,
      ...(override.weaponRarityWeights
        ? { weaponRarityWeights: Object.freeze({ ...override.weaponRarityWeights }) }
        : {}),
    });
  }
  return Object.freeze({
    ...data,
    placementPoints: Object.freeze([...data.placementPoints]),
    weaponRarityWeights: Object.freeze({ ...data.weaponRarityWeights }),
    maps: Object.freeze(maps),
  });
}

const resolvedByConfig = new WeakMap<GameConfig, Map<string, GameConfig>>();

/**
 * The config one map plays with (P4-1): the top-level values with `maps[mapId]` on top. A map without
 * overrides gets `config` itself back, so the first map's behaviour is unchanged. Results are cached per
 * config, so callers can resolve freely. The result keeps `maps`, so resolving it again is harmless.
 */
export function configForMap(config: GameConfig, mapId: string): GameConfig {
  const override = config.maps[mapId];
  if (!override || Object.keys(override).length === 0) return config;
  let cache = resolvedByConfig.get(config);
  if (!cache) {
    cache = new Map();
    resolvedByConfig.set(config, cache);
  }
  let resolved = cache.get(mapId);
  if (!resolved) {
    // Overrides are validated value by value at load; one more pass keeps the merged object honest.
    resolved = loadConfig({ ...config, ...override, maps: {} }, `config.json maps.${mapId}`);
    resolved = Object.freeze({ ...resolved, maps: config.maps });
    cache.set(mapId, resolved);
  }
  return resolved;
}

/**
 * Merges a test or tooling override (KEKE_CONFIG, soak timers, room tests) over a config (P4-1). A key the
 * override sets also leaves every map's overrides, so a short e2e countdown or soak round timer applies on
 * every map. An override that sets `maps` itself replaces them. Returns raw data for `loadConfig`.
 */
export function mergeConfigOverride(
  config: GameConfig,
  override: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const keys = new Set(Object.keys(override));
  const maps: Record<string, Record<string, unknown>> = {};
  for (const [id, mapOverride] of Object.entries(config.maps)) {
    maps[id] = Object.fromEntries(Object.entries(mapOverride).filter(([key]) => !keys.has(key)));
  }
  return { ...config, maps, ...override };
}
