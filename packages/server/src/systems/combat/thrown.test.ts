// Thrown weapons and the projectile system without a network (M4-3): eggs (splash) and the shaken soda
// bottle (fizz burst with area knockback), flight, walls, range, teammates, reflect and the schema mirror.
// Same setup as CombatSystem.test.ts: players by hand on open floor right of van 0's spawn (≥ 370 px open).
import {
  Button,
  defaultThemeId,
  getTheme,
  getWeaponCatalogue,
  loadConfig,
  playerHalfSize,
  vanSpawn,
  type CombatEventWire,
  type InputFrame,
  type MapModel,
  type ProjectileStats,
} from '@keke/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadThemeMap } from '../../maps';
import { GameState, PlayerState } from '../../schema/GameState';
import { CombatSystem } from './CombatSystem';
import { meleeBehaviour } from './melee';
import { ProjectileSystem } from './projectiles';
import { thrownBehaviour } from './thrown';
import type { BehaviourModule } from './types';

const config = loadConfig({ ...loadConfig(), roundStartProtectionSeconds: 0 });
const weapons = getWeaponCatalogue();
const TICK = 1 / config.serverTickHz;
const MAX = config.maxHp;
let map: MapModel;

beforeAll(() => {
  map = loadThemeMap(getTheme(defaultThemeId));
});

function projectileOf(id: string): ProjectileStats {
  const def = weapons.require(id);
  if (def.behaviour !== 'thrown') throw new Error(`${id} is not thrown`);
  return def.projectile;
}

interface Setup {
  state: GameState;
  combat: CombatSystem;
  projectiles: ProjectileSystem;
  events: CombatEventWire[];
  players: PlayerState[];
  now: number;
}

/** Players at van 0's spawn + offsets; `extra` modules run before the default ones (e.g. a test block). */
function setup(
  at: readonly [number, number][],
  { teams = false, team = (_i: number): number => 0, extra = [] as BehaviourModule[] } = {},
): Setup {
  const state = new GameState();
  state.settings.teams = teams;
  const base = vanSpawn(map, 0, playerHalfSize(config));
  const players = at.map(([dx, dy], i) => {
    const p = new PlayerState();
    p.sessionId = `p${i}`;
    p.joinOrder = i;
    p.van = 0;
    p.team = team(i);
    p.x = base.x + dx;
    p.y = base.y + dy;
    state.players.set(p.sessionId, p);
    return p;
  });
  const projectiles = new ProjectileSystem(state);
  const events: CombatEventWire[] = [];
  const combat = new CombatSystem(state, config, map, (e) => events.push(e), { onKo: () => undefined }, 1, [
    ...extra,
    meleeBehaviour,
    projectiles,
    thrownBehaviour(projectiles),
  ]);
  combat.startRound(players);
  return { state, combat, projectiles, events, players, now: 0 };
}

let seq = 0;
function frame(buttons: number, aim: number): InputFrame {
  return { seq: ++seq, move: { x: 0, y: 0 }, aim, buttons };
}

function tick(s: Setup, frames: () => void = () => undefined): void {
  s.now += TICK;
  s.combat.beginTick(s.now);
  frames();
  s.combat.tick(s.now);
}

function idle(s: Setup, seconds: number): void {
  const until = s.now + seconds;
  while (s.now < until - 1e-9) tick(s);
}

function give(s: Setup, p: PlayerState, weapon: string): void {
  for (let i = 0; i < 500 && p.weapon !== weapon; i++) s.combat.onPickup(p.sessionId, 'item');
  expect(p.weapon).toBe(weapon);
}

function throwOne(s: Setup, p: PlayerState, aim = 0): void {
  tick(s, () => s.combat.afterFrame(p, frame(Button.Attack, aim), Button.Attack));
}

const hits = (s: Setup) =>
  s.events
    .filter((e) => e.type === 'hit')
    .map((e) => e.payload as { target: string; damage: number; weapon: string });

describe('thrown weapons (M4-3)', () => {
  it('egg: flies, hits the first body on its path for 8, spends one egg, then leaves the state', () => {
    const s = setup([
      [0, 0],
      [120, 0],
      [200, 0],
    ]);
    const [a, b, c] = s.players as [PlayerState, PlayerState, PlayerState];
    give(s, a, 'egg_carton');
    throwOne(s, a);
    expect(a.weaponUses).toBe(5);
    expect(s.state.projectiles.size).toBe(1);
    const shot = [...s.state.projectiles.values()][0];
    expect(shot?.weapon).toBe('egg_carton');
    expect(shot?.vx).toBeCloseTo(projectileOf('egg_carton').speedPxPerSecond);
    expect(b.hp).toBe(MAX);
    idle(s, 0.3);
    expect(b.hp).toBe(MAX - projectileOf('egg_carton').damage);
    expect(c.hp).toBe(MAX);
    expect(hits(s)).toEqual([expect.objectContaining({ target: 'p1', weapon: 'egg_carton', damage: 8 })]);
    expect(s.projectiles.active()).toHaveLength(0);
    // Shown landed for a tick, then gone.
    idle(s, 2 * TICK);
    expect(s.state.projectiles.size).toBe(0);
  });

  it('egg: the splash (r = 32 px) hits bodies next to the impact too, not the thrower', () => {
    const s = setup([
      [0, 0],
      [120, 0],
      [120, 30],
      [120, 70],
    ]);
    const [a, b, near, far] = s.players as [PlayerState, PlayerState, PlayerState, PlayerState];
    give(s, a, 'egg_carton');
    throwOne(s, a);
    idle(s, 0.4);
    expect(b.hp).toBe(MAX - 8);
    expect(near.hp).toBe(MAX - 8);
    expect(far.hp).toBe(MAX);
    expect(a.hp).toBe(MAX);
    expect(hits(s).map((h) => h.target)).toEqual(['p1', 'p2']);
  });

  it('an egg that hits nothing lands at the end of its range and splashes there', () => {
    const range = projectileOf('egg_carton').rangePx;
    // 30 px off the path: missed in flight (6 + 10 px reach), inside the splash where it lands.
    const s = setup([
      [0, 0],
      [range, 30],
    ]);
    const [a, b] = s.players as [PlayerState, PlayerState];
    give(s, a, 'egg_carton');
    throwOne(s, a);
    const landedAt: number[] = [];
    for (let i = 0; i < 40 && landedAt.length === 0; i++) {
      tick(s);
      for (const p of s.state.projectiles.values()) if (p.landed) landedAt.push(p.x);
    }
    expect(landedAt[0]).toBeCloseTo(a.x + range, 0);
    expect(b.hp).toBe(MAX - 8);
  });

  it('a wall stops a projectile before its range', () => {
    // Van 0's spawn has a wall 96 px to the left.
    const s = setup([[0, 0]]);
    const [a] = s.players as [PlayerState];
    give(s, a, 'egg_carton');
    throwOne(s, a, Math.PI);
    let landedX: number | null = null;
    for (let i = 0; i < 40 && landedX === null; i++) {
      tick(s);
      for (const p of s.state.projectiles.values()) if (p.landed) landedX = p.x;
    }
    expect(landedX).not.toBeNull();
    expect(a.x - (landedX ?? 0)).toBeLessThan(96);
    expect(a.x - (landedX ?? 0)).toBeGreaterThan(80);
  });

  it('soda: 6 damage and a fizz burst (r = 64 px) that shoves everyone away from the impact', () => {
    const s = setup([
      [0, 0],
      [120, 0],
      [120, -50],
    ]);
    const [a, b, side] = s.players as [PlayerState, PlayerState, PlayerState];
    give(s, a, 'soda_bottle');
    expect(a.weaponUses).toBe(2);
    const bx = b.x;
    const sideY = side.y;
    throwOne(s, a);
    idle(s, 0.6);
    expect(b.hp).toBe(MAX - 6);
    expect(side.hp).toBe(MAX - 6);
    // The direct hit flies on along the throw; the bystander is pushed up, away from the burst.
    expect(b.x).toBeGreaterThan(bx + 40);
    expect(side.y).toBeLessThan(sideY - 40);
    expect(a.weaponUses).toBe(1);
  });

  it('soda: the burst does not reach through a wall into the next aisle (M4 review F3)', () => {
    // Find a wall one tile thick with 4 open tiles to its left and 2 to its right, over 3 rows.
    const grid = map.collision;
    const open = (tx: number, ty: number) => !grid.isSolid(tx, ty);
    let found: { tx: number; ty: number } | null = null;
    for (let ty = 2; ty < grid.height - 2 && !found; ty++) {
      for (let tx = 5; tx < grid.width - 3 && !found; tx++) {
        const rowsOk = [-1, 0, 1].every(
          (dy) =>
            !open(tx, ty + dy) &&
            [1, 2, 3, 4].every((dx) => open(tx - dx, ty + dy)) &&
            [1, 2].every((dx) => open(tx + dx, ty + dy)),
        );
        if (rowsOk) found = { tx, ty };
      }
    }
    if (!found) throw new Error('no thin wall on the map');
    const t = grid.tileSize;
    const base = vanSpawn(map, 0, playerHalfSize(config));
    const wallLeft = found.tx * t;
    const y = found.ty * t + t / 2;
    // Thrower 3.5 tiles left of the wall; the victim's centre 10 px past the wall's right face.
    const s = setup([
      [wallLeft - 3.5 * t - base.x, y - base.y],
      [wallLeft + t + 10 - base.x, y - base.y],
    ]);
    const [a, b] = s.players as [PlayerState, PlayerState];
    give(s, a, 'soda_bottle');
    throwOne(s, a);
    idle(s, 0.8);
    expect(s.events.some((e) => e.type === 'attack')).toBe(true);
    expect(b.hp, 'no splash through the wall').toBe(MAX);
  });

  it('respects the cooldown: one throw per press, a press during the cooldown is lost', () => {
    const s = setup([[0, 0]]);
    const [a] = s.players as [PlayerState];
    give(s, a, 'soda_bottle'); // 0.8 s cooldown
    throwOne(s, a);
    throwOne(s, a);
    expect(a.weaponUses).toBe(1);
    tick(s, () => s.combat.afterFrame(a, frame(Button.Attack, 0), 0)); // held, no new press
    expect(s.projectiles.active().length + s.state.projectiles.size).toBeGreaterThan(0);
    expect(a.weaponUses).toBe(1);
  });

  it('passes through teammates and the splash ignores them (Teams on); enemies behind are hit', () => {
    const s = setup(
      [
        [0, 0],
        [60, 0],
        [140, 0],
      ],
      { teams: true, team: (i) => (i < 2 ? 1 : 2) },
    );
    const [a, mate, enemy] = s.players as [PlayerState, PlayerState, PlayerState];
    give(s, a, 'soda_bottle');
    throwOne(s, a);
    idle(s, 0.6);
    expect(mate.hp).toBe(MAX);
    expect(enemy.hp).toBe(MAX - 6);
  });

  it('team 0 players hit each other (free-for-all)', () => {
    const s = setup([
      [0, 0],
      [60, 0],
    ]);
    const [a, b] = s.players as [PlayerState, PlayerState];
    give(s, a, 'egg_carton');
    throwOne(s, a);
    idle(s, 0.3);
    expect(b.hp).toBe(MAX - 8);
  });

  it("a module can reflect a projectile from adjustHit: it flies back as the blocker's", () => {
    let projectiles: ProjectileSystem | null = null;
    const mirror: BehaviourModule = {
      name: 'test-mirror',
      modes: [],
      adjustHit(_ctx, hit) {
        if (hit.delivery === 'projectile' && hit.target === 'p1' && hit.projectile !== undefined) {
          projectiles?.reflect(hit.projectile, hit.target);
          return null;
        }
        return hit;
      },
    };
    const s = setup(
      [
        [0, 0],
        [120, 0],
      ],
      { extra: [mirror] },
    );
    projectiles = s.projectiles;
    const [a, b] = s.players as [PlayerState, PlayerState];
    give(s, a, 'egg_carton');
    throwOne(s, a);
    idle(s, 0.25);
    expect(b.hp).toBe(MAX);
    idle(s, 0.5);
    expect(a.hp).toBe(MAX - 8);
    expect(hits(s)).toEqual([expect.objectContaining({ target: 'p0' })]);
    expect(s.events.find((e) => e.type === 'hit')?.payload).toMatchObject({ source: { id: 'p1' } });
  });

  it('a spawner can replace the impact (e.g. a different on-hit effect)', () => {
    const s = setup([
      [0, 0],
      [100, 0],
    ]);
    const seen: string[] = [];
    s.projectiles.spawn({
      owner: 'p0',
      weapon: 'egg_carton',
      x: s.players[0]?.x ?? 0,
      y: s.players[0]?.y ?? 0,
      aim: 0,
      stats: projectileOf('egg_carton'),
      onImpact: (_ctx, hit) => seen.push(hit.impact.kind === 'body' ? hit.impact.id : hit.impact.kind),
    });
    idle(s, 0.4);
    expect(seen).toEqual(['p1']);
    expect(s.players[1]?.hp).toBe(MAX);
  });

  it("a KO'd thrower's projectiles keep flying; a thrower who leaves takes them along; reset clears all", () => {
    const s = setup([
      [0, 0],
      [300, 0],
    ]);
    const [a] = s.players as [PlayerState, PlayerState];
    give(s, a, 'egg_carton');
    throwOne(s, a);
    s.projectiles.removePlayer('p0', true);
    expect(s.projectiles.active()).toHaveLength(1);
    s.combat.removePlayer(a);
    expect(s.projectiles.active()).toHaveLength(0);
    expect(s.state.projectiles.size).toBe(0);
    give(s, s.players[1] as PlayerState, 'egg_carton');
    throwOne(s, s.players[1] as PlayerState, Math.PI);
    expect(s.state.projectiles.size).toBe(1);
    s.combat.reset();
    expect(s.state.projectiles.size).toBe(0);
  });
});
