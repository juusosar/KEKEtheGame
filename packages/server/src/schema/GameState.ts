// Synchronised room state (§15.2 schema/). Clients read it; only the server writes it.
import { schema, t, type SchemaType } from '@colyseus/schema';

/** One connected player (or late-joining spectator). Keyed by sessionId in `GameState.players`. */
export const PlayerState = schema(
  {
    sessionId: t.string().default(''),
    nickname: t.string().default(''),
    /** Uppercase hex from PLAYER_COLORS. */
    color: t.string().default(''),
    /** One of HAT_IDS. */
    hat: t.string().default(''),
    ready: t.boolean().default(false),
    /** 0 = no team (free-for-all), 1 or 2 when teams are on. */
    team: t.uint8().default(0),
    /** Increases with every join; the smallest value is the longest-connected player (host succession). */
    joinOrder: t.uint32().default(0),
    /** Joined while a round was running; watches until the next round starts (§13.1). */
    spectator: t.boolean().default(false),
    /** False while the player is inside the reconnect window (set by M2-6). */
    connected: t.boolean().default(true),
  },
  'PlayerState',
);
export type PlayerState = SchemaType<typeof PlayerState>;

/** Host settings (§13.1). */
export const RoomSettingsState = schema(
  {
    /** GameMode: 'timed' | 'race'. */
    mode: t.string().default('timed'),
    roundsPerMap: t.uint8().default(1),
    teams: t.boolean().default(false),
  },
  'RoomSettingsState',
);
export type RoomSettingsState = SchemaType<typeof RoomSettingsState>;

export const GameState = schema(
  {
    /** 4-letter room code, also in the room listing metadata. */
    code: t.string().default(''),
    /** RoundPhase: 'lobby' | 'countdown' | 'playing' | 'roundResults' | 'podium'. */
    phase: t.string().default('lobby'),
    /** sessionId of the host; '' only while the room is empty. */
    hostId: t.string().default(''),
    settings: RoomSettingsState,
    /** Current round, 1-based; 0 in the lobby. */
    round: t.uint8().default(0),
    /** Rounds in this session; 0 in the lobby. */
    totalRounds: t.uint8().default(0),
    /** Whole seconds left in the current phase, rounded up; 0 when the phase has no timer. */
    secondsLeft: t.uint16().default(0),
    players: t.map(PlayerState),
  },
  'GameState',
);
export type GameState = SchemaType<typeof GameState>;
