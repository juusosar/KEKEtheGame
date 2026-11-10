// The server projectile system (§7, §15.3; M4-3). A behaviour module with no attack mode of its own: any
// module spawns a projectile with `spawn` (thrown eggs and soda here, the champagne cork in M4-6), and every
// tick this moves each one with the shared `stepProjectile`, lands it on the first body, wall or the end of
// its range, and mirrors it into `GameState.projectiles` so clients can draw it.
//
// Impact, by default: the body it hit (if any) takes `damage` and is shoved along the flight; then, when the
// stats have an `area`, everyone else inside it takes `damage` too and is shoved away from the impact point
// (egg splash, soda fizz burst). A spawner may replace this with its own `onImpact`.
//
// Teammates, the thrower, KO'd and spawn-protected bodies are not on the path at all: projectiles pass
// through them, and areas ignore them (`canHit`, §3.3).
//
// Reflect (pan block, M4-6): a direct hit carries `projectile: id` in its CombatHit. A module's `adjustHit`
// may call `reflect(id, blocker)` and return null; the projectile then flies back from the impact point with
// the blocker as its owner and its full range again. A cancelled hit without a reflect ends the projectile
// with no splash.
import {
  aimDirection,
  areaTargets,
  knockbackDirection,
  reflectFlight,
  stepProjectile,
  type HitSource,
  type ProjectileCandidate,
  type ProjectileFlight,
  type ProjectileImpact,
  type ProjectileStats,
  type Vec2,
} from '@keke/shared';
import { ProjectileState, type GameState } from '../../schema/GameState';
import type { BehaviourModule, CombatContext } from './types';

/** What a module asks for when it fires a projectile. */
export interface ProjectileSpec {
  /** Thrower's session id (hits are theirs; they are never hit by their own projectile). */
  readonly owner: string;
  /** Weapon id: reported on hits and drawn by clients. */
  readonly weapon: string;
  /** Start (the thrower's centre) and direction in radians. */
  readonly x: number;
  readonly y: number;
  readonly aim: number;
  readonly stats: ProjectileStats;
  /** Replaces the default impact (direct hit + area). */
  readonly onImpact?: (ctx: CombatContext, impact: ProjectileHit) => void;
}

/** A projectile that hit something, as `onImpact` sees it. */
export interface ProjectileHit {
  readonly id: number;
  readonly owner: string;
  readonly weapon: string;
  readonly stats: ProjectileStats;
  /** Impact point. */
  readonly at: Vec2;
  /** Unit vector of the flight. */
  readonly dir: Vec2;
  readonly impact: ProjectileImpact;
}

/** A projectile in flight, read-only (tests, M4-6). */
export interface ActiveProjectile {
  readonly id: number;
  readonly owner: string;
  readonly weapon: string;
  readonly flight: ProjectileFlight;
}

interface Live {
  id: number;
  owner: string;
  weapon: string;
  stats: ProjectileStats;
  flight: ProjectileFlight;
  onImpact?: ProjectileSpec['onImpact'];
  /** Bumped by `reflect`, so the impact code can tell a reflect from a plain cancel. */
  reflects: number;
}

const source = (id: string): HitSource => ({ kind: 'player', id });

export class ProjectileSystem implements BehaviourModule {
  readonly name = 'projectiles';
  readonly modes = [] as const;
  private readonly live = new Map<number, Live>();
  /** Landed last tick: shown at the impact point for one tick, removed at the start of the next. */
  private landed: number[] = [];
  private nextId = 1;

  constructor(private readonly state: GameState) {}

  /** Fires a projectile; it first moves in this tick's module ticks. Returns its id. */
  spawn(spec: ProjectileSpec): number {
    const id = this.nextId++;
    const live: Live = {
      id,
      owner: spec.owner,
      weapon: spec.weapon,
      stats: spec.stats,
      flight: {
        x: spec.x,
        y: spec.y,
        dir: aimDirection(spec.aim),
        speedPxPerSecond: spec.stats.speedPxPerSecond,
        rangePx: spec.stats.rangePx,
        travelledPx: 0,
        radiusPx: spec.stats.radiusPx,
      },
      onImpact: spec.onImpact,
      reflects: 0,
    };
    this.live.set(id, live);
    const s = new ProjectileState();
    s.id = id;
    s.weapon = spec.weapon;
    s.areaRadius = spec.stats.area?.radiusPx ?? 0;
    s.radius = spec.stats.radiusPx;
    this.state.projectiles.set(String(id), s);
    this.syncOne(live);
    return id;
  }

  /**
   * Turns a projectile around with `newOwner` as its thrower and its full range again (pan block). Call it
   * from `adjustHit` on the hit's `projectile` id, then cancel the hit. False if it is not in flight.
   */
  reflect(id: number, newOwner: string): boolean {
    const p = this.live.get(id);
    if (!p) return false;
    p.flight = reflectFlight(p.flight);
    p.owner = newOwner;
    p.reflects++;
    this.syncOne(p);
    return true;
  }

  /** Projectiles in flight, in spawn order. */
  active(): ActiveProjectile[] {
    return [...this.live.values()].map(({ id, owner, weapon, flight }) => ({ id, owner, weapon, flight }));
  }

  tick(ctx: CombatContext, dt: number): void {
    for (const id of this.landed) this.state.projectiles.delete(String(id));
    this.landed = [];
    for (const p of [...this.live.values()]) {
      const candidates = this.candidates(ctx, p.owner);
      const step = stepProjectile(ctx.map.collision, p.flight, dt, candidates, ctx.bodyRadius);
      p.flight = step.flight;
      if (step.impact === null) {
        this.syncOne(p);
        continue;
      }
      const reflectsBefore = p.reflects;
      const hit: ProjectileHit = {
        id: p.id,
        owner: p.owner,
        weapon: p.weapon,
        stats: p.stats,
        at: { x: step.flight.x, y: step.flight.y },
        dir: step.flight.dir,
        impact: step.impact,
      };
      if (p.onImpact) p.onImpact(ctx, hit);
      else this.defaultImpact(ctx, hit, () => p.reflects !== reflectsBefore);
      if (p.reflects !== reflectsBefore) {
        // Flies back from here next tick.
        this.syncOne(p);
        continue;
      }
      this.land(p);
    }
  }

  reset(): void {
    this.live.clear();
    this.landed = [];
    this.state.projectiles.clear();
  }

  /** A thrower who left takes their projectiles with them; a KO'd thrower's keep flying. */
  removePlayer(id: string, ko: boolean): void {
    if (ko) return;
    for (const p of [...this.live.values()]) {
      if (p.owner !== id) continue;
      this.live.delete(p.id);
      this.state.projectiles.delete(String(p.id));
    }
  }

  // --- internals ------------------------------------------------------------------------------------

  /** Bodies the owner's projectile can hit right now (others are passed through). */
  private candidates(ctx: CombatContext, owner: string): ProjectileCandidate[] {
    // Players and store workers alike (M5-3).
    return ctx.targets(source(owner)).map((b) => ({ id: b.id, x: b.x, y: b.y }));
  }

  private defaultImpact(ctx: CombatContext, hit: ProjectileHit, reflected: () => boolean): void {
    const { stats } = hit;
    const area = stats.area;
    let direct: string | null = null;
    if (hit.impact.kind === 'body') {
      const landed = ctx.hit({
        source: source(hit.owner),
        target: hit.impact.id,
        damage: stats.damage,
        weapon: hit.weapon,
        delivery: 'projectile',
        projectile: hit.id,
        // At the centre of its own burst: the stronger of the two shoves, along the flight.
        knockback: { dir: hit.dir, px: Math.max(stats.knockbackPx, area?.knockbackPx ?? 0) },
      });
      // Reflected or caught (a cancelled hit): no splash.
      if (!landed || reflected()) return;
      direct = hit.impact.id;
    }
    if (!area) return;
    const aim = Math.atan2(hit.dir.y, hit.dir.x);
    const others = this.candidates(ctx, hit.owner).filter((c) => c.id !== direct);
    for (const id of areaTargets(hit.at, area.radiusPx, others, ctx.bodyRadius, ctx.map.collision)) {
      const target = ctx.position(id);
      if (!target) continue;
      ctx.hit({
        source: source(hit.owner),
        target: id,
        damage: stats.damage,
        weapon: hit.weapon,
        delivery: 'area',
        knockback: { dir: knockbackDirection(hit.at, target, aim), px: area.knockbackPx },
      });
    }
  }

  private land(p: Live): void {
    this.live.delete(p.id);
    const s = this.state.projectiles.get(String(p.id));
    if (!s) return;
    s.x = p.flight.x;
    s.y = p.flight.y;
    s.vx = 0;
    s.vy = 0;
    s.landed = true;
    this.landed.push(p.id);
  }

  private syncOne(p: Live): void {
    const s = this.state.projectiles.get(String(p.id));
    if (!s) return;
    s.x = p.flight.x;
    s.y = p.flight.y;
    s.vx = p.flight.dir.x * p.flight.speedPxPerSecond;
    s.vy = p.flight.dir.y * p.flight.speedPxPerSecond;
    if (s.owner !== p.owner) s.owner = p.owner;
  }
}
