// Server entry point: Express + Colyseus on one port, serving the built client (§15.1, §16).
import { existsSync } from 'node:fs';
import { ConfigError, MapError } from '@keke/shared';
import { DEFAULT_CLIENT_DIST, resolvePort } from './app';
import { devBanner, lanBanner } from './lan';
import { readConfigOverride, type ConfigOverride } from './configOverride';
import { MapFileError, loadMapRegistry } from './maps';
import { startServer } from './start';
import { withFixtureMap } from './testMaps';

const port = resolvePort(process.env['PORT']);
// `npm run dev` passes --dev: the page is then served by Vite, not by this server.
const dev = process.argv.includes('--dev');
// Debug-only room messages (teleport, end phase) for the e2e server. Never set this on a real server.
const debug = process.env['KEKE_DEBUG'] === '1';
// Optional JSON merged over config.json (test servers only, e.g. the e2e countdown). Validated like config.json.
const configPath = process.env['KEKE_CONFIG'];
// The e2e server's second map (P1-5): KEKE_TEST_MAPS=1 adds the small fixture map as 'prisma' when that
// map is not loaded yet, so browser specs can pick another map. Honoured only with KEKE_DEBUG=1.
const testMaps = debug && process.env['KEKE_TEST_MAPS'] === '1';
let override: ConfigOverride | undefined;
try {
  if (configPath) override = readConfigOverride(configPath);
  const maps = testMaps ? withFixtureMap(loadMapRegistry()) : undefined;
  await startServer({ port, debug, rawConfig: override?.raw, ...(maps ? { maps } : {}) });
} catch (err) {
  if (err instanceof ConfigError || err instanceof MapError || err instanceof MapFileError) {
    console.error(`[keke] Refusing to start. ${err.message}`);
    process.exit(1);
  }
  throw err;
}

console.log(`[keke] Server listening on port ${port}`);
if (debug)
  console.log('[keke] KEKE_DEBUG=1: debug room messages (teleport, end phase) are ON. Not for real games.');
if (testMaps)
  console.log('[keke] KEKE_TEST_MAPS=1: the test fixture map stands in for any map not built yet.');
if (override)
  console.log(`[keke] KEKE_CONFIG=${override.path}: overrides ${override.keys.join(', ') || 'nothing'}.`);
for (const line of dev ? devBanner(port) : lanBanner(port)) console.log(line);
if (!dev && !existsSync(DEFAULT_CLIENT_DIST)) {
  console.log(
    `[keke] No client build at ${DEFAULT_CLIENT_DIST}; run "npm run build" to serve the game page.`,
  );
}
