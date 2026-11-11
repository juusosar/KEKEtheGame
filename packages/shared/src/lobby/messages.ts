// Wire contract of the game room (lobby part). Names and payloads shared by client and server.
import type { LobbySettingsUpdate } from './settings';

/** Registered room names. */
export const ROOM_NAMES = { game: 'game', lobby: 'lobby' } as const;

/** HTTP health check on the game server (M3 review F5): the Boot badge and the e2e specs read it. */
export const HEALTH_PATH = '/healthz';

/** Body of `GET /healthz`. */
export interface HealthResponse {
  ok: true;
  /** The debug-only room messages are accepted (the server runs with KEKE_DEBUG=1). */
  debug: boolean;
  /** Theme ids of the maps this server loaded, in order (P1 review F9: Docker smoke checks them). */
  maps: string[];
}

/** Client → server message types. */
export const ClientMessage = {
  /** `{ ready: boolean }` */
  ready: 'ready',
  /** `LobbySettingsUpdate`, host only, lobby phase only. */
  settings: 'settings',
  /** No payload. Host only, lobby phase only, teams on. */
  shuffleTeams: 'shuffleTeams',
  /** No payload. Host only, lobby phase only, everyone ready. */
  start: 'start',
  /** `{ nickname?, color?, hat? }` profile change while in the lobby. */
  profile: 'profile',
  /**
   * `InputFrame`, one per fixed input step (1 / inputHz s), idle frames included. Only applied while
   * the phase is 'playing' and the sender is not spectating; otherwise silently ignored (no ack).
   */
  input: 'input',
} as const;

/**
 * Debug-only client → server messages (§17). The server registers them only when it runs with
 * `KEKE_DEBUG=1` (the e2e server does); a normal server ignores them. Never enable that in production.
 */
export const DebugMessage = {
  /** `{ x, y }` body centre in pixels: moves the sender. Phase 'playing', not spectating, not into a wall. */
  teleport: 'debugTeleport',
  /** No payload. Host only, any phase but 'lobby': ends the current phase now (short rounds in e2e). */
  endPhase: 'debugEndPhase',
  /**
   * `{ weapon }` a weapons.json id: the sender holds that weapon with full uses, as if a pickup rolled it.
   * Phase 'playing', not spectating, not KO'd. For e2e specs of one weapon.
   */
  giveWeapon: 'debugGiveWeapon',
  /**
   * `{ points }` a whole number 0..65535: sets the banked item points of the sender's van, as if they had
   * been deposited (they do not count as the sender's own `deposited`). Phase 'playing', not spectating.
   * Race e2e (M6-2): set `raceQuota - 1`, then one deposit packs the order box. Setting the quota or more
   * packs nothing by itself; packing happens on a deposit.
   */
  vanPoints: 'debugVanPoints',
  /**
   * No payload. Host only, any phase: removes the store workers and their carts from this room for good
   * (this round and every later one). For e2e specs that are not about NPCs, so a stocker, guard,
   * butcher or forklift cannot join a scripted fight or knock a scripted walk off course (M7 review F4).
   */
  noNpcs: 'debugNoNpcs',
  /**
   * `{ npc, seconds }` an NPC id from the synced state and 0 < seconds <= 30: that store worker stands
   * still (no walking, no swings) for that long, or until something hits it, so an e2e spec can walk up
   * and punch it (M7 review F7). Phase 'playing'.
   */
  holdNpc: 'debugHoldNpc',
} as const;

export interface DebugHoldNpcMessage {
  npc: string;
  seconds: number;
}

export interface DebugVanPointsMessage {
  points: number;
}

export interface DebugGiveWeaponMessage {
  weapon: string;
}

export interface DebugTeleportMessage {
  x: number;
  y: number;
}

/** Server → client message types. */
export const ServerMessage = {
  /** `LobbyErrorMessage`, sent to the client whose request was refused. */
  lobbyError: 'lobbyError',
} as const;

export interface ReadyMessage {
  ready: boolean;
}
export type SettingsMessage = LobbySettingsUpdate;

export const LOBBY_ERROR_CODES = [
  'not_host',
  'wrong_phase',
  'invalid_payload',
  'not_ready',
  'teams_off',
  /** A debug-only message (`DebugMessage`) on a server without KEKE_DEBUG=1. */
  'debug_off',
  /** A `maps` setting naming a map this server has not loaded (theme not available yet). */
  'map_unavailable',
] as const;
export type LobbyErrorCode = (typeof LOBBY_ERROR_CODES)[number];

export interface LobbyErrorMessage {
  code: LobbyErrorCode;
  /** The client message type that was refused. */
  request: string;
}

/** Options for `client.create('game', …)` and `client.join('game', …)`. */
export interface GameJoinOptions {
  /** Required to join an existing room; ignored on create (the server picks the code). */
  code?: string;
  nickname?: string;
  color?: string;
  hat?: string;
  /**
   * On create only: the host's settings from the room setup menu, validated like a lobby settings
   * update. A create with invalid settings fails; on join they are ignored.
   */
  settings?: LobbySettingsUpdate;
}

/** Room listing metadata shown in the room list (LobbyRoom). */
export interface GameRoomMetadata {
  code: string;
  hostName: string;
  mode: string;
  phase: string;
  /** The `maps` setting (MapChoice). */
  maps: string;
  /** Theme id of the current (or, in the lobby, first) map: `GameState.mapId`. */
  map: string;
}
