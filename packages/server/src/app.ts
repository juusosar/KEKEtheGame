import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LobbyRoom, Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { HEALTH_PATH, ROOM_NAMES, loadConfig, type GameConfig, type HealthResponse } from '@keke/shared';
import express from 'express';
import { gameRoomWithConfig } from './rooms/GameRoom';
import { loadMapRegistry, type MapRegistry } from './maps';

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
  /**
   * The maps rooms can play (Phase 2, P1-1). Defaults to the map of every `available` theme from maps/,
   * each checked against the NPC types it spawns.
   */
  maps?: MapRegistry;
  /**
   * Accept the debug-only room messages (teleport, end phase; `DebugMessage` in @keke/shared). For the
   * e2e server and local testing only: `KEKE_DEBUG=1` turns it on in index.ts. Default off.
   */
  debug?: boolean;
  /**
   * Spawn the store workers (§8). Default on. Room tests that are not about NPCs pass `false` so
   * stockers, carts, forklifts and guards cannot spoil exact moves and pickups (M7 review F3).
   */
  npcs?: boolean;
}

/** Colyseus + Express on one HTTP server: rooms, matchmaking and the static client on a single port. */
export function createGameServer({
  clientDist = DEFAULT_CLIENT_DIST,
  config = loadConfig(),
  // §8: loading refuses a map that cannot host the NPCs it spawns (M5-1 handoff, per map since P1-1).
  maps = loadMapRegistry(),
  debug = false,
  npcs = true,
}: GameServerOptions = {}): Server {
  const server = new Server({
    transport: new WebSocketTransport(),
    greet: false,
    express: (app) => {
      // Health check for the client's connection badge and the e2e specs (replaces the M0 hello room).
      app.get(HEALTH_PATH, (_req, res) => {
        const health: HealthResponse = { ok: true, debug };
        res.set('Cache-Control', 'no-store').json(health);
      });
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
  // Join by code: the room puts its code in metadata, and filterBy matches `{ code }` join options against it.
  server
    .define(ROOM_NAMES.game, gameRoomWithConfig(config, maps, { debug, npcs }))
    .filterBy(['code'])
    .enableRealtimeListing();
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
