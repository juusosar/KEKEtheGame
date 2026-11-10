import { Room, type Client } from '@colyseus/core';

/** Message the hello room sends each client right after it joins. */
export interface HelloMessage {
  message: 'connected';
  roomId: string;
  sessionId: string;
}

/**
 * M0 smoke-test room: no state, it just greets every client that joins.
 * The client's Boot scene uses it to prove the network path works end to end.
 */
export class HelloRoom extends Room {
  override onJoin(client: Client): void {
    const hello: HelloMessage = { message: 'connected', roomId: this.roomId, sessionId: client.sessionId };
    client.send('hello', hello);
  }
}
