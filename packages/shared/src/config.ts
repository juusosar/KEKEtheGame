// Game config (§6): schema, validation and the default values from data/config.json.
import { z } from 'zod';
import defaultConfigJson from './data/config.json';

const positiveInt = z.number().int().positive();
const nonNegative = z.number().nonnegative();
const positive = z.number().positive();
const fraction = z.number().min(0).max(1);

export const configSchema = z
  .object({
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
    placementPoints: z.array(z.number().int().nonnegative()).min(1),
    placementPointsOther: z.number().int().nonnegative(),
    wantedSeconds: positive,
    npcRespawnSeconds: nonNegative,
    reconnectWindowSeconds: nonNegative,
    coldRoomFriction: fraction,
    coldRoomSpeedMultiplier: positive,
    jokeItemChance: fraction,
    jokeItemValue: positiveInt,
    hpRegenPerSec: nonNegative,
    nicknameMaxLength: positiveInt,
    maxRoundsPerMap: positiveInt,
    countdownSeconds: nonNegative,
    roundResultsSeconds: nonNegative,
    podiumSeconds: nonNegative,
  })
  .strict();

type RawConfig = z.infer<typeof configSchema>;

/** Validated, read-only game config. */
export type GameConfig = Readonly<Omit<RawConfig, 'placementPoints'>> & {
  readonly placementPoints: readonly number[];
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
  return Object.freeze({
    ...result.data,
    placementPoints: Object.freeze([...result.data.placementPoints]),
  });
}
