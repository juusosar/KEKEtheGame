// Reads the synced GameState (M2-1 schema) into a plain view of the lobby for the Lobby scene.
// The client has no schema classes, and create()/join() resolve before the first patch, so every
// field is read defensively and a missing one falls back to its schema default.
import {
  DEFAULT_LOBBY_SETTINGS,
  GAME_MODES,
  ROUND_PHASES,
  canStart,
  type GameMode,
  type LobbyErrorCode,
  type LobbySettings,
  type RoundPhase,
} from '@keke/shared';

export interface LobbyPlayerView {
  id: string;
  nickname: string;
  color: string;
  hat: string;
  ready: boolean;
  /** 0 = no team, 1 or 2. */
  team: number;
  joinOrder: number;
  spectator: boolean;
  connected: boolean;
  isHost: boolean;
  isMe: boolean;
}

export interface LobbyView {
  code: string;
  phase: RoundPhase;
  hostId: string;
  settings: LobbySettings;
  /** Sorted by join order: the host-succession order (§13.1). */
  players: LobbyPlayerView[];
  me: LobbyPlayerView | null;
  isHost: boolean;
  /** Same rule the server checks on Start: everyone who isn't spectating is ready. */
  everyoneReady: boolean;
  /** True once the first state patch has arrived (we appear in the player map). */
  synced: boolean;
}

type Bag = Record<string, unknown>;

const isBag = (value: unknown): value is Bag => typeof value === 'object' && value !== null;
const str = (bag: Bag, key: string, fallback = ''): string =>
  typeof bag[key] === 'string' ? bag[key] : fallback;
const num = (bag: Bag, key: string, fallback = 0): number =>
  typeof bag[key] === 'number' && Number.isFinite(bag[key]) ? bag[key] : fallback;
const bool = (bag: Bag, key: string, fallback = false): boolean =>
  typeof bag[key] === 'boolean' ? bag[key] : fallback;

/** Entries of a schema MapSchema (has forEach) or a plain object, as [key, value] pairs. */
function mapEntries(value: unknown): [string, unknown][] {
  if (!isBag(value)) return [];
  const forEach = value['forEach'];
  if (typeof forEach === 'function') {
    const out: [string, unknown][] = [];
    (forEach as (cb: (v: unknown, k: string) => void) => void).call(value, (v, k) => out.push([k, v]));
    return out;
  }
  return Object.entries(value);
}

function readSettings(value: unknown): LobbySettings {
  if (!isBag(value)) return { ...DEFAULT_LOBBY_SETTINGS };
  const mode = str(value, 'mode', DEFAULT_LOBBY_SETTINGS.mode);
  return {
    mode: (GAME_MODES as readonly string[]).includes(mode) ? (mode as GameMode) : DEFAULT_LOBBY_SETTINGS.mode,
    roundsPerMap: num(value, 'roundsPerMap', DEFAULT_LOBBY_SETTINGS.roundsPerMap),
    teams: bool(value, 'teams', DEFAULT_LOBBY_SETTINGS.teams),
  };
}

export function readLobby(state: unknown, mySessionId: string): LobbyView {
  const s: Bag = isBag(state) ? state : {};
  const hostId = str(s, 'hostId');
  const phaseRaw = str(s, 'phase', 'lobby');
  const phase = (ROUND_PHASES as readonly string[]).includes(phaseRaw) ? (phaseRaw as RoundPhase) : 'lobby';

  const players: LobbyPlayerView[] = [];
  for (const [key, value] of mapEntries(s['players'])) {
    if (!isBag(value)) continue;
    const id = str(value, 'sessionId', key) || key;
    players.push({
      id,
      nickname: str(value, 'nickname'),
      color: str(value, 'color'),
      hat: str(value, 'hat'),
      ready: bool(value, 'ready'),
      team: num(value, 'team'),
      joinOrder: num(value, 'joinOrder'),
      spectator: bool(value, 'spectator'),
      connected: bool(value, 'connected', true),
      isHost: id === hostId,
      isMe: id === mySessionId,
    });
  }
  players.sort((a, b) => a.joinOrder - b.joinOrder || a.id.localeCompare(b.id));
  const me = players.find((p) => p.isMe) ?? null;

  return {
    code: str(s, 'code'),
    phase,
    hostId,
    settings: readSettings(s['settings']),
    players,
    me,
    isHost: hostId !== '' && hostId === mySessionId,
    everyoneReady: canStart(players),
    synced: me !== null,
  };
}

/** i18n key for a refused lobby request (ServerMessage.lobbyError). */
export function lobbyErrorKey(code: unknown): `lobby.error.${LobbyErrorCode | 'unknown'}` {
  switch (code) {
    case 'not_host':
    case 'wrong_phase':
    case 'invalid_payload':
    case 'not_ready':
    case 'teams_off':
      return `lobby.error.${code}`;
    default:
      return 'lobby.error.unknown';
  }
}
