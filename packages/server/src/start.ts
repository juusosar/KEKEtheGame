// Server startup: validate game data first, then listen (§15.4: invalid data → refuse to start).
import { loadConfig, type GameConfig } from '@keke/shared';
import type { Server } from '@colyseus/core';
import { createGameServer, type GameServerOptions } from './app';

export interface StartOptions extends Omit<GameServerOptions, 'config'> {
  port: number;
  /** Raw config data to validate. Defaults to the bundled shared/data/config.json. */
  rawConfig?: unknown;
}

export interface StartedServer {
  server: Server;
  config: GameConfig;
}

/**
 * Validates the config and starts listening. Throws `ConfigError` before opening the port
 * when the data is invalid, so a bad config.json never produces a half-working server.
 */
export async function startServer({
  port,
  rawConfig,
  ...serverOptions
}: StartOptions): Promise<StartedServer> {
  const config = rawConfig === undefined ? loadConfig() : loadConfig(rawConfig);
  const server = createGameServer({ ...serverOptions, config });
  await server.listen(port);
  return { server, config };
}
