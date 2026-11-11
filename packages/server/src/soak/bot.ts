import type { Room as ClientRoom } from '@colyseus/sdk';
import {
  Button,
  ClientMessage,
  ORDER_BOX_ITEM_ID,
  findPath,
  playerHalfSize,
  vanSpawn,
  type GameConfig,
  type MapModel,
  type Vec2,
} from '@keke/shared';
import type { GameRoom } from '../rooms/GameRoom';
import type { GameState, ItemState, NpcState, PlayerState } from '../schema/GameState';

// M7-4 soak: one simulated player. It plays from its own decoded copy of the room state, as a real
// client would: walks the map with the shared pathfinder, picks up its target (E), brings it to its van,
// carries a race order box to the office, fights other players and hits store workers (which makes it
// Wanted). It sends one InputFrame per fixed input step (1 / inputHz s), idle frames included, like the
// browser client. No prediction: it steers from the last patch, which is good enough for a bot.

export type SoakConn = ClientRoom<GameRoom, GameState>;

/**
 * What a bot prefers when it is free to choose. Every persona still fetches its own target when nothing
 * else is going on, fights back when someone is next to it and carries a race box to the office.
 */
export type Persona = 'runner' | 'thief' | 'brawler' | 'vandal';
export const PERSONAS: readonly Persona[] = ['runner', 'brawler', 'thief', 'vandal'];

/** Close enough to swing fists at (fists reach 28 px past the body edge; this is centre to centre). */
const MELEE_REACH_PX = 40;
/** Held weapons other than fists are used on anyone this close (throwables and sprays reach far). */
const WEAPON_REACH_PX = 5 * 32;
/** A bot that moved less than this in STUCK_SECONDS while walking somewhere wanders for a moment. */
const STUCK_PX = 8;
const STUCK_SECONDS = 1.5;
const WANDER_SECONDS = 0.6;
const REPATH_SECONDS = 0.6;

interface Goal {
  readonly kind: 'target' | 'item' | 'van' | 'office' | 'player' | 'npc' | 'wander';
  readonly at: Vec2;
  /** Press E on arrival (items). */
  readonly pickUp?: number;
  /** Swing at whoever is at the goal (players, NPCs). */
  readonly attack?: boolean;
}

export interface BotStats {
  framesSent: number;
  pickupsTried: number;
  attacksTried: number;
  dropsTried: number;
  wanders: number;
}

/** A tiny seeded PRNG so a soak run with the same seed makes the same choices (timing still varies). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class SoakBot {
  readonly stats: BotStats = { framesSent: 0, pickupsTried: 0, attacksTried: 0, dropsTried: 0, wanders: 0 };
  private seq = 0;
  private path: Vec2[] = [];
  private goal: Goal | undefined;
  private pathAge = Infinity;
  private wanderLeft = 0;
  private wanderDir: Vec2 = { x: 0, y: 0 };
  private stuckClock = 0;
  private stuckFrom: Vec2 = { x: 0, y: 0 };
  /** E, Q and attack are edge-triggered on the server: a press needs a frame without it first. */
  private lastButtons = 0;
  private readonly half;
  private readonly step: number;
  private office: Vec2;

  constructor(
    readonly conn: SoakConn,
    readonly persona: Persona,
    private map: MapModel,
    private readonly config: GameConfig,
    private readonly random: () => number,
  ) {
    this.half = playerHalfSize(config);
    this.step = 1 / config.inputHz;
    this.office = officeCentre(map);
  }

  /** The map the next session plays on (Phase 2: the soak plays sessions on both maps). */
  useMap(map: MapModel): void {
    this.map = map;
    this.office = officeCentre(map);
    this.path = [];
    this.goal = undefined;
  }

  get state(): GameState {
    return this.conn.state;
  }

  get me(): PlayerState | undefined {
    return this.conn.state.players.get(this.conn.sessionId);
  }

  /** One fixed input step. Sends nothing outside 'playing' (the server would drop it anyway). */
  frame(): void {
    const me = this.me;
    if (!me || me.spectator || this.state.phase !== 'playing' || !this.conn.connection.isOpen) {
      this.goal = undefined;
      this.path = [];
      return;
    }
    const pos = { x: me.x, y: me.y };
    let move: Vec2 = { x: 0, y: 0 };
    let aim = me.aim;
    let buttons = 0;

    if (me.alive) {
      this.chooseGoal(me);
      move = this.steer(pos);
      if (move.x !== 0 || move.y !== 0) aim = Math.atan2(move.y, move.x);

      // Opportunistic fighting: anyone hostile within reach gets a swing, aimed at them.
      const foe = this.nearestFoe(me);
      const reach = me.weapon === 'fists' ? MELEE_REACH_PX : WEAPON_REACH_PX;
      const swingChance = this.persona === 'brawler' ? 0.6 : 0.25;
      if (foe && foe.distance <= reach && this.random() < swingChance) {
        aim = Math.atan2(foe.at.y - pos.y, foe.at.x - pos.x);
        buttons |= Button.Attack;
      }
      // Goal-driven actions on arrival.
      const goal = this.goal;
      if (goal && dist(pos, goal.at) <= this.config.tileSize * 0.9) {
        if (goal.pickUp !== undefined && me.carrying === 0) buttons |= Button.Interact;
        if (goal.attack) {
          aim = Math.atan2(goal.at.y - pos.y, goal.at.x - pos.x);
          buttons |= Button.Attack;
        }
      }
      // Now and then a carrier drops what it holds (a loose item for someone else to grab).
      if (me.carrying !== 0 && this.random() < 0.002) buttons |= Button.Drop;
    }

    // Edge-triggered buttons: release for one frame after each press so the next one counts.
    const edge = Button.Attack | Button.Interact | Button.Drop;
    buttons &= ~(this.lastButtons & edge);
    this.lastButtons = buttons;
    if (buttons & Button.Interact) this.stats.pickupsTried++;
    if (buttons & Button.Attack) this.stats.attacksTried++;
    if (buttons & Button.Drop) this.stats.dropsTried++;

    this.seq += 1;
    this.conn.send(ClientMessage.input, { seq: this.seq, move, aim, buttons });
    this.stats.framesSent++;
  }

  // --- Decisions -------------------------------------------------------------------------------

  private chooseGoal(me: PlayerState): void {
    const pos = { x: me.x, y: me.y };
    const carried = me.carrying !== 0 ? this.state.items.get(String(me.carrying)) : undefined;
    let next: Goal | undefined;

    if (carried && carried.itemId === ORDER_BOX_ITEM_ID) {
      next = { kind: 'office', at: this.office };
    } else if (carried) {
      next = { kind: 'van', at: vanSpawn(this.map, me.van, this.half) };
    } else if (this.persona === 'brawler') {
      const victim = this.richestFoe(me);
      if (victim) next = { kind: 'player', at: victim, attack: true };
    } else if (this.persona === 'vandal' && !me.wanted) {
      const npc = this.nearestNpc(pos, 'stocker', 16 * this.config.tileSize);
      if (npc) next = { kind: 'npc', at: { x: npc.x, y: npc.y }, attack: true };
    } else if (this.persona === 'thief') {
      const item = this.nearestStealable(me, 14 * this.config.tileSize);
      if (item) next = { kind: 'item', at: { x: item.x, y: item.y }, pickUp: item.id };
    }
    if (!next) {
      const target = me.target !== 0 ? this.state.items.get(String(me.target)) : undefined;
      if (target && target.state !== 'carried') {
        next = { kind: 'target', at: { x: target.x, y: target.y }, pickUp: target.id };
      } else {
        // Our target is in someone's hands (or none is free): go and get it back.
        const holder = target?.carrier ? this.state.players.get(target.carrier) : undefined;
        if (holder) next = { kind: 'player', at: { x: holder.x, y: holder.y }, attack: true };
      }
    }
    if (!next) next = { kind: 'van', at: vanSpawn(this.map, me.van, this.half) };

    const moved = !this.goal || this.goal.kind !== next.kind || dist(this.goal.at, next.at) > 24;
    this.goal = next;
    if (moved) this.pathAge = Infinity;
  }

  private steer(pos: Vec2): Vec2 {
    this.pathAge += this.step;
    // Stuck check: walking somewhere but barely moving (a wall corner, a crowd, a forklift).
    this.stuckClock += this.step;
    if (this.stuckClock >= STUCK_SECONDS) {
      const goalFar = this.goal && dist(pos, this.goal.at) > this.config.tileSize;
      if (goalFar && dist(pos, this.stuckFrom) < STUCK_PX && this.wanderLeft <= 0) {
        const a = this.random() * Math.PI * 2;
        this.wanderDir = { x: Math.cos(a), y: Math.sin(a) };
        this.wanderLeft = WANDER_SECONDS;
        this.stats.wanders++;
        this.pathAge = Infinity;
      }
      this.stuckClock = 0;
      this.stuckFrom = pos;
    }
    if (this.wanderLeft > 0) {
      this.wanderLeft -= this.step;
      return this.wanderDir;
    }
    if (!this.goal) return { x: 0, y: 0 };
    if (this.pathAge >= REPATH_SECONDS) {
      this.path = findPath(this.map.collision, pos, this.goal.at, { radius: this.half.hw }) ?? [];
      this.pathAge = 0;
    }
    while (this.path.length > 0 && dist(pos, this.path[0] as Vec2) < 6) this.path.shift();
    const next = this.path[0] ?? this.goal.at;
    const d = dist(pos, next);
    if (d < 4) return { x: 0, y: 0 };
    return { x: (next.x - pos.x) / d, y: (next.y - pos.y) / d };
  }

  // --- Queries on the decoded state ------------------------------------------------------------

  private isFoe(me: PlayerState, other: PlayerState): boolean {
    if (other.sessionId === me.sessionId || other.spectator || !other.alive || !other.connected) return false;
    return !(me.team !== 0 && other.team === me.team);
  }

  private nearestFoe(me: PlayerState): { at: Vec2; distance: number } | undefined {
    let best: { at: Vec2; distance: number } | undefined;
    for (const p of this.state.players.values()) {
      if (!this.isFoe(me, p)) continue;
      const d = Math.hypot(p.x - me.x, p.y - me.y);
      if (!best || d < best.distance) best = { at: { x: p.x, y: p.y }, distance: d };
    }
    for (const n of this.state.npcs.values()) {
      // Store workers only get hit by vandals (the others leave them alone, like most players).
      if (this.persona !== 'vandal' || !n.alive || n.type === 'forklift') continue;
      const d = Math.hypot(n.x - me.x, n.y - me.y);
      if (!best || d < best.distance) best = { at: { x: n.x, y: n.y }, distance: d };
    }
    return best;
  }

  /** A carrier first (they drop what they hold on a KO), else the nearest foe. */
  private richestFoe(me: PlayerState): Vec2 | undefined {
    let best: { at: Vec2; score: number } | undefined;
    for (const p of this.state.players.values()) {
      if (!this.isFoe(me, p)) continue;
      const score = Math.hypot(p.x - me.x, p.y - me.y) - (p.carrying !== 0 ? 600 : 0);
      if (!best || score < best.score) best = { at: { x: p.x, y: p.y }, score };
    }
    return best?.at;
  }

  private nearestNpc(pos: Vec2, type: string, within: number): NpcState | undefined {
    let best: NpcState | undefined;
    let bestD = within;
    for (const n of this.state.npcs.values()) {
      if (n.type !== type || !n.alive) continue;
      const d = Math.hypot(n.x - pos.x, n.y - pos.y);
      if (d < bestD) {
        best = n;
        bestD = d;
      }
    }
    return best;
  }

  /** A loose item, an order box lying around, or someone else's target. */
  private nearestStealable(me: PlayerState, within: number): ItemState | undefined {
    let best: ItemState | undefined;
    let bestD = within;
    for (const item of this.state.items.values()) {
      if (item.state === 'carried') continue;
      if (item.state === 'target' && item.owner === me.sessionId) continue;
      const d = Math.hypot(item.x - me.x, item.y - me.y);
      if (d < bestD) {
        best = item;
        bestD = d;
      }
    }
    return best;
  }
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function officeCentre(map: MapModel): Vec2 {
  const b = map.officeTrigger.bounds;
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}
