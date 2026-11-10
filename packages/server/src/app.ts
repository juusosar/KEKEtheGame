import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LobbyRoom, Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ROOM_NAMES, loadConfig, type GameConfig } from '@keke/shared';
import express from 'express';
import { gameRoomWithConfig } from './rooms/GameRoom';
import { HelloRoom } from './rooms/HelloRoom';

/** Default port from §16; override with the PORT env var. */
export const DEFAULT_PORT = 2567;

/**
 * The built client. Both `src/` and the bundled `dist/` sit one level below
 * packages/server, so the same relative path works from source and from the build.
 */
export const DEFAULT_CLIENT_DIST = fileURLToPath(new URL('../../client/dist', import.meta.url));

export interface GameServerOptions {
  /** Folder with the built client to serve on `/`. */
  clientDist?: string;
  /** Validated game config. Defaults to the bundled shared/data/config.json. */
  config?: GameConfig;
}

/** Colyseus + Express on one HTTP server: rooms, matchmaking and the static client on a single port. */
export function createGameServer({
  clientDist = DEFAULT_CLIENT_DIST,
  config = loadConfig(),
}: GameServerOptions = {}): Server {
  const server = new Server({
    transport: new WebSocketTransport(),
    greet: false,
    express: (app) => {
      const indexHtml = join(clientDist, 'index.html');
      if (existsSync(indexHtml)) {
        app.use(express.static(clientDist));
      } else {
        // Without this, Colyseus answers `/` with its own version banner.
        app.get('/', (_req, res) => {
          res
            .status(503)
            .type('text')
            .send('The client is not built yet. Run "npm run build", then restart the server.');
        });
      }
    },
  });
  server.define('hello', HelloRoom);
  // Join by code: the room puts its code in metadata, and filterBy matches `{ code }` join options against it.
  server.define(ROOM_NAMES.game, gameRoomWithConfig(config)).filterBy(['code']).enableRealtimeListing();
  // Built-in room list (§15.1): clients join it to get "rooms", "+" and "-" updates.
  server.define(ROOM_NAMES.lobby, LobbyRoom);
  return server;
}

/** Parses PORT; falls back to the default when it's unset and fails loudly when it's garbage. */
export function resolvePort(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`PORT must be an integer between 0 and 65535, got "${value}".`);
  }
  return port;
}
