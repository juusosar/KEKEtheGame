// The game room the player is in, handed from the Play scene to the next scene (Lobby, M2-5).
import type { Room } from '@colyseus/sdk';

export interface CurrentRoom {
  room: Room;
  /** The 4-letter room code. */
  code: string;
}

/** Game registry key holding the current room code; the Boot overlay shows it. */
export const ROOM_CODE_REGISTRY_KEY = 'roomCode';

let current: CurrentRoom | null = null;

export function setCurrentRoom(next: CurrentRoom | null): void {
  current = next;
}

export function currentRoom(): CurrentRoom | null {
  return current;
}
