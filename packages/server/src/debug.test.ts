import { ColyseusTestServer } from '@colyseus/testing';
import type { Room as ClientRoom } from '@colyseus/sdk';
import {
  ClientMessage,
  DebugMessage,
  ServerMessage,
  defaultThemeId,
  getWeaponCatalogue,
  getTheme,
  loadConfig,
  playerHalfSize,
  vanSpawn,
  type LobbyErrorMessage,
} from '@keke/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGameServer } from './app';
import { loadThemeMap, singleMapRegistry } from './maps';
import type { GameRoom } from './rooms/GameRoom';
import type { GameState } from './schema/GameState';

// M3-9: the debug-only room messages behind KEKE_DEBUG=1 (teleport, end phase) that the e2e specs use.
// Own ports: other integration files use 2568, 2571, 2572 and 2574 to 2576, and files run in parallel.
const PORT = 2577;
const PORT_OFF = 2578;

const config = loadConfig();
const map = loadThemeMap(getTheme(defaultThemeId));

type Conn = ClientRoom<GameRoom, GameState>;

async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > until) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** Starts a server, and per test a two-player room that is in 'playing'. */
function setup(port: number, debug: boolean) {
  let colyseus: ColyseusTestServer;
  const open: Conn[] = [];
  beforeAll(async () => {
    const server = createGameServer({ config, maps: singleMapRegistry(map), debug });
    await server.listen(port);
    colyseus = new ColyseusTestServer(server);
  });
  afterEach(async () => {
    await Promise.all(open.splice(0).map((c) => (c.connection.isOpen ? c.leave() : Promise.resolve())));
    await colyseus.cleanup();
  });
  afterAll(async () => {
    await colyseus.shutdown();
  });

  return async function playing(): Promise<{
    room: GameRoom;
    host: Conn;
    guest: Conn;
    errors: LobbyErrorMessage[];
  }> {
    const host = (await colyseus.sdk.create('game', { nickname: 'Host' })) as Conn;
    open.push(host);
    await host.waitForInitialState();
    const room = colyseus.getRoomById<GameRoom>(host.roomId);
    const guest = (await colyseus.sdk.join('game', { code: room.state.code, nickname: 'Guest' })) as Conn;
    open.push(guest);
    await guest.waitForInitialState();
    for (const c of [host, guest]) c.reconnection.enabled = false;
    const errors: LobbyErrorMessage[] = [];
    for (const c of [host, guest])
      c.onMessage(ServerMessage.lobbyError, (m: LobbyErrorMessage) => errors.push(m));
    for (const c of [host, guest]) c.send(ClientMessage.ready, { ready: true });
    await waitFor(() => [...room.state.players.values()].every((p) => p.ready));
    host.send(ClientMessage.start);
    await waitFor(() => room.state.phase === 'countdown');
    return { room, host, guest, errors };
  };
}

describe('debug room messages with KEKE_DEBUG on', () => {
  const playing = setup(PORT, true);

  it('end phase: the host steps countdown → playing → roundResults; a guest is refused', async () => {
    const { room, host, guest, errors } = await playing();
    guest.send(DebugMessage.endPhase);
    await waitFor(() => errors.length === 1);
    expect(errors[0]).toEqual({ code: 'not_host', request: DebugMessage.endPhase });
    expect(room.state.phase).toBe('countdown');

    host.send(DebugMessage.endPhase);
    await waitFor(() => room.state.phase === 'playing');
    host.send(DebugMessage.endPhase);
    await waitFor(() => room.state.phase === 'roundResults');
    expect(room.state.players.get(host.sessionId)?.place).toBeGreaterThan(0);
  });

  it('teleport: moves the sender in playing, refuses walls, bad payloads and other phases', async () => {
    const { room, host, guest, errors } = await playing();
    const me = room.state.players.get(guest.sessionId);
    if (!me) throw new Error('no guest');
    const spot = vanSpawn(map, 0, playerHalfSize(config));

    guest.send(DebugMessage.teleport, { x: spot.x, y: spot.y });
    await waitFor(() => errors.length === 1);
    expect(errors[0]).toEqual({ code: 'wrong_phase', request: DebugMessage.teleport });

    host.send(DebugMessage.endPhase);
    await waitFor(() => room.state.phase === 'playing');

    guest.send(DebugMessage.teleport, { x: spot.x + 4, y: spot.y + 2 });
    await waitFor(() => me.x === spot.x + 4 && me.y === spot.y + 2);
    expect([me.vx, me.vy]).toEqual([0, 0]);

    // Map corner (0,0) is a wall tile; strings are not numbers.
    guest.send(DebugMessage.teleport, { x: 1, y: 1 });
    guest.send(DebugMessage.teleport, { x: '5', y: 5 });
    await waitFor(() => errors.length === 3);
    expect(errors.slice(1).map((e) => e.code)).toEqual(['invalid_payload', 'invalid_payload']);
    expect([me.x, me.y]).toEqual([spot.x + 4, spot.y + 2]);
  });

  it('give weapon: arms the sender with full uses in playing; refuses unknown ids and other phases', async () => {
    const { room, host, guest, errors } = await playing();
    const me = room.state.players.get(guest.sessionId);
    if (!me) throw new Error('no guest');
    const baguette = getWeaponCatalogue().require('baguette');

    guest.send(DebugMessage.giveWeapon, { weapon: baguette.id });
    await waitFor(() => errors.length === 1);
    expect(errors[0]).toEqual({ code: 'wrong_phase', request: DebugMessage.giveWeapon });

    host.send(DebugMessage.endPhase);
    await waitFor(() => room.state.phase === 'playing');
    guest.send(DebugMessage.giveWeapon, { weapon: baguette.id });
    await waitFor(() => me.weapon === baguette.id);
    expect(me.weaponUses).toBe(baguette.uses ?? -1);
    expect(room.state.players.get(host.sessionId)?.weapon).toBe('fists');

    guest.send(DebugMessage.giveWeapon, { weapon: 'no_such_weapon' });
    guest.send(DebugMessage.giveWeapon, { weapon: 7 });
    await waitFor(() => errors.length === 3);
    expect(errors.slice(1).map((e) => e.code)).toEqual(['invalid_payload', 'invalid_payload']);
    expect(me.weapon).toBe(baguette.id);
  });

  it('hold NPC: a worker stands still until the hold ends or it is hit; bad ids and phases are refused', async () => {
    const { room, host, guest, errors } = await playing();
    await waitFor(() => room.state.npcs.size > 0);
    const stocker = [...room.state.npcs.values()].find((n) => n.behaviour === 'stocker');
    if (!stocker) throw new Error('no stocker');
    guest.send(DebugMessage.holdNpc, { npc: stocker.id, seconds: 5 });
    await waitFor(() => errors.length === 1);
    expect(errors[0]).toEqual({ code: 'wrong_phase', request: DebugMessage.holdNpc });

    host.send(DebugMessage.endPhase);
    await waitFor(() => room.state.phase === 'playing');
    guest.send(DebugMessage.holdNpc, { npc: stocker.id, seconds: 5 });
    await new Promise((r) => setTimeout(r, 200));
    const at = { x: stocker.x, y: stocker.y };
    // Stockers walk at 80 px/s: one second free would move it well over a few pixels.
    await new Promise((r) => setTimeout(r, 1000));
    expect([stocker.x, stocker.y, stocker.moving]).toEqual([at.x, at.y, false]);

    guest.send(DebugMessage.holdNpc, { npc: 'no_such_npc', seconds: 5 });
    guest.send(DebugMessage.holdNpc, { npc: stocker.id, seconds: 0 });
    guest.send(DebugMessage.holdNpc, { npc: stocker.id, seconds: 31 });
    await waitFor(() => errors.length === 4);
    expect(errors.slice(1).map((e) => e.code)).toEqual([
      'invalid_payload',
      'invalid_payload',
      'invalid_payload',
    ]);
  });

  it('no NPCs: host only: removes the store workers now and keeps them out of the next round (M7 review F4)', async () => {
    const { room, host, guest, errors } = await playing();
    await waitFor(() => room.state.npcs.size > 0);
    guest.send(DebugMessage.noNpcs);
    await waitFor(() => errors.length === 1);
    expect(errors[0]).toEqual({ code: 'not_host', request: DebugMessage.noNpcs });
    expect(room.state.npcs.size).toBeGreaterThan(0);

    host.send(DebugMessage.noNpcs);
    await waitFor(() => room.state.npcs.size === 0 && room.state.stockCarts.size === 0);
    // The next session's round starts without them too.
    for (const phase of ['playing', 'roundResults', 'podium', 'lobby']) {
      host.send(DebugMessage.endPhase);
      await waitFor(() => room.state.phase === phase);
    }
    for (const c of [host, guest]) c.send(ClientMessage.ready, { ready: true });
    await waitFor(() => [...room.state.players.values()].every((p) => p.ready));
    host.send(ClientMessage.start);
    await waitFor(() => room.state.phase === 'countdown');
    expect(room.state.npcs.size).toBe(0);
  });
});

describe('debug room messages with KEKE_DEBUG off (default)', () => {
  const playing = setup(PORT_OFF, false);

  it('are refused with debug_off, and the sender stays connected (M3 review F1)', async () => {
    const { room, host, guest, errors } = await playing();
    host.send(DebugMessage.endPhase);
    guest.send(DebugMessage.teleport, { x: 100, y: 100 });
    guest.send(DebugMessage.giveWeapon, { weapon: 'baguette' });
    guest.send(DebugMessage.vanPoints, { points: 5 });
    host.send(DebugMessage.noNpcs);
    guest.send(DebugMessage.holdNpc, { npc: 'stocker_1', seconds: 5 });
    await waitFor(() => errors.length === 6);
    expect(errors).toEqual(
      expect.arrayContaining([
        { code: 'debug_off', request: DebugMessage.endPhase },
        { code: 'debug_off', request: DebugMessage.teleport },
        { code: 'debug_off', request: DebugMessage.giveWeapon },
        { code: 'debug_off', request: DebugMessage.vanPoints },
        { code: 'debug_off', request: DebugMessage.noNpcs },
        { code: 'debug_off', request: DebugMessage.holdNpc },
      ]),
    );
    expect(room.state.phase).toBe('countdown');
    for (const c of [host, guest]) {
      expect(c.connection.isOpen).toBe(true);
      expect(room.state.players.get(c.sessionId)?.connected).toBe(true);
    }
    // Still served: a later request gets its normal answer.
    host.send(ClientMessage.ready, { ready: true });
    await waitFor(() => errors.length === 7);
    expect(errors[6]).toEqual({ code: 'wrong_phase', request: ClientMessage.ready });
  });
});
