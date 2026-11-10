// Combat on the server (§3.3, §7, §15.3; M4-2). Owns the round's immutable CombatWorld from the shared
// combat rules, mirrors it into PlayerState, broadcasts every combat event, and runs the behaviour
// modules (melee here; thrown, spray, trap, block, shot and charge plug in through modules.ts).
//
// Per server tick (GameRoom.tick):
//   1. beginTick(now): respawns that are due, regen, timed flags (stun, slow, protection) into the schema.
//   2. movement applies input frames; afterFrame records each living player's frame as an intent.
//   3. tick(now): resolves the intents in order after everyone has moved (M3 review H3), runs module
//      ticks, then moves shoved bodies.
import {
  addCombatant,
  armOnPickup,
  attackBlocked,
  attackMode,
  canHit,
  combatEventToWire,
  createCombatWorld,
  createRng,
  findCombatant,
  getWeaponCatalogue,
  hit as applyHit,
  knockbackStep,
  playerHalfSize,
  regenerate,
  removeCombatant,
  respawnDue,
  startKnockback,
  syncedCombatSpeed,
  useWeapon,
  vanSpawn,
  type AttackMode,
  type CombatEvent,
  type CombatEventWire,
  type CombatResult,
  type CombatWorld,
  type GameConfig,
  type HitSource,
  type InputFrame,
  type Knockback,
  type MapModel,
  type PickupWhat,
  type Rng,
  type Vec2,
  type WeaponCatalogue,
  type WeaponDef,
} from '@keke/shared';
import type { GameState, PlayerState } from '../../schema/GameState';
import { defaultCombatModules } from './modules';
import type { BehaviourModule, CombatContext, CombatHit, FrameIntent } from './types';

export type CombatBroadcast = (event: CombatEventWire) => void;

export interface CombatHooks {
  /** A player was KO'd: the room drops their carried item (M3 review H1). */
  onKo(player: PlayerState, now: number): void;
}

export class CombatSystem {
  private world: CombatWorld = createCombatWorld();
  private rng: Rng;
  private readonly weapons: WeaponCatalogue;
  private readonly modules: readonly BehaviourModule[];
  private readonly byMode = new Map<AttackMode, BehaviourModule>();
  private running = false;
  private now = 0;
  private intents: FrameIntent[] = [];
  private readonly shoves = new Map<string, Knockback>();

  constructor(
    private readonly state: GameState,
    private readonly config: GameConfig,
    private readonly map: MapModel,
    private readonly broadcast: CombatBroadcast,
    private readonly hooks: CombatHooks,
    seed: number,
    modules: readonly BehaviourModule[] = defaultCombatModules(state),
    weapons: WeaponCatalogue = getWeaponCatalogue(),
  ) {
    this.rng = createRng(seed);
    this.weapons = weapons;
    this.modules = modules;
    for (const m of modules) {
      for (const mode of m.modes) {
        if (this.byMode.has(mode)) throw new Error(`CombatSystem: two modules handle '${mode}'`);
        this.byMode.set(mode, m);
      }
    }
  }

  /** The round's combat world (read-only, for tests and later systems). */
  get combatWorld(): CombatWorld {
    return this.world;
  }

  get catalogue(): WeaponCatalogue {
    return this.weapons;
  }

  /** A new round (countdown): everyone in it at full HP with fists, no protection (§3.3). */
  startRound(players: readonly PlayerState[], seed?: number): void {
    if (seed !== undefined) this.rng = createRng(seed);
    this.reset();
    let world = createCombatWorld();
    const teams = this.state.settings.teams;
    for (const p of players) {
      world = addCombatant(world, p.sessionId, teams ? p.team : 0, this.weapons, this.config);
    }
    this.world = world;
    this.running = true;
    this.now = 0;
    this.sync();
  }

  /** Lobby (and before a new round): no combat, every player's combat fields back to defaults. */
  reset(): void {
    this.world = createCombatWorld();
    this.running = false;
    this.intents = [];
    this.shoves.clear();
    for (const m of this.modules) m.reset?.();
    this.state.players.forEach((p) => {
      p.hp = 0;
      p.alive = true;
      p.weapon = this.weapons.fallback.id;
      p.weaponUses = -1;
      p.stunned = false;
      p.slowMultiplier = 1;
      p.protected = false;
      p.blocking = false;
      p.respawnIn = 0;
    });
  }

  /** A player left for good (or the window ran out). */
  removePlayer(player: PlayerState): void {
    if (!findCombatant(this.world, player.sessionId)) return;
    this.world = removeCombatant(this.world, player.sessionId);
    this.shoves.delete(player.sessionId);
    this.intents = this.intents.filter((i) => i.player !== player.sessionId);
    for (const m of this.modules) m.removePlayer?.(player.sessionId, false);
  }

  /** True when the player may act (attack, pick up): in the round and not KO'd. */
  canAct(player: PlayerState): boolean {
    return !this.running || player.alive;
  }

  /** Combat speed multiplier from synced state only, the same numbers the client predicts with (H1). */
  speedMultiplier(player: PlayerState): number {
    const block = player.blocking ? (this.weapons.get(player.weapon)?.block?.moveSpeedMultiplier ?? 1) : 1;
    return syncedCombatSpeed({
      alive: player.alive,
      stunned: player.stunned,
      slowMultiplier: player.slowMultiplier,
      blockSpeedMultiplier: block,
    });
  }

  /** An item (or, in M6, an order box) was picked up: roll the weapon (§7; review H2). */
  onPickup(playerId: string, what: PickupWhat): void {
    if (!this.running) return;
    this.commit(armOnPickup(this.world, playerId, what, this.weapons, this.rng, this.config, this.now));
  }

  /** Step 1 of a tick: respawns due, regen, and the timed flags into the schema. */
  beginTick(now: number): void {
    if (!this.running) return;
    const dt = Math.max(0, now - this.now);
    this.now = now;
    if (dt > 0) this.world = regenerate(this.world, dt, this.config);
    this.commit(respawnDue(this.world, now, this.weapons, this.config));
    this.sync();
  }

  /** Step 2: after each applied frame (movement hook). Records the frame; nothing resolves yet (H3). */
  afterFrame(player: PlayerState, frame: InputFrame, pressed: number): void {
    if (!this.running || !player.alive || !findCombatant(this.world, player.sessionId)) return;
    this.intents.push({
      player: player.sessionId,
      x: player.x,
      y: player.y,
      aim: frame.aim,
      move: frame.move,
      pressed,
      held: frame.buttons,
    });
  }

  /** Step 3: resolve this tick's frames in order, run module ticks, move shoved bodies. */
  tick(now: number): void {
    if (!this.running) {
      this.intents = [];
      return;
    }
    this.now = now;
    const ctx = this.context();
    const intents = this.intents;
    this.intents = [];
    for (const intent of intents) {
      const c = findCombatant(this.world, intent.player);
      if (!c || !c.alive) continue;
      const def = this.weapons.require(c.weapon.id);
      for (const m of this.modules) m.onAnyFrame?.(ctx, intent, def);
      // Re-read: an earlier module may have changed the weapon (none does yet).
      const held = findCombatant(this.world, intent.player);
      if (!held || !held.alive) continue;
      const heldDef = this.weapons.require(held.weapon.id);
      const mode = attackMode(heldDef, held.weapon.uses);
      this.byMode.get(mode)?.onFrame?.(ctx, intent, heldDef, mode);
    }
    const dt = 1 / this.config.serverTickHz;
    for (const m of this.modules) m.tick?.(ctx, dt);
    this.moveShoved(dt);
    this.sync();
  }

  // --- internals ------------------------------------------------------------------------------------

  private context(): CombatContext {
    // Built per tick (and per hit), after `now` is set for it.
    return {
      config: this.config,
      map: this.map,
      weapons: this.weapons,
      now: this.now,
      bodyRadius: this.config.playerHitboxSize / 2,
      player: (id) => (findCombatant(this.world, id) ? this.state.players.get(id) : undefined),
      combatant: (id) => findCombatant(this.world, id),
      bodies: () => this.bodies(),
      attackBlocked: (id) => attackBlocked(this.world, id, this.now),
      use: (intent, def, mode, amount) => this.use(intent, def, mode, amount),
      canHit: (source, target, allowSelf) => canHit(this.world, source, target, this.now, allowSelf),
      hit: (h) => this.landHit(h),
      push: (target, dir, px) => this.push(target, dir, px),
    };
  }

  private bodies(): PlayerState[] {
    const out: PlayerState[] = [];
    for (const c of this.world.players) {
      const p = this.state.players.get(c.id);
      if (p && !p.spectator) out.push(p);
    }
    return out;
  }

  private use(intent: FrameIntent, def: WeaponDef, mode: AttackMode, amount = 1): boolean {
    const result = useWeapon(this.world, intent.player, this.weapons, this.now, amount);
    if (result.rejected) return false;
    this.broadcast({
      type: 'attack',
      payload: { player: intent.player, weapon: def.id, mode, x: intent.x, y: intent.y, aim: intent.aim },
    });
    this.commit(result);
    return true;
  }

  private landHit(spec: CombatHit): boolean {
    let adjusted: CombatHit | null = spec;
    for (const m of this.modules) {
      if (adjusted === null) break;
      // A module without adjustHit leaves the hit alone; one that returns null cancels it.
      if (m.adjustHit) adjusted = m.adjustHit(this.context(), adjusted);
    }
    if (adjusted === null) return false;
    const { delivery: _delivery, knockback, projectile: _projectile, ...hitSpec } = adjusted;
    const result = applyHit(this.world, hitSpec, this.now, this.weapons, this.config);
    if (result.rejected) return false;
    this.commit(result);
    if (knockback) this.push(adjusted.target, knockback.dir, knockback.px);
    return true;
  }

  private push(target: string, dir: Vec2, px: number): void {
    if (!findCombatant(this.world, target)) return;
    const shove = startKnockback(dir, px, this.config);
    if (shove) this.shoves.set(target, shove);
  }

  private moveShoved(dt: number): void {
    const half = playerHalfSize(this.config);
    for (const [id, shove] of [...this.shoves]) {
      const p = this.state.players.get(id);
      if (!p) {
        this.shoves.delete(id);
        continue;
      }
      const next = knockbackStep(this.map.collision, { x: p.x, y: p.y }, half, shove, dt);
      p.x = next.pos.x;
      p.y = next.pos.y;
      p.vx = 0;
      p.vy = 0;
      if (next.knockback) this.shoves.set(id, next.knockback);
      else this.shoves.delete(id);
    }
  }

  /** Keeps a rule result, handles KO and respawn side effects, broadcasts the events, mirrors the schema. */
  private commit(result: CombatResult): void {
    if (result.rejected) return;
    this.world = result.world;
    this.sync();
    for (const event of result.events) {
      this.sideEffects(event);
      this.broadcast(combatEventToWire(event, this.now));
    }
  }

  private sideEffects(event: CombatEvent): void {
    if (event.type === 'ko') {
      const player = this.state.players.get(event.player);
      this.intents = this.intents.filter((i) => i.player !== event.player);
      for (const m of this.modules) m.removePlayer?.(event.player, true);
      if (player) {
        player.vx = 0;
        player.vy = 0;
        player.blocking = false;
        this.hooks.onKo(player, this.now);
      }
    } else if (event.type === 'respawn') {
      // Back at their own van, at rest (§3.3). Not carrying (dropped on KO), so no deposit (review H1).
      const player = this.state.players.get(event.player);
      this.shoves.delete(event.player);
      if (player) {
        const pos = vanSpawn(this.map, Math.max(0, player.van), playerHalfSize(this.config));
        player.x = pos.x;
        player.y = pos.y;
        player.vx = 0;
        player.vy = 0;
      }
    }
  }

  /** Mirrors the combat world into each round player's combat fields. */
  private sync(): void {
    const now = this.now;
    for (const c of this.world.players) {
      const p = this.state.players.get(c.id);
      if (!p) continue;
      const hp = Math.max(0, Math.round(c.hp));
      if (p.hp !== hp) p.hp = hp;
      if (p.alive !== c.alive) p.alive = c.alive;
      if (p.weapon !== c.weapon.id) p.weapon = c.weapon.id;
      const uses = c.weapon.uses ?? -1;
      if (p.weaponUses !== uses) p.weaponUses = uses;
      const stunned = c.alive && now < c.stunnedUntil;
      if (p.stunned !== stunned) p.stunned = stunned;
      const slow = c.alive && now < c.slowUntil ? c.slowMultiplier : 1;
      if (p.slowMultiplier !== slow) p.slowMultiplier = slow;
      const prot = c.alive && now < c.protectedUntil;
      if (p.protected !== prot) p.protected = prot;
      const respawnIn = !c.alive && c.respawnAt !== null ? Math.max(0, Math.ceil(c.respawnAt - now)) : 0;
      if (p.respawnIn !== respawnIn) p.respawnIn = respawnIn;
    }
  }
}

/** Source of a player's own hits, for modules. */
export function playerSource(id: string): HitSource {
  return { kind: 'player', id };
}
