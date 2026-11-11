// One bot player's decisions (host setting `bots`). Every input frame the bot reads the room state the
// way a person reads the screen, picks a goal (its target, the van, the office, a foe), walks there with
// the shared pathfinder and presses the same buttons a person would: E on its item, attack at a foe in
// reach. The room feeds the frames into the movement queue like a client's, so bots obey every rule.
// Grown from the soak bot (soak/bot.ts), which plays over the network; this one runs inside the room.
import {
  Button,
  ORDER_BOX_ITEM_ID,
  crossesGateWrongWay,
  findPath,
  getWeaponCatalogue,
  playerHalfSize,
  vanSpawn,
  type CollisionGrid,
  type GameConfig,
  type MapModel,
  type Rng,
  type Vec2,
} from '@keke/shared';
import type { GameState, ItemState, PlayerState } from '../schema/GameState';
import type { BotPersona, BotSkill } from './skill';

/** One input frame without its seq (the bot system numbers them). */
export interface BotFrame {
  readonly move: Vec2;
  readonly aim: number;
  readonly buttons: number;
}

/** What a bot sees of the round's map. Built once per map by the bot system. */
export interface BotMap {
  readonly map: MapModel;
  /** The live grid: parked stock carts are walls (the room's `liveMap`). */
  readonly grid: CollisionGrid;
  /** Tiles a careful bot keeps off (staff-only rooms, the oven). */
  readonly avoid: (tx: number, ty: number) => boolean;
  /** Centre of the office trigger (Race delivery). */
  readonly office: Vec2;
}

interface Goal {
  readonly kind: 'target' | 'item' | 'van' | 'office' | 'player';
  readonly at: Vec2;
  /** Press E on arrival. */
  readonly pickUp?: boolean;
  /** The player this goal follows (a carrier to knock over). */
  readonly player?: string;
}

/** A bot that moved less than this in STUCK_SECONDS while walking somewhere wanders for a moment. */
const STUCK_PX = 8;
const STUCK_SECONDS = 1.2;
const WANDER_SECONDS = 0.5;
const REPATH_SECONDS = 0.6;
/** Close enough to press E (pickup range is one tile, measured from the body centre). */
const PICKUP_SLACK = 0.85;

export class BotBrain {
  private path: Vec2[] = [];
  private goal: Goal | undefined;
  private pathAge = Infinity;
  private thinkLeft = 0;
  private pauseLeft = 0;
  private wanderLeft = 0;
  private wanderDir: Vec2 = { x: 0, y: 0 };
  private stuckClock = 0;
  private stuckFrom: Vec2 = { x: 0, y: 0 };
  /** E, Q and attack act on a press: a new press needs a frame without the button first. */
  private lastButtons = 0;
  private readonly step: number;
  private readonly half;
  private readonly tile: number;

  constructor(
    readonly persona: BotPersona,
    private readonly skill: BotSkill,
    private readonly config: GameConfig,
    private readonly world: BotMap,
    private readonly rng: Rng,
  ) {
    this.step = 1 / config.inputHz;
    this.half = playerHalfSize(config);
    this.tile = config.tileSize;
  }

  /** The goal the bot walks to now, for tests. */
  get goalKind(): Goal['kind'] | undefined {
    return this.goal?.kind;
  }

  /** One input frame for `me`, read from the room state as it stands. */
  frame(me: PlayerState, state: GameState): BotFrame {
    if (!me.alive || me.stunned || me.charging) {
      this.goal = undefined;
      this.path = [];
      this.lastButtons = 0;
      return { move: { x: 0, y: 0 }, aim: me.aim, buttons: 0 };
    }
    const pos = { x: me.x, y: me.y };

    this.thinkLeft -= this.step;
    if (this.thinkLeft <= 0 || !this.goal) {
      this.thinkLeft = this.skill.thinkSeconds * (0.75 + 0.5 * this.rng.next());
      this.choose(me, state);
      if (this.pauseLeft <= 0 && this.rng.chance(this.skill.pauseChancePerSecond * this.skill.thinkSeconds)) {
        this.pauseLeft = this.skill.pauseSeconds;
      }
    }

    let move: Vec2 = { x: 0, y: 0 };
    if (this.pauseLeft > 0 && me.carrying === 0) this.pauseLeft -= this.step;
    else move = this.steer(pos);
    move = this.dodge(me, state, move);
    let aim = move.x !== 0 || move.y !== 0 ? Math.atan2(move.y, move.x) : me.aim;
    let buttons = 0;

    const goal = this.goal;
    if (goal?.pickUp && me.carrying === 0 && dist(pos, goal.at) <= this.tile * PICKUP_SLACK) {
      buttons |= Button.Interact;
    }

    const foe = this.foeInReach(me, state);
    if (foe && this.rng.chance(this.skill.swingChance)) {
      aim = this.aimAt(pos, foe, me.weapon) + (this.rng.next() * 2 - 1) * this.skill.aimErrorRadians;
      buttons |= Button.Attack;
    }

    // Presses: release for one frame after each so the next one counts. Sprays are held down.
    const held =
      this.behaviourOf(me.weapon) === 'spray'
        ? Button.Interact | Button.Drop
        : Button.Attack | Button.Interact | Button.Drop;
    const sent = buttons & ~(this.lastButtons & held);
    this.lastButtons = sent;
    return { move, aim, buttons: sent };
  }

  // --- Decisions -----------------------------------------------------------------------------------

  private choose(me: PlayerState, state: GameState): void {
    const next = this.pickGoal(me, state);
    const moved =
      !this.goal || this.goal.kind !== next.kind || dist(this.goal.at, next.at) > this.tile * 0.75;
    this.goal = next;
    if (moved) this.pathAge = Infinity;
  }

  private pickGoal(me: PlayerState, state: GameState): Goal {
    const pos = { x: me.x, y: me.y };
    const own = vanSpawn(this.world.map, me.van, this.half);
    const carried = me.carrying !== 0 ? state.items.get(String(me.carrying)) : undefined;
    if (carried?.itemId === ORDER_BOX_ITEM_ID) return { kind: 'office', at: this.world.office };
    if (carried) return { kind: 'van', at: own };

    // Wanted and chased: a careful bot heads home, where its team is, rather than into the guard.
    // (A KO ends Wanted too, so it does not run forever.)
    if (this.skill.staffAware && me.wanted && this.guardChasing(me, state, 6)) {
      return { kind: 'van', at: own };
    }

    // Race: an order box is the round. Pick up a loose one, knock over a foe who carries one.
    const looseBox = this.nearestItem(
      state,
      pos,
      this.skill.boxHuntTiles,
      (i) => i.itemId === ORDER_BOX_ITEM_ID,
    );
    if (looseBox) return { kind: 'item', at: { x: looseBox.x, y: looseBox.y }, pickUp: true };
    const boxCarrier = this.nearestFoe(me, state, this.skill.boxHuntTiles, (p) => this.carriesBox(p, state));
    if (boxCarrier) return this.chase(boxCarrier);

    // Our target, unless it is in someone's hands: then that someone.
    const target = me.target !== 0 ? state.items.get(String(me.target)) : undefined;
    const holder = target?.state === 'carried' ? state.players.get(target.carrier) : undefined;

    if (this.persona === 'brawler' || this.skill.carrierHuntTiles > 0) {
      const range =
        this.persona === 'brawler' ? this.skill.carrierHuntTiles : this.skill.carrierHuntTiles / 3;
      const carrier = this.nearestFoe(me, state, range, (p) => p.carrying !== 0);
      if (carrier) return this.chase(carrier);
    }
    if (this.persona === 'thief' || this.skill.looseItemTiles > 0) {
      const range = this.persona === 'thief' ? this.skill.looseItemTiles : this.skill.looseItemTiles / 2;
      const loose = this.nearestItem(state, pos, range, (i) => i.state === 'loose');
      if (loose) return { kind: 'item', at: { x: loose.x, y: loose.y }, pickUp: true };
    }
    if (target && target.state !== 'carried') {
      return { kind: 'target', at: { x: target.x, y: target.y }, pickUp: true };
    }
    if (holder && this.isFoe(me, holder)) return this.chase(holder);
    return { kind: 'van', at: own };
  }

  private chase(p: PlayerState): Goal {
    return { kind: 'player', at: { x: p.x, y: p.y }, player: p.sessionId };
  }

  // --- Walking -------------------------------------------------------------------------------------

  private steer(pos: Vec2): Vec2 {
    const goal = this.goal;
    if (!goal) return { x: 0, y: 0 };
    this.pathAge += this.step;
    // Stuck: walking somewhere but barely moving (a corner, a crowd of customers, a cart).
    this.stuckClock += this.step;
    if (this.stuckClock >= STUCK_SECONDS) {
      const far = dist(pos, goal.at) > this.tile;
      if (far && dist(pos, this.stuckFrom) < STUCK_PX && this.wanderLeft <= 0) {
        const a = this.rng.next() * Math.PI * 2;
        this.wanderDir = { x: Math.cos(a), y: Math.sin(a) };
        this.wanderLeft = WANDER_SECONDS;
        this.pathAge = Infinity;
      }
      this.stuckClock = 0;
      this.stuckFrom = pos;
    }
    if (this.wanderLeft > 0) {
      this.wanderLeft -= this.step;
      return this.wanderDir;
    }
    if (this.pathAge >= REPATH_SECONDS) {
      this.path = this.findPath(pos, goal.at);
      this.pathAge = 0;
    }
    while (this.path.length > 0 && dist(pos, this.path[0] as Vec2) < 6) this.path.shift();
    const next = this.path[0] ?? goal.at;
    const d = dist(pos, next);
    // Next to a foe it chases: stand and swing rather than push into them.
    if (goal.kind === 'player' && dist(pos, goal.at) < this.half.hw * 2 + 4) return { x: 0, y: 0 };
    if (d < 3) return { x: 0, y: 0 };
    return { x: (next.x - pos.x) / d, y: (next.y - pos.y) / d };
  }

  private findPath(from: Vec2, to: Vec2): Vec2[] {
    const gates = this.world.map.gates;
    const base = {
      radius: this.half.hw,
      // A big map with no way through: give up early instead of searching every tile.
      maxExpanded: 6000,
      // In through the entrance doors, out through the checkout (phase 2 decision 9).
      ...(gates.length > 0 && { refuses: (a: Vec2, b: Vec2) => crossesGateWrongWay(gates, a, b, this.half) }),
    };
    if (this.skill.staffAware) {
      const careful = findPath(this.world.grid, from, to, { ...base, blocked: this.world.avoid });
      if (careful) return careful;
    }
    // The goal is inside a place to avoid (a target in the stockroom), or the bot does not care.
    return findPath(this.world.grid, from, to, base) ?? [];
  }

  /** Steps aside from a forklift close by, and away from a guard that chases this bot. */
  private dodge(me: PlayerState, state: GameState, move: Vec2): Vec2 {
    let push = { x: 0, y: 0 };
    const near = this.skill.forkliftDodgeTiles * this.tile;
    for (const npc of state.npcs.values()) {
      if (!npc.alive) continue;
      const dx = me.x - npc.x;
      const dy = me.y - npc.y;
      const d = Math.hypot(dx, dy);
      if (d < 1e-3) continue;
      let reach = 0;
      if (npc.type === 'forklift') reach = near;
      else if (
        this.skill.staffAware &&
        me.wanted &&
        npc.behaviour === 'security' &&
        npc.target === me.sessionId
      ) {
        reach = 4 * this.tile;
      }
      if (d >= reach) continue;
      const w = (reach - d) / reach;
      push = { x: push.x + (dx / d) * w, y: push.y + (dy / d) * w };
    }
    if (push.x === 0 && push.y === 0) return move;
    const x = move.x + push.x * 1.5;
    const y = move.y + push.y * 1.5;
    const len = Math.hypot(x, y);
    return len < 1e-3 ? move : { x: x / len, y: y / len };
  }

  // --- Fighting ------------------------------------------------------------------------------------

  /** A foe this bot's weapon reaches now, or undefined. Careful bots hold back where a guard watches. */
  private foeInReach(me: PlayerState, state: GameState): PlayerState | undefined {
    const reach = this.reachOf(me);
    const foe = this.nearestFoe(me, state, reach / this.tile);
    if (!foe) return undefined;
    if (this.skill.staffAware && !me.wanted && this.guardWatching(me, state)) {
      // Worth the risk only for an order box.
      if (!this.carriesBox(foe, state)) return undefined;
    }
    return foe;
  }

  private reachOf(me: PlayerState): number {
    const def = getWeaponCatalogue().get(me.weapon);
    const body = this.half.hw * 2;
    switch (def?.behaviour) {
      case 'spray':
        return (def.spray?.rangePx ?? 64) * 0.9;
      case 'thrown':
        return (def.projectile?.rangePx ?? 160) * 0.7;
      case 'shot_then_melee': {
        const shotLeft =
          def.uses !== null && def.shotUses !== undefined && me.weaponUses > def.uses - def.shotUses;
        return shotLeft ? (def.shot?.rangePx ?? 160) * 0.6 : (def.melee?.rangePx ?? 28) + body * 0.6;
      }
      case 'charge':
        return (def.charge?.distanceTiles ?? 3) * this.tile * 0.6;
      case 'trap':
        return this.tile * 1.5;
      default:
        return (def?.melee?.rangePx ?? 28) + body * 0.6;
    }
  }

  private aimAt(pos: Vec2, foe: PlayerState, weapon: string): number {
    let at = { x: foe.x, y: foe.y };
    if (this.skill.leadsShots) {
      const def = getWeaponCatalogue().get(weapon);
      const speed =
        def?.behaviour === 'thrown'
          ? def.projectile.speedPxPerSecond
          : def?.behaviour === 'shot_then_melee'
            ? def.shot.speedPxPerSecond
            : undefined;
      if (speed) {
        const t = dist(pos, at) / speed;
        at = { x: foe.x + foe.vx * t, y: foe.y + foe.vy * t };
      }
    }
    // Trap: drop it behind, where a chaser runs.
    if (this.behaviourOf(weapon) === 'trap') return Math.atan2(pos.y - at.y, pos.x - at.x);
    return Math.atan2(at.y - pos.y, at.x - pos.x);
  }

  private behaviourOf(weapon: string): string | undefined {
    return getWeaponCatalogue().get(weapon)?.behaviour;
  }

  // --- Queries -------------------------------------------------------------------------------------

  private isFoe(me: PlayerState, other: PlayerState): boolean {
    if (other.sessionId === me.sessionId || other.spectator || !other.alive || !other.connected) return false;
    if (other.protected) return false;
    return !(me.team !== 0 && other.team === me.team);
  }

  private carriesBox(p: PlayerState, state: GameState): boolean {
    return p.carrying !== 0 && state.items.get(String(p.carrying))?.itemId === ORDER_BOX_ITEM_ID;
  }

  private nearestFoe(
    me: PlayerState,
    state: GameState,
    withinTiles: number,
    accept: (p: PlayerState) => boolean = () => true,
  ): PlayerState | undefined {
    let best: PlayerState | undefined;
    let bestD = withinTiles * this.tile;
    for (const p of state.players.values()) {
      if (!this.isFoe(me, p) || !accept(p)) continue;
      const d = Math.hypot(p.x - me.x, p.y - me.y);
      if (d <= bestD) {
        best = p;
        bestD = d;
      }
    }
    return best;
  }

  private nearestItem(
    state: GameState,
    pos: Vec2,
    withinTiles: number,
    accept: (item: ItemState) => boolean,
  ): ItemState | undefined {
    let best: ItemState | undefined;
    let bestD = withinTiles * this.tile;
    for (const item of state.items.values()) {
      if (item.state === 'carried' || !accept(item)) continue;
      const d = Math.hypot(item.x - pos.x, item.y - pos.y);
      if (d <= bestD) {
        best = item;
        bestD = d;
      }
    }
    return best;
  }

  /** A guard close enough to see a fight here (wantedGuardRangeTiles, walls not checked: be careful). */
  private guardWatching(me: PlayerState, state: GameState): boolean {
    const range = (this.config.wantedGuardRangeTiles + 1) * this.tile;
    for (const npc of state.npcs.values()) {
      if (npc.behaviour !== 'security' || !npc.alive) continue;
      if (Math.hypot(npc.x - me.x, npc.y - me.y) <= range) return true;
    }
    return false;
  }

  private guardChasing(me: PlayerState, state: GameState, withinTiles: number): boolean {
    for (const npc of state.npcs.values()) {
      if (npc.behaviour !== 'security' || !npc.alive || npc.target !== me.sessionId) continue;
      if (Math.hypot(npc.x - me.x, npc.y - me.y) <= withinTiles * this.tile) return true;
    }
    return false;
  }
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
