import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config';
import { DEFAULT_LOBBY_SETTINGS, settingsUpdateSchema } from './settings';

const schema = settingsUpdateSchema(loadConfig());

describe('host settings', () => {
  it('defaults to free-for-all Timed with one round', () => {
    expect(DEFAULT_LOBBY_SETTINGS).toEqual({
      mode: 'timed',
      roundsPerMap: 1,
      teams: false,
      maps: 'both',
      rules: {},
      bots: 0,
      botLevel: 'normal',
    });
  });

  it('accepts partial updates within range', () => {
    expect(schema.safeParse({ mode: 'race' }).success).toBe(true);
    expect(schema.safeParse({ roundsPerMap: 3, teams: true }).success).toBe(true);
    expect(schema.safeParse({ maps: 'both' }).success).toBe(true);
    expect(schema.safeParse({ bots: 15, botLevel: 'hard' }).success).toBe(true);
    expect(schema.safeParse({ bots: 0, botLevel: 'easy' }).success).toBe(true);
    expect(schema.safeParse({ rules: { timedRoundSeconds: 120, raceQuota: 10 } }).success).toBe(true);
  });

  it('rejects out-of-range or unknown values', () => {
    expect(schema.safeParse({ roundsPerMap: 0 }).success).toBe(false);
    expect(schema.safeParse({ roundsPerMap: 5 }).success).toBe(true);
    expect(schema.safeParse({ roundsPerMap: 6 }).success).toBe(false);
    expect(schema.safeParse({ roundsPerMap: 1.5 }).success).toBe(false);
    expect(schema.safeParse({ mode: 'deathmatch' }).success).toBe(false);
    expect(schema.safeParse({ cheats: true }).success).toBe(false);
    expect(schema.safeParse({ maps: 'mall' }).success).toBe(false);
    expect(schema.safeParse({ rules: { raceQuota: 0 } }).success).toBe(false);
    expect(schema.safeParse({ rules: { tileSize: 16 } }).success).toBe(false);
    expect(schema.safeParse({ bots: -1 }).success).toBe(false);
    expect(schema.safeParse({ bots: 2.5 }).success).toBe(false);
    expect(schema.safeParse({ bots: 16 }).success).toBe(false);
    expect(schema.safeParse({ botLevel: 'insane' }).success).toBe(false);
  });
});
