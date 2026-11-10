// Server entry point: Express + Colyseus on one port, serving the built client (§15.1, §16).
import { existsSync } from 'node:fs';
import { ConfigError, MapError } from '@keke/shared';
import { DEFAULT_CLIENT_DIST, resolvePort } from './app';
import { devBanner, lanBanner } from './lan';
import { MapFileError } from './maps';
import { startServer } from './start';

const port = resolvePort(process.env['PORT']);
// `npm run dev` passes --dev: the page is then served by Vite, not by this server.
const dev = process.argv.includes('--dev');
try {
  await startServer({ port });
} catch (err) {
  if (err instanceof ConfigError || err instanceof MapError || err instanceof MapFileError) {
    console.error(`[keke] Refusing to start. ${err.message}`);
    process.exit(1);
  }
  throw err;
}

console.log(`[keke] Server listening on port ${port}`);
for (const line of dev ? devBanner(port) : lanBanner(port)) console.log(line);
if (!dev && !existsSync(DEFAULT_CLIENT_DIST)) {
  console.log(
    `[keke] No client build at ${DEFAULT_CLIENT_DIST}; run "npm run build" to serve the game page.`,
  );
}
