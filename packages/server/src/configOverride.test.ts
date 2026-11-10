import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigError, loadConfig } from '@keke/shared';
import { describe, expect, it } from 'vitest';
import { readConfigOverride } from './configOverride';

const dir = mkdtempSync(join(tmpdir(), 'keke-config-'));
function file(name: string, text: string): string {
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
}

describe('readConfigOverride (KEKE_CONFIG)', () => {
  it('merges the file over the bundled config and lists its keys', () => {
    const { raw, keys } = readConfigOverride(file('ok.json', '{ "countdownSeconds": 8 }'));
    expect(keys).toEqual(['countdownSeconds']);
    const config = loadConfig(raw);
    expect(config.countdownSeconds).toBe(8);
    expect(config.timedRoundSeconds).toBe(loadConfig().timedRoundSeconds);
  });

  it('refuses a value the schema rejects, naming the file and the key', () => {
    const path = file('bad.json', '{ "countdownSeconds": "long" }');
    expect(() => readConfigOverride(path)).toThrow(ConfigError);
    expect(() => readConfigOverride(path)).toThrow(/bad\.json[\s\S]*countdownSeconds/);
  });

  it('refuses an unknown key, broken JSON, a non-object and a missing file', () => {
    expect(() => readConfigOverride(file('unknown.json', '{ "countdownSecs": 8 }'))).toThrow(ConfigError);
    expect(() => readConfigOverride(file('broken.json', '{ countdownSeconds: 8'))).toThrow(/not valid JSON/);
    expect(() => readConfigOverride(file('array.json', '[1]'))).toThrow(/JSON object/);
    expect(() => readConfigOverride(join(dir, 'missing.json'))).toThrow(/cannot read/);
  });
});
