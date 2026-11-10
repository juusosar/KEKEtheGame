// Room list shown on the Play screen, fed by the server's LobbyRoom ("rooms" = full list,
// "+" = [roomId, room] added or updated, "-" = roomId removed). Pure, so it is unit-tested.

export type RoomPhase = 'lobby' | 'countdown' | 'playing' | 'roundResults' | 'podium';

export interface RoomSummary {
  roomId: string;
  code: string;
  hostName: string;
  clients: number;
  maxClients: number;
  phase: RoomPhase | null;
  mode: string | null;
}

const PHASES: readonly string[] = ['lobby', 'countdown', 'playing', 'roundResults', 'podium'];

const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/** Reads one listing entry from the server. Entries without an id or code are dropped. */
export function toRoomSummary(raw: unknown): RoomSummary | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const room = raw as Record<string, unknown>;
  const meta = (
    typeof room['metadata'] === 'object' && room['metadata'] !== null ? room['metadata'] : {}
  ) as Record<string, unknown>;
  const roomId = str(room['roomId']);
  const code = str(meta['code']);
  if (!roomId || !code) return null;
  const phase = str(meta['phase']);
  return {
    roomId,
    code,
    hostName: str(meta['hostName']) ?? '',
    clients: num(room['clients']),
    maxClients: num(room['maxClients']),
    phase: phase !== null && PHASES.includes(phase) ? (phase as RoomPhase) : null,
    mode: str(meta['mode']),
  };
}

/** Rooms in the lobby first (they're starting soon), then by code. */
export function sortRooms(rooms: readonly RoomSummary[]): RoomSummary[] {
  return [...rooms].sort((a, b) => {
    const aLobby = a.phase === 'lobby' ? 0 : 1;
    const bLobby = b.phase === 'lobby' ? 0 : 1;
    return aLobby - bLobby || a.code.localeCompare(b.code);
  });
}

/** "rooms": replaces the whole list. */
export function setRooms(raw: unknown): RoomSummary[] {
  if (!Array.isArray(raw)) return [];
  return sortRooms(raw.map(toRoomSummary).filter((r): r is RoomSummary => r !== null));
}

/** "+": adds a room or replaces the entry with the same id. */
export function addRoom(list: readonly RoomSummary[], message: unknown): RoomSummary[] {
  if (!Array.isArray(message)) return [...list];
  const [roomId, raw] = message as [unknown, unknown];
  const summary = toRoomSummary(typeof raw === 'object' && raw !== null ? { roomId, ...raw } : null);
  if (!summary) return [...list];
  return sortRooms([...list.filter((r) => r.roomId !== summary.roomId), summary]);
}

/** "-": removes the room with this id. */
export function removeRoom(list: readonly RoomSummary[], roomId: unknown): RoomSummary[] {
  return list.filter((r) => r.roomId !== roomId);
}

/** True when another player can still get in (late joiners spectate, so any phase counts). */
export function isJoinable(room: RoomSummary): boolean {
  return room.maxClients === 0 || room.clients < room.maxClients;
}
