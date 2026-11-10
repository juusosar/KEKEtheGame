// Optional config override for test servers (M3 review F2): KEKE_CONFIG=path/to/override.json is
// merged over the bundled config.json before validation, so e2e runs can use a longer countdown or
// short timers without touching the real data. The merged result goes through the same zod schema,
// so a bad override refuses to start like a bad config.json (§15.4).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfigError, loadConfig } from '@keke/shared';

export interface ConfigOverride {
  /** Absolute path of the override file. */
  path: string;
  /** The keys the file sets. */
  keys: string[];
  /** Bundled config with the override merged on top, not yet validated. */
  raw: Record<string, unknown>;
}

/** Reads an override file and merges it over the bundled config. Throws `ConfigError` on bad JSON. */
export function readConfigOverride(file: string): ConfigOverride {
  const path = resolve(file);
  const source = `KEKE_CONFIG override ${path}`;
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new ConfigError(source, [`cannot read the file: ${(err as Error).message}`]);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new ConfigError(source, [`not valid JSON: ${(err as Error).message}`]);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ConfigError(source, ['(root): expected a JSON object of config keys']);
  }
  const override = parsed as Record<string, unknown>;
  // Validate the merge here too, so the error names the override file rather than config.json.
  const raw = { ...loadConfig(), ...override };
  loadConfig(raw, source);
  return { path, keys: Object.keys(override), raw };
}
