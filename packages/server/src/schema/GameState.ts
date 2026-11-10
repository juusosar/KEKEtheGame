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
     * `stunned`, `slowMultiplier`, `blocking` and `charging` (`syncedCombatSpeed`), like `carrying` (review H1).
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
    /** Dashing with a pallet jack (M4-6): input does not move the body; set only by the charge module. */
    charging: t.boolean().default(false),
    /** Whole seconds until the respawn while KO'd, rounded up; 0 while alive (KO countdown overlay). */
    respawnIn: t.uint8().default(0),
    /** Slipped on a banana peel (M4-5): sliding without control (also `stunned`) until the slide ends. */
    sliding: t.boolean().default(false),
    /**
     * Wanted status (§8; M5-3): security guards chase this player. Mirrored every tick from the room's
     * WantedWorld; false in the lobby and at each countdown. Draw the ❗ above players with this set.
     */
    wanted: t.boolean().default(false),
    /** Whole seconds of Wanted left, rounded up; 0 when not Wanted (held at full while in staff_only). */
    wantedIn: t.uint8().default(0),
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
    /**
     * Race (§4.2, M6-2): the van slot that packed this order box (`itemId` 'order_box'); -1 for a normal
     * item. A carrier whose `van` differs carries a stolen box.
     */
    packedVan: t.int8().default(-1),
    /** Race: item points packed into this order box; 0 for a normal item. */
    points: t.uint16().default(0),
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
    /**
     * Race (§4.2, M6-2): "items you control": `points` plus the boxes this van packed that one of its
     * players carries. Equals `points` in Timed. The race scoreboard sorts by it.
     */
    controlled: t.uint16().default(0),
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

/**
 * A banana peel on the floor (§7, M4-5). Keyed by String(id) in `GameState.traps`. Added when dropped,
 * removed when someone slips on it, when it expires (45 s) and at every round start and in the lobby.
 */
export const TrapState = schema(
  {
    /** Unique within the round, from 1. */
    id: t.uint32().default(0),
    /** Weapon id that dropped it ('banana_peels'). */
    weapon: t.string().default(''),
    /** sessionId of the thrower. */
    owner: t.string().default(''),
    /** The thrower's team when dropped (0 = no teams): the owner and their team never slip on it. */
    team: t.uint8().default(0),
    /** Position in pixels. */
    x: t.float32().default(0),
    y: t.float32().default(0),
    /** False for the arm delay after the drop; only armed peels trip anyone. */
    armed: t.boolean().default(false),
  },
  'TrapState',
);
export type TrapState = SchemaType<typeof TrapState>;

/**
 * A store worker or hazard (§8; M5-3). Keyed by `id` in `GameState.npcs`. Created at each countdown from
 * the round's NPC plan (only for behaviours the server runs), removed in the lobby. Owned by NpcSystem.
 */
export const NpcState = schema(
  {
    /** Stable for the round: `<type>_<n>` from planNpcs, e.g. 'stocker_2'. */
    id: t.string().default(''),
    /** npcs.json id ('stocker', 'security', 'forklift', 'butcher'); sprite key via the catalogue. */
    type: t.string().default(''),
    /** NpcBehaviour, the same as the catalogue entry's. */
    behaviour: t.string().default(''),
    /** Body centre in pixels. */
    x: t.float32().default(0),
    y: t.float32().default(0),
    /** Facing, radians (0 = +x, clockwise): the walk direction, or toward the player it attacks. */
    aim: t.float32().default(0),
    /** Walking this tick (walk anim vs idle anim). */
    moving: t.boolean().default(false),
    /** 0..maxHp; 0 while KO'd. Invulnerable NPCs (forklifts) have hp = maxHp = 0. */
    hp: t.uint16().default(0),
    maxHp: t.uint16().default(0),
    /** False while KO'd: the body lies where it fell and cannot be hit, until the respawn. */
    alive: t.boolean().default(true),
    /** Whole seconds to the respawn while KO'd, rounded up; 0 while up. */
    respawnIn: t.uint8().default(0),
    /** Knocked down or stunned (pallet jack, rolling pin): does not move or attack. */
    stunned: t.boolean().default(false),
    /**
     * What the behaviour is doing, for animation and FX. Common: 'idle', 'ko'. Stocker: 'walk' (to an aisle
     * waypoint), 'stock' (restocking a shelf), 'angry' (retaliating against `target`). Forklift: 'drive'
     * (to the next route corner), 'corner' (stopped at a corner), 'blocked' (a stock cart is in the way).
     * Security (M5-4): 'patrol' (to a waypoint), 'watch' (pausing at one), 'post' (standing at its post),
     * 'return' (back to the post), 'chase' (sees `target`), 'search' (walking to where it last saw
     * `target`). Butcher: 'idle' (at its post), 'attack' (after `target`, a player behind the counter),
     * 'return' (walking back to its post). Later behaviours add their own (see the M5-3 handoff).
     */
    mode: t.string().default('idle'),
    /** sessionId of the player this NPC is after (retaliation, chase); '' when none. */
    target: t.string().default(''),
  },
  'NpcState',
);
export type NpcState = SchemaType<typeof NpcState>;

/**
 * A stock cart parked in an aisle (§8 stocker; M5-3). Keyed by String(id) in `GameState.stockCarts`.
 * Its tiles block movement like walls (shared `gridWithBlocked` + `rectCovers`) until it is removed.
 */
export const StockCartState = schema(
  {
    /** Unique within the round, from 1. */
    id: t.uint32().default(0),
    /** NPC id of the stocker that parked it. */
    npc: t.string().default(''),
    /** Top-left tile and size in tiles (one of w, h is 1; the other is npcs.json `stockCart.lengthTiles`). */
    tx: t.uint16().default(0),
    ty: t.uint16().default(0),
    w: t.uint8().default(1),
    h: t.uint8().default(1),
  },
  'StockCartState',
);
export type StockCartState = SchemaType<typeof StockCartState>;

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
    /** Banana peels on the floor this round (M4-5). */
    traps: t.map(TrapState),
    /** Store workers and forklifts this round (M5-3). Emptied in the lobby, refilled at each countdown. */
    npcs: t.map(NpcState),
    /** Stock carts parked in aisles right now (M5-3). */
    stockCarts: t.map(StockCartState),
    /**
     * Race (§4.2, M6-2): sessionId of the player who delivered a box and ended the round; '' while the
     * round runs, when the time cap ended it, and in Timed. Reset at each countdown and in the lobby.
     */
    raceWinner: t.string().default(''),
    /** Race: the winning box was packed by another van (stolen and delivered). */
    raceStolen: t.boolean().default(false),
  },
  'GameState',
);
export type GameState = SchemaType<typeof GameState>;
