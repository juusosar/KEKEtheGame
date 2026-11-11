// Store workers on the server (§8; M5-3). Spawns the round's NPCs from `planNpcs`, keeps their health
// (shared rules/npcHealth.ts), takes hits from player weapons (it is the CombatSystem's `NpcTargets`),
// KOs them and respawns them at their spawn after `npcRespawnSeconds`, moves shoved bodies, parks and
// removes stock carts, mirrors everything into `GameState.npcs` / `stockCarts`, and runs one behaviour
// module per NPC behaviour (modules.ts). NPCs of a behaviour without a module are not spawned yet.
//
// Per server tick (GameRoom.tick), after player movement and before the combat tick (M4 review H4):
//   tick(now): respawns, cart expiry, shoves, then each behaviour's tick (walk, swing).
import {
  createRng,
  findSpawn,
  freshNpcVitals,
  getNpcCatalogue,
  hitNpc,
  knockbackStep,
  meleeTargets,
  moveAabb,
  npcCanBeHit,
  npcRespawnDue,
  npcRespawnIn,
  npcSpeedMultiplier,
  npcStunned,
  placeStockCart,
  planNpcs,
  rectCovers,
  startKnockback,
  tileOf,
  type DropReason,
  type GameConfig,
  type HitSource,
  type Knockback,
  type MapModel,
  type NpcBehaviour,
  type NpcCatalogue,
  type NpcEventWire,
  type NpcPlacement,
  type NpcVitals,
  type Rng,
  type TileRect,
  type Vec2,
  type WantedWatcher,
} from '@keke/shared';
import { NpcState, StockCartState, type GameState, type PlayerState } from '../../schema/GameState';
import type { CombatHit, NpcTargets } from '../combat/types';
import { defaultNpcBehaviours } from './modules';
import type { Npc, NpcBehaviourModule, NpcContext, NpcHitInfo, NpcMeleeSwing, WalkResult } from './types';
import { Walker } from './walker';

export type NpcBroadcast = (event: NpcEventWire) => void;

export interface NpcHooks {
  /** Lands an NPC's hit on a player through the combat system (block, KO, item drop; M4 review H2). */
  hitPlayer(hit: CombatHit): boolean;
  /** A player damaged an NPC: the room feeds it to the wanted rules (§8). */
  onNpcDamaged?(attacker: string, npc: string, damage: number): void;
  /** Players who are Wanted now (guards chase them). */
  wantedPlayers?(): readonly string[];
  /** A player drops their carried item where they stand (forklift contact, M5-5). */
  dropCarried?(player: PlayerState, reason: DropReason): void;
}

/**
 * A player store workers notice: in the round, up, and connected. A disconnected body stays in the
 * world for the reconnect window (§15.3), but workers ignore it (M5 review F6): the butcher does not
 * cleave it, guards and stockers stop chasing it, forklifts pass it.
 */
function isTargetable(p: PlayerState): boolean {
  return !p.spectator && p.alive && p.connected;
}

/** Zones a stock cart is never parked in: the vans and the player spawn must stay open. */
const NO_CART_ZONES: readonly string[] = ['loading_dock'];

interface Runtime extends Npc {
  vitals: NpcVitals;
  shove: Knockback | null;
  readonly walker: Walker;
  readonly module: NpcBehaviourModule;
}

interface Cart {
  readonly id: number;
  readonly npc: string;
  readonly rect: TileRect;
  readonly until: number;
}

export class NpcSystem implements NpcTargets {
  private readonly npcs = new Map<string, Runtime>();
  private readonly byBehaviour = new Map<NpcBehaviour, NpcBehaviourModule>();
  private readonly carts = new Map<number, Cart>();
  private nextCartId = 1;
  /** Bumped when a cart is parked or removed, so walkers re-plan (an event, not every tick). */
  private cartsVersion = 0;
  private rng: Rng;
  private running = false;
  private now = 0;

  constructor(
    private readonly state: GameState,
    private readonly config: GameConfig,
    /** The live map: its collision must include the carts (`gridWithBlocked` + `isCartTile`). */
    private readonly map: MapModel,
    private readonly broadcast: NpcBroadcast,
    private readonly hooks: NpcHooks,
    seed: number,
    modules: readonly NpcBehaviourModule[] = defaultNpcBehaviours(),
    private readonly catalogue: NpcCatalogue = getNpcCatalogue(),
  ) {
    this.rng = createRng(seed);
    for (const m of modules) {
      if (this.byBehaviour.has(m.behaviour)) throw new Error(`NpcSystem: two modules run '${m.behaviour}'`);
      this.byBehaviour.set(m.behaviour, m);
    }
  }

  /** Behaviours that have a module (and so spawn). */
  get behaviours(): readonly NpcBehaviour[] {
    return [...this.byBehaviour.keys()];
  }

  /** True when tile (tx, ty) holds a parked stock cart. The room's live collision grid asks this. */
  isCartTile(tx: number, ty: number): boolean {
    for (const cart of this.carts.values()) if (rectCovers(cart.rect, tx, ty)) return true;
    return false;
  }

  /** A new round (countdown): the round's NPCs at their spawns with full HP. `players` = non-spectators. */
  startRound(players: number, seed?: number): void {
    if (seed !== undefined) this.rng = createRng(seed);
    this.reset();
    this.running = true;
    this.now = 0;
    for (const placement of planNpcs(this.catalogue, this.map, players)) {
      const module = this.byBehaviour.get(placement.behaviour);
      if (!module) continue;
      this.add(placement, module);
    }
  }

  /** Lobby (and before a round): no NPCs, no carts. */
  reset(): void {
    this.running = false;
    for (const m of this.byBehaviour.values()) m.reset?.();
    this.npcs.clear();
    this.carts.clear();
    this.state.npcs.clear();
    this.state.stockCarts.clear();
    this.nextCartId = 1;
    this.cartsVersion++;
  }

  /** A player left for good: behaviours stop chasing them. */
  removePlayer(id: string): void {
    for (const m of this.byBehaviour.values()) m.removePlayer?.(id);
    for (const npc of this.npcs.values()) if (npc.state.target === id) npc.state.target = '';
  }

  /** Security guards that are up (wanted witness check, M5-2). */
  guards(): WantedWatcher[] {
    const out: WantedWatcher[] = [];
    for (const npc of this.npcs.values()) {
      if (npc.def.behaviour === 'security' && npc.vitals.alive) {
        out.push({ id: npc.id, x: npc.state.x, y: npc.state.y });
      }
    }
    return out;
  }

  /** The NPC runtime, for tests. */
  npc(id: string): Npc | undefined {
    return this.npcs.get(id);
  }

  /** Path searches the NPC has run so far (tests check repathing happens on events only). */
  searchesOf(id: string): number {
    return this.npcs.get(id)?.walker.searches ?? 0;
  }

  /** One tick of NPC simulation. */
  tick(now: number): void {
    if (!this.running) return;
    const dt = 1 / this.config.serverTickHz;
    this.now = now;
    this.expireCarts();
    const ctx = this.context();
    for (const npc of this.npcs.values()) {
      if (!npc.vitals.alive) {
        if (npcRespawnDue(npc.vitals, now)) this.respawn(npc, ctx);
        else this.sync(npc);
        continue;
      }
      if (npc.shove) {
        this.moveShoved(npc, dt);
        npc.state.moving = false;
      } else if (npcStunned(npc.vitals, now)) {
        npc.state.moving = false;
      } else {
        npc.state.moving = false;
        npc.module.tick(ctx, npc, dt);
      }
      this.sync(npc);
    }
  }

  // --- NpcTargets (the CombatSystem's view) -------------------------------------------------------

  bodies(): { id: string; x: number; y: number }[] {
    const out: { id: string; x: number; y: number }[] = [];
    for (const npc of this.npcs.values()) {
      if (npc.vitals.alive && npc.vitals.hp !== null)
        out.push({ id: npc.id, x: npc.state.x, y: npc.state.y });
    }
    return out;
  }

  has(id: string): boolean {
    return this.npcs.has(id);
  }

  canHit(source: HitSource, id: string): boolean {
    const npc = this.npcs.get(id);
    return this.running && !!npc && npcCanBeHit(npc.vitals, source, id);
  }

  position(id: string): Vec2 | undefined {
    const npc = this.npcs.get(id);
    return npc ? { x: npc.state.x, y: npc.state.y } : undefined;
  }

  hit(hit: CombatHit): boolean {
    const npc = this.npcs.get(hit.target);
    if (!this.running || !npc) return false;
    const result = hitNpc(npc.vitals, npc.id, hit, this.now, this.config);
    if (!result.landed) return false;
    npc.vitals = result.vitals;
    const damage = Math.max(0, hit.damage);
    const weapon = hit.weapon ?? null;
    this.broadcast({
      type: 'npcHit',
      payload: { npc: npc.id, source: hit.source, damage, weapon, hp: Math.round(npc.vitals.hp ?? 0) },
    });
    if (damage > 0 && hit.source.kind === 'player') this.hooks.onNpcDamaged?.(hit.source.id, npc.id, damage);
    const ctx = this.context();
    const info: NpcHitInfo = { source: hit.source, damage, weapon, ko: result.ko };
    if (result.ko) {
      npc.shove = null;
      npc.walker.clear();
      npc.module.onHit?.(ctx, npc, info);
      npc.module.onKo?.(ctx, npc);
      npc.state.mode = 'ko';
      npc.state.target = '';
      npc.state.moving = false;
      this.broadcast({
        type: 'npcKo',
        payload: { npc: npc.id, source: hit.source, weapon, respawnInSeconds: this.config.npcRespawnSeconds },
      });
    } else {
      if (hit.knockback) this.push(npc.id, hit.knockback.dir, hit.knockback.px);
      npc.module.onHit?.(ctx, npc, info);
    }
    this.sync(npc);
    return true;
  }

  push(id: string, dir: Vec2, px: number): void {
    const npc = this.npcs.get(id);
    if (!npc || !npc.vitals.alive || npc.vitals.hp === null) return;
    const shove = startKnockback(dir, px, this.config);
    if (shove) {
      npc.shove = shove;
      // Moved off its path: re-plan once the shove ends (M4 review H5).
      npc.walker.clear();
    }
  }

  // --- internals ------------------------------------------------------------------------------------

  private add(placement: NpcPlacement, module: NpcBehaviourModule): void {
    const def = this.catalogue.require(placement.type);
    const half = { hw: def.hitboxPx / 2, hh: def.hitboxPx / 2 };
    const state = new NpcState();
    state.id = placement.key;
    state.type = def.id;
    state.behaviour = def.behaviour;
    const npc: Runtime = {
      id: placement.key,
      def,
      placement,
      state,
      half,
      vitals: freshNpcVitals(def.hp),
      shove: null,
      walker: new Walker(),
      module,
    };
    this.npcs.set(npc.id, npc);
    this.state.npcs.set(npc.id, state);
    this.place(npc);
    module.spawn(this.context(), npc);
    this.sync(npc);
  }

  /** At the spawn, nudged off walls, carts and NPCs that already stand there. */
  private place(npc: Runtime): void {
    let at = findSpawn(this.map.collision, npc.placement.spawn, npc.half);
    const taken = (p: Vec2): boolean =>
      [...this.npcs.values()].some(
        (o) => o !== npc && o.vitals.alive && Math.hypot(o.state.x - p.x, o.state.y - p.y) < npc.def.hitboxPx,
      );
    if (taken(at)) {
      const ts = this.map.tileSize;
      const ring = [
        { x: ts, y: 0 },
        { x: -ts, y: 0 },
        { x: 0, y: ts },
        { x: 0, y: -ts },
      ];
      const free = ring
        .map((d) => findSpawn(this.map.collision, { x: at.x + d.x, y: at.y + d.y }, npc.half))
        .find((p) => !taken(p));
      if (free) at = free;
    }
    npc.state.x = at.x;
    npc.state.y = at.y;
    npc.state.moving = false;
    npc.state.mode = 'idle';
    npc.state.target = '';
  }

  private respawn(npc: Runtime, ctx: NpcContext): void {
    npc.vitals = freshNpcVitals(npc.def.hp);
    npc.shove = null;
    npc.walker.clear();
    this.place(npc);
    npc.module.spawn(ctx, npc);
    this.sync(npc);
    this.broadcast({ type: 'npcRespawn', payload: { npc: npc.id } });
  }

  private moveShoved(npc: Runtime, dt: number): void {
    if (!npc.shove) return;
    const next = knockbackStep(
      this.map.collision,
      { x: npc.state.x, y: npc.state.y },
      npc.half,
      npc.shove,
      dt,
    );
    npc.state.x = next.pos.x;
    npc.state.y = next.pos.y;
    npc.shove = next.knockback;
  }

  private expireCarts(): void {
    for (const cart of [...this.carts.values()]) {
      if (this.now < cart.until) continue;
      this.carts.delete(cart.id);
      this.state.stockCarts.delete(String(cart.id));
      this.cartsVersion++;
    }
  }

  private sync(npc: Runtime): void {
    const s = npc.state;
    const v = npc.vitals;
    const hp = Math.max(0, Math.round(v.hp ?? 0));
    if (s.hp !== hp) s.hp = hp;
    const maxHp = v.maxHp ?? 0;
    if (s.maxHp !== maxHp) s.maxHp = maxHp;
    if (s.alive !== v.alive) s.alive = v.alive;
    const respawnIn = npcRespawnIn(v, this.now);
    if (s.respawnIn !== respawnIn) s.respawnIn = respawnIn;
    const stunned = npcStunned(v, this.now);
    if (s.stunned !== stunned) s.stunned = stunned;
  }

  private alivePlayer(id: string): PlayerState | undefined {
    const p = this.state.players.get(id);
    return p && isTargetable(p) ? p : undefined;
  }

  private context(): NpcContext {
    return {
      config: this.config,
      map: this.map,
      catalogue: this.catalogue,
      now: this.now,
      rng: this.rng,
      players: () => [...this.state.players.values()].filter(isTargetable),
      player: (id) => this.alivePlayer(id),
      wantedPlayers: () => this.hooks.wantedPlayers?.() ?? [],
      guards: () => this.guards(),
      walk: (npc, goal, speed) => this.walk(npc, goal, speed),
      stop: (npc) => {
        npc.state.moving = false;
        this.runtime(npc)?.walker.clear();
      },
      face: (npc, at) => {
        if (at.x !== npc.state.x || at.y !== npc.state.y) {
          npc.state.aim = Math.atan2(at.y - npc.state.y, at.x - npc.state.x);
        }
      },
      swing: (npc, swing) => this.swing(npc, swing),
      moveBy: (npc, delta) => {
        const moved = moveAabb(this.map.collision, { x: npc.state.x, y: npc.state.y }, npc.half, delta);
        const dx = moved.x - npc.state.x;
        const dy = moved.y - npc.state.y;
        npc.state.x = moved.x;
        npc.state.y = moved.y;
        npc.state.moving = Math.hypot(dx, dy) > 1e-6;
        if (npc.state.moving) npc.state.aim = Math.atan2(dy, dx);
        return moved;
      },
      hitPlayer: (hit) => this.hooks.hitPlayer(hit),
      dropCarried: (playerId, reason) => {
        const p = this.alivePlayer(playerId);
        if (p) this.hooks.dropCarried?.(p, reason);
      },
      placeStockCart: (npc, lengthTiles, seconds) => this.placeCart(npc, lengthTiles, seconds),
    };
  }

  private runtime(npc: Npc): Runtime | undefined {
    return this.npcs.get(npc.id);
  }

  private walk(npc: Npc, goal: Vec2, speed: number): WalkResult {
    const rt = this.runtime(npc);
    if (!rt) return 'unreachable';
    const dt = 1 / this.config.serverTickHz;
    const distance = Math.max(0, speed) * npcSpeedMultiplier(rt.vitals, this.now) * dt;
    const step = rt.walker.step(
      this.map.collision,
      { x: rt.state.x, y: rt.state.y },
      rt.half,
      goal,
      distance,
      dt,
      this.now,
      this.cartsVersion,
    );
    rt.state.x = step.position.x;
    rt.state.y = step.position.y;
    rt.state.moving = step.dir !== null;
    if (step.dir) rt.state.aim = Math.atan2(step.dir.y, step.dir.x);
    return step.result;
  }

  private swing(npc: Npc, swing: NpcMeleeSwing): string[] {
    const source = { kind: 'npc', id: npc.id } as const;
    const origin = { x: npc.state.x, y: npc.state.y };
    npc.state.aim = swing.aim;
    const only = swing.only;
    const candidates = [...this.state.players.values()]
      .filter((p) => isTargetable(p) && (only === undefined || only.includes(p.sessionId)))
      .map((p) => ({ id: p.sessionId, x: p.x, y: p.y }));
    this.broadcast({
      type: 'npcAttack',
      payload: { npc: npc.id, x: origin.x, y: origin.y, aim: swing.aim, target: only?.[0] ?? '' },
    });
    const hit: string[] = [];
    const radius = this.config.playerHitboxSize / 2;
    // Every hit needs a clear line from its origin, like player swings (PR #55); the live map, so carts block.
    for (const id of meleeTargets(origin, swing.aim, candidates, swing.melee, radius, this.map.collision)) {
      const target = this.state.players.get(id);
      if (!target) continue;
      const dx = target.x - origin.x;
      const dy = target.y - origin.y;
      const len = Math.hypot(dx, dy);
      const dir =
        len > 1e-6 ? { x: dx / len, y: dy / len } : { x: Math.cos(swing.aim), y: Math.sin(swing.aim) };
      const landed = this.hooks.hitPlayer({
        source,
        target: id,
        damage: swing.melee.damage,
        stunSeconds: swing.melee.stunSeconds,
        delivery: 'melee',
        knockback: { dir, px: swing.melee.knockbackPx },
      });
      if (landed) hit.push(id);
    }
    return hit;
  }

  private placeCart(npc: Npc, lengthTiles: number, seconds: number): TileRect | null {
    const grid = this.map.collision;
    const ts = grid.tileSize;
    const bodies: { x: number; y: number; hw: number; hh: number }[] = [];
    const playerHalf = this.config.playerHitboxSize / 2;
    this.state.players.forEach((p) => {
      if (!p.spectator) bodies.push({ x: p.x, y: p.y, hw: playerHalf, hh: playerHalf });
    });
    for (const o of this.npcs.values())
      bodies.push({ x: o.state.x, y: o.state.y, hw: o.half.hw, hh: o.half.hh });
    const occupied = (tx: number, ty: number): boolean => {
      // Already solid for the live grid (another cart) is checked by placeStockCart; bodies and zones here.
      const x0 = tx * ts;
      const y0 = ty * ts;
      if (
        bodies.some((b) => b.x + b.hw > x0 && b.x - b.hw < x0 + ts && b.y + b.hh > y0 && b.y - b.hh < y0 + ts)
      ) {
        return true;
      }
      const zone = this.map.zoneAt(x0 + ts / 2, y0 + ts / 2);
      return zone !== undefined && NO_CART_ZONES.includes(zone.id);
    };
    const rect = placeStockCart(
      grid,
      { stand: tileOf(grid, { x: npc.state.x, y: npc.state.y }), lengthTiles, occupied },
      this.rng,
    );
    if (!rect) return null;
    this.addCart(npc.id, rect, seconds);
    return rect;
  }

  /** Parks a stock cart on `rect` for `seconds`, wherever that is (room tests; stockers use placeCart). */
  parkCartForTest(npcId: string, rect: TileRect, seconds: number): void {
    this.addCart(npcId, rect, seconds);
  }

  private addCart(npcId: string, rect: TileRect, seconds: number): void {
    const cart: Cart = { id: this.nextCartId++, npc: npcId, rect, until: this.now + seconds };
    this.carts.set(cart.id, cart);
    const s = new StockCartState();
    s.id = cart.id;
    s.npc = npcId;
    s.tx = rect.tx;
    s.ty = rect.ty;
    s.w = rect.w;
    s.h = rect.h;
    this.state.stockCarts.set(String(cart.id), s);
    this.cartsVersion++;
  }
}
