// Room contract agreed with the server's GameRoom (M2-1):
// - create: client.create('game', profile); the server makes the 4-letter code (metadata.code and state.code)
// - join by code: client.join('game', { code, ...profile }), matched with filterBy(['code'])
// - room list: the built-in LobbyRoom 'lobby' with realtime listing ("rooms", "+", "-" messages)
import type { Client, Room } from '@colyseus/sdk';
import { ROOM_CODE_LENGTH, ROOM_NAMES, type GameJoinOptions, type PlayerProfile } from '@keke/shared';

/**
 * Cleans what the player types into the code box as they type: upper case, letters only, at most
 * 4 characters. The shared normalizeRoomCode then decides whether it is a valid code to join with.
 */
export function cleanCodeInput(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, ROOM_CODE_LENGTH);
}

/** Creates a new game room; the server assigns the code. */
export function createGameRoom(client: Client, profile: PlayerProfile): Promise<Room> {
  const options: GameJoinOptions = { ...profile };
  return client.create(ROOM_NAMES.game, options);
}

/** Joins the game room with this (already normalised) code. Rejects when no open room has it. */
export function joinGameRoomByCode(client: Client, code: string, profile: PlayerProfile): Promise<Room> {
  const options: GameJoinOptions = { ...profile, code };
  return client.join(ROOM_NAMES.game, options);
}

/** The room's code from its synced state, or `fallback` while the state has not arrived. */
export function roomCodeOf(room: Pick<Room, 'state'>, fallback = ''): string {
  const state: unknown = room.state;
  if (typeof state === 'object' && state !== null && 'code' in state && typeof state.code === 'string') {
    return state.code;
  }
  return fallback;
}

/**
 * Resolves with the room's code. create()/join() resolve before the first state patch, so on a fresh
 * room state.code may still be empty: wait for a state change that carries it, up to `timeoutMs`,
 * then fall back to `fallback` (the code we joined with, if any).
 */
export function waitForRoomCode(room: Room, fallback = '', timeoutMs = 5000): Promise<string> {
  const now = roomCodeOf(room);
  if (now !== '') return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = (code: string): void => {
      clearTimeout(timer);
      room.onStateChange.remove(onChange);
      resolve(code);
    };
    const onChange = (): void => {
      const code = roomCodeOf(room);
      if (code !== '') done(code);
    };
    const timer = setTimeout(() => done(fallback), timeoutMs);
    room.onStateChange(onChange);
  });
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
