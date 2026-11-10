// `window.__KEKE__`: a test/debug hook installed only with `?debug=1` (§17). E2E specs read state through
// it instead of reading pixels off the canvas. Grows with later milestones (scripted pickup, deposit, …).
// Types only (no DOM), so the Playwright specs can import them too.
import type { NpcView, StockCartView } from '../net/npcView';

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
  /** Holding Block with the pan (M4-6). */
  blocking: boolean;
  /** Dashing with the pallet jack (M4-6). */
  charging: boolean;
  /** Whole seconds to the respawn while KO'd, else 0. */
  respawnIn: number;
  /** Slipped on a banana peel and sliding (M4-5). */
  sliding: boolean;
  /** Speed multiplier from a slow (ketchup 0.6), 1 when not slowed. */
  slowMultiplier: number;
}

/** A combat broadcast as the client received it (`attack`, `hit`, `ko`, `respawn`, `weaponRolled`, `weaponSpent`). */
export interface KekeCombatEvent {
  type: string;
  payload: unknown;
}

/** A projectile in flight (M4-3), at its server position from the last patch. */
export interface KekeProjectileSnapshot {
  id: number;
  /** Weapon id that threw it. */
  weapon: string;
  /** Thrower's session id. */
  owner: string;
  x: number;
  y: number;
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
  /** 0 = no team, 1 or 2 (M6-4). */
  team: number;
  /** Body outline `#RRGGBB`: the team colour with Teams on, null otherwise (§4.3). */
  outline: string | null;
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
  /** 0 = no team, 1 or 2 (M6-4). */
  team: number;
  /** Our body outline `#RRGGBB`: the team colour with Teams on, null otherwise (§4.3). */
  outline: string | null;
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
  /** Frame in the 'items' atlas (the 'order_box' atlas for an order box). */
  frame: string;
  /** Outline colour `#RRGGBB` (owner or team colour), null for none. */
  outline: string | null;
  /** Race (M6-3): van slot that packed this order box (itemId 'order_box'); -1 for a normal item. */
  packedVan: number;
  /** Race: item points in this order box; 0 for a normal item. */
  points: number;
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
  /** Item points banked this round (race: quota progress, back to 0 at each packing). */
  points: number;
  /** Race (M6-3): items this van controls (banked + its own boxes its players carry); = points in Timed. */
  controlled: number;
  /** 0 when teams are off. */
  team: number;
  /** Frame in the 'van' atlas (`slot_<index>`). */
  frame: string;
  /** Parking bay colour `#RRGGBB` (owner or team colour), null for none. */
  outline: string | null;
}

/** A race broadcast this client received (M6-3): `boxPacked` or `delivery` with its payload. */
export interface KekeRaceEvent {
  type: string;
  payload: unknown;
}

/** A marker the minimap draws (render/minimap.ts), in world pixels. */
export interface KekeMinimapMarker {
  /** `van`, `loose`, `target`, `self`, `forklift`; race: `office`, `box`, `carrier`. */
  kind: string;
  /** e.g. `van:0`, `item:12`, `self`. */
  id: string;
  x: number;
  y: number;
  color?: string;
  /** Our own van or position. */
  mine?: boolean;
}

/** The held weapon sprite of one player (M4-7). */
export interface KekeHeldSnapshot {
  id: string;
  weapon: string;
  visible: boolean;
  /** Frame in the `weapons` atlas. */
  frame: string;
  /** Rotation, radians (the aim, or the swing angle mid-swing). */
  angle: number;
  x: number;
  y: number;
  swinging: boolean;
  blocking: boolean;
}

/** A combat effect on screen (M4-7): `sprite` (fx atlas frame), `number` (damage), `wedge`, `trail`. */
export interface KekeFxSnapshot {
  kind: 'wedge' | 'sprite' | 'number' | 'trail';
  frame?: string;
  target?: string;
  text?: string;
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
  /**
   * Online: asks the server to put a weapon (weapons.json id) in our hands with full uses
   * (`DebugMessage.giveWeapon`, phase 'playing', needs `KEKE_DEBUG=1`). For e2e specs of one weapon; the
   * change shows in `net().weapon` with the next patch. Returns true when asked; false offline.
   */
  giveWeapon(weapon: string): boolean;
  /**
   * Online: asks the server to set our van's banked item points (`DebugMessage.vanPoints`, phase
   * 'playing', needs `KEKE_DEBUG=1`). Race e2e (M6-2): set `raceQuota - 1`, then one deposit packs the
   * order box. Returns true when asked; false offline.
   */
  vanPoints(points: number): boolean;
  /** Zone id at a pixel position, or null. */
  zoneAt(x: number, y: number): string | null;
  /** Room and prediction state; null offline. */
  net(): KekeNetSnapshot | null;
  /** Other players on the map, in join order; empty offline. */
  remotePlayers(): KekeRemoteSnapshot[];
  /** Markers on the minimap at its last redraw (a few times a second). */
  minimap(): KekeMinimapMarker[];
  /** The last 50 combat and store worker (M5-7) broadcasts this client received, oldest first; empty offline. */
  combatEvents(): KekeCombatEvent[];
  /** Spray vision clouds in the world now (M4-4), world pixels; empty offline. */
  sprayClouds(): { x: number; y: number; radiusPx: number }[];
  /** Projectiles in flight at the last patch (M4-3); empty offline. */
  projectiles(): KekeProjectileSnapshot[];
  /** Held weapon of every player drawn (us included); empty offline. */
  held(): KekeHeldSnapshot[];
  /**
   * Swings predicted on our own Attack presses (M4 review F1): a counter that only goes up, so specs
   * poll it instead of the 0.18 s `held().swinging` window. Zero offline.
   */
  swings(): KekeSwingsSnapshot;
  /** Combat effects alive right now; empty offline. */
  fx(): KekeFxSnapshot[];
  /**
   * The last 50 combat effects started, oldest first, including those already over: a damage number
   * lives 0.7 s, so specs on slow pages read this instead of `fx()` (M4 review F1). Empty offline.
   */
  fxStarted(): KekeFxSnapshot[];
  /**
   * Where a world point is on screen now, in CSS pixels of the page (follows the camera, also where it
   * is clamped at the map edge). Specs aim the mouse with it.
   */
  screenPoint(x: number, y: number): { x: number; y: number };
  /** Items in the world, by id; empty offline and in the lobby. */
  items(): KekeItemSnapshot[];
  /** Vans drawn on the dock, by slot. Offline: slot 1 only. */
  vans(): KekeVanSnapshot[];
  /** Race broadcasts received (`boxPacked`, `delivery`), last 50, oldest first; empty offline. */
  raceEvents(): KekeRaceEvent[];
  /** Banana peels on the floor (M4-5), by id; empty offline. */
  traps(): KekeTrapSnapshot[];
  /** Store workers in the synced state (M5-3), by id; empty offline. What is drawn is `npcSprites()`. */
  npcs(): NpcView[];
  /** Stock carts parked right now (M5-3), by id; empty offline. */
  stockCarts(): StockCartView[];
  /** Store workers as drawn this frame (M5-7), by id; empty offline. */
  npcSprites(): KekeNpcSpriteSnapshot[];
  /** Session ids of players with the Wanted ❗ icon showing this frame (M5-7); empty offline. */
  wantedIcons(): string[];
  /** How many times each placeholder sound has played (M5-7: wantedAlarm, forkliftBeep, ...). */
  sfx(): Record<string, number>;
}

/** A store worker as drawn (M5-7). */
export interface KekeNpcSpriteSnapshot {
  id: string;
  type: string;
  /** Atlas the sprite uses (npcs.json `sprite`; `customer` when that atlas is missing). */
  sheet: string;
  /** Animation key playing, e.g. `stocker/walk_left`, `forklift/drive_up`. */
  anim: string;
  visible: boolean;
  /** Drawn (interpolated) position, world px. */
  x: number;
  y: number;
  alpha: number;
  /** Anger mark showing (after a player). */
  hostile: boolean;
  /** Forklift warning light on. */
  light: boolean;
}

/** A banana peel on the floor (M4-5). */
export interface KekeTrapSnapshot {
  id: number;
  weapon: string;
  /** Session id of the thrower. */
  owner: string;
  x: number;
  y: number;
  /** Past its arm delay: trips rivals. */
  armed: boolean;
}

/** Our own predicted swings (`__KEKE__.swings()`). */
export interface KekeSwingsSnapshot {
  /** Presses that swung the held weapon locally, since the Game scene started. */
  predicted: number;
  /** The last one: weapon id, attack mode and scene clock seconds; null before the first. */
  last: { weapon: string; mode: string; at: number } | null;
}
