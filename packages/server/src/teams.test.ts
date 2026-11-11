import { ColyseusTestServer } from '@colyseus/testing';
import type { Room as ClientRoom } from '@colyseus/sdk';
import {
  Button,
  ClientMessage,
  DebugMessage,
  ORDER_BOX_ITEM_ID,
  aabbOverlapsSolid,
  defaultThemeId,
  getTheme,
  inWantedZone,
  loadConfig,
  playerHalfSize,
  vanSpawn,
  type GameMode,
  type Vec2,
} from '@keke/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGameServer } from './app';
import { loadThemeMap } from './maps';
import type { GameRoom } from './rooms/GameRoom';
import type { GameState, PlayerState } from './schema/GameState';

// M6-4: the Teams option (§4.3) end to end on the server. Teammates share one van, so in Quota + Race
// they share one quota and one order box that any of them may carry and deliver; a box taken by the
// other team is stolen. Wanted stays per player. Teams are rebalanced at each countdown when players
// leave for good. Own port (memory: 2590 is this file's).
const PORT = 2590;

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

/** A walkable spot inside the staff-only zone (entering it makes a player Wanted, §8). */
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

describe('Teams option on the server (integration)', () => {
  let colyseus: ColyseusTestServer;
  const open: Conn[] = [];

  beforeAll(async () => {
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

  /** A Teams room in 'playing' with `count` players; returns them by team (each in join order). */
  async function playing(
    count: number,
    mode: GameMode,
    roundsPerMap = 1,
  ): Promise<{ room: GameRoom; all: Player[]; red: Player[]; blue: Player[] }> {
    const host = (await colyseus.sdk.create('game', { nickname: 'P0' })) as Conn;
    open.push(host);
    await host.waitForInitialState();
    const room = colyseus.getRoomById<GameRoom>(host.roomId);
    const conns = [host];
    for (let i = 1; i < count; i++) {
      const c = (await colyseus.sdk.join('game', { code: room.state.code, nickname: `P${i}` })) as Conn;
      open.push(c);
      await c.waitForInitialState();
      conns.push(c);
    }
    host.send(ClientMessage.settings, { mode, teams: true, roundsPerMap });
    await waitFor(
      () =>
        room.state.settings.teams &&
        room.state.settings.mode === mode &&
        room.state.settings.roundsPerMap === roundsPerMap,
    );
    for (const c of conns) c.send(ClientMessage.ready, { ready: true });
    await waitFor(() => [...room.state.players.values()].every((p) => p.ready));
    host.send(ClientMessage.start);
    await waitFor(() => room.state.phase === 'playing');
    const all = conns.map((conn) => {
      conn.reconnection.enabled = false;
      conn.onMessage('*', () => {});
      const me = room.state.players.get(conn.sessionId);
      if (!me) throw new Error(`no player for ${conn.sessionId}`);
      return { conn, me, seq: 0 };
    });
    return { room, all, red: all.filter((p) => p.me.team === 1), blue: all.filter((p) => p.me.team === 2) };
  }

  async function press(p: Player, buttons = 0): Promise<void> {
    const seq = ++p.seq;
    p.conn.send(ClientMessage.input, { seq, move: { x: 0, y: 0 }, aim: 0, buttons });
    await waitFor(() => p.me.ack === seq);
  }

  function moveTo(p: Player, pos: Vec2): void {
    p.me.x = pos.x;
    p.me.y = pos.y;
  }

  /**
   * `setter` puts the team van one point short of the quota with the debug aid; `depositor` (a teammate)
   * then deposits their own target there, which packs the team's box into the depositor's hands.
   */
  async function packTeamBox(room: GameRoom, setter: Player, depositor: Player): Promise<number> {
    expect(depositor.me.van).toBe(setter.me.van);
    const van = () => room.state.vans.get(String(setter.me.van));
    setter.conn.send(DebugMessage.vanPoints, { points: config.raceQuota - 1 });
    await waitFor(() => van()?.points === config.raceQuota - 1);

    const target = room.state.items.get(String(depositor.me.target));
    if (!target) throw new Error('no target');
    moveTo(depositor, target);
    await press(depositor, Button.Interact);
    await press(depositor);
    expect(depositor.me.carrying).toBe(target.id);
    moveTo(depositor, vanSpawn(map, depositor.me.van, playerHalfSize(config)));
    await press(depositor);

    const box = room.state.items.get(String(depositor.me.carrying));
    expect(box?.itemId).toBe(ORDER_BOX_ITEM_ID);
    expect(box?.packedVan).toBe(setter.me.van);
    expect(van()?.points).toBe(0);
    return depositor.me.carrying;
  }

  it('balances 4 players 2 against 2 and gives each team one shared van in the first slots', async () => {
    const { room, red, blue } = await playing(4, 'timed');
    expect([red.length, blue.length]).toEqual([2, 2]);
    for (const p of red) expect(p.me.van).toBe(0);
    for (const p of blue) expect(p.me.van).toBe(1);
    expect([...room.state.vans.values()].map((v) => [v.van, v.team]).sort()).toEqual([
      [0, 1],
      [1, 2],
    ]);
    // Personal targets stay personal (§4.3).
    const targets = [...red, ...blue].map((p) => p.me.target);
    expect(targets.every((t) => t > 0)).toBe(true);
    expect(new Set(targets).size).toBe(targets.length);
    // Combat knows the teams (no friendly fire).
    for (const p of [...red, ...blue]) {
      expect(room.combatWorld.players.find((c) => c.id === p.conn.sessionId)?.team).toBe(p.me.team);
    }
  });

  it('race: teammates share the quota and the box, and a teammate who did not pack it can deliver it', async () => {
    const { room, red, blue } = await playing(4, 'race');
    const [r1, r2] = red;
    if (!r1 || !r2) throw new Error('red needs two players');
    // r1 fills the shared van, r2's deposit reaches the quota and packs the box.
    const boxId = await packTeamBox(room, r1, r2);
    await press(r2, Button.Drop);
    expect(r2.me.carrying).toBe(0);
    const box = room.state.items.get(String(boxId));
    moveTo(r1, { x: box?.x ?? 0, y: box?.y ?? 0 });
    await press(r1, Button.Interact);
    await press(r1);
    expect(r1.me.carrying).toBe(boxId);
    // Still the team's own box: it counts as controlled by the shared van.
    expect(room.state.vans.get(String(r1.me.van))?.controlled).toBe(box?.points);

    moveTo(r1, office);
    await waitFor(() => room.state.phase === 'roundResults');
    expect(room.state.raceWinner).toBe(r1.conn.sessionId);
    expect(room.state.raceStolen).toBe(false);
    expect(room.state.teams.get('1')?.place).toBe(1);
    expect(room.state.teams.get('2')?.place).toBe(2);
    for (const p of red) expect([p.me.place, p.me.roundPoints]).toEqual([1, 10]);
    for (const p of blue) expect([p.me.place, p.me.roundPoints]).toEqual([2, 7]);
    // Session tie-break: the members' own deposits (r2's one target), not the box.
    expect(room.state.teams.get('1')?.sessionItemPoints).toBe(r1.me.deposited + r2.me.deposited);
  });

  it("race: a box taken by the other team is stolen and wins for the thief's team", async () => {
    const { room, red, blue } = await playing(4, 'race');
    const [r1, r2] = red;
    const [b1] = blue;
    if (!r1 || !r2 || !b1) throw new Error('teams too small');
    const boxId = await packTeamBox(room, r1, r2);
    await press(r2, Button.Drop);
    const box = room.state.items.get(String(boxId));
    moveTo(b1, { x: box?.x ?? 0, y: box?.y ?? 0 });
    await press(b1, Button.Interact);
    await press(b1);
    expect(b1.me.carrying).toBe(boxId);
    // A stolen box counts for nobody.
    expect(room.state.vans.get(String(r1.me.van))?.controlled).toBe(0);
    expect(room.state.vans.get(String(b1.me.van))?.controlled).toBe(0);

    moveTo(b1, office);
    await waitFor(() => room.state.phase === 'roundResults');
    expect([room.state.raceWinner, room.state.raceStolen]).toEqual([b1.conn.sessionId, true]);
    for (const p of blue) expect(p.me.place).toBe(1);
    for (const p of red) expect(p.me.place).toBe(2);
  });

  it('Wanted stays per player: a teammate of a Wanted player is not Wanted', async () => {
    const { room, red } = await playing(4, 'timed');
    const [r1, r2] = red;
    if (!r1 || !r2) throw new Error('red needs two players');
    moveTo(r1, staffOnlySpot());
    await waitFor(() => r1.me.wanted);
    // Give the room a few ticks to (wrongly) spread it.
    await new Promise((r) => setTimeout(r, 300));
    expect(r2.me.wanted).toBe(false);
    expect([...room.state.players.values()].filter((p) => p.wanted)).toHaveLength(1);
  });

  it('rebalances at the next countdown when a team loses players for good, and the new team carries over', async () => {
    const { room, red, blue } = await playing(4, 'timed', 2);
    // Both blue players leave for good: red 2, blue 0.
    for (const p of blue) await p.conn.leave();
    await waitFor(() => room.state.players.size === 2);
    room.advancePhase(); // roundResults
    room.advancePhase(); // countdown of round 2
    expect(room.state.phase).toBe('countdown');
    const teams = red.map((p) => p.me.team).sort();
    expect(teams).toEqual([1, 2]);
    // The later joiner moved; vans and combat follow the new teams.
    const [stay, moved] = red;
    expect(stay?.me.team).toBe(1);
    expect(moved?.me.team).toBe(2);
    expect(moved?.me.van).toBe(1);
    expect(room.combatWorld.players.find((c) => c.id === moved?.conn.sessionId)?.team).toBe(2);
  });

  it('race: a team keeps the deposits of a member who left for good in its session tie-break (M6 review F9)', async () => {
    const { room, red } = await playing(4, 'race');
    const [r1, r2] = red;
    if (!r1 || !r2) throw new Error('red needs two players');
    // r1 banks their target at the shared van (far below the quota: no box), then leaves for good.
    const target = room.state.items.get(String(r1.me.target));
    if (!target) throw new Error('no target');
    moveTo(r1, target);
    await press(r1, Button.Interact);
    await press(r1);
    expect(r1.me.carrying).toBe(target.id);
    moveTo(r1, vanSpawn(map, r1.me.van, playerHalfSize(config)));
    await press(r1);
    const banked = r1.me.deposited;
    expect(banked).toBeGreaterThan(0);
    expect(banked).toBeLessThan(config.raceQuota);
    await r1.conn.leave();
    await waitFor(() => !room.state.players.has(r1.conn.sessionId));

    room.advancePhase(); // the cap ran out: roundResults
    expect(room.state.phase).toBe('roundResults');
    expect(room.state.teams.get('1')?.sessionItemPoints).toBe(banked);
    expect(r2.me.sessionItemPoints).toBe(0); // players keep their own deposits only
  });
});
