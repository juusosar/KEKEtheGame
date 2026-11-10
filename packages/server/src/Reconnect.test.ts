import { ColyseusTestServer } from '@colyseus/testing';
import type { Room as ClientRoom } from '@colyseus/sdk';
import { ClientMessage, loadConfig } from '@keke/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGameServer } from './app';
import type { GameRoom } from './rooms/GameRoom';
import type { GameState } from './schema/GameState';

// A short reconnect window and long phases, so a round stays in 'playing' while players drop.
const RECONNECT_SECONDS = 0.4;
const config = loadConfig({
  ...loadConfig(),
  reconnectWindowSeconds: RECONNECT_SECONDS,
  countdownSeconds: 0.05,
  timedRoundSeconds: 60,
});

type Conn = ClientRoom<GameRoom, GameState>;

describe('GameRoom reconnect + spectators (integration)', () => {
  let colyseus: ColyseusTestServer;
  const open: Conn[] = [];

  beforeAll(async () => {
    // Own port: other integration files use 2568 and 2571, and test files run in parallel.
    const server = createGameServer({ config });
    await server.listen(2572);
    colyseus = new ColyseusTestServer(server);
  });
  afterEach(async () => {
    await Promise.all(open.splice(0).map((c) => (c.connection.isOpen ? c.leave() : Promise.resolve())));
    await colyseus.cleanup();
  });
  afterAll(async () => {
    await colyseus.shutdown();
  });

  function track(client: Conn): Conn {
    // Tests drive reconnection by hand unless they turn it back on.
    client.reconnection.enabled = false;
    open.push(client);
    return client;
  }

  async function create(options: Record<string, unknown> = {}): Promise<{ client: Conn; room: GameRoom }> {
    const client = track((await colyseus.sdk.create('game', { nickname: 'Host', ...options })) as Conn);
    const room = colyseus.getRoomById<GameRoom>(client.roomId);
    await client.waitForInitialState();
    return { client, room };
  }

  async function join(code: string, options: Record<string, unknown> = {}): Promise<Conn> {
    const client = track((await colyseus.sdk.join('game', { code, ...options })) as Conn);
    await client.waitForInitialState();
    return client;
  }

  /** Drops the connection without consent, as a closed tab or lost network would. */
  async function drop(client: Conn): Promise<void> {
    await client.leave(false);
  }

  async function reconnect(token: string): Promise<Conn> {
    const client = track((await colyseus.sdk.reconnect(token)) as Conn);
    await client.waitForInitialState();
    return client;
  }

  async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
    const until = Date.now() + timeoutMs;
    while (!check()) {
      if (Date.now() > until) throw new Error('waitFor timed out');
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  async function startRound(room: GameRoom, clients: Conn[]): Promise<void> {
    for (const c of clients) c.send(ClientMessage.ready, { ready: true });
    await waitFor(() => clients.every((c) => room.state.players.get(c.sessionId)?.ready === true));
    clients[0]?.send(ClientMessage.start);
    await waitFor(() => room.state.phase === 'playing');
  }

  it('keeps a dropped player, their team and slot for the reconnect window', async () => {
    const { client: host, room } = await create();
    host.send(ClientMessage.settings, { teams: true });
    const guest = await join(room.state.code, { nickname: 'Guest' });
    await waitFor(() => room.state.settings.teams);
    await startRound(room, [host, guest]);

    const before = room.state.players.get(guest.sessionId);
    const team = before?.team;
    const joinOrder = before?.joinOrder;
    expect(team).toBeGreaterThan(0);

    const token = guest.reconnectionToken;
    await drop(guest);
    await waitFor(() => room.state.players.get(guest.sessionId)?.connected === false);
    expect(room.state.players.size).toBe(2);

    const back = await reconnect(token);
    expect(back.sessionId).toBe(guest.sessionId);
    await waitFor(() => room.state.players.get(guest.sessionId)?.connected === true);
    const after = room.state.players.get(guest.sessionId);
    expect(after).toBe(before);
    expect(after?.team).toBe(team);
    expect(after?.joinOrder).toBe(joinOrder);
    expect(after?.spectator).toBe(false);
    expect(room.state.phase).toBe('playing');
    // The reconnected client sees itself in the synced state.
    await waitFor(() => back.state.players.get(back.sessionId)?.connected === true);
  });

  it('reconnects on its own after a network drop (SDK auto-reconnect)', async () => {
    const { room } = await create();
    const guest = await join(room.state.code);
    guest.reconnection.enabled = true;
    guest.reconnection.minUptime = 0;

    let reconnected = false;
    guest.onReconnect(() => (reconnected = true));
    // 4010 MAY_TRY_RECONNECT: a close code the SDK answers by reconnecting on its own.
    guest.connection.close(4010, 'network lost');
    await waitFor(() => reconnected);
    await waitFor(() => room.state.players.get(guest.sessionId)?.connected === true);
    expect(room.state.players.size).toBe(2);
  });

  it('removes the player once the reconnect window runs out', async () => {
    const { room } = await create();
    const guest = await join(room.state.code);
    const token = guest.reconnectionToken;
    await drop(guest);
    await waitFor(() => room.state.players.get(guest.sessionId)?.connected === false);
    await waitFor(() => !room.state.players.has(guest.sessionId), RECONNECT_SECONDS * 1000 + 1000);
    await expect(colyseus.sdk.reconnect(token)).rejects.toThrow();
  });

  it('removes a player who leaves on purpose at once', async () => {
    const { room } = await create();
    const guest = await join(room.state.code);
    await guest.leave();
    await waitFor(() => !room.state.players.has(guest.sessionId));
  });

  it('passes the host role while the host is away and does not give it back', async () => {
    const { client: host, room } = await create();
    const second = await join(room.state.code, { nickname: 'Second' });
    const hostId = host.sessionId;
    const token = host.reconnectionToken;

    await drop(host);
    await waitFor(() => room.state.hostId === second.sessionId);
    expect(room.state.players.get(hostId)?.connected).toBe(false);

    await reconnect(token);
    await waitFor(() => room.state.players.get(hostId)?.connected === true);
    expect(room.state.hostId).toBe(second.sessionId);
  });

  it('keeps the host role with an away player when nobody is online, then gives it to the first one back', async () => {
    const { client: host, room } = await create();
    const second = await join(room.state.code, { nickname: 'Second' });
    const hostToken = host.reconnectionToken;
    const secondToken = second.reconnectionToken;

    await drop(host);
    await waitFor(() => room.state.hostId === second.sessionId);
    await drop(second);
    await waitFor(() => room.state.players.get(second.sessionId)?.connected === false);
    expect(room.state.hostId).toBe(second.sessionId);

    const back = await reconnect(hostToken);
    await waitFor(() => room.state.hostId === back.sessionId);
    await reconnect(secondToken);
    await waitFor(() => room.state.players.get(second.sessionId)?.connected === true);
    expect(room.state.hostId).toBe(back.sessionId);
  });

  it('lets the lobby start without a player who is inside the reconnect window', async () => {
    const { client: host, room } = await create();
    const guest = await join(room.state.code);
    const token = guest.reconnectionToken;
    await drop(guest);
    await waitFor(() => room.state.players.get(guest.sessionId)?.connected === false);

    host.send(ClientMessage.ready, { ready: true });
    await waitFor(() => room.state.players.get(host.sessionId)?.ready === true);
    host.send(ClientMessage.start);
    await waitFor(() => room.state.phase !== 'lobby');

    // Back in time: they play the round as a normal player.
    await reconnect(token);
    await waitFor(() => room.state.players.get(guest.sessionId)?.connected === true);
    expect(room.state.players.get(guest.sessionId)?.spectator).toBe(false);
  });

  it('keeps a late joiner spectating across a reconnect until the next round', async () => {
    const { client: host, room } = await create();
    await startRound(room, [host]);

    const late = await join(room.state.code, { nickname: 'Late' });
    expect(room.state.players.get(late.sessionId)?.spectator).toBe(true);

    const token = late.reconnectionToken;
    await drop(late);
    await waitFor(() => room.state.players.get(late.sessionId)?.connected === false);
    await reconnect(token);
    await waitFor(() => room.state.players.get(late.sessionId)?.connected === true);
    expect(room.state.players.get(late.sessionId)?.spectator).toBe(true);

    room.advancePhase(); // playing → roundResults
    room.advancePhase(); // roundResults → podium (a one-round session)
    expect(room.state.players.get(late.sessionId)?.spectator).toBe(true);
    room.advancePhase(); // podium → lobby
    expect(room.state.players.get(late.sessionId)?.spectator).toBe(false);
  });

  it('accepts a reloaded client restarting its seq past its ack, while old frames are still queued (M2 review F2)', async () => {
    const { client: host, room } = await create();
    const guest = await join(room.state.code, { nickname: 'Guest' });
    await startRound(room, [host, guest]);
    const player = room.state.players.get(guest.sessionId);
    if (!player) throw new Error('guest missing');
    // Step the simulation by hand so the queue does not drain while the guest is away.
    (room as unknown as { simulation?: { pause(): void } }).simulation?.pause();
    const frame = (seq: number) => ({ seq, move: { x: 1, y: 0 }, aim: 0, buttons: 0 });

    // The old socket's frames are still queued (the newest maxQueuedInputs of a flood), so the
    // high-water mark is far past the ack the client last saw.
    const sent = config.maxQueuedInputs * 4;
    for (let s = 1; s <= sent; s++) guest.send(ClientMessage.input, frame(s));
    await new Promise((r) => setTimeout(r, 100));
    const restart = player.ack + config.maxQueuedInputs + 1; // where a reloaded page restarts (InputSequence)
    expect(restart).toBeLessThan(sent); // the old high-water mark would refuse it

    const token = guest.reconnectionToken;
    await drop(guest);
    await waitFor(() => player.connected === false);
    const back = await reconnect(token);
    await waitFor(() => player.connected === true);
    back.send(ClientMessage.input, frame(restart));
    await new Promise((r) => setTimeout(r, 100));
    room.tick();
    expect(player.ack).toBe(restart);
  });
});
