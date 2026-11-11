// Banana peels through a real room (M4-5): Attack drops a synced peel, a rival steps on it, slips,
// drops the carried item (drop broadcast with reason 'slip') and slides; clients see the peel in the state.
import { ColyseusTestServer } from '@colyseus/testing';
import type { Room as ClientRoom } from '@colyseus/sdk';
import {
  Button,
  ClientMessage,
  CombatEventMessage,
  ItemEventMessage,
  defaultThemeId,
  getTheme,
  getWeaponCatalogue,
  loadConfig,
  playerHalfSize,
  vanSpawn,
  type DropMessage,
  type InputFrame,
} from '@keke/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGameServer } from './app';
import { loadThemeMap, singleMapRegistry } from './maps';
import type { GameRoom } from './rooms/GameRoom';
import type { GameState, PlayerState } from './schema/GameState';
import type { CombatSystem } from './systems/combat/CombatSystem';

// Own port: other integration files use 2568, 2571, 2572 and 2574 to 2579, and files run in parallel.
const PORT = 2582;

const config = loadConfig({
  ...loadConfig(),
  countdownSeconds: 0.05,
  timedRoundSeconds: 60,
  roundResultsSeconds: 60,
});
const map = loadThemeMap(getTheme(defaultThemeId));
const peelDef = getWeaponCatalogue().require('banana_peels');
if (peelDef.behaviour !== 'trap') throw new Error('banana_peels is not a trap');

type Conn = ClientRoom<GameRoom, GameState>;

interface Player {
  conn: Conn;
  me: PlayerState;
  seq: number;
  events: { type: string; payload: unknown }[];
}

describe('GameRoom banana peels (integration)', () => {
  let colyseus: ColyseusTestServer;
  const open: Conn[] = [];

  beforeAll(async () => {
    const server = createGameServer({ config, maps: singleMapRegistry(map), npcs: false });
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

  /** Rolls pickups on the room's combat system until `p` holds banana peels (seeded per room, so bounded). */
  function giveBananas(room: GameRoom, p: Player): void {
    const combat = (room as unknown as { combat: CombatSystem }).combat;
    for (let i = 0; i < 500 && p.me.weapon !== 'banana_peels'; i++) combat.onPickup(p.conn.sessionId, 'item');
    expect(p.me.weapon).toBe('banana_peels');
  }

  it('a rival slips on an armed peel: drops the carried item and slides; the peel is synced', async () => {
    const { room, players } = await playingRoom(2);
    const [a, b] = players as [Player, Player];
    // b carries their target.
    const target = room.state.items.get(String(b.me.target));
    if (!target) throw new Error('no target');
    place(b, target.x, target.y);
    await press(b, Button.Interact);
    await waitFor(() => b.me.carrying !== 0);
    const carried = b.me.carrying;

    giveBananas(room, a);
    const start = vanSpawn(map, 0, playerHalfSize(config));
    place(a, start.x, start.y);
    await press(a, Button.Attack, 0);
    await waitFor(() => room.state.traps.size === 1);
    const peel = [...room.state.traps.values()][0];
    if (!peel) throw new Error('no peel');
    expect(peel.owner).toBe(a.conn.sessionId);
    expect(a.me.weaponUses).toBe((peelDef.uses ?? 0) - 1);
    // The client sees it, then sees it arm.
    await waitFor(() => b.conn.state.traps.size === 1);
    await waitFor(() => [...b.conn.state.traps.values()][0]?.armed === true);

    // The owner stands on it: nothing. b steps on it: slip.
    expect(a.me.sliding).toBe(false);
    place(b, peel.x, peel.y);
    await waitFor(() => b.me.sliding);
    expect(b.me.stunned).toBe(true);
    expect(b.me.carrying).toBe(0);
    expect(room.state.traps.size).toBe(0);
    await waitFor(() => b.events.some((e) => e.type === 'drop'));
    const drop = b.events.find((e) => e.type === 'drop')?.payload as DropMessage;
    expect(drop).toMatchObject({ player: b.conn.sessionId, reason: 'slip', item: { id: carried } });
    await waitFor(() => b.conn.state.players.get(b.conn.sessionId)?.sliding === true);
    // E while sliding, standing on the dropped item, does not take it back (M4 review F4).
    const lying = room.state.items.get(String(carried));
    if (!lying) throw new Error('dropped item is gone');
    place(b, lying.x, lying.y);
    await press(b, 0); // release E from the first pickup, so the next frame is a new press
    await press(b, Button.Interact);
    expect(b.me.stunned || b.me.sliding).toBe(true);
    expect(b.me.carrying).toBe(0);
    // Out of control for the slide time (a wall may end the slide itself sooner).
    await waitFor(() => !b.me.sliding && !b.me.stunned, 2000);
    // Back on their feet, b can pick it up again.
    place(b, lying.x, lying.y);
    await press(b, 0);
    await press(b, Button.Interact);
    await waitFor(() => b.me.carrying === carried);
  }, 15000);
});
