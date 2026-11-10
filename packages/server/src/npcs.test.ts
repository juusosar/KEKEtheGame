// Store workers and Wanted through a real room (M5-3): NPCs in the synced state, a punch on a stocker
// (npcHit broadcast, Wanted for npc_damage, the stocker swinging back), the staff-only zone, and the
// lobby clearing it all.
import { ColyseusTestServer } from '@colyseus/testing';
import type { Room as ClientRoom } from '@colyseus/sdk';
import {
  Button,
  ClientMessage,
  CombatEventMessage,
  NpcEventMessage,
  aabbOverlapsSolid,
  defaultThemeId,
  getTheme,
  inWantedZone,
  loadConfig,
  playerHalfSize,
  vanSpawn,
  type HitMessage,
  type InputFrame,
  type NpcHitMessage,
  type Vec2,
  type WantedMessage,
} from '@keke/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGameServer } from './app';
import { loadThemeMap } from './maps';
import type { GameRoom } from './rooms/GameRoom';
import type { GameState, PlayerState } from './schema/GameState';

// Own port (M5-3): 2584.
const PORT = 2584;

const config = loadConfig({
  ...loadConfig(),
  countdownSeconds: 0.05,
  timedRoundSeconds: 60,
  roundResultsSeconds: 60,
});
const map = loadThemeMap(getTheme(defaultThemeId));

type Conn = ClientRoom<GameRoom, GameState>;

interface Player {
  conn: Conn;
  me: PlayerState;
  seq: number;
  events: { type: string; payload: unknown }[];
}

/** A walkable point inside the staff-only zone. */
function staffOnlySpot(): Vec2 {
  const zone = map.zones.find((z) => z.wantedOnEnter);
  if (!zone) throw new Error('no wantedOnEnter zone');
  const ts = map.tileSize;
  const half = playerHalfSize(config);
  for (let y = zone.bounds.minY + ts / 2; y < zone.bounds.maxY; y += ts) {
    for (let x = zone.bounds.minX + ts / 2; x < zone.bounds.maxX; x += ts) {
      const p = { x, y };
      if (inWantedZone(map.zones, x, y) && !aabbOverlapsSolid(map.collision, p, half)) return p;
    }
  }
  throw new Error('no free spot in the staff-only zone');
}

describe('GameRoom NPCs and Wanted (integration)', () => {
  let colyseus: ColyseusTestServer;
  const open: Conn[] = [];

  beforeAll(async () => {
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

  async function playingRoom(): Promise<{ room: GameRoom; p: Player }> {
    const conn = (await colyseus.sdk.create('game', { nickname: 'Host' })) as Conn;
    open.push(conn);
    await conn.waitForInitialState();
    conn.reconnection.enabled = false;
    const room = colyseus.getRoomById<GameRoom>(conn.roomId);
    const me = room.state.players.get(conn.sessionId);
    if (!me) throw new Error('no player');
    const p: Player = { conn, me, seq: 0, events: [] };
    for (const type of [...Object.values(CombatEventMessage), ...Object.values(NpcEventMessage)]) {
      conn.onMessage(type, (payload: unknown) => p.events.push({ type, payload }));
    }
    conn.send(ClientMessage.ready, { ready: true });
    await waitFor(() => me.ready);
    conn.send(ClientMessage.start);
    await waitFor(() => room.state.phase === 'playing');
    return { room, p };
  }

  async function press(p: Player, buttons = 0, aim = 0): Promise<void> {
    const frame: InputFrame = { seq: ++p.seq, move: { x: 0, y: 0 }, aim, buttons };
    p.conn.send(ClientMessage.input, frame);
    await waitFor(() => p.me.ack === frame.seq);
  }

  it('stockers are in the synced state at round start', async () => {
    const { room, p } = await playingRoom();
    expect(room.state.npcs.size).toBeGreaterThanOrEqual(3);
    await waitFor(() => p.conn.state.npcs.size === room.state.npcs.size);
    const npc = [...p.conn.state.npcs.values()][0];
    expect(npc).toMatchObject({ type: 'stocker', behaviour: 'stocker', alive: true });
    expect(npc?.hp).toBe(npc?.maxHp);
  });

  it('punching a stocker makes the puncher Wanted and the stocker swings back', async () => {
    const { room, p } = await playingRoom();
    const start = vanSpawn(map, 0, playerHalfSize(config));
    p.me.x = start.x;
    p.me.y = start.y;
    const npc = room.npcSystem.npc('stocker_1');
    if (!npc) throw new Error('no stocker_1');
    npc.state.x = start.x + 22;
    npc.state.y = start.y;
    await press(p, Button.Attack, 0);
    await waitFor(() => p.events.some((e) => e.type === 'npcHit'));
    const hit = p.events.find((e) => e.type === 'npcHit')?.payload as NpcHitMessage;
    expect(hit).toMatchObject({ npc: 'stocker_1', source: { kind: 'player', id: p.conn.sessionId } });

    await waitFor(() => p.me.wanted);
    expect(p.me.wantedIn).toBe(config.wantedSeconds);
    await waitFor(() => p.events.some((e) => e.type === 'wanted'));
    const wanted = p.events.find((e) => e.type === 'wanted')?.payload as WantedMessage;
    expect(wanted).toMatchObject({
      player: p.conn.sessionId,
      reason: 'npc_damage',
      refreshed: false,
      npc: 'stocker_1',
    });
    await waitFor(() => p.conn.state.players.get(p.conn.sessionId)?.wanted === true);

    // It retaliates: a hit from the NPC lands on the player.
    await waitFor(() =>
      p.events.some((e) => e.type === 'hit' && (e.payload as HitMessage).source.kind === 'npc'),
    );
    expect(p.me.hp).toBeLessThan(config.maxHp);
  });

  it('standing in staff_only makes a player Wanted; the lobby clears NPCs and Wanted', async () => {
    const { room, p } = await playingRoom();
    const at = staffOnlySpot();
    p.me.x = at.x;
    p.me.y = at.y;
    await waitFor(() => p.me.wanted);
    await waitFor(() => p.events.some((e) => e.type === 'wanted'));
    expect((p.events.find((e) => e.type === 'wanted')?.payload as WantedMessage).reason).toBe('zone');

    room.advancePhase(); // roundResults
    room.advancePhase(); // podium (one round)
    room.advancePhase(); // lobby
    expect(room.state.phase).toBe('lobby');
    expect(room.state.npcs.size).toBe(0);
    expect(room.state.stockCarts.size).toBe(0);
    expect(p.me.wanted).toBe(false);
  });
});
