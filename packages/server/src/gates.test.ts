// One-way gates in a room (phase 2 P2-1, decision 9): the stop event, no pick-up or attack while
// stopped, and no way back in. Runs on the real prisma map.
import { ColyseusTestServer } from '@colyseus/testing';
import type { Room as ClientRoom } from '@colyseus/sdk';
import {
  Button,
  ClientMessage,
  CombatEventMessage,
  GateEventMessage,
  ItemEventMessage,
  gateStopFrames,
  getTheme,
  loadConfig,
  type GateStopMessage,
  type InputFrame,
} from '@keke/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGameServer } from './app';
import { loadThemeMap, singleMapRegistry } from './maps';
import type { GameRoom } from './rooms/GameRoom';
import type { GameState, PlayerState } from './schema/GameState';

// Own port (P2-1 thread: 2604); integration files run in parallel.
const PORT = 2604;

const config = loadConfig({
  ...loadConfig(),
  countdownSeconds: 0.05,
  timedRoundSeconds: 60,
  roundResultsSeconds: 60,
});
const map = loadThemeMap(getTheme('prisma'));
const lane = map.gates.find((g) => g.kind === 'checkout');
if (!lane) throw new Error('prisma has no checkout gate');
const laneX = lane.x + lane.width / 2;
const lineY = lane.y + lane.height / 2;

type Conn = ClientRoom<GameRoom, GameState>;

describe('GameRoom one-way gates (integration, P2-1)', () => {
  let colyseus: ColyseusTestServer;
  const open: Conn[] = [];

  beforeAll(async () => {
    const server = createGameServer({
      config,
      maps: singleMapRegistry(map, getTheme('prisma')),
      npcs: false,
    });
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

  async function waitFor(check: () => boolean, timeoutMs = 10_000): Promise<void> {
    const until = Date.now() + timeoutMs;
    while (!check()) {
      if (Date.now() > until) throw new Error('waitFor timed out');
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  async function playing(): Promise<{
    room: GameRoom;
    conn: Conn;
    me: PlayerState;
    events: { type: string; payload: unknown }[];
  }> {
    const conn = (await colyseus.sdk.create('game', { nickname: 'Host' })) as Conn;
    open.push(conn);
    await conn.waitForInitialState();
    conn.reconnection.enabled = false;
    const room = colyseus.getRoomById<GameRoom>(conn.roomId);
    const events: { type: string; payload: unknown }[] = [];
    for (const type of [
      ...Object.values(GateEventMessage),
      ...Object.values(ItemEventMessage),
      CombatEventMessage.attack,
    ]) {
      conn.onMessage(type, (payload: unknown) => events.push({ type, payload }));
    }
    conn.send(ClientMessage.settings, { maps: 'prisma' });
    await waitFor(() => room.state.settings.maps === 'prisma');
    conn.send(ClientMessage.ready, { ready: true });
    await waitFor(() => [...room.state.players.values()].every((p) => p.ready));
    conn.send(ClientMessage.start);
    await waitFor(() => room.state.phase === 'playing');
    const me = room.state.players.get(conn.sessionId);
    if (!me) throw new Error('no player');
    return { room, conn, me, events };
  }

  async function send(
    conn: Conn,
    me: PlayerState,
    move: { x: number; y: number },
    buttons = 0,
  ): Promise<void> {
    const frame: InputFrame = { seq: me.ack + 1, move, aim: Math.PI / 2, buttons };
    conn.send(ClientMessage.input, frame);
    await waitFor(() => me.ack === frame.seq);
  }

  it('stops a player crossing out, broadcasts it, and refuses pick-ups and attacks until the stop ends', async () => {
    const { conn, me, events } = await playing();
    expect(me.gateLast).toBe(-1);
    me.x = laneX;
    me.y = lineY - 12;
    while (me.gateStop === 0) await send(conn, me, { x: 0, y: 1 });
    // `me` is the server's own state, so the ack is there before the broadcast reaches the client.
    await waitFor(() => events.some((e) => e.type === GateEventMessage.gateStop));
    const stop = events.find((e) => e.type === GateEventMessage.gateStop)?.payload as GateStopMessage;
    expect(stop).toEqual({
      player: conn.sessionId,
      gate: lane.index,
      carrying: false,
      seconds: gateStopFrames('checkout', false, config) / config.inputHz,
    });
    expect(me.gateLast).toBe(lane.index);

    // Stopped: input does not move the body; E and Attack do nothing.
    const at = { x: me.x, y: me.y };
    await send(conn, me, { x: 0, y: 1 }, Button.Interact | Button.Attack);
    expect({ x: me.x, y: me.y }).toEqual(at);
    expect(me.gateStop).toBeGreaterThan(0);
    await send(conn, me, { x: 0, y: 1 });
    await new Promise((r) => setTimeout(r, 120)); // a couple of ticks for any attack event to arrive
    expect(events.filter((e) => e.type === CombatEventMessage.attack)).toEqual([]);

    while (me.gateStop > 0) await send(conn, me, { x: 0, y: 1 });
    await send(conn, me, { x: 0, y: 1 });
    expect(me.y).toBeGreaterThan(at.y);
    // Free again: the same press swings.
    await send(conn, me, { x: 0, y: 0 }, Button.Attack);
    await waitFor(() => events.some((e) => e.type === CombatEventMessage.attack));
    expect(events.filter((e) => e.type === GateEventMessage.gateStop)).toHaveLength(1);
  }, 20_000);

  it('cannot walk back in through the gate', async () => {
    const { conn, me } = await playing();
    me.x = laneX;
    me.y = lineY + 30;
    for (let i = 0; i < 20; i++) await send(conn, me, { x: 0, y: -1 });
    expect(me.y).toBe(lineY);
    expect(me.gateStop).toBe(0);
  }, 20_000);
});
