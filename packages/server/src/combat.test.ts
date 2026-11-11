// Combat through a real room (M4-2): the Attack button from input frames, the weapon roll on pickup,
// hit/ko/respawn broadcasts, and the carried item dropping on KO.
import { ColyseusTestServer } from '@colyseus/testing';
import type { Room as ClientRoom } from '@colyseus/sdk';
import {
  Button,
  ClientMessage,
  CombatEventMessage,
  ItemEventMessage,
  defaultThemeId,
  getTheme,
  loadConfig,
  playerHalfSize,
  vanSpawn,
  type DropMessage,
  type HitMessage,
  type InputFrame,
} from '@keke/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGameServer } from './app';
import { loadThemeMap, singleMapRegistry } from './maps';
import type { GameRoom } from './rooms/GameRoom';
import type { GameState, PlayerState } from './schema/GameState';

// Own port: other integration files use 2568, 2571, 2572 and 2574 to 2578, and files run in parallel.
const PORT = 2579;

const config = loadConfig({
  ...loadConfig(),
  countdownSeconds: 0.05,
  timedRoundSeconds: 60,
  roundResultsSeconds: 60,
  // Two fist hits KO, so the KO test needs no rare weapon.
  maxHp: 10,
  respawnSeconds: 0.3,
  spawnProtectionSeconds: 0.2,
});
const map = loadThemeMap(getTheme(defaultThemeId));

type Conn = ClientRoom<GameRoom, GameState>;

interface Player {
  conn: Conn;
  me: PlayerState;
  seq: number;
  events: { type: string; payload: unknown }[];
}

describe('GameRoom combat (integration)', () => {
  let colyseus: ColyseusTestServer;
  const open: Conn[] = [];

  beforeAll(async () => {
    const server = createGameServer({ config, maps: singleMapRegistry(map) });
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

  async function playingRoom(count: number): Promise<{ room: GameRoom; players: Player[] }> {
    const host = (await colyseus.sdk.create('game', { nickname: 'Host' })) as Conn;
    open.push(host);
    await host.waitForInitialState();
    const room = colyseus.getRoomById<GameRoom>(host.roomId);
    const conns = [host];
    for (let i = 1; i < count; i++) {
      const guest = (await colyseus.sdk.join('game', { code: room.state.code, nickname: `G${i}` })) as Conn;
      open.push(guest);
      await guest.waitForInitialState();
      conns.push(guest);
    }
    const players = conns.map((conn): Player => {
      conn.reconnection.enabled = false;
      const me = room.state.players.get(conn.sessionId);
      if (!me) throw new Error('no player');
      const p: Player = { conn, me, seq: 0, events: [] };
      for (const type of [...Object.values(ItemEventMessage), ...Object.values(CombatEventMessage)]) {
        conn.onMessage(type, (payload: unknown) => p.events.push({ type, payload }));
      }
      return p;
    });
    for (const c of conns) c.send(ClientMessage.ready, { ready: true });
    await waitFor(() => [...room.state.players.values()].every((p) => p.ready));
    host.send(ClientMessage.start);
    await waitFor(() => room.state.phase === 'playing');
    return { room, players };
  }

  async function press(p: Player, buttons = 0, aim = 0): Promise<void> {
    const frame: InputFrame = { seq: ++p.seq, move: { x: 0, y: 0 }, aim, buttons };
    p.conn.send(ClientMessage.input, frame);
    await waitFor(() => p.me.ack === frame.seq);
  }

  function place(p: Player, x: number, y: number): void {
    p.me.x = x;
    p.me.y = y;
    p.me.vx = 0;
    p.me.vy = 0;
  }

  it('Attack swings fists: hit broadcast, HP synced to the client, one swing per press', async () => {
    const { players } = await playingRoom(2);
    const [a, b] = players as [Player, Player];
    const start = vanSpawn(map, 0, playerHalfSize(config));
    place(a, start.x, start.y);
    place(b, start.x + 24, start.y);
    await press(a, Button.Attack, 0);
    await waitFor(() => b.me.hp === config.maxHp - 5);
    await waitFor(() => a.events.some((e) => e.type === 'hit'));
    const hit = a.events.find((e) => e.type === 'hit')?.payload as HitMessage;
    expect(hit).toMatchObject({
      source: { kind: 'player', id: a.conn.sessionId },
      target: b.conn.sessionId,
      damage: 5,
    });
    expect(a.events.some((e) => e.type === 'attack')).toBe(true);
    await waitFor(() => b.conn.state.players.get(b.conn.sessionId)?.hp === config.maxHp - 5);
    // Held, not pressed again: no second swing even after the cooldown.
    await new Promise((r) => setTimeout(r, 450));
    await press(a, Button.Attack, 0);
    expect(b.me.hp).toBe(config.maxHp - 5);
  });

  it('picking up the target rolls a weapon', async () => {
    const { room, players } = await playingRoom(1);
    const [p] = players as [Player];
    const target = room.state.items.get(String(p.me.target));
    if (!target) throw new Error('no target');
    place(p, target.x, target.y);
    await press(p, Button.Interact);
    await waitFor(() => p.me.weapon !== 'fists');
    await waitFor(() => p.events.some((e) => e.type === 'weaponRolled'));
    expect(p.me.weaponUses).toBeGreaterThan(0);
  });

  it('a KO drops the carried item, and the player respawns at their van', async () => {
    const { room, players } = await playingRoom(2);
    const [a, b] = players as [Player, Player];
    // b picks up their target, then stands next to a.
    const target = room.state.items.get(String(b.me.target));
    if (!target) throw new Error('no target');
    place(b, target.x, target.y);
    await press(b, Button.Interact);
    await waitFor(() => b.me.carrying !== 0);
    const carried = b.me.carrying;

    // maxHp 10 here: two fist swings (cooldown 0.4 s) KO.
    for (let i = 0; i < 4 && b.me.alive; i++) {
      place(a, b.me.x - 24, b.me.y);
      await press(a, Button.Attack, 0);
      await press(a, 0, 0);
      if (b.me.alive) await new Promise((r) => setTimeout(r, 420));
    }
    expect(b.me.alive).toBe(false);
    await waitFor(() => a.events.some((e) => e.type === 'ko'));
    const drop = a.events.find((e) => e.type === 'drop')?.payload as DropMessage | undefined;
    expect(drop).toMatchObject({ player: b.conn.sessionId, reason: 'ko', item: { id: carried } });
    expect(b.me.carrying).toBe(0);

    await waitFor(() => b.me.alive, 2000);
    expect(b.me.hp).toBe(config.maxHp);
    expect({ x: b.me.x, y: b.me.y }).toEqual(vanSpawn(map, b.me.van, playerHalfSize(config)));
  }, 20000);
});
