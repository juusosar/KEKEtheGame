import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config';
import rawConfig from './data/config.json';

describe('loadConfig', () => {
  it('validates the bundled config.json with the §6 defaults', () => {
    const config = loadConfig();
    expect(config.tileSize).toBe(32);
    expect(config.serverTickHz).toBe(20);
    expect(config.playerSpeed).toBe(160);
    expect(config.placementPoints).toEqual([10, 7, 5, 3]);
    expect(config.placementPointsOther).toBe(1);
    expect(config.jokeItemChance).toBe(0.08);
    expect(config.jokeItemValue).toBe(2);
  });

  it('returns a frozen object', () => {
    const config = loadConfig();
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.placementPoints)).toBe(true);
  });

  it('fails with a readable message naming each bad key', () => {
    const broken = { ...rawConfig, playerSpeed: 'fast', jokeItemChance: 1.5 };
    let error: unknown;
    try {
      loadConfig(broken, 'test-config.json');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ConfigError);
    const message = (error as ConfigError).message;
    expect(message).toMatch(/^Invalid test-config\.json:/);
    expect(message).toMatch(/playerSpeed: .*number/i);
    expect(message).toMatch(/jokeItemChance: .*1/);
    expect((error as ConfigError).issues).toHaveLength(2);
  });

  it('reports missing keys', () => {
    const { raceQuota: _dropped, ...rest } = rawConfig;
    expect(() => loadConfig(rest)).toThrow(/raceQuota/);
  });

  it('rejects unknown keys so typos do not silently fall back to defaults', () => {
    expect(() => loadConfig({ ...rawConfig, playerSpeeed: 200 })).toThrow(/playerSpeeed/);
  });

  it('points into arrays by index', () => {
    expect(() => loadConfig({ ...rawConfig, placementPoints: [10, -1] })).toThrow(/placementPoints\.1/);
  });

  it('rejects non-object input', () => {
    expect(() => loadConfig(null)).toThrow(ConfigError);
  });
});
