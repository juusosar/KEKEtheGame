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
  armWith,
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
  type Combatant,
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
import { resetGateTimers } from '../movement';
import { defaultCombatModules } from './modules';
import type { BehaviourModule, CombatContext, CombatHit, FrameIntent, HitTarget, NpcTargets } from './types';

export type CombatBroadcast = (event: CombatEventWire) => void;

export interface CombatHooks {
  /** A player was KO'd: the room drops their carried item (M3 review H1). */
  onKo(player: PlayerState, now: number): void;
  /** A dash swept the band from→to: scatter the lying items in it (pallet jack, M4-6). */
  onScatterItems?(from: Vec2, to: Vec2, halfWidth: number, px: number): void;
  /** A dash swept the band from→to heading `dir`: shove the carts in it (pallet jack, P2-5). */
  onShoveCarts?(from: Vec2, to: Vec2, halfWidth: number, dir: Vec2, skip: ReadonlySet<number>): number[];
  /** A hit makes the player drop their carried item (banana peel slip, M4-5). */
  onDropCarried?(player: PlayerState, now: number): void;
  /** Every combat event after it was applied (the room feeds landed hits to the wanted rules, M5-3). */
  onEvent?(event: CombatEvent): void;
}

/** Attack modes a player KO'd earlier in the same tick still gets (M4 review F6). */
const SIMULTANEOUS_AFTER_KO: ReadonlySet<AttackMode> = new Set<AttackMode>(['melee', 'thrown', 'shot']);

export class CombatSystem {
  private world: CombatWorld = createCombatWorld();
  private rng: Rng;
  private readonly weapons: WeaponCatalogue;
  private readonly modules: readonly BehaviourModule[];
  private readonly byMode = new Map<AttackMode, BehaviourModule>();
  private running = false;
  private now = 0;
  private intents: FrameIntent[] = [];
  /**
   * The world as it was when this tick's intents started resolving (M4 review F6), or null outside that
   * loop. Attacks of one tick are simultaneous: a player stunned or KO'd by an earlier intent of the same
   * tick still gets their own attack, with the weapon they held at the start of the tick.
   */
  private tickStart: CombatWorld | null = null;
  private readonly shoves = new Map<string, Knockback>();
  /** Store workers weapons can hit (M5-3); the room sets it after creating its NpcSystem. */
  npcTargets: NpcTargets | null = null;

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

  /**
   * A new round (countdown): everyone in it at full HP with fists (§3.3), and spawn-protected for the
   * first `roundStartProtectionSeconds` of play (P4-2), so a round does not open with a brawl between
   * neighbouring vans. Round time starts at 0 at the Go, so the protection covers the countdown too.
   */
  startRound(players: readonly PlayerState[], seed?: number): void {
    if (seed !== undefined) this.rng = createRng(seed);
    this.reset();
    let world = createCombatWorld();
    const teams = this.state.settings.teams;
    for (const p of players) {
      world = addCombatant(world, p.sessionId, teams ? p.team : 0, this.weapons, this.config);
    }
    const protectedUntil = this.config.roundStartProtectionSeconds;
    if (protectedUntil > 0) world = { players: world.players.map((c) => ({ ...c, protectedUntil })) };
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
      p.charging = false;
      p.sliding = false;
      p.respawnIn = 0;
    });
  }

  /**
   * Round over (roundResults, M4 review F8): the simulation stops, so clear what would otherwise stay
   * frozen on screen under the results: projectiles, peels, slides, dashes, shoves and the block, charge
   * and slide flags. HP and weapons stay until the next round's `startRound`.
   */
  freeze(): void {
    this.intents = [];
    this.shoves.clear();
    for (const m of this.modules) m.reset?.();
    this.state.players.forEach((p) => {
      p.blocking = false;
      p.charging = false;
      p.sliding = false;
    });
  }

  /**
   * A player dropped and their body waits for a reconnect (M4 review F8): nobody controls it, so it stops
   * blocking (a raised pan would soften hits and reflect projectiles for 30 s) and ends a dash. Frames
   * after a reconnect raise the pan again while Block is held.
   */
  onDisconnect(player: PlayerState): void {
    if (!findCombatant(this.world, player.sessionId)) return;
    player.blocking = false;
    for (const m of this.modules) m.onDisconnect?.(player.sessionId);
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

  /**
   * True when the player may pick up or drop an item: may act, and not stunned or sliding (M4 review F4).
   * A slip drops the carried item; without this a mashed E took it straight back. Deposits stay automatic
   * for a stunned body (a player shoved into their van still banks).
   */
  canPickUp(player: PlayerState): boolean {
    return this.canAct(player) && (!this.running || (!player.stunned && !player.sliding));
  }

  /** Combat speed multiplier from synced state only, the same numbers the client predicts with (H1). */
  speedMultiplier(player: PlayerState): number {
    // The pan block is per frame (blockSpeedMultiplier, M4 review F7), not from the synced flag.
    return syncedCombatSpeed({
      alive: player.alive,
      stunned: player.stunned,
      slowMultiplier: player.slowMultiplier,
      charging: player.charging,
    });
  }

  /**
   * Speed multiplier for this player's frames that hold Block (M4 review F7), or undefined when they
   * cannot raise a block now. The same rule as the client's prediction (combatView.blockSpeed).
   */
  blockSpeedMultiplier(player: PlayerState): number | undefined {
    if (!player.alive || player.stunned) return undefined;
    return this.weapons.get(player.weapon)?.block?.moveSpeedMultiplier;
  }

  /** An item (or, in M6, an order box) was picked up: roll the weapon (§7; review H2). */
  onPickup(playerId: string, what: PickupWhat): void {
    if (!this.running) return;
    this.commit(armOnPickup(this.world, playerId, what, this.weapons, this.rng, this.config, this.now));
  }

  /**
   * Debug only (`DebugMessage.giveWeapon`): puts `weaponId` in the player's hands with full uses, as a
   * pickup roll would. False when no round runs, the weapon id is unknown or the player is not in the round.
   */
  giveWeapon(playerId: string, weaponId: string): boolean {
    const def = this.weapons.get(weaponId);
    if (!this.running || !def) return false;
    const result = armWith(this.world, playerId, def, this.now);
    if (result.rejected) return false;
    this.commit(result);
    return true;
  }

  /**
   * A hit from outside the weapon modules (an NPC's swing, a forklift; M5-3). Goes through every module's
   * `adjustHit` (a raised pan softens an NPC's melee too). True when it landed.
   */
  externalHit(hit: CombatHit): boolean {
    if (!this.running) return false;
    return this.landHit(hit);
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
    this.tickStart = this.world;
    for (const intent of intents) {
      // Who may act is decided from the start of the tick, not by hits earlier in this loop (join order).
      const start = findCombatant(this.tickStart, intent.player);
      if (!start || !start.alive || !findCombatant(this.world, intent.player)) continue;
      const now = this.actor(intent.player);
      if (!now) continue;
      const def = this.weapons.require(now.weapon.id);
      let taken = false;
      for (const m of this.modules) if (m.onAnyFrame?.(ctx, intent, def) === true) taken = true;
      if (taken) continue;
      // Re-read: an earlier module may have changed the weapon (none does yet).
      const held = this.actor(intent.player);
      if (!held) continue;
      const heldDef = this.weapons.require(held.weapon.id);
      const mode = attackMode(heldDef, held.weapon.uses);
      // A body KO'd earlier this tick still lands its swing, throw or shot, but does not start a dash,
      // a spray or a peel from the floor.
      if (!findCombatant(this.world, intent.player)?.alive && !SIMULTANEOUS_AFTER_KO.has(mode)) continue;
      this.byMode.get(mode)?.onFrame?.(ctx, intent, heldDef, mode);
    }
    this.tickStart = null;
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
      canHit: (source, target, allowSelf) => this.canHitAny(source, target, allowSelf),
      targets: (source) => this.targets(source),
      position: (id) => this.position(id),
      hit: (h) => this.landHit(h),
      push: (target, dir, px) => this.push(target, dir, px),
      scatterItems: (from, to, halfWidth, px) => this.hooks.onScatterItems?.(from, to, halfWidth, px),
      shoveCarts: (from, to, halfWidth, dir, skip) =>
        this.hooks.onShoveCarts?.(from, to, halfWidth, dir, skip) ?? [],
      dropCarried: (target) => {
        const p = findCombatant(this.world, target) ? this.state.players.get(target) : undefined;
        if (p) this.hooks.onDropCarried?.(p, this.now);
      },
    };
  }

  /** A target id that is not a round player but a store worker. */
  private npcId(id: string): boolean {
    return !findCombatant(this.world, id) && (this.npcTargets?.has(id) ?? false);
  }

  private canHitAny(source: HitSource, target: string, allowSelf?: boolean): boolean {
    if (this.npcId(target)) return this.npcTargets?.canHit(source, target) ?? false;
    return canHit(this.world, source, target, this.now, allowSelf);
  }

  private targets(source: HitSource): HitTarget[] {
    const out: HitTarget[] = [];
    for (const b of this.bodies()) {
      if (canHit(this.world, source, b.sessionId, this.now)) {
        out.push({ id: b.sessionId, kind: 'player', x: b.x, y: b.y });
      }
    }
    for (const n of this.npcTargets?.bodies() ?? []) {
      if (!findCombatant(this.world, n.id) && this.npcTargets?.canHit(source, n.id)) {
        out.push({ id: n.id, kind: 'npc', x: n.x, y: n.y });
      }
    }
    return out;
  }

  private position(id: string): Vec2 | undefined {
    const p = findCombatant(this.world, id) ? this.state.players.get(id) : undefined;
    if (p) return { x: p.x, y: p.y };
    return this.npcTargets?.position(id);
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
    let result = useWeapon(this.world, intent.player, this.weapons, this.now, amount);
    if (result.rejected === 'ko' || result.rejected === 'stunned')
      result = this.useAsAtTickStart(intent.player, amount);
    if (result.rejected) return false;
    this.broadcast({
      type: 'attack',
      payload: { player: intent.player, weapon: def.id, mode, x: intent.x, y: intent.y, aim: intent.aim },
    });
    this.commit(result);
    return true;
  }

  /**
   * The combatant as their own attack this tick sees them (M4 review F6): as now, but when an earlier
   * intent of the same tick stunned or KO'd them, as at the start of the tick (alive, unstunned, the
   * weapon they held then). Null when they could not act at the start of the tick either.
   */
  private actor(id: string): Combatant | null {
    const current = findCombatant(this.world, id);
    if (!current) return null;
    const start = this.tickStart ? findCombatant(this.tickStart, id) : undefined;
    if (!start) return current.alive ? current : null;
    if (!start.alive) return null;
    if (current.alive) return current;
    return { ...current, alive: true, stunnedUntil: start.stunnedUntil, weapon: start.weapon };
  }

  /** `useWeapon` for a player hit earlier in this tick: spends as at the tick start, keeps their new state. */
  private useAsAtTickStart(id: string, amount: number): CombatResult {
    const refused: CombatResult = { world: this.world, events: [], rejected: 'stunned' };
    const start = this.tickStart ? findCombatant(this.tickStart, id) : undefined;
    const current = findCombatant(this.world, id);
    if (!start || !current || attackBlocked(this.tickStart as CombatWorld, id, this.now) !== null)
      return refused;
    const patch = (world: CombatWorld, f: (c: Combatant) => Combatant): CombatWorld => ({
      ...world,
      players: world.players.map((c) => (c.id === id ? f(c) : c)),
    });
    const ko = !current.alive;
    const asAtStart = patch(this.world, (c) => ({
      ...c,
      alive: true,
      stunnedUntil: start.stunnedUntil,
      weapon: ko ? start.weapon : c.weapon,
    }));
    const result = useWeapon(asAtStart, id, this.weapons, this.now, amount);
    if (result.rejected) return result;
    // Put back what this tick did to them: still stunned, or still KO'd with fists.
    const world = patch(result.world, (c) => ({
      ...c,
      alive: current.alive,
      stunnedUntil: current.stunnedUntil,
      weapon: ko ? current.weapon : c.weapon,
    }));
    // A KO'd player's weapon was already lost; no "spent" event for it.
    return { world, events: ko ? [] : result.events };
  }

  private landHit(spec: CombatHit): boolean {
    let adjusted: CombatHit | null = spec;
    for (const m of this.modules) {
      if (adjusted === null) break;
      // A module without adjustHit leaves the hit alone; one that returns null cancels it.
      if (m.adjustHit) adjusted = m.adjustHit(this.context(), adjusted);
    }
    if (adjusted === null) return false;
    if (this.npcId(adjusted.target)) return this.npcTargets?.hit(adjusted) ?? false;
    const { delivery: _delivery, knockback, projectile: _projectile, ...hitSpec } = adjusted;
    const result = applyHit(this.world, hitSpec, this.now, this.weapons, this.config);
    if (result.rejected) return false;
    this.commit(result);
    if (knockback) this.push(adjusted.target, knockback.dir, knockback.px);
    return true;
  }

  private push(target: string, dir: Vec2, px: number): void {
    if (this.npcId(target)) {
      this.npcTargets?.push(target, dir, px);
      return;
    }
    if (!findCombatant(this.world, target)) return;
    // A dashing pallet jack is not shoved off its line (M4 review F8): the dash wins.
    if (this.state.players.get(target)?.charging) return;
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
      const next = knockbackStep(this.map.collision, { x: p.x, y: p.y }, half, shove, dt, this.map.gates);
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
      this.hooks.onEvent?.(event);
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
        player.charging = false;
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
        resetGateTimers(player);
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
