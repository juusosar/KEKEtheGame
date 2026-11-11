// Host rules: game config values the host sets for one room when creating it or in its lobby.
// Each rule is a config key (§6) with a range and a step. A rule the host leaves unset plays the
// server's value, including that map's `maps.<id>` override (P4-1); a rule the host sets wins on every map.
import { z } from 'zod';
import { loadConfig, mergeConfigOverride, type GameConfig } from '../config';

/** What a rule's number means, for labels and formatting. */
export type RuleUnit = 'seconds' | 'count' | 'percent' | 'multiplier' | 'hp' | 'speed' | 'hpPerSecond';

/** The editor's sections. */
export const RULE_GROUPS = ['round', 'race', 'players', 'combat', 'store'] as const;
export type RuleGroup = (typeof RULE_GROUPS)[number];

export interface RuleSpec {
  readonly key: RuleKey;
  readonly group: RuleGroup;
  readonly min: number;
  readonly max: number;
  /** Allowed values are `min + k * step`. */
  readonly step: number;
  readonly unit: RuleUnit;
}

/** Config keys a host can set. Keep in sync with `RULES` (the test checks both ways). */
export const RULE_KEYS = [
  'timedRoundSeconds',
  'raceRoundSeconds',
  'countdownSeconds',
  'roundResultsSeconds',
  'podiumSeconds',
  'raceQuota',
  'raceTeamQuotaPerMember',
  'maxHp',
  'hpRegenPerSec',
  'playerSpeed',
  'carrySpeedMultiplier',
  'respawnSeconds',
  'spawnProtectionSeconds',
  'roundStartProtectionSeconds',
  'wantedSeconds',
  'npcRespawnSeconds',
  'looseItemDespawnSeconds',
  'jokeItemChance',
] as const satisfies readonly (keyof GameConfig)[];
export type RuleKey = (typeof RULE_KEYS)[number];

/** The host's rules: only the keys they set. */
export type HostRules = { [K in RuleKey]?: number | undefined };

/** Every rule in editor order. Ranges keep a round playable; every shipped default sits on a step. */
export const RULES: readonly RuleSpec[] = Object.freeze([
  // Round flow
  { key: 'timedRoundSeconds', group: 'round', min: 30, max: 900, step: 15, unit: 'seconds' },
  { key: 'raceRoundSeconds', group: 'round', min: 30, max: 900, step: 15, unit: 'seconds' },
  { key: 'countdownSeconds', group: 'round', min: 0, max: 15, step: 1, unit: 'seconds' },
  { key: 'roundResultsSeconds', group: 'round', min: 3, max: 60, step: 1, unit: 'seconds' },
  { key: 'podiumSeconds', group: 'round', min: 5, max: 60, step: 1, unit: 'seconds' },
  // Race: the order and the team order sizes
  { key: 'raceQuota', group: 'race', min: 1, max: 30, step: 1, unit: 'count' },
  { key: 'raceTeamQuotaPerMember', group: 'race', min: 0, max: 10, step: 1, unit: 'count' },
  // Players
  { key: 'maxHp', group: 'players', min: 25, max: 500, step: 25, unit: 'hp' },
  { key: 'hpRegenPerSec', group: 'players', min: 0, max: 20, step: 0.5, unit: 'hpPerSecond' },
  { key: 'playerSpeed', group: 'players', min: 80, max: 320, step: 10, unit: 'speed' },
  { key: 'carrySpeedMultiplier', group: 'players', min: 0.3, max: 1.5, step: 0.05, unit: 'multiplier' },
  // Knockouts and protection
  { key: 'respawnSeconds', group: 'combat', min: 0, max: 20, step: 0.5, unit: 'seconds' },
  { key: 'spawnProtectionSeconds', group: 'combat', min: 0, max: 10, step: 0.5, unit: 'seconds' },
  { key: 'roundStartProtectionSeconds', group: 'combat', min: 0, max: 15, step: 0.5, unit: 'seconds' },
  // The store: staff, loose items, joke items
  { key: 'wantedSeconds', group: 'store', min: 5, max: 120, step: 1, unit: 'seconds' },
  { key: 'npcRespawnSeconds', group: 'store', min: 5, max: 180, step: 5, unit: 'seconds' },
  { key: 'looseItemDespawnSeconds', group: 'store', min: 5, max: 120, step: 5, unit: 'seconds' },
  { key: 'jokeItemChance', group: 'store', min: 0, max: 0.5, step: 0.01, unit: 'percent' },
] satisfies RuleSpec[]);

const SPEC_BY_KEY: ReadonlyMap<string, RuleSpec> = new Map(RULES.map((spec) => [spec.key, spec]));

/** The spec of one rule, or undefined for a key that is not a rule. */
export function ruleSpec(key: string): RuleSpec | undefined {
  return SPEC_BY_KEY.get(key);
}

export function isRuleKey(key: string): key is RuleKey {
  return SPEC_BY_KEY.has(key);
}

/** Whether `value` sits on one of the rule's steps (float tolerant: 0.3 + 11 * 0.05 is 0.85). */
export function onStep(spec: RuleSpec, value: number): boolean {
  const k = (value - spec.min) / spec.step;
  return Math.abs(k - Math.round(k)) < 1e-6;
}

/** The closest allowed value: clamped into range and rounded to a step (UI inputs). */
export function snapRule(spec: RuleSpec, value: number): number {
  if (!Number.isFinite(value)) return spec.min;
  const clamped = Math.min(spec.max, Math.max(spec.min, value));
  const k = Math.round((clamped - spec.min) / spec.step);
  // Round away float noise: 0.3 + 11 * 0.05 = 0.8500000000000001.
  return Math.min(spec.max, Number((spec.min + k * spec.step).toFixed(6)));
}

const ruleValue = (spec: RuleSpec) =>
  z
    .number()
    .min(spec.min)
    .max(spec.max)
    .refine((v) => onStep(spec, v), { message: `must be ${spec.min} plus a multiple of ${spec.step}` });

/** Schema for a full set of host rules: any subset of the rule keys, each in range and on a step. */
export const hostRulesSchema = z
  .object(
    Object.fromEntries(RULES.map((spec) => [spec.key, ruleValue(spec)])) as unknown as Record<
      RuleKey,
      z.ZodType<number>
    >,
  )
  .partial()
  .strict();

/** Rules with float noise removed and keys in `RULES` order, so equal rules compare and cache equal. */
export function normalizeRules(rules: HostRules): HostRules {
  const out: HostRules = {};
  for (const spec of RULES) {
    const value = rules[spec.key];
    if (value !== undefined) out[spec.key] = snapRule(spec, value);
  }
  return out;
}

/** Drops rules equal to `config`'s value, so a host who changed nothing has no rules. */
export function changedRules(config: GameConfig, rules: HostRules): HostRules {
  const out: HostRules = {};
  for (const [key, value] of Object.entries(normalizeRules(rules)) as [RuleKey, number | undefined][]) {
    if (value !== undefined && Math.abs(config[key] - value) > 1e-9) out[key] = value;
  }
  return out;
}

const withRulesCache = new WeakMap<GameConfig, Map<string, GameConfig>>();

/**
 * The config a room plays with: `config` with the host's rules on top. A rule the host set also replaces
 * that key in every map's overrides (`mergeConfigOverride`), so `configForMap` on the result keeps the
 * host's value on every map. No rules gives `config` itself back. Cached per config and rule set.
 */
export function withHostRules(config: GameConfig, rules: HostRules): GameConfig {
  const normalized = normalizeRules(rules);
  if (Object.keys(normalized).length === 0) return config;
  const id = JSON.stringify(normalized);
  let cache = withRulesCache.get(config);
  if (!cache) {
    cache = new Map();
    withRulesCache.set(config, cache);
  }
  let resolved = cache.get(id);
  if (!resolved) {
    resolved = loadConfig(mergeConfigOverride(config, normalized), 'host rules');
    cache.set(id, resolved);
  }
  return resolved;
}

/** Host rules from untrusted data (synced state, storage): unknown keys and bad values are dropped. */
export function readRules(value: unknown): HostRules {
  const out: HostRules = {};
  if (typeof value !== 'object' || value === null) return out;
  const entries: [string, unknown][] = [];
  const forEach = (value as { forEach?: unknown }).forEach;
  if (typeof forEach === 'function' && !Array.isArray(value)) {
    (forEach as (cb: (v: unknown, k: string) => void) => void).call(value, (v, k) => entries.push([k, v]));
  } else {
    entries.push(...Object.entries(value));
  }
  for (const [key, raw] of entries) {
    const spec = ruleSpec(key);
    if (!spec || typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    if (raw < spec.min || raw > spec.max || !onStep(spec, raw)) continue;
    out[spec.key] = raw;
  }
  return normalizeRules(out);
}
