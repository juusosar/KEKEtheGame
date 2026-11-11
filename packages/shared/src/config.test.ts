import { describe, expect, it } from 'vitest';
import { ConfigError, GLOBAL_CONFIG_KEYS, configForMap, loadConfig, mergeConfigOverride } from './config';
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

describe('per-map overrides (P4-1)', () => {
  const withMaps = (maps: unknown): unknown => ({ ...rawConfig, maps });

  it('ships with no overrides, so every map plays the top-level values', () => {
    const config = loadConfig();
    expect(config.maps).toEqual({});
    expect(configForMap(config, 'kespro')).toBe(config);
    expect(configForMap(config, 'prisma')).toBe(config);
  });

  it('treats a missing maps key as no overrides', () => {
    const { maps: _dropped, ...rest } = rawConfig;
    expect(loadConfig(rest).maps).toEqual({});
  });

  it("puts a map's overrides over the top-level values and leaves the other map alone", () => {
    const config = loadConfig(
      withMaps({ prisma: { raceQuota: 9, timedRoundSeconds: 200, jokeItemChance: 0.2 } }),
    );
    const prisma = configForMap(config, 'prisma');
    expect(prisma.raceQuota).toBe(9);
    expect(prisma.timedRoundSeconds).toBe(200);
    expect(prisma.jokeItemChance).toBe(0.2);
    expect(prisma.playerSpeed).toBe(config.playerSpeed);
    expect(Object.isFrozen(prisma)).toBe(true);
    expect(configForMap(config, 'prisma')).toBe(prisma);
    expect(configForMap(prisma, 'prisma')).toEqual(prisma);
    expect(configForMap(config, 'kespro')).toBe(config);
    expect(config.raceQuota).toBe(6);
  });

  it('merges nested weapon weights as a whole object', () => {
    const weights = { common: 1, uncommon: 1, rare: 1 };
    const config = loadConfig(withMaps({ prisma: { weaponRarityWeights: weights } }));
    expect(configForMap(config, 'prisma').weaponRarityWeights).toEqual(weights);
  });

  it('refuses an unknown map, a session-wide key, an unknown key and a bad value', () => {
    expect(() => loadConfig(withMaps({ lidl: { raceQuota: 9 } }))).toThrow(/maps\.lidl: unknown map/);
    expect(() => loadConfig(withMaps({ prisma: { serverTickHz: 30 } }))).toThrow(
      /maps\.prisma[\s\S]*serverTickHz/,
    );
    expect(() => loadConfig(withMaps({ prisma: { raceQuotaa: 9 } }))).toThrow(/raceQuotaa/);
    expect(() => loadConfig(withMaps({ prisma: { jokeItemChance: 2 } }))).toThrow(
      /maps\.prisma\.jokeItemChance/,
    );
  });

  it('keeps the network, scoring and body keys global', () => {
    for (const key of [
      'tileSize',
      'serverTickHz',
      'inputHz',
      'placementPoints',
      'maxHp',
      'playerHitboxSize',
    ]) {
      expect(GLOBAL_CONFIG_KEYS).toContain(key);
    }
    expect(GLOBAL_CONFIG_KEYS).not.toContain('raceQuota');
    expect(GLOBAL_CONFIG_KEYS).not.toContain('timedRoundSeconds');
  });

  it('lets a test override beat the map overrides for the keys it sets', () => {
    const config = loadConfig(withMaps({ prisma: { countdownSeconds: 5, raceQuota: 9 } }));
    const merged = loadConfig(mergeConfigOverride(config, { countdownSeconds: 1 }));
    expect(merged.countdownSeconds).toBe(1);
    expect(configForMap(merged, 'prisma').countdownSeconds).toBe(1);
    expect(configForMap(merged, 'prisma').raceQuota).toBe(9);
    const replaced = loadConfig(mergeConfigOverride(config, { maps: {} }));
    expect(configForMap(replaced, 'prisma').raceQuota).toBe(6);
  });
});
