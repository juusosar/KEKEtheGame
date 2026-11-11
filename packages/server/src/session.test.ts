import { ColyseusTestServer } from '@colyseus/testing';
import type { Room as ClientRoom } from '@colyseus/sdk';
import {
  Button,
  ClientMessage,
  DebugMessage,
  ORDER_BOX_ITEM_ID,
  defaultThemeId,
  getTheme,
  loadConfig,
  playerHalfSize,
  vanSpawn,
} from '@keke/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGameServer } from './app';
import { loadThemeMap } from './maps';
import type { GameRoom } from './rooms/GameRoom';
import type { GameState, PlayerState } from './schema/GameState';

// M7-1: whole multi-round sessions (§5) on the server: three rounds back to back, placement points
// adding up, the session tie-break on item points, every round starting clean, a late joiner, the
// podium and the lobby. Timed and Race. Own port (memory: 2595 and 2596 are M7-1's).
const PORT = 2595;

const config = loadConfig({
  ...loadConfig(),
  countdownSeconds: 0.05,
  timedRoundSeconds: 60,
  raceRoundSeconds: 60,
  roundResultsSeconds: 60,
  podiumSeconds: 60,
});
const map = loadThemeMap(getTheme(defaultThemeId));
const office = {
  x: (map.officeTrigger.bounds.minX + map.officeTrigger.bounds.maxX) / 2,
  y: (map.officeTrigger.bounds.minY + map.officeTrigger.bounds.maxY) / 2,
};

type Conn = ClientRoom<GameRoom, GameState>;

interface Player {
  conn: Conn;
  me: PlayerState;
  seq: number;
}

async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > until) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('multi-round sessions (integration)', () => {
  let colyseus: ColyseusTestServer;
  const open: Conn[] = [];

  beforeAll(async () => {
    // KEKE_DEBUG on for the race van points aid.
    const server = createGameServer({ config, map, debug: true });
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

  function wrap(room: GameRoom, conn: Conn): Player {
    conn.reconnection.enabled = false;
    // Broadcasts are not under test here.
    conn.onMessage('*', () => {});
    const me = room.state.players.get(conn.sessionId);
    if (!me) throw new Error(`no player for ${conn.sessionId}`);
    return { conn, me, seq: 0 };
  }

  async function join(room: GameRoom, nickname: string): Promise<Conn> {
    const conn = (await colyseus.sdk.join('game', { code: room.state.code, nickname })) as Conn;
    open.push(conn);
    await conn.waitForInitialState();
    return conn;
  }

  /** A room with `count` players in 'playing' of round 1, with the given lobby settings. */
  async function session(
    count: number,
    settings: { mode?: 'timed' | 'race'; roundsPerMap: number },
  ): Promise<{ room: GameRoom; players: Player[] }> {
    const host = (await colyseus.sdk.create('game', { nickname: 'Host' })) as Conn;
    open.push(host);
    await host.waitForInitialState();
    const room = colyseus.getRoomById<GameRoom>(host.roomId);
    const conns = [host];
    for (let i = 1; i < count; i++) conns.push(await join(room, `P${i}`));
    host.send(ClientMessage.settings, settings);
    await waitFor(
      () =>
        room.state.settings.roundsPerMap === settings.roundsPerMap &&
        room.state.settings.mode === (settings.mode ?? 'timed'),
    );
    const players = conns.map((c) => wrap(room, c));
    for (const c of conns) c.send(ClientMessage.ready, { ready: true });
    await waitFor(() => [...room.state.players.values()].every((p) => p.ready));
    host.send(ClientMessage.start);
    await waitFor(() => room.state.phase === 'playing');
    return { room, players };
  }

  /** Ends a Timed round now with these deposits (set and advanced in one synchronous step). */
  function endTimedRound(room: GameRoom, players: Player[], deposits: number[]): void {
    expect(room.state.phase).toBe('playing');
    players.forEach((p, i) => (p.me.deposited = deposits[i] ?? 0));
    room.advancePhase();
    expect(room.state.phase).toBe('roundResults');
  }

  /** Results → countdown of the next round → playing. */
  async function nextRound(room: GameRoom, round: number): Promise<void> {
    expect(room.state.phase).toBe('roundResults');
    room.advancePhase();
    expect(room.state.phase).toBe('countdown');
    expect(room.state.round).toBe(round);
    await waitFor(() => room.state.phase === 'playing');
  }

  async function press(p: Player, buttons = 0): Promise<void> {
    const seq = ++p.seq;
    p.conn.send(ClientMessage.input, { seq, move: { x: 0, y: 0 }, aim: 0, buttons });
    await waitFor(() => p.me.ack === seq);
  }

  /** Every player is back at full health with fists, carrying nothing, not Wanted, at their van. */
  function expectCleanStart(room: GameRoom, players: Player[], vans: number[]): void {
    players.forEach((p, i) => {
      expect(p.me.van).toBe(vans[i]);
      expect([p.me.hp, p.me.alive, p.me.weapon, p.me.carrying, p.me.wanted]).toEqual([
        config.maxHp,
        true,
        'fists',
        0,
        false,
      ]);
      expect([p.me.place, p.me.roundPoints, p.me.deposited]).toEqual([0, 0, 0]);
      const spawn = vanSpawn(map, p.me.van, playerHalfSize(config));
      expect([p.me.x, p.me.y]).toEqual([spawn.x, spawn.y]);
      expect(p.me.target).not.toBe(0);
    });
    expect([...room.state.items.values()].some((it) => it.itemId === ORDER_BOX_ITEM_ID)).toBe(false);
    expect([room.state.raceWinner, room.state.raceStolen]).toEqual(['', false]);
  }

  it('plays a 3-round Timed session: points add up, ties break on items, a late joiner starts at 0', async () => {
    const { room, players } = await session(4, { roundsPerMap: 3 });
    const [a, b, c, d] = players;
    if (!a || !b || !c || !d) throw new Error('no players');
    expect([room.state.round, room.state.totalRounds]).toEqual([1, 3]);
    const vans = players.map((p) => p.me.van);
    expect(new Set(vans).size).toBe(4);

    // Round 1: a hurts b, picks up a target and keeps it, so round 2 must start clean.
    b.me.hp = 1;
    b.me.weapon = 'baguette';
    const target = room.state.items.get(String(a.me.target));
    if (!target) throw new Error('no target');
    a.me.x = target.x;
    a.me.y = target.y;
    await press(a, Button.Interact);
    await press(a);
    expect(a.me.carrying).toBe(target.id);
    endTimedRound(room, players, [4, 2, 1, 0]);
    expect(players.map((p) => p.me.roundPoints)).toEqual([10, 7, 5, 3]);
    expect(players.map((p) => p.me.sessionPlace)).toEqual([1, 2, 3, 4]);

    await nextRound(room, 2);
    expectCleanStart(room, players, vans);
    expect(players.map((p) => p.me.sessionPoints)).toEqual([10, 7, 5, 3]);

    // A late joiner spectates round 2 and plays round 3 from 0 points.
    const late = wrap(room, await join(room, 'Late'));
    expect(late.me.spectator).toBe(true);
    endTimedRound(room, players, [0, 1, 2, 3]);
    expect(players.map((p) => p.me.sessionPoints)).toEqual([13, 12, 12, 13]);
    expect([late.me.place, late.me.sessionPlace, late.me.sessionPoints]).toEqual([0, 0, 0]);

    await nextRound(room, 3);
    expect(late.me.spectator).toBe(false);
    expectCleanStart(room, players, vans);
    const all = [...players, late];
    // Everyone ties round 3 on items: all share 1st and its 10 points.
    endTimedRound(room, all, [1, 1, 1, 1, 1]);
    expect(all.map((p) => p.me.place)).toEqual([1, 1, 1, 1, 1]);
    expect(all.map((p) => p.me.sessionPoints)).toEqual([23, 22, 22, 23, 10]);
    // a and d tie on 23 points; a has more item points (5 against 4).
    // b and c tie on both (22 points, 4 item points) and share 3rd.
    expect(all.map((p) => p.me.sessionItemPoints)).toEqual([5, 4, 4, 4, 1]);
    expect(all.map((p) => p.me.sessionPlace)).toEqual([1, 3, 3, 2, 5]);

    // The last round's results lead to the podium, which keeps the standings, then the lobby clears them.
    room.advancePhase();
    expect(room.state.phase).toBe('podium');
    expect(all.map((p) => p.me.sessionPlace)).toEqual([1, 3, 3, 2, 5]);
    room.advancePhase();
    expect(room.state.phase).toBe('lobby');
    expect([room.state.round, room.state.totalRounds]).toEqual([0, 0]);
    for (const p of all)
      expect([p.me.sessionPoints, p.me.sessionItemPoints, p.me.sessionPlace]).toEqual([0, 0, 0]);
  }, 20_000);

  it('plays a 3-round Race session: a delivery, a time cap with a carried box, then a full tie', async () => {
    const { room, players } = await session(2, { mode: 'race', roundsPerMap: 3 });
    const [a, b] = players;
    if (!a || !b) throw new Error('no players');
    const vans = players.map((p) => p.me.van);

    /** Debug aid one short of the quota, then a real pickup and deposit packs the box. */
    const packBox = async (p: Player): Promise<void> => {
      p.conn.send(DebugMessage.vanPoints, { points: config.raceQuota - 1 });
      await waitFor(() => room.state.vans.get(String(p.me.van))?.points === config.raceQuota - 1);
      const item = room.state.items.get(String(p.me.target));
      if (!item) throw new Error('no target');
      p.me.x = item.x;
      p.me.y = item.y;
      await press(p, Button.Interact);
      await press(p);
      const van = vanSpawn(map, p.me.van, playerHalfSize(config));
      p.me.x = van.x;
      p.me.y = van.y;
      await press(p);
      expect(room.state.items.get(String(p.me.carrying))?.itemId).toBe(ORDER_BOX_ITEM_ID);
    };

    // Round 1: a delivers. a 1st (10), b 2nd (7).
    await packBox(a);
    a.me.x = office.x;
    a.me.y = office.y;
    await waitFor(() => room.state.phase === 'roundResults');
    expect(room.state.raceWinner).toBe(a.conn.sessionId);
    expect([a.me.roundPoints, b.me.roundPoints]).toEqual([10, 7]);
    const aItems = a.me.deposited;

    await nextRound(room, 2);
    expectCleanStart(room, players, vans);
    expect(room.state.vans.get(String(a.me.van))?.points).toBe(0);

    // Round 2: b packs a box and still carries it at the time cap: b controls more items and wins.
    await packBox(b);
    room.advancePhase();
    expect(room.state.phase).toBe('roundResults');
    expect(room.state.raceWinner).toBe('');
    expect([a.me.roundPoints, b.me.roundPoints]).toEqual([7, 10]);
    const bItems = b.me.deposited;

    await nextRound(room, 3);
    expectCleanStart(room, players, vans);

    // Round 3: nobody scores: both share 1st. 27 points each; the tie breaks on own deposits.
    room.advancePhase();
    expect([a.me.place, b.me.place]).toEqual([1, 1]);
    expect([a.me.sessionPoints, b.me.sessionPoints]).toEqual([27, 27]);
    expect([a.me.sessionItemPoints, b.me.sessionItemPoints]).toEqual([aItems, bItems]);
    const expected = aItems === bItems ? [1, 1] : aItems > bItems ? [1, 2] : [2, 1];
    expect([a.me.sessionPlace, b.me.sessionPlace]).toEqual(expected);

    room.advancePhase();
    expect(room.state.phase).toBe('podium');
    room.advancePhase();
    expect(room.state.phase).toBe('lobby');
  }, 20_000);
});
