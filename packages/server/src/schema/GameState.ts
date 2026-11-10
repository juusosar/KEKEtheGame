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
    /** Body centre in pixels, set by the server's movement simulation (M2-2). */
    x: t.float64().default(0),
    y: t.float64().default(0),
    /** Velocity in px/s; prediction needs it to replay from this state on slippery floors. */
    vx: t.float64().default(0),
    vy: t.float64().default(0),
    /** Aim of the last applied input, radians (InputFrame.aim). */
    aim: t.float32().default(0),
    /** `seq` of the last InputFrame the server applied for this player; 0 before any (§15.3). */
    ack: t.uint32().default(0),
    /**
     * Van slot (0-based; map van `index` = van + 1) that banks this player's deposits; -1 before the
     * first round. Teammates share one van (§4.3). Kept across reconnects and rounds (§15.3, M3-4).
     */
    van: t.int8().default(-1),
    /** World item id (key in `GameState.items`) this player carries; 0 = nothing. Movement is 0.85× while set. */
    carrying: t.uint32().default(0),
    /** World item id of this player's current target; 0 = none (while carrying their own, or no spawn free). */
    target: t.uint32().default(0),
    /** Item points this player deposited this round (§5 tie-break, Timed ranking input). */
    deposited: t.uint16().default(0),
    /**
     * Round results (§5, M3-5), set when 'playing' ends and reset to 0 at each countdown.
     * `place`: 1-based placement in the round just played (the team's place with Teams on; ties share
     * the higher place); 0 = not ranked (spectated that round, or the round is still running).
     */
    place: t.uint8().default(0),
    /** Placement points earned in the round just played (10, 7, 5, 3, then 1; `config.placementPoints`). */
    roundPoints: t.uint8().default(0),
    /** Placement points summed over this session's finished rounds. Reset at Start and in the lobby. */
    sessionPoints: t.uint16().default(0),
    /** Item points deposited over this session's finished rounds (§5 tie-break). */
    sessionItemPoints: t.uint16().default(0),
    /**
     * Session standing after the last finished round (podium): most sessionPoints, then sessionItemPoints;
     * the team's standing with Teams on. 0 = not ranked yet.
     */
    sessionPlace: t.uint8().default(0),
    /**
     * Combat (§3.3, §7; M4-2). Mirrored from the server's CombatWorld every tick by CombatSystem; set at
     * each countdown (full HP, fists) and reset in the lobby. Movement prediction reads `alive`,
     * `stunned`, `slowMultiplier` and `blocking` (`syncedCombatSpeed`), like `carrying` (review H1).
     * `hp`: 0..maxHp; 0 while KO'd.
     */
    hp: t.uint16().default(0),
    /** False while KO'd (body stays where it fell, cannot act, cannot be hit) until the respawn. */
    alive: t.boolean().default(true),
    /** Held weapon id (`getWeaponCatalogue().get(weapon)`); the fallback 'fists' when nothing else. */
    weapon: t.string().default('fists'),
    /** Uses left of the held weapon (seconds of spray for sprays); -1 = unlimited (fists). */
    weaponUses: t.float32().default(-1),
    /** Cannot move or attack (rolling pin, knockdowns). */
    stunned: t.boolean().default(false),
    /** Speed multiplier from a slow (ketchup, M4-4); 1 = not slowed. */
    slowMultiplier: t.float32().default(1),
    /** Spawn protection after a respawn: hits do not land (§3.3). */
    protected: t.boolean().default(false),
    /** Holding Block with a weapon that can block (pan, M4-6). Set only by the block module. */
    blocking: t.boolean().default(false),
    /** Whole seconds until the respawn while KO'd, rounded up; 0 while alive (KO countdown overlay). */
    respawnIn: t.uint8().default(0),
  },
  'PlayerState',
);
export type PlayerState = SchemaType<typeof PlayerState>;

/** An item lying in the world or carried (§3.1, §3.2). Keyed by String(id) in `GameState.items`. */
export const ItemState = schema(
  {
    /** World item id, unique within the round; starts at 1. */
    id: t.uint32().default(0),
    /** Catalogue item id (`getItemCatalogue(theme).get(itemId)` for name, sprite, zone). */
    itemId: t.string().default(''),
    /** ItemRarity: 'normal' | 'joke'. */
    rarity: t.string().default('normal'),
    /** WorldItemState: 'target' | 'loose' | 'carried'. */
    state: t.string().default('target'),
    /** Position in pixels. For a carried item, draw it at the carrier instead. */
    x: t.float32().default(0),
    y: t.float32().default(0),
    /** sessionId whose target this is ('' unless state is 'target'). Outline in the owner's colour. */
    owner: t.string().default(''),
    /** sessionId carrying it ('' unless state is 'carried'). */
    carrier: t.string().default(''),
  },
  'ItemState',
);
export type ItemState = SchemaType<typeof ItemState>;

/** One van in use this round. Keyed by String(van) in `GameState.vans`. */
export const VanState = schema(
  {
    /** Van slot, 0-based (map van `index` = van + 1). */
    van: t.uint8().default(0),
    /** Item points banked this round (§3.2: cannot be stolen). */
    points: t.uint16().default(0),
    /** Team using this van (0 when teams are off). */
    team: t.uint8().default(0),
  },
  'VanState',
);
export type VanState = SchemaType<typeof VanState>;

/**
 * One team's results with Teams on (§4.3, §5, M3-5). Keyed by String(team) ('1', '2') in `GameState.teams`.
 * Created at Start when Teams is on; round fields set when 'playing' ends, reset at each countdown.
 */
export const TeamState = schema(
  {
    /** 1 or 2. */
    team: t.uint8().default(0),
    /** Placement in the round just played; 0 = not ranked (round running, or the team had no players). */
    place: t.uint8().default(0),
    /** The team's item points in the round just played (sum of its members' deposits). */
    itemPoints: t.uint16().default(0),
    /** Placement points the team earned in the round just played. */
    roundPoints: t.uint8().default(0),
    /** Placement points over this session's finished rounds. */
    sessionPoints: t.uint16().default(0),
    /** Item points over this session's finished rounds (tie-break). */
    sessionItemPoints: t.uint16().default(0),
    /** Session standing after the last finished round; 0 = not ranked yet. */
    sessionPlace: t.uint8().default(0),
  },
  'TeamState',
);
export type TeamState = SchemaType<typeof TeamState>;

/**
 * A projectile in flight (§7 thrown, M4-3; the champagne cork in M4-6). Keyed by String(id) in
 * `GameState.projectiles`. Owned by the server ProjectileSystem: created on a throw, moved every tick,
 * and kept for one more tick with `landed` at the impact point (so clients can draw the splash there).
 */
export const ProjectileState = schema(
  {
    /** Unique within the room; starts at 1. */
    id: t.uint32().default(0),
    /** Weapon id that threw it (sprite / FX key). */
    weapon: t.string().default(''),
    /** sessionId of the thrower (the blocker after a reflect). */
    owner: t.string().default(''),
    /** Position in pixels. */
    x: t.float32().default(0),
    y: t.float32().default(0),
    /** Velocity in pixels per second (0 once landed), for client extrapolation. */
    vx: t.float32().default(0),
    vy: t.float32().default(0),
    /** Collision radius of the projectile. */
    radius: t.float32().default(0),
    /** Splash / burst radius where it lands; 0 = none. */
    areaRadius: t.float32().default(0),
    /** True for the one tick after it hit something; x/y is then the impact point. */
    landed: t.boolean().default(false),
  },
  'ProjectileState',
);
export type ProjectileState = SchemaType<typeof ProjectileState>;

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
    /** Items in the world this round (M3-4). Emptied in the lobby, refilled at each countdown. */
    items: t.map(ItemState),
    /** Vans in use this round with their banked item points (M3-4). */
    vans: t.map(VanState),
    /** Team results with Teams on (M3-5); empty in free-for-all and in the lobby. */
    teams: t.map(TeamState),
    /** Projectiles in flight (M4-3). Emptied in the lobby and at each countdown. */
    projectiles: t.map(ProjectileState),
  },
  'GameState',
);
export type GameState = SchemaType<typeof GameState>;
