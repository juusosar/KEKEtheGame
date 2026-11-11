import { ColyseusTestServer } from '@colyseus/testing';
import type { Room as ClientRoom } from '@colyseus/sdk';
import {
  Button,
  ClientMessage,
  DebugMessage,
  ItemEventMessage,
  ORDER_BOX_ITEM_ID,
  RaceEventMessage,
  ServerMessage,
  aabbOverlapsSolid,
  defaultThemeId,
  getTheme,
  inOfficeTrigger,
  loadConfig,
  playerHalfSize,
  vanSpawn,
  type BoxPackedMessage,
  type DeliveryMessage,
  type LobbyErrorMessage,
  type PickupMessage,
} from '@keke/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGameServer } from './app';
import { loadThemeMap, singleMapRegistry } from './maps';
import type { GameRoom } from './rooms/GameRoom';
import type { GameState, PlayerState } from './schema/GameState';

// M6-2: Quota + Race on the server (§4.2): packing at quota, delivery to the office, stolen boxes,
// the time-cap ranking and the debug van points aid. Own port (memory: 2585 is this file's).
const PORT = 2585;

const config = loadConfig({
  ...loadConfig(),
  countdownSeconds: 0.05,
  // Different from the race cap, so the test can tell which clock the mode chose.
  timedRoundSeconds: 20,
  raceRoundSeconds: 60,
  roundResultsSeconds: 60,
  podiumSeconds: 60,
  // Two fist hits KO (the doorstep test), and no spawn protection in the way.
  maxHp: 10,
  spawnProtectionSeconds: 0,
});
const map = loadThemeMap(getTheme(defaultThemeId));
/** Middle of the office trigger: inside it, and walkable (checked below). */
const office = {
  x: (map.officeTrigger.bounds.minX + map.officeTrigger.bounds.maxX) / 2,
  y: (map.officeTrigger.bounds.minY + map.officeTrigger.bounds.maxY) / 2,
};

type Conn = ClientRoom<GameRoom, GameState>;

interface Player {
  conn: Conn;
  me: PlayerState;
  seq: number;
  packed: BoxPackedMessage[];
  delivered: DeliveryMessage[];
  pickups: PickupMessage[];
  errors: LobbyErrorMessage[];
}

async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > until) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('Quota + Race on the server (integration)', () => {
  let colyseus: ColyseusTestServer;
  const open: Conn[] = [];

  beforeAll(async () => {
    // KEKE_DEBUG on: the van points aid is what the race e2e specs use too.
    const server = createGameServer({ config, maps: singleMapRegistry(map), debug: true, npcs: false });
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
    const me = room.state.players.get(conn.sessionId);
    if (!me) throw new Error(`no player for ${conn.sessionId}`);
    const p: Player = { conn, me, seq: 0, packed: [], delivered: [], pickups: [], errors: [] };
    conn.onMessage(RaceEventMessage.boxPacked, (m: BoxPackedMessage) => p.packed.push(m));
    conn.onMessage(RaceEventMessage.delivery, (m: DeliveryMessage) => p.delivered.push(m));
    conn.onMessage(ItemEventMessage.pickup, (m: PickupMessage) => p.pickups.push(m));
    conn.onMessage(ServerMessage.lobbyError, (m: LobbyErrorMessage) => p.errors.push(m));
    // Other broadcasts (targets, deposits, combat, NPCs) are not under test here.
    conn.onMessage('*', () => {});
    return p;
  }

  /** A race room in 'playing' with two players, picked by the host in the lobby settings. */
  async function racing(roundsPerMap = 1): Promise<{ room: GameRoom; a: Player; b: Player }> {
    const host = (await colyseus.sdk.create('game', { nickname: 'Host' })) as Conn;
    open.push(host);
    await host.waitForInitialState();
    const room = colyseus.getRoomById<GameRoom>(host.roomId);
    const guest = (await colyseus.sdk.join('game', { code: room.state.code, nickname: 'Guest' })) as Conn;
    open.push(guest);
    await guest.waitForInitialState();
    const [a, b] = [wrap(room, host), wrap(room, guest)];
    host.send(ClientMessage.settings, { mode: 'race', roundsPerMap });
    await waitFor(
      () => room.state.settings.mode === 'race' && room.state.settings.roundsPerMap === roundsPerMap,
    );
    for (const c of [host, guest]) c.send(ClientMessage.ready, { ready: true });
    await waitFor(() => [...room.state.players.values()].every((p) => p.ready));
    host.send(ClientMessage.start);
    await waitFor(() => room.state.phase === 'playing');
    return { room, a, b };
  }

  async function press(p: Player, buttons = 0): Promise<void> {
    const seq = ++p.seq;
    p.conn.send(ClientMessage.input, { seq, move: { x: 0, y: 0 }, aim: 0, buttons });
    await waitFor(() => p.me.ack === seq);
  }

  function moveTo(p: Player, pos: { x: number; y: number }): void {
    p.me.x = pos.x;
    p.me.y = pos.y;
  }

  /**
   * The debug aid sets the van one point short of the quota; then a real pickup of the own target and a
   * deposit at the own van packs the box into the player's hands. Returns the box's world item id.
   */
  async function packBox(room: GameRoom, p: Player): Promise<number> {
    p.conn.send(DebugMessage.vanPoints, { points: config.raceQuota - 1 });
    const van = () => room.state.vans.get(String(p.me.van));
    await waitFor(() => van()?.points === config.raceQuota - 1);
    expect(p.me.deposited).toBe(0); // debug points are not the player's own deposits

    const target = room.state.items.get(String(p.me.target));
    if (!target) throw new Error('no target');
    moveTo(p, target);
    await press(p, Button.Interact);
    await press(p);
    expect(p.me.carrying).toBe(target.id);
    moveTo(p, vanSpawn(map, p.me.van, playerHalfSize(config)));
    await press(p);

    // Packed at the quota: the van is back to 0 and the depositor carries the box.
    expect(p.me.carrying).not.toBe(0);
    const box = room.state.items.get(String(p.me.carrying));
    expect(box?.itemId).toBe(ORDER_BOX_ITEM_ID);
    expect(box?.state).toBe('carried');
    expect(box?.packedVan).toBe(p.me.van);
    expect(box?.points).toBeGreaterThanOrEqual(config.raceQuota);
    expect(van()?.points).toBe(0);
    expect(van()?.controlled).toBe(box?.points);
    expect(p.me.target).toBe(0); // a carrier gets no new target
    // Broadcast to everyone: find our own packing among them.
    await waitFor(() => p.packed.some((m) => m.player === p.conn.sessionId));
    expect(p.packed.find((m) => m.player === p.conn.sessionId)).toMatchObject({
      player: p.conn.sessionId,
      van: p.me.van,
      points: box?.points,
    });
    return p.me.carrying;
  }

  it('the office spot used by these tests is inside the trigger and walkable', () => {
    expect(inOfficeTrigger(map, office.x, office.y)).toBe(true);
    expect(aabbOverlapsSolid(map.collision, office, playerHalfSize(config))).toBe(false);
  });

  it('wins a round by delivering your own box: the round ends at once and the deliverer is 1st', async () => {
    const { room, a, b } = await racing();
    // The lobby setting chose the race clock (240 s by default), not the Timed one.
    expect(room.state.secondsLeft).toBeGreaterThan(config.timedRoundSeconds);
    expect(room.state.secondsLeft).toBeLessThanOrEqual(config.raceRoundSeconds);

    const boxId = await packBox(room, a);
    // Standing at the own van with the box: no deposit, no error, the box stays carried.
    await press(a);
    expect(a.me.carrying).toBe(boxId);

    moveTo(a, office);
    await waitFor(() => room.state.phase === 'roundResults');
    expect(room.state.raceWinner).toBe(a.conn.sessionId);
    expect(room.state.raceStolen).toBe(false);
    expect(room.state.items.has(String(boxId))).toBe(false);
    expect(a.me.carrying).toBe(0);
    expect([a.me.place, a.me.roundPoints]).toEqual([1, 10]);
    expect([b.me.place, b.me.roundPoints]).toEqual([2, 7]);
    // Session tie-break counts the player's own deposits only.
    expect(a.me.sessionItemPoints).toBe(a.me.deposited);

    await waitFor(() => b.delivered.length === 1);
    expect(b.delivered[0]).toMatchObject({
      player: a.conn.sessionId,
      van: a.me.van,
      packedVan: a.me.van,
      stolen: false,
    });
    expect(b.delivered[0]?.box.id).toBe(boxId);
    await waitFor(() => b.conn.state.raceWinner === a.conn.sessionId);
  });

  it('wins a round by delivering a stolen box; picking up a box rolls no weapon', async () => {
    const { room, a, b } = await racing();
    const boxId = await packBox(room, a);
    // a drops the box at their van (Q); b grabs it.
    await press(a, Button.Drop);
    expect(a.me.carrying).toBe(0);
    const box = room.state.items.get(String(boxId));
    expect(box?.state).toBe('loose');

    expect(b.me.weapon).toBe('fists');
    moveTo(b, { x: box?.x ?? 0, y: box?.y ?? 0 });
    await press(b, Button.Interact);
    await press(b);
    expect(b.me.carrying).toBe(boxId);
    expect(b.me.weapon).toBe('fists');
    await waitFor(() => b.pickups.some((m) => m.item.id === boxId));
    expect(b.pickups.find((m) => m.item.id === boxId)?.kind).toBe('box');
    // A stolen box counts for nobody: not for the packer's van, not for the thief's.
    expect(room.state.vans.get(String(a.me.van))?.controlled).toBe(0);
    expect(room.state.vans.get(String(b.me.van))?.controlled).toBe(0);

    moveTo(b, office);
    await waitFor(() => room.state.phase === 'roundResults');
    expect(room.state.raceWinner).toBe(b.conn.sessionId);
    expect(room.state.raceStolen).toBe(true);
    expect([b.me.place, a.me.place]).toEqual([1, 2]);
    await waitFor(() => a.delivered.length === 1);
    expect(a.delivered[0]).toMatchObject({
      player: b.conn.sessionId,
      van: b.me.van,
      packedVan: a.me.van,
      stolen: true,
    });

    // The next countdown clears the winner.
    room.advancePhase();
    expect(room.state.phase).toBe('podium');
    room.advancePhase();
    expect(room.state.phase).toBe('lobby');
    expect([room.state.raceWinner, room.state.raceStolen]).toEqual(['', false]);
  });

  it('at the time cap ranks by items you control: a carried own box counts, banked points count', async () => {
    const { room, a, b } = await racing();
    await packBox(room, a);
    b.conn.send(DebugMessage.vanPoints, { points: 2 });
    await waitFor(() => room.state.vans.get(String(b.me.van))?.points === 2);
    room.advancePhase(); // the cap ran out
    expect(room.state.phase).toBe('roundResults');
    expect(room.state.raceWinner).toBe('');
    expect([a.me.place, b.me.place]).toEqual([1, 2]);
  });

  it('the van points aid refuses bad payloads and phases other than playing', async () => {
    const { room, a } = await racing();
    a.conn.send(DebugMessage.vanPoints, { points: -1 });
    a.conn.send(DebugMessage.vanPoints, { points: 1.5 });
    a.conn.send(DebugMessage.vanPoints, { points: '3' });
    await waitFor(() => a.errors.length === 3);
    expect(a.errors.map((e) => e.code)).toEqual(['invalid_payload', 'invalid_payload', 'invalid_payload']);
    room.advancePhase();
    a.conn.send(DebugMessage.vanPoints, { points: 3 });
    await waitFor(() => a.errors.length === 4);
    expect(a.errors[3]).toEqual({ code: 'wrong_phase', request: DebugMessage.vanPoints });
  });

  it("the next round's countdown clears the winner and the stolen flag (M6 review F4)", async () => {
    const { room, a, b } = await racing(2);
    const boxId = await packBox(room, a);
    await press(a, Button.Drop);
    const box = room.state.items.get(String(boxId));
    moveTo(b, { x: box?.x ?? 0, y: box?.y ?? 0 });
    await press(b, Button.Interact);
    await press(b);
    expect(b.me.carrying).toBe(boxId);
    moveTo(b, office);
    await waitFor(() => room.state.phase === 'roundResults');
    expect([room.state.raceWinner, room.state.raceStolen]).toEqual([b.conn.sessionId, true]);

    room.advancePhase(); // round 1 of 2: on to round 2, not the podium
    expect(room.state.phase).toBe('countdown');
    expect(room.state.round).toBe(2);
    expect([room.state.raceWinner, room.state.raceStolen]).toEqual(['', false]);
    await waitFor(() => room.state.phase === 'playing');
    expect([room.state.raceWinner, room.state.raceStolen]).toEqual(['', false]);
    await waitFor(
      () => b.conn.state.round === 2 && b.conn.state.raceWinner === '' && !b.conn.state.raceStolen,
    );
  });

  it('a carrier knocked out on the office doorstep in the same tick drops the box and does not win (M6 review F4)', async () => {
    const { room, a, b } = await racing();
    const boxId = await packBox(room, a);
    // Step the simulation by hand so both hits and the step into the office land in known ticks.
    (room as unknown as { simulation?: { pause(): void } }).simulation?.pause();
    const send = (aim: number, buttons: number) =>
      b.conn.send(ClientMessage.input, { seq: ++b.seq, move: { x: 0, y: 0 }, aim, buttons });
    const settle = () => new Promise((r) => setTimeout(r, 100));

    // First fist hit outside the office: a is down to half (maxHp 10, fists 5).
    const outside = { x: map.officeTrigger.bounds.minX - 80, y: office.y };
    moveTo(a, outside);
    moveTo(b, { x: outside.x - 24, y: outside.y });
    send(0, Button.Attack);
    await settle();
    room.tick();
    expect(a.me.hp).toBe(config.maxHp - 5);
    expect(a.me.carrying).toBe(boxId);
    send(0, 0); // release: one click is one swing
    await settle();
    room.tick();
    await new Promise((r) => setTimeout(r, 450)); // fist cooldown 0.4 s

    // a is in the office trigger with the box when this tick resolves, and b's second hit KOs them in it.
    moveTo(a, office);
    // b stands just above a, inside the tall trigger too (no wall between them), and swings down.
    moveTo(b, { x: office.x, y: office.y - 24 });
    send(Math.PI / 2, Button.Attack);
    await settle();
    room.tick();
    expect(a.me.alive).toBe(false);
    expect(a.me.carrying).toBe(0);
    expect(room.state.phase).toBe('playing');
    expect(room.state.raceWinner).toBe('');
    expect(room.state.items.get(String(boxId))?.state).toBe('loose');
    expect(a.delivered).toEqual([]);
  });

  it('two carriers in the office in the same tick: the room RNG picks the deliverer, not join order (M6 review F8)', async () => {
    const { room, a, b } = await racing();
    await packBox(room, a);
    await packBox(room, b);
    (room as unknown as { simulation?: { pause(): void } }).simulation?.pause();
    // The RNG picks from the carriers in join order [a, b]; make it pick the last one, the later joiner.
    const picked: string[][] = [];
    (room as unknown as { rng: { pick<T>(xs: readonly T[]): T } }).rng = {
      pick: <T>(xs: readonly T[]): T => {
        picked.push(xs.map((x) => (x as unknown as PlayerState).sessionId));
        return xs[xs.length - 1] as T;
      },
    };
    moveTo(a, office);
    moveTo(b, { x: office.x, y: office.y + 40 });
    room.tick();
    expect(picked).toEqual([[a.conn.sessionId, b.conn.sessionId]]);
    expect(room.state.phase).toBe('roundResults');
    expect(room.state.raceWinner).toBe(b.conn.sessionId);
    expect(room.state.raceStolen).toBe(false);
  });
});
