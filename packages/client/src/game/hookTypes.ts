// `window.__KEKE__`: a test/debug hook installed only with `?debug=1` (§17). E2E specs read state through
// it instead of reading pixels off the canvas. Grows with later milestones (scripted pickup, deposit, …).
// Types only (no DOM), so the Playwright specs can import them too.

export interface KekePlayerSnapshot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: string;
  /** Zone id under the player, or null outside every zone. */
  zone: string | null;
}

/** A player's combat state from the last patch (M4-2). */
export interface KekeCombatSnapshot {
  hp: number;
  alive: boolean;
  /** Held weapon id ('fists' when nothing else). */
  weapon: string;
  /** Uses left (spray: seconds); null = unlimited. */
  weaponUses: number | null;
  stunned: boolean;
  /** Spawn protection after a respawn. */
  protected: boolean;
  /** Whole seconds to the respawn while KO'd, else 0. */
  respawnIn: number;
}

/** A combat broadcast as the client received it (`attack`, `hit`, `ko`, `respawn`, `weaponRolled`, `weaponSpent`). */
export interface KekeCombatEvent {
  type: string;
  payload: unknown;
}

/** A remote player as the Game scene draws them (online only). */
export interface KekeRemoteSnapshot extends KekeCombatSnapshot {
  /** Session id (same as the lobby's data-player-id). */
  id: string;
  nickname: string;
  /** Drawn (interpolated, ~100 ms behind) position. */
  x: number;
  y: number;
  /** Latest authoritative position from the server. */
  serverX: number;
  serverY: number;
  connected: boolean;
}

/** Netcode state of the local player, or null offline (`?scene=game`). */
export interface KekeNetSnapshot extends KekeCombatSnapshot {
  code: string;
  sessionId: string;
  /** RoundPhase. */
  phase: string;
  /** True while the local player is predicted and sending inputs (phase 'playing', not spectating). */
  controlling: boolean;
  spectator: boolean;
  /** Session id the spectator camera follows, or null. */
  spectating: string | null;
  /** Inputs sent and not yet acked. */
  pendingInputs: number;
  /** Last acked input seq from the server. */
  ack: number;
  /** Pixels the last reconcile moved our prediction (0 = the server agreed). */
  lastCorrection: number;
  /** Our 0-based van slot (-1 before the first round); its map `index` is van + 1. */
  van: number;
  /** World item id we carry, 0 = none. */
  carrying: number;
  /** World item id of our target, 0 = none (while carrying our own target, or no spawn free). */
  target: number;
  /** Item points we deposited this round. */
  deposited: number;
}

/** A world item as the Game scene draws it (M3-6). */
export interface KekeItemSnapshot {
  /** World item id (`net().target` / `net().carrying` point at these). */
  id: number;
  /** Catalogue id. */
  itemId: string;
  /** Catalogue name, as shown. */
  name: string;
  rarity: 'normal' | 'joke';
  state: 'target' | 'loose' | 'carried';
  /** Drawn centre: on the floor, or above the carrier's drawn head while carried. */
  x: number;
  y: number;
  /** Position from the server (for a carried item, the carrier's server position). */
  serverX: number;
  serverY: number;
  /** Session id whose target it is ('' unless state is 'target'). */
  owner: string;
  /** Session id carrying it ('' unless state is 'carried'). */
  carrier: string;
  /** Frame in the 'items' atlas. */
  frame: string;
  /** Outline colour `#RRGGBB` (owner or team colour), null for none. */
  outline: string | null;
}

/** A van on the loading dock (M3-6). */
export interface KekeVanSnapshot {
  /** 0-based slot, as in PlayerState.van. */
  van: number;
  /** Map van slot `index` (van + 1), painted on the van. */
  index: number;
  /** Van centre in pixels (the deposit point). */
  x: number;
  y: number;
  /** Item points banked this round. */
  points: number;
  /** 0 when teams are off. */
  team: number;
  /** Frame in the 'van' atlas (`slot_<index>`). */
  frame: string;
  /** Parking bay colour `#RRGGBB` (owner or team colour), null for none. */
  outline: string | null;
}

/** A marker the minimap draws (render/minimap.ts), in world pixels. */
export interface KekeMinimapMarker {
  /** `van`, `loose`, `target`, `self` (later milestones add more). */
  kind: string;
  /** e.g. `van:0`, `item:12`, `self`. */
  id: string;
  x: number;
  y: number;
  color?: string;
  /** Our own van or position. */
  mine?: boolean;
}

export interface KekeHook {
  /** Active scene key, e.g. `Game`. */
  scene: string;
  /** Map size in pixels and the theme id. */
  map: { theme: string; widthPx: number; heightPx: number; tileSize: number };
  player(): KekePlayerSnapshot;
  /**
   * Moves the local player (pixels, body centre). Ignored when the spot is inside a wall. Offline it moves
   * at once. In a room the server owns positions: this asks it (`DebugMessage.teleport`, phase 'playing'),
   * which only a server started with `KEKE_DEBUG=1` does; the move shows in the next patches.
   * Returns true if moved (offline) or asked (online).
   */
  teleport(x: number, y: number): boolean;
  /**
   * Online, host only: asks the server to end the current phase now (`DebugMessage.endPhase`, needs
   * `KEKE_DEBUG=1` on the server). Lets an e2e play a whole round without waiting 180 s. Returns true
   * when asked; false offline.
   */
  endPhase(): boolean;
  /** Zone id at a pixel position, or null. */
  zoneAt(x: number, y: number): string | null;
  /** Room and prediction state; null offline. */
  net(): KekeNetSnapshot | null;
  /** Other players on the map, in join order; empty offline. */
  remotePlayers(): KekeRemoteSnapshot[];
  /** Markers on the minimap at its last redraw (a few times a second). */
  minimap(): KekeMinimapMarker[];
  /** The last 50 combat broadcasts this client received, oldest first; empty offline. */
  combatEvents(): KekeCombatEvent[];
  /** Items in the world, by id; empty offline and in the lobby. */
  items(): KekeItemSnapshot[];
  /** Vans drawn on the dock, by slot. Offline: slot 1 only. */
  vans(): KekeVanSnapshot[];
}
