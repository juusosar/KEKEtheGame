import { Client, type Room } from '@colyseus/sdk';

/** Name of the M0 smoke-test room registered by the server. */
export const HELLO_ROOM = 'hello';

/** Joins (or creates) the hello room on the given Colyseus endpoint. */
export async function joinHelloRoom(endpoint: string): Promise<Room> {
  const client = new Client(endpoint);
  return client.joinOrCreate(HELLO_ROOM);
}
