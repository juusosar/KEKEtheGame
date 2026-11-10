// Server entry point: Express + Colyseus on one port, serving the built client (§15.1, §16).
import { existsSync } from 'node:fs';
import { ConfigError } from '@keke/shared';
import { DEFAULT_CLIENT_DIST, resolvePort } from './app';
import { lanBanner } from './lan';
import { startServer } from './start';

const port = resolvePort(process.env['PORT']);
try {
  await startServer({ port });
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(`[keke] Refusing to start. ${err.message}`);
    process.exit(1);
  }
  throw err;
}

console.log(`[keke] Server listening on port ${port}`);
for (const line of lanBanner(port)) console.log(line);
if (!existsSync(DEFAULT_CLIENT_DIST)) {
  console.log(
    `[keke] No client build at ${DEFAULT_CLIENT_DIST}; run "npm run build" to serve the game page.`,
  );
}
