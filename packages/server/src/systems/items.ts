// Items and vans on the server (§3, §3.1, §3.2, §15.3). Owns one immutable ItemWorld per round from the
// shared carry rules, does what those rules leave to the server (range checks, button edges, the
// round clock), mirrors the world into the synced schema and broadcasts each rule event.
import {
  Button,
  addCarryPlayer,
  assignTargets,
  carryMultiplier,
  createItemWorld,
  createRng,
  deliver,
  deposit,
  despawnLooseItems,
  drop,
  findCarryPlayer,
  getItemCatalogue,
  inDepositRange,
  isCarryingBox,
  isOrderBox,
  itemEventToWire,
  itemsControlled,
  moveLyingItems,
  nearestInReach,
  pickup,
  raceDeposit,
  raceEventToWire,
  removeCarryPlayer,
  scatterMoves,
  vanCentre,
  type CarryResult,
  type DropReason,
  type ItemEvent,
  type GameConfig,
  type ItemCatalogue,
  type ItemEventWire,
  type ItemWorld,
  type MapModel,
  type PickupKind,
  type RaceDelivery,
  type RaceEvent,
  type RaceEventWire,
  type RaceResult,
  type Rng,
  type StepModifiers,
  type ThemeId,
  type Vec2,
} from '@keke/shared';
import { ItemState, VanState, type GameState, type PlayerState } from '../schema/GameState';

/** Item events (M3-4) and, in race mode, race events (M6-2: `boxPacked`, `delivery`). */
export type ItemBroadcast = (event: ItemEventWire | RaceEventWire) => void;
/**
 * Called once per committed `pickup` event, whatever caused it (M3 review H2: the weapon roll hooks here).
 * `kind` 'box' is an order box (M6-2): no weapon roll for it (plan M4-1).
 */
export type PickupListener = (playerId: string, kind: PickupKind) => void;

const isRaceEvent = (event: ItemEvent | RaceEvent): event is RaceEvent =>
  event.type === 'boxPacked' || event.type === 'delivery';

export class ItemSystem {
  private world: ItemWorld = createItemWorld();
  private rng: Rng;
  private readonly catalogue: ItemCatalogue;
  /** True from a round's countdown until the lobby: item actions and despawns run only then. */
  private running = false;
  /** Set by the room: CombatSystem rolls a weapon on every pickup (§7) except an order box's (M6-2). */
  onPickup: PickupListener | null = null;

  constructor(
    private readonly state: GameState,
    private readonly config: GameConfig,
    private readonly map: MapModel,
    private readonly broadcast: ItemBroadcast,
    theme: ThemeId,
    seed: number,
  ) {
    this.catalogue = getItemCatalogue(theme);
    this.rng = createRng(seed);
  }

  /** The current round's world (read-only view for tests and later systems, e.g. M3-5 ranking). */
  get itemWorld(): ItemWorld {
    return this.world;
  }

  /** True while the round's items are live (from the countdown until the lobby or the next countdown). */
  get active(): boolean {
    return this.running;
  }

  /**
   * A new round (countdown): a fresh world with every round player at their van and a first target
   * each. `players` are the non-spectators, in join order; their `van` is already assigned.
   */
  startRound(players: readonly PlayerState[], seed?: number): void {
    if (seed !== undefined) this.rng = createRng(seed);
    this.reset();
    let world = createItemWorld();
    for (const p of players) world = addCarryPlayer(world, p.sessionId, Math.max(0, p.van));
    this.running = true;
    for (const p of players) {
      const key = String(Math.max(0, p.van));
      if (this.state.vans.has(key)) continue;
      const van = new VanState();
      van.van = Math.max(0, p.van);
      van.team = this.state.settings.teams ? p.team : 0;
      this.state.vans.set(key, van);
    }
    this.commit({ world, events: [] });
    this.sync();
  }

  /** Back to the lobby: no items in the world, no vans in use. Player vans stay assigned. */
  reset(): void {
    this.world = createItemWorld();
    this.running = false;
    this.state.items.clear();
    this.state.vans.clear();
    this.state.players.forEach((p) => {
      p.carrying = 0;
      p.target = 0;
      p.deposited = 0;
    });
  }

  /** Movement modifiers for a player, from synced state only, the same rule the client predicts with (H1). */
  modifiers(player: PlayerState): StepModifiers {
    return { speedMultiplier: carryMultiplier(this.config, player.carrying !== 0) };
  }

  /**
   * After each applied input frame: Q drops the carried item, E picks up the nearest lying item in
   * range, and a carrier at their own van deposits automatically. `now` is the round clock in seconds.
   * `handsFree` false (stunned or sliding, CombatSystem.canPickUp) ignores Q and E but still deposits.
   */
  afterFrame(player: PlayerState, pressed: number, now: number, handsFree = true): void {
    if (!this.running || !findCarryPlayer(this.world, player.sessionId)) return;
    const pos = { x: player.x, y: player.y };
    if (!handsFree) {
      // Neither drop nor pick up; fall through to the deposit check.
    } else if (pressed & Button.Drop && player.carrying !== 0) {
      this.commit(drop(this.world, player.sessionId, pos, now, 'drop'));
    } else if (pressed & Button.Interact && player.carrying === 0) {
      const lying = this.world.items.filter((i) => i.state !== 'carried');
      const item = nearestInReach(pos, lying, this.config);
      if (item) this.commit(pickup(this.world, player.sessionId, item.id));
    }
    if (player.carrying !== 0) {
      const van = vanCentre(this.map.vanSlots, Math.max(0, player.van));
      if (van && inDepositRange(pos, van, this.config)) {
        // Race (§4.2): a deposit that reaches the quota packs the order box into the depositor's hands.
        // A box carrier at their van is refused with box_not_depositable every frame; commit ignores it.
        this.commit(
          this.race
            ? raceDeposit(this.world, player.sessionId, pos, this.config)
            : deposit(this.world, player.sessionId, this.config),
        );
      }
    }
  }

  /** True while the room's mode is Quota + Race (the host setting, fixed from Start to the lobby). */
  private get race(): boolean {
    return this.state.settings.mode === 'race';
  }

  /** True when `player` carries an order box (race mode). */
  carriesBox(player: PlayerState): boolean {
    return this.running && isCarryingBox(this.world, player.sessionId);
  }

  /**
   * Race (§4.2): `player`, carrying an order box, is inside the office trigger (checked by the room). The
   * box leaves the world and the `delivery` event goes out. Returns the delivery, or null when the player
   * carries no box.
   */
  deliverBox(player: PlayerState, now: number): RaceDelivery | null {
    if (!this.running) return null;
    const result = deliver(this.world, player.sessionId, now);
    if (result.rejected || !result.delivery) return null;
    this.commit(result);
    return result.delivery;
  }

  /**
   * Debug only (`DebugMessage.vanPoints`): sets the banked points of `player`'s van, so an e2e spec
   * reaches the race quota with one deposit. False when no round runs or the player is not in it.
   */
  setVanPoints(player: PlayerState, points: number): boolean {
    const carry = this.running ? findCarryPlayer(this.world, player.sessionId) : undefined;
    if (!carry) return false;
    this.world = { ...this.world, vanPoints: { ...this.world.vanPoints, [carry.van]: points } };
    this.sync();
    return true;
  }

  /** Once per server tick, after movement: loose items past their time despawn. */
  tick(now: number): void {
    if (!this.running) return;
    this.commit(despawnLooseItems(this.world, now, this.config));
  }

  /** Drops what `player` carries where they stand (disconnect, KO). No-op when not carrying. */
  dropCarried(player: PlayerState, now: number, reason: DropReason): void {
    if (!this.running || player.carrying === 0) return;
    this.commit(drop(this.world, player.sessionId, { x: player.x, y: player.y }, now, reason));
  }

  /** Pushes the lying items within `halfWidth` of from→to `px` pixels out of that line (pallet jack, §7). */
  scatter(from: Vec2, to: Vec2, halfWidth: number, px: number): void {
    if (!this.running) return;
    const lying = this.world.items.filter((i) => i.state !== 'carried');
    const moves = scatterMoves(this.map.collision, from, to, halfWidth, px, lying);
    if (moves.length > 0) this.commit(moveLyingItems(this.world, moves));
  }

  /** A player left the room for good: their carried item drops, their target despawns (M3-2). */
  removePlayer(player: PlayerState, now: number): void {
    if (!this.running || !findCarryPlayer(this.world, player.sessionId)) return;
    this.commit(removeCarryPlayer(this.world, player.sessionId, { x: player.x, y: player.y }, now));
  }

  /**
   * Takes a rule result: keeps its world, gives targets to anyone who lost theirs (same tick, §3.1),
   * broadcasts the events in order and mirrors the world into the schema. A refused action changes nothing.
   */
  private commit(result: CarryResult | RaceResult): void {
    if (result.rejected) return;
    const assigned = assignTargets(result.world, {
      catalogue: this.catalogue.items,
      map: this.map,
      rng: this.rng,
      config: this.config,
    });
    const events = [...result.events, ...assigned.events];
    if (assigned.world === this.world && events.length === 0) return;
    this.world = assigned.world;
    this.sync();
    for (const event of events) {
      if (isRaceEvent(event)) {
        this.broadcast(raceEventToWire(event));
        continue;
      }
      this.broadcast(itemEventToWire(event));
      if (event.type === 'pickup') this.onPickup?.(event.player, event.kind);
    }
  }

  /** Mirrors the world into `GameState.items`, the vans' points and each player's carry fields. */
  private sync(): void {
    const items = this.state.items;
    const live = new Set<string>();
    for (const item of this.world.items) {
      const key = String(item.id);
      live.add(key);
      let s = items.get(key);
      if (!s) {
        s = new ItemState();
        s.id = item.id;
        s.itemId = item.itemId;
        s.rarity = item.rarity;
        items.set(key, s);
      }
      s.state = item.state;
      s.x = item.x;
      s.y = item.y;
      s.owner = item.owner ?? '';
      s.carrier = item.carrier ?? '';
      // Order boxes (M6-2): the van that packed it and the points inside; -1 / 0 for normal items.
      s.packedVan = isOrderBox(item) ? item.box.van : -1;
      s.points = isOrderBox(item) ? item.box.points : 0;
    }
    for (const key of [...items.keys()]) if (!live.has(key)) items.delete(key);

    for (const [key, points] of Object.entries(this.world.vanPoints)) {
      let van = this.state.vans.get(key);
      if (!van) {
        van = new VanState();
        van.van = Number(key);
        this.state.vans.set(key, van);
      }
      van.points = points;
    }
    // Race (§4.2): "items you control" per van, the race scoreboard and the time-cap ranking.
    this.state.vans.forEach((van) => {
      const controlled = this.race ? itemsControlled(this.world, van.van) : van.points;
      if (van.controlled !== controlled) van.controlled = controlled;
    });
    for (const p of this.world.players) {
      const player = this.state.players.get(p.id);
      if (!player) continue;
      player.carrying = p.carrying ?? 0;
      player.target = p.target ?? 0;
      player.deposited = p.deposited;
    }
  }
}
