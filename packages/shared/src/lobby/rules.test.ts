import { describe, expect, it } from 'vitest';
import { configForMap, loadConfig, mergeConfigOverride, type GameConfig } from '../config';
import {
  RULES,
  RULE_KEYS,
  changedRules,
  hostRulesSchema,
  onStep,
  readRules,
  snapRule,
  withHostRules,
} from './rules';

const config = loadConfig();

describe('host rules', () => {
  it('lists every rule key once, each a config key whose shipped value is in range and on a step', () => {
    expect(RULES.map((r) => r.key)).toEqual([...RULE_KEYS]);
    for (const spec of RULES) {
      const value = config[spec.key];
      expect(typeof value, spec.key).toBe('number');
      expect(value, spec.key).toBeGreaterThanOrEqual(spec.min);
      expect(value, spec.key).toBeLessThanOrEqual(spec.max);
      expect(onStep(spec, value), spec.key).toBe(true);
      expect(onStep(spec, spec.max), `${spec.key} max on a step`).toBe(true);
    }
  });

  it('every range end is a valid config (a room can be created at the extremes)', () => {
    const lows = Object.fromEntries(RULES.map((r) => [r.key, r.min]));
    const highs = Object.fromEntries(RULES.map((r) => [r.key, r.max]));
    expect(() => withHostRules(config, lows)).not.toThrow();
    expect(() => withHostRules(config, highs)).not.toThrow();
  });

  it('accepts values in range and on a step, refuses the rest', () => {
    expect(hostRulesSchema.safeParse({}).success).toBe(true);
    expect(hostRulesSchema.safeParse({ timedRoundSeconds: 120, raceQuota: 12 }).success).toBe(true);
    expect(hostRulesSchema.safeParse({ carrySpeedMultiplier: 0.85 }).success).toBe(true);
    expect(hostRulesSchema.safeParse({ jokeItemChance: 0.25 }).success).toBe(true);
    expect(hostRulesSchema.safeParse({ timedRoundSeconds: 20 }).success).toBe(false);
    expect(hostRulesSchema.safeParse({ timedRoundSeconds: 125 }).success).toBe(false);
    expect(hostRulesSchema.safeParse({ raceQuota: 31 }).success).toBe(false);
    expect(hostRulesSchema.safeParse({ raceQuota: 2.5 }).success).toBe(false);
    expect(hostRulesSchema.safeParse({ raceQuota: '8' }).success).toBe(false);
    // Session-wide keys a host must not touch.
    expect(hostRulesSchema.safeParse({ serverTickHz: 60 }).success).toBe(false);
    expect(hostRulesSchema.safeParse({ maxPlayersPerRoom: 64 }).success).toBe(false);
  });

  it('snaps a typed value into range and onto a step', () => {
    const spec = RULES.find((r) => r.key === 'carrySpeedMultiplier');
    if (!spec) throw new Error('no carry rule');
    expect(snapRule(spec, 0.86)).toBe(0.85);
    expect(snapRule(spec, 9)).toBe(1.5);
    expect(snapRule(spec, -1)).toBe(0.3);
    expect(snapRule(spec, Number.NaN)).toBe(0.3);
  });

  it('keeps only the rules that differ from the config', () => {
    expect(changedRules(config, { raceQuota: config.raceQuota, timedRoundSeconds: 120 })).toEqual({
      timedRoundSeconds: 120,
    });
  });

  it('applies the rules over the config and returns the config itself without rules', () => {
    expect(withHostRules(config, {})).toBe(config);
    const ruled = withHostRules(config, { timedRoundSeconds: 120, raceQuota: 10, maxHp: 200 });
    expect(ruled.timedRoundSeconds).toBe(120);
    expect(ruled.raceQuota).toBe(10);
    expect(ruled.maxHp).toBe(200);
    expect(ruled.playerSpeed).toBe(config.playerSpeed);
    expect(withHostRules(config, { raceQuota: 10, maxHp: 200, timedRoundSeconds: 120 })).toBe(ruled);
  });

  it("beats a map's override for the keys the host set and keeps the map's other overrides", () => {
    const base: GameConfig = loadConfig({
      ...mergeConfigOverride(config, {}),
      maps: { prisma: { raceQuota: 9, timedRoundSeconds: 90 } },
    });
    const ruled = withHostRules(base, { raceQuota: 4 });
    expect(configForMap(ruled, 'prisma').raceQuota).toBe(4);
    expect(configForMap(ruled, 'prisma').timedRoundSeconds).toBe(90);
    expect(configForMap(ruled, 'kespro').raceQuota).toBe(4);
  });

  it('reads rules from synced state or storage, dropping anything invalid', () => {
    const synced = new Map<string, unknown>([
      ['raceQuota', 8],
      ['timedRoundSeconds', 7],
      ['serverTickHz', 60],
      ['wantedSeconds', 'x'],
    ]);
    expect(readRules(synced)).toEqual({ raceQuota: 8 });
    expect(readRules({ jokeItemChance: 0.2, nope: 1 })).toEqual({ jokeItemChance: 0.2 });
    expect(readRules(null)).toEqual({});
  });
});
