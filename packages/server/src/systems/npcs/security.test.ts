// Security guard (M5-4): patrol and post, chasing Wanted players it can see, the stun swing that spares
// bystanders, losing sight, and the staff-door guard's leash and return to its post.
import {
  aabbOverlapsSolid,
  getNpcCatalogue,
  loadNpcCatalogue,
  npcCatalogueForMap,
  npcCount,
  playerHalfSize,
  type CombatEventWire,
  type HitMessage,
  type Vec2,
} from '@keke/shared';
import { describe, expect, it } from 'vitest';
import { config, must, spot } from '../combat/testKit';
import { createSecurityBehaviour } from './security';
import { npcIdle, npcSetup, npcTick, putNpc, type NpcSetup } from './testKit';

const guard = getNpcCatalogue().require('security');
if (guard.behaviour !== 'security') throw new Error('security is not a guard');
const baton = guard.attack.melee;
const sight = guard.chase.sightRangeTiles * config.tileSize;

function hitsOn(events: CombatEventWire[], target: string): HitMessage[] {
  return events
    .filter((e) => e.type === 'hit')
    .map((e) => e.payload as HitMessage)
    .filter((h) => h.target === target);
}

/** Guards only, so stockers never get in the way. */
function guards(players: number, at?: (i: number) => Vec2): NpcSetup {
  return npcSetup(players, at, { modules: [createSecurityBehaviour()] });
}

/** The first floor spot (player-sized) at least `min` px from `from`, scanning outward along x then y. */
function floorNear(s: NpcSetup, from: Vec2, min: number, max = min + 64): Vec2 {
  const half = playerHalfSize(config);
  for (let r = min; r <= max; r += 4) {
    for (const [dx, dy] of [
      [r, 0],
      [-r, 0],
      [0, r],
      [0, -r],
    ] as const) {
      const at = { x: from.x + dx, y: from.y + dy };
      if (!aabbOverlapsSolid(s.live.collision, at, half)) return at;
    }
  }
  throw new Error(`no floor near ${from.x},${from.y}`);
}

function postedGuard(s: NpcSetup): string {
  return must(
    [...s.state.npcs.keys()].find((id) => s.npcs.npc(id)?.placement.post),
    'posted guard',
  );
}

describe('security guard', () => {
  it('spawns from the default modules: one guard on the staff-door post, the rest patrol', () => {
    const s = npcSetup(2);
    const ids = [...s.state.npcs.values()].filter((n) => n.behaviour === 'security').map((n) => n.id);
    expect(ids).toHaveLength(npcCount(guard.count, 2));
    expect(s.npcs.behaviours).toContain('security');
    expect(s.npcs.guards().map((g) => g.id)).toEqual(ids);

    const g = guards(2);
    const posted = postedGuard(g);
    const at = new Map([...g.state.npcs.values()].map((n) => [n.id, { x: n.x, y: n.y }]));
    npcIdle(g, 10);
    for (const n of g.state.npcs.values()) {
      const from = must(at.get(n.id));
      const moved = Math.hypot(n.x - from.x, n.y - from.y);
      if (n.id === posted) {
        expect(n.mode).toBe('post');
        expect(moved).toBe(0);
      } else {
        expect(['patrol', 'watch']).toContain(n.mode);
        expect(moved).toBeGreaterThan(32);
      }
    }
  });

  it('ignores players who are not Wanted, chases a Wanted one it sees and stuns them', () => {
    const s = guards(1);
    const a = must(s.players[0]);
    const id = must([...s.state.npcs.keys()].find((k) => k !== postedGuard(s)));
    putNpc(s, id, floorNear(s, a, 120));
    const npc = must(s.state.npcs.get(id));

    npcIdle(s, 1);
    expect(npc.target).toBe('');
    expect(hitsOn(s.events, a.sessionId)).toHaveLength(0);

    s.wanted.push(a.sessionId);
    npcTick(s);
    expect(npc.mode).toBe('chase');
    expect(npc.target).toBe(a.sessionId);
    npcIdle(s, 2);
    const hits = hitsOn(s.events, a.sessionId);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]).toMatchObject({ source: { kind: 'npc', id }, damage: baton.damage });
    expect(s.npcEvents.some((e) => e.type === 'npcAttack')).toBe(true);
    // One swing per cooldown, not one per tick.
    expect(hits.length).toBeLessThanOrEqual(Math.ceil(2 / guard.attack.cooldownSeconds) + 1);
  });

  it('lets a Wanted player go in a release zone, searches where it last saw them, then gives up (P4-2)', () => {
    const plain = guards(1);
    const zone = must(
      plain.live.zoneAt(must(plain.players[0]).x, must(plain.players[0]).y),
      'zone at the van',
    ).id;
    const raw = JSON.parse(JSON.stringify({ npcs: getNpcCatalogue().npcs })) as {
      npcs: { behaviour: string; mapZones?: unknown }[];
    };
    for (const n of raw.npcs)
      if (n.behaviour === 'security') n.mapZones = { kespro: { releaseZones: [zone] } };
    const catalogue = npcCatalogueForMap(loadNpcCatalogue(raw, 'test'), 'kespro');
    const s = npcSetup(1, undefined, { modules: [createSecurityBehaviour()], catalogue });
    const a = must(s.players[0]);
    const id = must([...s.state.npcs.keys()].find((k) => k !== postedGuard(s)));
    putNpc(s, id, floorNear(s, a, 120));
    const npc = must(s.state.npcs.get(id));

    s.wanted.push(a.sessionId);
    npcIdle(s, 2);
    expect(npc.mode).not.toBe('chase');
    expect(hitsOn(s.events, a.sessionId)).toHaveLength(0);
    npcIdle(s, guard.chase.loseSightSeconds + 0.5);
    expect(npc.target).toBe('');
  });

  it('the stun lands: the Wanted player is stunned right after the swing', () => {
    const s = guards(1);
    const a = must(s.players[0]);
    const id = must([...s.state.npcs.keys()].find((k) => k !== postedGuard(s)));
    putNpc(s, id, floorNear(s, a, 30));
    s.wanted.push(a.sessionId);
    let stunned = false;
    npcIdle(s, 1, () => (stunned ||= a.stunned));
    expect(stunned).toBe(true);
  });

  it('spares a bystander standing in the swing arc', () => {
    const s = guards(2, (i) => spot(i * 16));
    const [a, b] = [must(s.players[0]), must(s.players[1])];
    const id = must([...s.state.npcs.keys()].find((k) => k !== postedGuard(s)));
    putNpc(s, id, floorNear(s, a, 30));
    s.wanted.push(a.sessionId);
    npcIdle(s, 3);
    expect(hitsOn(s.events, a.sessionId).length).toBeGreaterThan(0);
    expect(hitsOn(s.events, b.sessionId)).toHaveLength(0);
  });

  it('stops chasing when the player is no longer Wanted', () => {
    const s = guards(1);
    const a = must(s.players[0]);
    const id = must([...s.state.npcs.keys()].find((k) => k !== postedGuard(s)));
    putNpc(s, id, floorNear(s, a, 200));
    const npc = must(s.state.npcs.get(id));
    s.wanted.push(a.sessionId);
    npcIdle(s, 0.3);
    expect(npc.mode).toBe('chase');
    s.wanted.length = 0;
    npcTick(s);
    expect(npc.target).toBe('');
    expect(['patrol', 'watch']).toContain(npc.mode);
  });

  it('a Wanted player out of sight is searched for, then given up after loseSightSeconds', () => {
    const s = guards(1);
    const a = must(s.players[0]);
    const id = must([...s.state.npcs.keys()].find((k) => k !== postedGuard(s)));
    putNpc(s, id, floorNear(s, a, 150));
    const npc = must(s.state.npcs.get(id));
    s.wanted.push(a.sessionId);
    npcTick(s);
    expect(npc.mode).toBe('chase');
    // The player vanishes far away (out of sight range).
    const away = floorNear(s, a, sight * 2.5, sight * 4);
    a.x = away.x;
    a.y = away.y;
    npcTick(s);
    expect(npc.mode).toBe('search');
    expect(npc.target).toBe(a.sessionId);
    npcIdle(s, guard.chase.loseSightSeconds + 0.2);
    expect(npc.target).toBe('');
    expect(['patrol', 'watch']).toContain(npc.mode);
  });

  it('the posted guard only chases near its post and walks back to it afterwards', () => {
    const s = guards(1);
    const a = must(s.players[0]);
    const id = postedGuard(s);
    const npc = must(s.state.npcs.get(id));
    const post = { x: npc.x, y: npc.y };

    // Wanted at the van, far from the staff door: the door guard stays.
    s.wanted.push(a.sessionId);
    npcIdle(s, 1);
    expect(npc.mode).toBe('post');
    expect({ x: npc.x, y: npc.y }).toEqual(post);

    // Close to the post: it goes after them.
    const near = floorNear(s, post, 96);
    a.x = near.x;
    a.y = near.y;
    npcTick(s);
    expect(npc.mode).toBe('chase');
    npcIdle(s, 1);
    expect(hitsOn(s.events, a.sessionId).length).toBeGreaterThan(0);
    expect(Math.hypot(npc.x - post.x, npc.y - post.y)).toBeGreaterThan(8);

    // Wanted ends: back to the post.
    s.wanted.length = 0;
    npcTick(s);
    expect(npc.mode).toBe('return');
    npcIdle(s, 5);
    expect(npc.mode).toBe('post');
    expect(Math.hypot(npc.x - post.x, npc.y - post.y)).toBeLessThanOrEqual(config.tileSize / 4);
  });

  it('forgets a player who leaves', () => {
    const s = guards(1);
    const a = must(s.players[0]);
    const id = must([...s.state.npcs.keys()].find((k) => k !== postedGuard(s)));
    putNpc(s, id, floorNear(s, a, 150));
    const npc = must(s.state.npcs.get(id));
    s.wanted.push(a.sessionId);
    npcTick(s);
    expect(npc.target).toBe(a.sessionId);
    s.npcs.removePlayer(a.sessionId);
    s.state.players.delete(a.sessionId);
    s.wanted.length = 0;
    npcTick(s);
    expect(npc.target).toBe('');
  });
});
