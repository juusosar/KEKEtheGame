import { RULES, hostRulesSchema, loadConfig } from '@keke/shared';
import { describe, expect, it } from 'vitest';
import {
  PRESET_RULES,
  RULE_PRESETS,
  formatRuleValue,
  fromInput,
  inputRange,
  matchingPreset,
  readRoomSetup,
  rulesSummary,
  toInput,
} from './rules';

const config = loadConfig();
const spec = (key: string) => {
  const found = RULES.find((r) => r.key === key);
  if (!found) throw new Error(key);
  return found;
};

describe('rules on the client', () => {
  it('ships presets the server accepts, and each one is recognised again', () => {
    for (const preset of RULE_PRESETS) {
      expect(hostRulesSchema.safeParse(PRESET_RULES[preset]).success, preset).toBe(true);
      expect(matchingPreset(config, PRESET_RULES[preset])).toBe(preset);
    }
    expect(matchingPreset(config, { raceQuota: 13 })).toBeNull();
    // Values equal to the standard ones do not make a set custom.
    expect(matchingPreset(config, { raceQuota: config.raceQuota })).toBe('standard');
  });

  it('formats values for people', () => {
    expect(formatRuleValue(spec('timedRoundSeconds'), 180)).toBe('3:00');
    expect(formatRuleValue(spec('timedRoundSeconds'), 90)).toBe('1:30');
    expect(formatRuleValue(spec('respawnSeconds'), 1.5)).toBe('1.5 s');
    expect(formatRuleValue(spec('jokeItemChance'), 0.08)).toBe('8 %');
    expect(formatRuleValue(spec('carrySpeedMultiplier'), 0.85)).toBe('×0.85');
    expect(formatRuleValue(spec('maxHp'), 100)).toBe('100 HP');
    expect(formatRuleValue(spec('raceQuota'), 6)).toBe('6');
  });

  it('shows percentages as whole percent in the input', () => {
    const joke = spec('jokeItemChance');
    expect(toInput(joke, 0.08)).toBe(8);
    expect(fromInput(joke, 20)).toBe(0.2);
    expect(inputRange(joke)).toEqual({ min: 0, max: 50, step: 1 });
    expect(inputRange(spec('timedRoundSeconds'))).toEqual({ min: 30, max: 900, step: 15 });
  });

  it('sums up the changed rules with their standard values', () => {
    expect(rulesSummary(config, {})).toEqual([]);
    expect(rulesSummary(config, { raceQuota: 10, timedRoundSeconds: 120 })).toEqual([
      'Round time (Timed): 2:00 (standard 3:00)',
      'Items per order: 10 (standard 6)',
    ]);
  });

  it('reads the remembered setup and falls back field by field', () => {
    const max = config.maxRoundsPerMap;
    expect(readRoomSetup(null, max)).toEqual({
      mode: 'timed',
      roundsPerMap: 1,
      teams: false,
      maps: 'both',
      rules: {},
    });
    expect(readRoomSetup('not json', max).mode).toBe('timed');
    const stored = JSON.stringify({
      mode: 'race',
      roundsPerMap: 2,
      teams: true,
      maps: 'prisma',
      rules: { raceQuota: 9 },
    });
    expect(readRoomSetup(stored, max)).toEqual({
      mode: 'race',
      roundsPerMap: 2,
      teams: true,
      maps: 'prisma',
      rules: { raceQuota: 9 },
    });
    const bad = JSON.stringify({
      mode: 'golf',
      roundsPerMap: 99,
      teams: 'yes',
      maps: 'mall',
      rules: { raceQuota: 0, tileSize: 8 },
    });
    expect(readRoomSetup(bad, max)).toEqual({
      mode: 'timed',
      roundsPerMap: 1,
      teams: false,
      maps: 'both',
      rules: {},
    });
  });
});
