// Store workers and Wanted through a real room (M5-3): NPCs in the synced state, a punch on a stocker
// (npcHit broadcast, Wanted for npc_damage, the stocker swinging back), the staff-only zone, and the
// lobby clearing it all. M5 review F4/F5: a fight witnessed by a guard (and hidden by a wall or a cart),
// and a forklift running over a carrier through the real item drop.
import { ColyseusTestServer } from '@colyseus/testing';
import type { Room as ClientRoom } from '@colyseus/sdk';
import {
  Button,
  ClientMessage,
  clearLine,
  CombatEventMessage,
  ItemEventMessage,
  NpcEventMessage,
  aabbOverlapsSolid,
  defaultThemeId,
  getTheme,
  inWantedZone,
  loadConfig,
  playerHalfSize,
  vanSpawn,
  type DropMessage,
  type HitMessage,
  type InputFrame,
  type NpcHitMessage,
  type Vec2,
  type WantedMessage,
} from '@keke/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGameServer } from './app';
import { loadThemeMap, singleMapRegistry } from './maps';
import type { GameRoom } from './rooms/GameRoom';
import type { CombatSystem } from './systems/combat/CombatSystem';
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
/** The staff_only floor spot nearest `to` (the door guard's post). */
function staffOnlySpotNear(to: Vec2): Vec2 {
  const zone = map.zones.find((z) => z.wantedOnEnter);
  if (!zone) throw new Error('no wantedOnEnter zone');
  const ts = map.tileSize;
  const half = playerHalfSize(config);
  let best: Vec2 | undefined;
  for (let y = zone.bounds.minY + ts / 2; y < zone.bounds.maxY; y += ts) {
    for (let x = zone.bounds.minX + ts / 2; x < zone.bounds.maxX; x += ts) {
      const p = { x, y };
      if (!inWantedZone(map.zones, x, y) || aabbOverlapsSolid(map.collision, p, half)) continue;
      if (!best || Math.hypot(x - to.x, y - to.y) < Math.hypot(best.x - to.x, best.y - to.y)) best = p;
    }
  }
  if (!best) throw new Error('no floor in staff_only');
  return best;
}

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

  async function playingRoom(count = 1): Promise<{ room: GameRoom; p: Player; players: Player[] }> {
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
      for (const type of [
        ...Object.values(CombatEventMessage),
        ...Object.values(NpcEventMessage),
        ...Object.values(ItemEventMessage),
      ]) {
        conn.onMessage(type, (payload: unknown) => p.events.push({ type, payload }));
      }
      return p;
    });
    for (const c of conns) c.send(ClientMessage.ready, { ready: true });
    await waitFor(() => [...room.state.players.values()].every((pl) => pl.ready));
    host.send(ClientMessage.start);
    await waitFor(() => room.state.phase === 'playing');
    return { room, p: players[0] as Player, players };
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

  it('the staff-door guard goes after a player in staff_only and stuns them', async () => {
    const { room, p } = await playingRoom();
    const guards = [...room.state.npcs.values()].filter((n) => n.behaviour === 'security');
    expect(guards.length).toBeGreaterThanOrEqual(1);
    const posted = guards.find((n) => room.npcSystem.npc(n.id)?.placement.post);
    if (!posted) throw new Error('no posted guard');
    expect(posted.mode).toBe('post');
    const at = staffOnlySpotNear(posted);
    p.me.x = at.x;
    p.me.y = at.y;
    await waitFor(() => p.me.wanted);
    await waitFor(() => posted.target === p.conn.sessionId);
    await waitFor(
      () => p.events.some((e) => e.type === 'hit' && (e.payload as HitMessage).source.id === posted.id),
      8000,
    );
    expect(p.me.hp).toBeLessThan(config.maxHp);
  });

  it('a KO ends Wanted, also one held by standing in staff_only (playtest 1)', async () => {
    const { room, p } = await playingRoom();
    const at = staffOnlySpot();
    p.me.x = at.x;
    p.me.y = at.y;
    await waitFor(() => p.me.wanted);
    const combat = (room as unknown as { combat: CombatSystem }).combat;
    await waitFor(() =>
      combat.externalHit({
        source: { kind: 'hazard', id: 'test' },
        target: p.conn.sessionId,
        damage: 999,
        delivery: 'melee',
      }),
    );
    expect(p.me.alive).toBe(false);
    await waitFor(() => !p.me.wanted);
    expect(p.me.wantedIn).toBe(0);
    await waitFor(() => p.events.some((e) => e.type === 'wantedEnded'));
    // Respawned at the van: no new timer from having left the zone by KO.
    await waitFor(() => p.me.alive, config.respawnSeconds * 1000 + 2000);
    await new Promise((r) => setTimeout(r, 200));
    expect(p.me.wanted).toBe(false);
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

  describe('witnessed fights and forklifts (M5 review F4, F5)', () => {
    const ts = map.tileSize;
    const open = (tx: number, ty: number): boolean =>
      !map.collision.isSolid(tx, ty) && !inWantedZone(map.zones, (tx + 0.5) * ts, (ty + 0.5) * ts);

    /** Leftmost tile of a run of 6 open tiles (outside wanted zones) over 3 rows. */
    function openRun(): { tx: number; ty: number } {
      for (let ty = 2; ty < map.collision.height - 2; ty++) {
        for (let tx = 1; tx < map.collision.width - 7; tx++) {
          if ([-1, 0, 1].every((dy) => [0, 1, 2, 3, 4, 5].every((dx) => open(tx + dx, ty + dy)))) {
            return { tx, ty };
          }
        }
      }
      throw new Error('no open run on the map');
    }

    /** Left edge (px) and row of a one-tile wall with 3 open tiles each side, over 3 rows. */
    function thinWall(): { tx: number; ty: number } {
      for (let ty = 2; ty < map.collision.height - 2; ty++) {
        for (let tx = 4; tx < map.collision.width - 4; tx++) {
          const ok = [-1, 0, 1].every(
            (dy) =>
              map.collision.isSolid(tx, ty + dy) &&
              [1, 2, 3].every((dx) => open(tx - dx, ty + dy) && open(tx + dx, ty + dy)),
          );
          if (ok) return { tx, ty };
        }
      }
      throw new Error('no thin wall on the map');
    }

    const centre = (tx: number, ty: number): Vec2 => ({ x: (tx + 0.5) * ts, y: (ty + 0.5) * ts });

    /** Every guard stands at `guard`; `a` (at `at`) punches `b` just right of them. */
    async function fight(room: GameRoom, a: Player, b: Player, guard: Vec2, at: Vec2): Promise<void> {
      const guards = [...room.state.npcs.values()].filter((n) => n.behaviour === 'security');
      expect(guards.length).toBeGreaterThanOrEqual(1);
      for (const g of guards) {
        const npc = room.npcSystem.npc(g.id);
        if (!npc) throw new Error(`no ${g.id}`);
        npc.state.x = guard.x;
        npc.state.y = guard.y;
      }
      a.me.x = at.x;
      a.me.y = at.y;
      b.me.x = at.x + 24;
      b.me.y = at.y;
      await press(a, Button.Attack, 0);
      await waitFor(() => b.me.hp < config.maxHp);
      // The wanted rules run at the end of the tick that landed the hit; give it a few more.
      await new Promise((r) => setTimeout(r, 200));
    }

    const witnessed = (p: Player): WantedMessage[] =>
      p.events
        .filter((e) => e.type === 'wanted')
        .map((e) => e.payload as WantedMessage)
        .filter((w) => w.reason === 'witnessed');

    it('a guard who sees a punch makes the attacker Wanted (witnessed), not the victim', async () => {
      const { room, players } = await playingRoom(2);
      const [a, b] = players as [Player, Player];
      const run = openRun();
      const guard = centre(run.tx, run.ty);
      const at = centre(run.tx + 3, run.ty);
      expect(clearLine(map.collision, guard, at)).toBe(true);
      await fight(room, a, b, guard, at);
      await waitFor(() => a.me.wanted);
      await waitFor(() => witnessed(a).length > 0);
      expect(witnessed(a)[0]).toMatchObject({ player: a.conn.sessionId, refreshed: false });
      expect(b.me.wanted).toBe(false);
    });

    it('a wall between the guard and the fight: nobody becomes Wanted', async () => {
      const { room, players } = await playingRoom(2);
      const [a, b] = players as [Player, Player];
      const wall = thinWall();
      const guard = centre(wall.tx - 2, wall.ty);
      const at = centre(wall.tx + 1, wall.ty);
      await fight(room, a, b, guard, at);
      expect(witnessed(a)).toEqual([]);
      expect(b.me.wanted).toBe(false);
    });

    it('a parked stock cart between the guard and the fight hides it like a wall (F5)', async () => {
      const { room, players } = await playingRoom(2);
      const [a, b] = players as [Player, Player];
      const run = openRun();
      room.npcSystem.parkCartForTest('stocker_1', { tx: run.tx + 1, ty: run.ty - 1, w: 1, h: 3 }, 30);
      const guard = centre(run.tx, run.ty);
      const at = centre(run.tx + 3, run.ty);
      await fight(room, a, b, guard, at);
      expect(witnessed(a)).toEqual([]);
      expect(a.me.wanted).toBe(false);
    });

    it('wanted refreshes go only to the Wanted player, at most once a second (F8)', async () => {
      const { room, players } = await playingRoom(2);
      const [a, b] = players as [Player, Player];
      const start = vanSpawn(map, 0, playerHalfSize(config));
      const npc = room.npcSystem.npc('stocker_1');
      if (!npc) throw new Error('no stocker_1');
      const began = Date.now();
      let landed = 0;
      for (let i = 0; i < 5; i++) {
        a.me.x = start.x;
        a.me.y = start.y;
        npc.state.x = start.x + 22;
        npc.state.y = start.y;
        const before = npc.state.hp;
        await press(a, Button.Attack, 0);
        await press(a, 0, 0);
        await waitFor(() => npc.state.hp < before, 1000).then(
          () => landed++,
          () => undefined,
        );
        await new Promise((r) => setTimeout(r, 420)); // fist cooldown 0.4 s
      }
      const elapsed = (Date.now() - began) / 1000;
      expect(landed).toBeGreaterThanOrEqual(3);
      await waitFor(() => a.me.wanted);
      const refreshes = (p: Player): number =>
        p.events.filter((e) => e.type === 'wanted' && (e.payload as WantedMessage).refreshed).length;
      const starts = (p: Player): number =>
        p.events.filter((e) => e.type === 'wanted' && !(e.payload as WantedMessage).refreshed).length;
      // Everyone hears that a became Wanted; only a hears the refreshes, and not one per punch.
      await waitFor(() => starts(b) === 1);
      expect(starts(a)).toBe(1);
      expect(refreshes(b)).toBe(0);
      expect(refreshes(a)).toBeGreaterThanOrEqual(1);
      expect(refreshes(a)).toBeLessThanOrEqual(Math.ceil(elapsed));
      expect(refreshes(a)).toBeLessThan(landed);
    }, 15000);

    it('a moving forklift runs over a carrier: 25 damage, knocked down, item dropped (forklift)', async () => {
      const { room, p } = await playingRoom();
      const target = room.state.items.get(String(p.me.target));
      if (!target) throw new Error('no target');
      p.me.x = target.x;
      p.me.y = target.y;
      await press(p, Button.Interact);
      await waitFor(() => p.me.carrying !== 0);
      const carried = p.me.carrying;
      const forklift = [...room.state.npcs.values()].find((n) => n.behaviour === 'forklift');
      if (!forklift) throw new Error('no forklift');
      const ranOver = (): boolean =>
        p.events.some((e) => e.type === 'hit' && (e.payload as HitMessage).source.kind === 'hazard');
      // Stand just ahead of it while it drives (it stops at corners, so try again until it hits).
      const until = Date.now() + 8000;
      while (!ranOver() && Date.now() < until) {
        if (forklift.mode === 'drive') {
          p.me.x = forklift.x + Math.cos(forklift.aim) * 20;
          p.me.y = forklift.y + Math.sin(forklift.aim) * 20;
        }
        await new Promise((r) => setTimeout(r, 60));
      }
      expect(ranOver()).toBe(true);
      const hit = p.events.find((e) => e.type === 'hit' && (e.payload as HitMessage).source.kind === 'hazard')
        ?.payload as HitMessage;
      expect(hit).toMatchObject({ source: { id: forklift.id }, target: p.conn.sessionId, damage: 25 });
      expect(p.me.hp).toBe(config.maxHp - 25);
      await waitFor(() => p.events.some((e) => e.type === 'drop'));
      const drop = p.events.find((e) => e.type === 'drop')?.payload as DropMessage;
      expect(drop).toMatchObject({ player: p.conn.sessionId, reason: 'forklift', item: { id: carried } });
      expect(p.me.carrying).toBe(0);
      expect(room.state.items.get(String(carried))?.state).toBe('loose');
    }, 15000);
  });
});
