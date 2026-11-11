// Bot players (host setting `bots`): the host adds bots from the lobby, they fill seats people do not need,
// are always ready and never host, and they play: they deposit in Timed, deliver an order box in Race, and
// play Teams, on both maps (with store workers, gates, customers and carts on the second one).
import { ColyseusTestServer } from '@colyseus/testing';
import type { Room as ClientRoom } from '@colyseus/sdk';
import { ClientMessage, ServerMessage, loadConfig, mergeConfigOverride, type GameConfig } from '@keke/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from '@colyseus/core';
import { createGameServer } from './app';
import { loadMapRegistry } from './maps';
import type { GameRoom } from './rooms/GameRoom';
import type { GameState, PlayerState } from './schema/GameState';

// Own ports (bots); integration files run in parallel. The second server runs store workers.
const PORT = 2616;
const PORT_NPCS = 2617;

// Long phases: the tests step the rounds with advancePhase() and tick().
const config = loadConfig(
  mergeConfigOverride(loadConfig(), {
    countdownSeconds: 60,
    timedRoundSeconds: 200,
    raceRoundSeconds: 300,
    roundResultsSeconds: 60,
    podiumSeconds: 60,
    maxPlayersPerRoom: 6,
  }),
);

type Conn = ClientRoom<GameRoom, GameState>;

async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > until) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

const botsOf = (state: GameState): PlayerState[] => [...state.players.values()].filter((p) => p.bot);

/** Runs the room's simulation for `seconds` of game time (or until `until` holds), synchronously. */
function play(room: GameRoom, cfg: GameConfig, seconds: number, until: () => boolean = () => false): void {
  const ticks = Math.round(seconds * cfg.serverTickHz);
  for (let i = 0; i < ticks && room.state.phase === 'playing' && !until(); i++) room.tick();
}

describe('bot players (integration)', () => {
  let colyseus: ColyseusTestServer;
  let withNpcs: ColyseusTestServer;
  const open: Conn[] = [];

  beforeAll(async () => {
    const server: Server = createGameServer({ config, maps: loadMapRegistry(), npcs: false });
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
    const npcServer: Server = createGameServer({ config, maps: loadMapRegistry() });
    await npcServer.listen(PORT_NPCS);
    withNpcs = new ColyseusTestServer(npcServer);
  });
  afterEach(async () => {
    await Promise.all(open.splice(0).map((c) => (c.connection.isOpen ? c.leave() : Promise.resolve())));
    await colyseus.cleanup();
    await withNpcs.cleanup();
  });
  afterAll(async () => {
    await colyseus.shutdown();
    await withNpcs.shutdown();
  });

  async function create(
    settings?: Record<string, unknown>,
    on: ColyseusTestServer = colyseus,
  ): Promise<{ room: GameRoom; host: Conn }> {
    const host = (await on.sdk.create('game', { nickname: 'P0', ...(settings ? { settings } : {}) })) as Conn;
    open.push(host);
    await host.waitForInitialState();
    return { room: on.getRoomById<GameRoom>(host.roomId), host };
  }

  async function join(room: GameRoom, nickname: string, on: ColyseusTestServer = colyseus): Promise<Conn> {
    const conn = (await on.sdk.joinById(room.roomId, { code: room.state.code, nickname })) as Conn;
    open.push(conn);
    await conn.waitForInitialState();
    return conn;
  }

  async function start(room: GameRoom, host: Conn): Promise<void> {
    host.send(ClientMessage.ready, { ready: true });
    await waitFor(() => [...room.state.players.values()].every((p) => p.ready));
    host.send(ClientMessage.start);
    await waitFor(() => room.state.phase === 'countdown');
    while (room.state.phase !== 'playing') room.advancePhase();
  }

  it('adds the bots the host asks for: ready, never host, each with its own name and colour', async () => {
    const { room, host } = await create({ bots: 2, botLevel: 'hard' });
    expect(botsOf(room.state)).toHaveLength(2);
    await waitFor(() => botsOf(host.state).length === 2);
    const bots = botsOf(room.state);
    expect(bots.every((b) => b.ready && b.connected && !b.spectator)).toBe(true);
    expect(new Set(bots.map((b) => b.nickname)).size).toBe(2);
    const colors = [...room.state.players.values()].map((p) => p.color);
    expect(new Set(colors).size).toBe(colors.length);
    expect(room.state.hostId).toBe(host.sessionId);
    expect(room.state.settings.botLevel).toBe('hard');

    host.send(ClientMessage.settings, { bots: 4, botLevel: 'easy' });
    await waitFor(() => botsOf(room.state).length === 4);
    expect(room.state.settings.botLevel).toBe('easy');
    host.send(ClientMessage.settings, { bots: 1 });
    await waitFor(() => botsOf(room.state).length === 1);
    // The first bot stays: the newest leave first.
    expect(botsOf(room.state)[0]?.sessionId).toBe(bots[0]?.sessionId);
  });

  it('refuses bots from anyone but the host, and out of range', async () => {
    const { room, host } = await create();
    const guest = await join(room, 'P1');
    const errors: unknown[] = [];
    guest.onMessage(ServerMessage.lobbyError, (m: unknown) => errors.push(m));
    host.onMessage(ServerMessage.lobbyError, (m: unknown) => errors.push(m));
    guest.send(ClientMessage.settings, { bots: 2 });
    host.send(ClientMessage.settings, { bots: config.maxPlayersPerRoom });
    await waitFor(() => errors.length === 2);
    expect(errors).toContainEqual({ code: 'not_host', request: ClientMessage.settings });
    expect(errors).toContainEqual({ code: 'invalid_payload', request: ClientMessage.settings });
    expect(botsOf(room.state)).toHaveLength(0);
  });

  it('gives a person a bot’s seat in a full room, and the bot comes back when they leave', async () => {
    const max = config.maxPlayersPerRoom;
    const { room, host } = await create({ bots: max - 1 });
    expect(room.state.players.size).toBe(max);
    const guest = await join(room, 'P1');
    expect(room.state.players.size).toBe(max);
    expect(botsOf(room.state)).toHaveLength(max - 2);
    await guest.leave();
    await waitFor(() => botsOf(room.state).length === max - 1);
    expect(room.state.hostId).toBe(host.sessionId);
  });

  it('hands the host role to a person, never to a bot', async () => {
    const { room, host } = await create({ bots: 2 });
    const guest = await join(room, 'P1');
    await host.leave();
    await waitFor(() => room.state.hostId === guest.sessionId);
    expect(botsOf(room.state)).toHaveLength(2);
  });

  it('keeps teams balanced with bots in them', async () => {
    const { room, host } = await create({ teams: true, bots: 3 });
    const teams = [...room.state.players.values()].map((p) => p.team);
    expect(teams.filter((t) => t === 1)).toHaveLength(2);
    expect(teams.filter((t) => t === 2)).toHaveLength(2);
    host.send(ClientMessage.settings, { bots: 4 });
    await waitFor(() => botsOf(room.state).length === 4);
    const after = [...room.state.players.values()].map((p) => p.team);
    expect(Math.abs(after.filter((t) => t === 1).length - after.filter((t) => t === 2).length)).toBe(1);
  });

  it('plays Timed on the first map: bots bring items to their vans', async () => {
    const { room, host } = await create({ maps: 'kespro', bots: 3, botLevel: 'normal' });
    await start(room, host);
    play(room, room.currentConfig, 90);
    const deposited = botsOf(room.state).map((b) => b.deposited);
    // Every bot scores (a brawler too: it fetches its own target when nobody carries anything near).
    expect(deposited.filter((d) => d > 0).length).toBeGreaterThanOrEqual(2);
    expect(deposited.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(4);
  });

  it('plays Race on the first map: a bot packs an order box and delivers it', async () => {
    const { room, host } = await create({
      maps: 'kespro',
      mode: 'race',
      bots: 3,
      botLevel: 'hard',
      rules: { raceQuota: 3 },
    });
    await start(room, host);
    play(room, room.currentConfig, 240);
    expect(room.state.phase).toBe('roundResults');
    expect(room.state.players.get(room.state.raceWinner)?.bot).toBe(true);
  });

  it('plays Timed with Teams on the second map, with store workers, gates, customers and carts', async () => {
    const { room, host } = await create(
      { maps: 'prisma', teams: true, bots: 3, botLevel: 'normal' },
      withNpcs,
    );
    await start(room, host);
    expect(room.state.npcs.size).toBeGreaterThan(0);
    play(room, room.currentConfig, 90);
    const banked = [...room.state.vans.values()].reduce((sum, v) => sum + v.points, 0);
    expect(banked).toBeGreaterThanOrEqual(3);
    expect(botsOf(room.state).some((b) => b.deposited > 0)).toBe(true);
  });

  it('plays Race with Teams on the second map', async () => {
    const { room, host } = await create(
      { maps: 'prisma', mode: 'race', teams: true, bots: 3, botLevel: 'hard', rules: { raceQuota: 3 } },
      withNpcs,
    );
    await start(room, host);
    play(room, room.currentConfig, 280);
    expect(room.state.phase).toBe('roundResults');
    expect(room.state.raceWinner).not.toBe('');
  });

  it('goes back to the lobby with the bots ready, and keeps them over a whole session', async () => {
    const { room, host } = await create({ maps: 'kespro', bots: 2, roundsPerMap: 1 });
    await start(room, host);
    play(room, room.currentConfig, 5);
    while (room.state.phase !== 'lobby') room.advancePhase();
    const bots = botsOf(room.state);
    expect(bots).toHaveLength(2);
    expect(bots.every((b) => b.ready)).toBe(true);
    expect(room.state.players.get(host.sessionId)?.ready).toBe(false);
  });
});
