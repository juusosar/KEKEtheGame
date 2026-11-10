import { Client } from '@colyseus/sdk';
import { serverEndpoint } from './endpoint';

let client: Client | undefined;

/** The one Colyseus client for the game server this page came from. */
export function gameClient(): Client {
  client ??= new Client(serverEndpoint(window.location, import.meta.env.DEV));
  return client;
}
