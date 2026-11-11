// Wanted status (§8, M5-2). Pure and immutable like combat.ts: each operation takes a `WantedWorld` and
// returns a new one plus the events it caused, so the server can mirror the status into its schema and
// broadcast the events (the ❗ icon and the alarm sound play from them). `now` is the round clock in seconds.
//
// A player becomes Wanted for `wantedSeconds` (20 s; a new offence restarts the full 20 s) when they
//  - damage any NPC,
//  - damage a player while a security guard within `wantedGuardRangeTiles` (6) tiles has a clear line of
//    sight to the attacker or to the victim,
//  - enter a zone with `wantedOnEnter` (staff_only). They stay Wanted while inside; the 20 s run from leaving.
// A KO ends the status (`clearWanted`, playtest 1): a Wanted player who respawned at the dock was
// chased straight back down by the staff-door guard.
// Wanted is per player, also with Teams on. Only hits that land with damage > 0 count: a 0-damage slip
// or push is not "damage", and a rejected hit (teammate, spawn protection) never reaches these rules.
// NPC ids and types are the server's business (M5-1/M5-3): guards come in as plain ids + positions.
import type { GameConfig } from '../config';
import { pointInPolygon } from '../map/geometry';
import type { Zone } from '../map/mapModel';
import type { Vec2 } from '../types';
import type { CollisionGrid } from './collision';
import type { CombatEvent } from './combat';
import { clearLine } from './spray';

export type WantedConfig = Pick<GameConfig, 'tileSize' | 'wantedSeconds' | 'wantedGuardRangeTiles'>;

export interface WantedEntry {
  readonly id: string;
  /** Round time the status runs out; null = not Wanted. Wanted while `now < until`. */
  readonly until: number | null;
  /** Inside a `wantedOnEnter` zone at the last `updateWantedZones` call. */
  readonly inZone: boolean;
}

export interface WantedWorld {
  /** In the order players were first seen. */
  readonly players: readonly WantedEntry[];
}

/** Why a player became (or stayed) Wanted. */
export type WantedReason = 'npc_damage' | 'witnessed' | 'zone';

export type WantedEvent =
  /** The status started (`refreshed` false) or a new offence restarted the timer (`refreshed` true). */
  | {
      readonly type: 'wanted';
      readonly player: string;
      readonly until: number;
      readonly reason: WantedReason;
      readonly refreshed: boolean;
      /** The guard that saw it, for `witnessed`. */
      readonly guard?: string;
      /** The NPC that was hit, for `npc_damage`. */
      readonly npc?: string;
    }
  | { readonly type: 'wantedEnded'; readonly player: string };

export interface WantedResult {
  readonly world: WantedWorld;
  readonly events: readonly WantedEvent[];
}

/** A hit that landed, in the generic shape these rules need. */
export interface WantedHit {
  /** The player who dealt it. Hits by NPCs and hazards are not offences, so do not pass them. */
  readonly attacker: string;
  readonly victim: { readonly kind: 'player' | 'npc'; readonly id: string };
  readonly damage: number;
}

/** A security guard that can witness a fight: any id and its position in pixels. */
export interface WantedWatcher {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

export interface WitnessContext {
  /** Security guards that are up (leave KO'd guards out). */
  readonly guards: readonly WantedWatcher[];
  /** Player positions in pixels (body centre); undefined = unknown, never witnessed there. */
  readonly positionOf: (playerId: string) => Vec2 | undefined;
  /** Walls block sight; without a grid every guard in range sees. */
  readonly grid?: CollisionGrid;
}

export function createWantedWorld(): WantedWorld {
  return { players: [] };
}

export function findWanted(world: WantedWorld, id: string): WantedEntry | undefined {
  return world.players.find((p) => p.id === id);
}

/** True while the player is Wanted at round time `now`. */
export function isWanted(world: WantedWorld, id: string, now: number): boolean {
  const until = findWanted(world, id)?.until ?? null;
  return until !== null && now < until;
}

/** Seconds of Wanted status left (0 when not Wanted), e.g. for a countdown on the ❗ icon. */
export function wantedSecondsLeft(world: WantedWorld, id: string, now: number): number {
  const until = findWanted(world, id)?.until ?? null;
  return until === null ? 0 : Math.max(0, until - now);
}

/** Ids of every player Wanted at `now`, in world order (what a guard may chase). */
export function wantedPlayers(world: WantedWorld, now: number): string[] {
  return world.players.filter((p) => p.until !== null && now < p.until).map((p) => p.id);
}

/** Forget a player who left the room. */
export function removeWantedPlayer(world: WantedWorld, id: string): WantedWorld {
  return { players: world.players.filter((p) => p.id !== id) };
}

function upsert(world: WantedWorld, entry: WantedEntry): WantedWorld {
  const i = world.players.findIndex((p) => p.id === entry.id);
  if (i < 0) return { players: [...world.players, entry] };
  const players = world.players.slice();
  players[i] = entry;
  return { players };
}

/**
 * Makes `player` Wanted until `now + wantedSeconds`, or restarts the timer if they already are. The
 * timer never moves backwards.
 */
export function markWanted(
  world: WantedWorld,
  player: string,
  reason: WantedReason,
  now: number,
  config: WantedConfig,
  detail: { guard?: string; npc?: string } = {},
): WantedResult {
  const entry = findWanted(world, player) ?? { id: player, until: null, inZone: false };
  const refreshed = entry.until !== null && now < entry.until;
  const until = Math.max(now + config.wantedSeconds, refreshed ? (entry.until as number) : -Infinity);
  const event: WantedEvent = {
    type: 'wanted',
    player,
    until,
    reason,
    refreshed,
    ...(detail.guard !== undefined ? { guard: detail.guard } : {}),
    ...(detail.npc !== undefined ? { npc: detail.npc } : {}),
  };
  return { world: upsert(world, { ...entry, until }), events: [event] };
}

/**
 * The first guard (in input order) within `wantedGuardRangeTiles` tiles of `at` with a clear line of
 * sight to it, or undefined. Distance is centre to centre; a body exactly at the range counts.
 */
export function witnessingGuard(
  at: Vec2,
  guards: readonly WantedWatcher[],
  config: Pick<WantedConfig, 'tileSize' | 'wantedGuardRangeTiles'>,
  grid?: CollisionGrid,
): WantedWatcher | undefined {
  const range = config.wantedGuardRangeTiles * config.tileSize;
  return guards.find((g) => Math.hypot(g.x - at.x, g.y - at.y) <= range && (!grid || clearLine(grid, g, at)));
}

/**
 * Turns the combat core's `hit` events into `WantedHit`s: those with a player source, a player target
 * other than the source, and damage > 0. NPC victims are not in the combat world; the NPC system (M5-3)
 * builds their `WantedHit`s itself.
 */
export function wantedHitsFromCombat(events: readonly CombatEvent[]): WantedHit[] {
  const hits: WantedHit[] = [];
  for (const e of events) {
    if (e.type !== 'hit' || e.source.kind !== 'player') continue;
    if (e.damage <= 0 || e.source.id === e.target) continue;
    hits.push({ attacker: e.source.id, victim: { kind: 'player', id: e.target }, damage: e.damage });
  }
  return hits;
}

/**
 * Applies landed hits in order: damaging an NPC makes the attacker Wanted; damaging another player does so
 * when a guard witnesses the attacker or the victim (see `witnessingGuard`). Positions are read at the
 * time of the call, so call it in the tick the hits land.
 */
export function applyWantedHits(
  world: WantedWorld,
  hits: readonly WantedHit[],
  ctx: WitnessContext,
  now: number,
  config: WantedConfig,
): WantedResult {
  let w = world;
  const events: WantedEvent[] = [];
  for (const h of hits) {
    if (h.damage <= 0) continue;
    let result: WantedResult | undefined;
    if (h.victim.kind === 'npc') {
      result = markWanted(w, h.attacker, 'npc_damage', now, config, { npc: h.victim.id });
    } else if (h.victim.id !== h.attacker) {
      const guard = [ctx.positionOf(h.attacker), ctx.positionOf(h.victim.id)]
        .filter((p): p is Vec2 => p !== undefined)
        .map((p) => witnessingGuard(p, ctx.guards, config, ctx.grid))
        .find((g) => g !== undefined);
      if (guard) result = markWanted(w, h.attacker, 'witnessed', now, config, { guard: guard.id });
    }
    if (result) {
      w = result.world;
      events.push(...result.events);
    }
  }
  return { world: w, events };
}

/** True when (x, y) lies in any zone with `wantedOnEnter`, nested zones included. */
export function inWantedZone(zones: readonly Zone[], x: number, y: number): boolean {
  return zones.some((z) => z.wantedOnEnter && pointInPolygon(x, y, z.polygon));
}

/**
 * Call every tick with whether each living player is inside a `wantedOnEnter` zone (`inWantedZone`).
 * Stepping in makes them Wanted (a `wanted` event, reason `zone`); while they stay inside the timer is
 * held at the full `wantedSeconds` without further events, so it runs down only after they leave.
 * Players not listed keep their last flag (pass KO'd players as outside if they respawn elsewhere).
 */
export function updateWantedZones(
  world: WantedWorld,
  players: readonly { readonly id: string; readonly inZone: boolean }[],
  now: number,
  config: WantedConfig,
): WantedResult {
  let w = world;
  const events: WantedEvent[] = [];
  for (const p of players) {
    const entry = findWanted(w, p.id) ?? { id: p.id, until: null, inZone: false };
    if (p.inZone && !entry.inZone) {
      const result = markWanted(w, p.id, 'zone', now, config);
      w = upsert(result.world, { ...(findWanted(result.world, p.id) as WantedEntry), inZone: true });
      events.push(...result.events);
    } else if (p.inZone) {
      const until = Math.max(entry.until ?? -Infinity, now + config.wantedSeconds);
      w = upsert(w, { ...entry, until });
    } else if (entry.inZone || !findWanted(w, p.id)) {
      w = upsert(w, { ...entry, inZone: false });
    }
  }
  return { world: w, events };
}

/**
 * Ends the status of `ids` at once (a KO, playtest 1): `wantedEnded` for each one who was Wanted, and
 * their zone flag is dropped so leaving a `wantedOnEnter` zone by KO starts no new timer.
 */
export function clearWanted(world: WantedWorld, ids: Iterable<string>): WantedResult {
  const clear = new Set(ids);
  const events: WantedEvent[] = [];
  let changed = false;
  const players = world.players.map((p) => {
    if (!clear.has(p.id) || (p.until === null && !p.inZone)) return p;
    changed = true;
    if (p.until !== null) events.push({ type: 'wantedEnded', player: p.id });
    return { ...p, until: null, inZone: false };
  });
  return changed ? { world: { players }, events } : { world, events };
}

/** Call every tick: ends the status of players whose time ran out (`wantedEnded`, until -> null). */
export function expireWanted(world: WantedWorld, now: number): WantedResult {
  const events: WantedEvent[] = [];
  const players = world.players.map((p) => {
    if (p.until === null || now < p.until) return p;
    events.push({ type: 'wantedEnded', player: p.id });
    return { ...p, until: null };
  });
  return events.length === 0 ? { world, events } : { world: { players }, events };
}
