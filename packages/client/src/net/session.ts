// The game room the player is in, handed from the Play scene to the next scene (Lobby, M2-5).
// It also remembers the room's reconnection token for this tab, so a reload inside the server's
// reconnect window (§15.3, 30 s) puts the player back in the same slot with the same team.
import type { Client, Room } from '@colyseus/sdk';

export interface CurrentRoom {
  room: Room;
  /** The 4-letter room code. */
  code: string;
}

/** Game registry key holding the current room code; the Boot overlay shows it. */
export const ROOM_CODE_REGISTRY_KEY = 'roomCode';

/** sessionStorage key: per tab, so two tabs stay two players. */
export const RESUME_STORAGE_KEY = 'keke.resume';

/** What a reload needs to get back into the room. */
export interface ResumeTicket {
  readonly token: string;
  readonly code: string;
}

type TicketStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

let current: CurrentRoom | null = null;

export function setCurrentRoom(next: CurrentRoom | null, storage: TicketStorage | null = tabStorage()): void {
  current = next;
  if (storage === null) return;
  if (next === null) {
    clearResumeTicket(storage);
    return;
  }
  const { room, code } = next;
  saveResumeTicket(storage, { token: room.reconnectionToken, code });
  // The SDK swaps the token on every reconnect; a leave for good (not a drop) ends the ticket.
  room.onReconnect(() => saveResumeTicket(storage, { token: room.reconnectionToken, code }));
  room.onLeave(() => {
    if (current?.room === room) clearResumeTicket(storage);
  });
}

export function currentRoom(): CurrentRoom | null {
  return current;
}

/**
 * Shows the room on the page: its code in the game registry (Boot overlay) and on
 * `<body data-room>`, and our session id on `<body data-session>` (e2e checks a reload keeps it).
 */
export function markRoom(
  registry: { set(key: string, value: unknown): unknown },
  { room, code }: CurrentRoom,
): void {
  registry.set(ROOM_CODE_REGISTRY_KEY, code);
  document.body.dataset['room'] = code;
  document.body.dataset['session'] = room.sessionId;
}

export function saveResumeTicket(storage: TicketStorage, ticket: ResumeTicket): void {
  try {
    storage.setItem(RESUME_STORAGE_KEY, JSON.stringify(ticket));
  } catch {
    // Storage full or blocked: a reload then starts from the menus, which is fine.
  }
}

export function loadResumeTicket(storage: TicketStorage): ResumeTicket | null {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(RESUME_STORAGE_KEY) ?? 'null');
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { token, code } = parsed as Record<string, unknown>;
    return typeof token === 'string' && token !== '' && typeof code === 'string' ? { token, code } : null;
  } catch {
    return null;
  }
}

export function clearResumeTicket(storage: TicketStorage): void {
  try {
    storage.removeItem(RESUME_STORAGE_KEY);
  } catch {
    // Nothing to do.
  }
}

/**
 * Tries to get back into the room this tab was in before a reload. Resolves with the room, or null
 * when there is no ticket or the server no longer holds the seat (the ticket is then cleared).
 */
export async function resumeRoom(
  client: Pick<Client, 'reconnect'>,
  storage: TicketStorage | null = tabStorage(),
): Promise<CurrentRoom | null> {
  if (storage === null) return null;
  const ticket = loadResumeTicket(storage);
  if (ticket === null) return null;
  try {
    const room = await client.reconnect(ticket.token);
    const resumed = { room, code: ticket.code };
    setCurrentRoom(resumed, storage);
    return resumed;
  } catch (err) {
    console.info('[keke] could not resume the previous room', err);
    clearResumeTicket(storage);
    return null;
  }
}

function tabStorage(): TicketStorage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}
