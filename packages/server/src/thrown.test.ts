// Thrown weapons through a real room (M4-3): an egg thrown with the Attack button shows up in every
// client's synced `projectiles`, lands on the other player and leaves the state again.
import { ColyseusTestServer } from '@colyseus/testing';
import type { Room as ClientRoom } from '@colyseus/sdk';
import {
  Button,
  ClientMessage,
  defaultThemeId,
  getTheme,
  loadConfig,
  playerHalfSize,
  vanSpawn,
  type InputFrame,
} from '@keke/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGameServer } from './app';
import { loadThemeMap, singleMapRegistry } from './maps';
import type { GameRoom } from './rooms/GameRoom';
import type { GameState } from './schema/GameState';
import type { CombatSystem } from './systems/combat/CombatSystem';

// Own port: other integration files use 2568, 2571, 2572 and 2574 to 2579, and files run in parallel.
const PORT = 2580;

const config = loadConfig({
  ...loadConfig(),
  countdownSeconds: 0.05,
  timedRoundSeconds: 60,
  roundResultsSeconds: 60,
});
const map = loadThemeMap(getTheme(defaultThemeId));

type Conn = ClientRoom<GameRoom, GameState>;

describe('GameRoom thrown weapons (integration)', () => {
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

  it('an egg flies in the synced state, hits the other player for 8 and is removed', async () => {
    const host = (await colyseus.sdk.create('game', { nickname: 'Host' })) as Conn;
    open.push(host);
    await host.waitForInitialState();
    const room = colyseus.getRoomById<GameRoom>(host.roomId);
    const guest = (await colyseus.sdk.join('game', { code: room.state.code, nickname: 'G' })) as Conn;
    open.push(guest);
    await guest.waitForInitialState();
    for (const c of [host, guest]) {
      c.reconnection.enabled = false;
      c.send(ClientMessage.ready, { ready: true });
    }
    await waitFor(() => [...room.state.players.values()].every((p) => p.ready));
    host.send(ClientMessage.start);
    await waitFor(() => room.state.phase === 'playing');

    const a = room.state.players.get(host.sessionId);
    const b = room.state.players.get(guest.sessionId);
    if (!a || !b) throw new Error('no players');
    const start = vanSpawn(map, 0, playerHalfSize(config));
    a.x = start.x;
    a.y = start.y;
    b.x = start.x + 160;
    b.y = start.y;
    // The weapon roll is random: roll until the host holds eggs (the room's combat is private).
    const combat = (room as unknown as { combat: CombatSystem }).combat;
    for (let i = 0; i < 500 && a.weapon !== 'egg_carton'; i++) combat.onPickup(host.sessionId, 'item');
    expect(a.weapon).toBe('egg_carton');

    let seen = false;
    const onChange = () => {
      if (guest.state.projectiles?.size) seen = true;
    };
    guest.onStateChange(onChange);
    const frame: InputFrame = { seq: 1, move: { x: 0, y: 0 }, aim: 0, buttons: Button.Attack };
    host.send(ClientMessage.input, frame);
    await waitFor(() => b.hp === config.maxHp - 8);
    expect(seen).toBe(true);
    expect(a.weaponUses).toBe(5);
    await waitFor(() => guest.state.projectiles.size === 0);
    expect(guest.state.players.get(guest.sessionId)?.hp).toBe(config.maxHp - 8);
  });
});
