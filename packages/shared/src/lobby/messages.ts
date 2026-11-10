// Wire contract of the game room (lobby part). Names and payloads shared by client and server.
import type { LobbySettingsUpdate } from './settings';

/** Registered room names. */
export const ROOM_NAMES = { game: 'game', lobby: 'lobby' } as const;

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
} as const;

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
}

/** Room listing metadata shown in the room list (LobbyRoom). */
export interface GameRoomMetadata {
  code: string;
  hostName: string;
  mode: string;
  phase: string;
}
