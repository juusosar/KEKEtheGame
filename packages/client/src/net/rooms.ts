// Room contract agreed with the server's GameRoom (M2-1):
// - create: client.create('game', profile); the server makes the 4-letter code (metadata.code and state.code)
// - join by code: client.join('game', { code, ...profile }), matched with filterBy(['code'])
// - room list: the built-in LobbyRoom 'lobby' with realtime listing ("rooms", "+", "-" messages)
import type { Client, Room } from '@colyseus/sdk';
import type { PlayerProfile } from '@keke/shared';

export const GAME_ROOM = 'game';
export const LOBBY_ROOM = 'lobby';
export const ROOM_CODE_LENGTH = 4;

/**
 * Cleans what the player types into the code box: upper case, letters only, at most 4 characters.
 * The server picks codes without ambiguous letters (I, L, O), but we don't reject them here: an
 * unknown code simply fails to join.
 */
export function cleanCodeInput(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, ROOM_CODE_LENGTH);
}

export function isCompleteRoomCode(code: string): boolean {
  return code.length === ROOM_CODE_LENGTH && /^[A-Z]+$/.test(code);
}

/** Creates a new game room; the server assigns the code. */
export function createGameRoom(client: Client, profile: PlayerProfile): Promise<Room> {
  return client.create(GAME_ROOM, { ...profile });
}

/** Joins the game room with this code. Rejects when no open room has it. */
export function joinGameRoomByCode(client: Client, code: string, profile: PlayerProfile): Promise<Room> {
  return client.join(GAME_ROOM, { ...profile, code: cleanCodeInput(code) });
}

/** The room's code: state.code once the state has synced, else the code we joined with. */
export function roomCodeOf(room: Room, fallback = ''): string {
  const state: unknown = room.state;
  if (typeof state === 'object' && state !== null && 'code' in state && typeof state.code === 'string') {
    return state.code;
  }
  return fallback;
}

/**
 * Rejections that mean "no room has this code": Colyseus matchmaking found no match (521), or the
 * GameRoom's onAuth refused the code (4404).
 */
export const NO_ROOM_ERROR_CODES: readonly number[] = [521, 4404];

export type JoinFailure = 'noRoom' | 'other';

/** Sorts a create/join rejection into "that code has no room" or anything else (full, locked, offline…). */
export function classifyJoinError(err: unknown): JoinFailure {
  const code = typeof err === 'object' && err !== null && 'code' in err ? err.code : undefined;
  return typeof code === 'number' && NO_ROOM_ERROR_CODES.includes(code) ? 'noRoom' : 'other';
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
