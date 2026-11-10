import { ColyseusTestServer } from '@colyseus/testing';
import type { Room as ClientRoom } from '@colyseus/sdk';
import {
  ClientMessage,
  applyInput,
  defaultThemeId,
  getTheme,
  loadConfig,
  playerHalfSize,
  vanSpawn,
  type InputFrame,
  type MovementState,
} from '@keke/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGameServer } from './app';
import { loadThemeMap } from './maps';
import type { GameRoom } from './rooms/GameRoom';
import type { GameState } from './schema/GameState';

// Own port: other integration test files run in parallel (GameRoom.test.ts uses 2571).
const PORT = 2574;

// Short countdown, long round: movement runs only in 'playing'.
const config = loadConfig({
  ...loadConfig(),
  countdownSeconds: 0.05,
  timedRoundSeconds: 60,
  roundResultsSeconds: 60,
});
const map = loadThemeMap(getTheme(defaultThemeId));

type Conn = ClientRoom<GameRoom, GameState>;

function frame(seq: number, x: number, y: number): InputFrame {
  return { seq, move: { x, y }, aim: 0.5, buttons: 0 };
}

/** What the server must compute: the same frames through the shared rules with the fixed input step. */
function replay(start: MovementState, frames: readonly InputFrame[]): MovementState {
  return frames.reduce((s, f) => applyInput(s, f, map, config), start);
}

describe('GameRoom movement (integration)', () => {
  let colyseus: ColyseusTestServer;
  const open: Conn[] = [];

  beforeAll(async () => {
    // boot() ignores its port argument for a Server instance, so listen here instead.
    const server = createGameServer({ config, map });
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
  });
  afterEach(async () => {
    await Promise.all(open.splice(0).map((c) => (c.connection.isOpen ? c.leave() : Promise.resolve())));
    await colyseus.cleanup();
  });
  afterAll(async () => {
    await colyseus.shutdown();
  });

  async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
    const until = Date.now() + timeoutMs;
    while (!check()) {
      if (Date.now() > until) throw new Error('waitFor timed out');
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  /** The server-side player for `client`; fails the test when missing. */
  function playerOf(room: GameRoom, client: Conn) {
    const player = room.state.players.get(client.sessionId);
    if (!player) throw new Error(`no player for ${client.sessionId}`);
    return player;
  }

  /** The first client (host) of a started room and its server-side player. */
  async function playingHost() {
    const { room, clients } = await playingRoom();
    const client = clients[0];
    if (!client) throw new Error('no host');
    return { room, client, me: playerOf(room, client) };
  }

  /** A room with `guests + 1` ready players, started and in the 'playing' phase. */
  async function playingRoom(guests = 0): Promise<{ room: GameRoom; clients: Conn[] }> {
    const host = (await colyseus.sdk.create('game', { nickname: 'Host' })) as Conn;
    open.push(host);
    await host.waitForInitialState();
    const room = colyseus.getRoomById<GameRoom>(host.roomId);
    const clients = [host];
    for (let i = 0; i < guests; i++) {
      const guest = (await colyseus.sdk.join('game', { code: room.state.code, nickname: `G${i}` })) as Conn;
      open.push(guest);
      await guest.waitForInitialState();
      clients.push(guest);
    }
    for (const c of clients) c.send(ClientMessage.ready, { ready: true });
    await waitFor(() => [...room.state.players.values()].every((p) => p.ready));
    host.send(ClientMessage.start);
    await waitFor(() => room.state.phase === 'playing');
    return { room, clients };
  }

  it('spawns players at their vans in join order when the round starts', async () => {
    const { room, clients } = await playingRoom(1);
    const half = playerHalfSize(config);
    clients.forEach((c, i) => {
      const p = room.state.players.get(c.sessionId);
      expect({ x: p?.x, y: p?.y }).toEqual(vanSpawn(map, i, half));
      expect(p?.ack).toBe(0);
    });
  });

  it('applies inputs in seq order with the fixed step, acks the last seq and syncs it to the client', async () => {
    const { client, me } = await playingHost();
    const start = { x: me.x, y: me.y, vx: 0, vy: 0 };

    // Up, then right, then idle: well inside maxQueuedInputs, so nothing is dropped.
    const frames = [
      ...Array.from({ length: 5 }, (_, i) => frame(i + 1, 0, -1)),
      ...Array.from({ length: 5 }, (_, i) => frame(i + 6, 1, 0)),
      frame(11, 0, 0),
    ];
    for (const f of frames) client.send(ClientMessage.input, f);

    await waitFor(() => me.ack === 11);
    const expected = replay(start, frames);
    expect(me.x).toBe(expected.x);
    expect(me.y).toBe(expected.y);
    expect(me.vx).toBe(expected.vx);
    expect(me.vy).toBe(expected.vy);
    expect(me.aim).toBeCloseTo(0.5);
    expect(me.x).not.toBe(start.x);

    // The client sees the same authoritative state and ack.
    await waitFor(() => client.state.players.get(client.sessionId)?.ack === 11);
    expect(client.state.players.get(client.sessionId)?.x).toBe(expected.x);
  });

  it('runs at most inputHz frames per second, whatever the client sends', async () => {
    const { client, me } = await playingHost();
    for (let s = 1; s <= config.maxQueuedInputs; s++) client.send(ClientMessage.input, frame(s, 1, 0));
    await waitFor(() => me.ack > 0);
    const startedAt = Date.now();
    await waitFor(() => me.ack === config.maxQueuedInputs);
    const seconds = (Date.now() - startedAt) / 1000;
    // 15 frames at 30 Hz with up to maxInputsPerTick in the first tick: about 0.4 s, never instant.
    const minimum = (config.maxQueuedInputs - config.maxInputsPerTick) / config.inputHz;
    expect(seconds).toBeGreaterThan(minimum * 0.8);
  });

  it('ignores stale, malformed and spectator inputs', async () => {
    const { room, client, me } = await playingHost();

    client.send(ClientMessage.input, frame(3, 1, 0));
    await waitFor(() => me.ack === 3);
    const after = { x: me.x, y: me.y };
    client.send(ClientMessage.input, frame(2, 1, 0)); // stale
    client.send(ClientMessage.input, { seq: 4, move: { x: 'fast', y: 0 }, aim: 0, buttons: 0 });
    client.send(ClientMessage.input, { ...frame(5, 1, 0), aim: Number.NaN });
    for (let i = 0; i < 3; i++) room.tick();
    expect(me.ack).toBe(3);
    expect({ x: me.x, y: me.y }).toEqual(after);

    // A late joiner spectates: their inputs never move them.
    const late = (await colyseus.sdk.join('game', { code: room.state.code, nickname: 'Late' })) as Conn;
    open.push(late);
    await late.waitForInitialState();
    const spectator = playerOf(room, late);
    expect(spectator.spectator).toBe(true);
    late.send(ClientMessage.input, frame(1, 1, 0));
    await new Promise((r) => setTimeout(r, 150));
    expect(spectator.ack).toBe(0);
    expect(spectator.x).toBe(0);
  });

  it('stops moving players when the round ends', async () => {
    const { room, client, me } = await playingHost();
    room.advancePhase();
    expect(room.state.phase).toBe('roundResults');
    client.send(ClientMessage.input, frame(1, 1, 0));
    await new Promise((r) => setTimeout(r, 150));
    expect(me.ack).toBe(0);
  });
});
