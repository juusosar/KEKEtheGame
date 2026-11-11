// The game room (§15.3): lobby, host role, ready-up, host settings and the round state machine.
// Gameplay systems (movement, items, combat, …) plug into the 'playing' phase in later tasks.
import { Room, ServerError, type AuthContext, type Client, type Delayed } from '@colyseus/core';
import {
  ClientMessage,
  DebugMessage,
  ServerMessage,
  aabbOverlapsSolid,
  applyWantedHits,
  balanceTeams,
  canStart,
  assignVans,
  createRng,
  createWantedWorld,
  expireWanted,
  generateRoomCode,
  gridWithBlocked,
  inOfficeTrigger,
  inWantedZone,
  isMapChoice,
  isWanted,
  mapChoiceAvailable,
  mapForRound,
  mapRotation,
  nextPhase,
  normalizeRoomCode,
  phaseSeconds,
  pickHost,
  placementPointsFor,
  playerHalfSize,
  rankRaceRound,
  rankSession,
  rankTimedRound,
  clearWanted,
  removeWantedPlayer,
  updateWantedZones,
  wantedEventToWire,
  wantedHitsFromCombat,
  wantedPlayers,
  wantedSecondsLeft,
  teamPointsFromVans,
  distinctColor,
  sanitizeProfile,
  settingsUpdateSchema,
  shuffleTeams,
  teamForJoiner,
  teamSideId,
  totalRounds,
  type CombatEvent,
  type GameConfig,
  type GameJoinOptions,
  type GameMode,
  type MapChoice,
  type MapModel,
  type GameRoomMetadata,
  type RaceDelivery,
  type LobbyErrorCode,
  type LobbyErrorMessage,
  type Rng,
  type RosterEntry,
  type RoundPhase,
  type SessionSide,
  type ThemeId,
  type WantedEvent,
  type WantedHit,
  type WantedWorld,
} from '@keke/shared';
import type { MapEntry, MapRegistry } from '../maps';
import { GameState, PlayerState, TeamState } from '../schema/GameState';
import { CombatSystem } from '../systems/combat/CombatSystem';
import { HazardSystem } from '../systems/hazards';
import { ItemSystem } from '../systems/items';
import type { MapSystem } from '../systems/mapSystem';
import { MovementSystem } from '../systems/movement';
import { NpcSystem } from '../systems/npcs/NpcSystem';

/** Close/auth error code for a join with a missing or wrong room code. */
export const WRONG_CODE_ERROR = 4404;

/** How often `secondsLeft` is refreshed, in ms. Only whole seconds are synced, so 4 Hz is plenty. */
const TIMER_REFRESH_MS = 250;

/** Codes of the rooms alive in this process. One process serves every room in v1 (§16). */
const codesInUse = new Set<string>();

/** Least gap between two `wanted` refresh messages to one player, seconds (M5 review F8). */
const WANTED_REFRESH_MIN_GAP_SECONDS = 1;

/** Seeds for room RNGs. The server may read the clock; shared rules get the RNG passed in. */
function randomSeed(): number {
  return Math.floor(Math.random() * 0x100000000);
}

export abstract class GameRoom extends Room<{ state: GameState; metadata: GameRoomMetadata }> {
  /** Validated game config; `gameRoomWithConfig` supplies it. */
  protected abstract readonly config: GameConfig;
  /** The maps this server runs (Phase 2, P1-1); `gameRoomWithConfig` supplies it. */
  protected abstract readonly maps: MapRegistry;
  /** Debug-only messages (teleport, end phase) are accepted. Off unless the server runs with KEKE_DEBUG=1. */
  protected readonly debug: boolean = false;
  /** Store workers spawn. Room tests that are not about NPCs turn it off (`createGameServer({ npcs: false })`). */
  protected readonly npcsOn: boolean = true;
  /** Set by the debug `noNpcs` message: no store workers in this room from then on. */
  private npcsOffForTest = false;

  override state = new GameState();

  private rng: Rng = createRng(randomSeed());
  private joinCounter = 0;
  private phaseTimer: Delayed | undefined;
  private phaseEndsAt = 0;
  /** The map the systems below are built for (`buildMapSystems`); `state.mapId` names it from each countdown. */
  private mapEntry: MapEntry | undefined;
  private movement!: MovementSystem;
  /** The map with parked stock carts as walls (built with the map systems). */
  private liveMap!: MapModel;
  private items!: ItemSystem;
  private combat!: CombatSystem;
  private npcs!: NpcSystem;
  /**
   * Every system built for the current map, in round-start order (P3-1): a map switch and the lobby
   * reset them all, each countdown starts a round on them all. New per-map systems join in
   * `buildMapSystems`.
   */
  private mapSystems: MapSystem[] = [];
  /** Floor hazards of the round's map (the bakery oven, P2-2). */
  private hazards!: HazardSystem;
  /** Wanted status per player this round (§8; M5-2 rules, wired in M5-3). */
  private wanted: WantedWorld = createWantedWorld();
  /** Round seconds of the last `wanted` refresh sent to each player (rate limit, M5 review F8). */
  private readonly wantedRefreshSentAt = new Map<string, number>();
  /** Landed combat events and NPC damage of the current tick, fed to the wanted rules at its end. */
  private tickCombatEvents: CombatEvent[] = [];
  private tickNpcHits: WantedHit[] = [];
  private simulation: Delayed | undefined;
  /** Clock time (ms) the 'playing' phase started; the round clock for item rules counts from here. */
  private playingSince = 0;
  /** Race (§4.2, M6-2): the round's first and only counted delivery; null until then and in Timed. */
  private delivery: RaceDelivery | null = null;

  override onCreate(): void {
    this.maxClients = this.config.maxPlayersPerRoom;
    this.state.code = generateRoomCode(this.rng, codesInUse);
    codesInUse.add(this.state.code);
    this.state.raceQuota = Math.min(255, this.config.raceQuota);

    this.onMessage(ClientMessage.ready, (client, message: unknown) => this.handleReady(client, message));
    this.onMessage(ClientMessage.settings, (client, message: unknown) =>
      this.handleSettings(client, message),
    );
    this.onMessage(ClientMessage.shuffleTeams, (client) => this.handleShuffle(client));
    this.onMessage(ClientMessage.start, (client) => this.handleStart(client));
    this.onMessage(ClientMessage.profile, (client, message: unknown) => this.handleProfile(client, message));
    this.onMessage(ClientMessage.input, (client, message: unknown) => this.handleInput(client, message));
    // Debug messages are always registered (M3 review F1): Colyseus disconnects a client that sends a
    // type with no handler, so on a normal server they are refused with 'debug_off' instead.
    this.onMessage(DebugMessage.teleport, (client, message: unknown) =>
      this.debug
        ? this.handleDebugTeleport(client, message)
        : this.refuse(client, DebugMessage.teleport, 'debug_off'),
    );
    this.onMessage(DebugMessage.giveWeapon, (client, message: unknown) =>
      this.debug
        ? this.handleDebugGiveWeapon(client, message)
        : this.refuse(client, DebugMessage.giveWeapon, 'debug_off'),
    );
    this.onMessage(DebugMessage.vanPoints, (client, message: unknown) =>
      this.debug
        ? this.handleDebugVanPoints(client, message)
        : this.refuse(client, DebugMessage.vanPoints, 'debug_off'),
    );
    this.onMessage(DebugMessage.holdNpc, (client, message: unknown) =>
      this.debug
        ? this.handleDebugHoldNpc(client, message)
        : this.refuse(client, DebugMessage.holdNpc, 'debug_off'),
    );
    this.onMessage(DebugMessage.noNpcs, (client) =>
      this.debug ? this.handleDebugNoNpcs(client) : this.refuse(client, DebugMessage.noNpcs, 'debug_off'),
    );
    this.onMessage(DebugMessage.endPhase, (client) =>
      this.debug ? this.handleDebugEndPhase(client) : this.refuse(client, DebugMessage.endPhase, 'debug_off'),
    );

    // Map choice (Phase 2): the lobby default when this server has it, else its first map. The map
    // systems are built for the lobby's map now (leave and drop paths need them before any round) and
    // rebuilt for the round's map at each countdown when it differs (`useRoundMap`).
    const choice: MapChoice = mapChoiceAvailable(this.state.settings.maps as MapChoice, this.maps.ids)
      ? (this.state.settings.maps as MapChoice)
      : (this.maps.ids[0] as ThemeId);
    this.state.settings.maps = choice;
    this.state.loadedMaps.push(...this.maps.ids);
    this.state.mapId = mapForRound(choice, 0, 1);
    this.buildMapSystems(this.maps.get(this.state.mapId as ThemeId));
    // One state patch per simulation tick.
    this.setPatchRate(1000 / this.config.serverTickHz);

    this.clock.setInterval(() => this.refreshSecondsLeft(), TIMER_REFRESH_MS);
    this.publishMetadata();
    // Locked until the creator is in (M2 review F3): a join without a code matches any open room, so
    // an unlocked new room could give its first seat to someone else. The creator's seat is reserved
    // directly by create(), which a lock does not stop.
    void this.lock();
  }

  /** The creator joins without a code; everyone after them must name this room's code. */
  override onAuth(_client: Client, options: GameJoinOptions | undefined, _context: AuthContext): boolean {
    if (this.joinCounter === 0) return true;
    if (normalizeRoomCode(options?.code) !== this.state.code) {
      throw new ServerError(WRONG_CODE_ERROR, 'No room with that code.');
    }
    return true;
  }

  override onJoin(client: Client, options?: GameJoinOptions): void {
    const profile = sanitizeProfile(options, this.config.nicknameMaxLength);
    const spectator = this.state.phase !== 'lobby';
    const player = new PlayerState();
    player.sessionId = client.sessionId;
    player.nickname = profile.nickname;
    player.color = distinctColor(profile.color, this.colorsTakenBy(client.sessionId));
    player.hat = profile.hat;
    player.joinOrder = this.joinCounter++;
    player.spectator = spectator;
    if (this.state.settings.teams && !spectator) player.team = teamForJoiner(this.activeRoster());
    this.state.players.set(client.sessionId, player);

    if (this.state.hostId === '') this.state.hostId = client.sessionId;
    if (player.joinOrder === 0) void this.unlock();
    this.publishMetadata();
  }

  /**
   * An unexpected disconnect (§15.3): the player keeps their slot, team and everything they own for
   * `reconnectWindowSeconds`. A consented leave skips this and goes straight to onLeave.
   */
  override onDrop(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    const seconds = this.config.reconnectWindowSeconds;
    if (!player || seconds <= 0) return; // onLeave follows and removes the player.
    player.connected = false;
    // §15.3: the carried item drops on disconnect, not when the window ends (review H4).
    this.items.dropCarried(player, this.roundSeconds(), 'disconnect');
    this.combat.onDisconnect(player);
    if (this.state.hostId === client.sessionId) this.reassignHost();
    this.allowReconnection(client, seconds);
  }

  override onReconnect(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    player.connected = true;
    this.movement.resume(player);
    // Everyone was away: the first one back takes the host role if its holder is still away.
    if (this.state.players.get(this.state.hostId)?.connected !== true) this.reassignHost();
  }

  /** A consented leave, or a reconnect window that ran out. */
  override onLeave(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (player) {
      this.items.removePlayer(player, this.roundSeconds());
      this.combat.removePlayer(player);
      this.npcs.removePlayer(player.sessionId);
      this.wanted = removeWantedPlayer(this.wanted, player.sessionId);
    }
    this.state.players.delete(client.sessionId);
    this.movement.remove(client.sessionId);
    if (this.state.hostId === client.sessionId) this.reassignHost();
    if (this.state.phase === 'lobby' && this.state.settings.teams)
      this.applyTeams(balanceTeams(this.activeRoster()));
    this.publishMetadata();
  }

  override onDispose(): void {
    codesInUse.delete(this.state.code);
  }

  // --- Client messages -------------------------------------------------------------------------

  private handleReady(client: Client, message: unknown): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    if (this.state.phase !== 'lobby') return this.refuse(client, ClientMessage.ready, 'wrong_phase');
    const ready = (message as { ready?: unknown } | null)?.ready;
    if (typeof ready !== 'boolean') return this.refuse(client, ClientMessage.ready, 'invalid_payload');
    player.ready = ready;
  }

  private handleSettings(client: Client, message: unknown): void {
    if (!this.checkHostInLobby(client, ClientMessage.settings)) return;
    const parsed = settingsUpdateSchema(this.config).safeParse(message);
    if (!parsed.success) return this.refuse(client, ClientMessage.settings, 'invalid_payload');
    const { mode, roundsPerMap, teams, maps } = parsed.data;
    if (maps !== undefined && !mapChoiceAvailable(maps, this.maps.ids)) {
      return this.refuse(client, ClientMessage.settings, 'map_unavailable');
    }
    const settings = this.state.settings;
    if (mode !== undefined) settings.mode = mode;
    if (maps !== undefined) {
      settings.maps = maps;
      // The lobby shows the session's first map; each countdown sets the round's map.
      this.state.mapId = mapForRound(maps, 0, 1);
    }
    if (roundsPerMap !== undefined) settings.roundsPerMap = roundsPerMap;
    if (teams !== undefined && teams !== settings.teams) {
      settings.teams = teams;
      if (teams) this.applyTeams(balanceTeams(this.activeRoster()));
      else this.state.players.forEach((p) => (p.team = 0));
    }
    this.publishMetadata();
  }

  private handleShuffle(client: Client): void {
    if (!this.checkHostInLobby(client, ClientMessage.shuffleTeams)) return;
    if (!this.state.settings.teams) return this.refuse(client, ClientMessage.shuffleTeams, 'teams_off');
    this.applyTeams(
      shuffleTeams(
        this.activeRoster().map((p) => p.id),
        this.rng,
      ),
    );
  }

  private handleStart(client: Client): void {
    if (!this.checkHostInLobby(client, ClientMessage.start)) return;
    if (!canStart(this.state.players.values())) return this.refuse(client, ClientMessage.start, 'not_ready');
    this.state.round = 1;
    const maps = this.state.settings.maps;
    this.state.totalRounds = totalRounds(
      this.state.settings.roundsPerMap,
      isMapChoice(maps) ? mapRotation(maps).length : 1,
    );
    this.resetSession(true);
    this.enterPhase(nextPhase('lobby', this.progress()));
  }

  private handleProfile(client: Client, message: unknown): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    if (this.state.phase !== 'lobby') return this.refuse(client, ClientMessage.profile, 'wrong_phase');
    if (typeof message !== 'object' || message === null) {
      return this.refuse(client, ClientMessage.profile, 'invalid_payload');
    }
    const current = { nickname: player.nickname, color: player.color, hat: player.hat };
    const profile = sanitizeProfile({ ...current, ...message }, this.config.nicknameMaxLength);
    player.nickname = profile.nickname;
    player.color = distinctColor(profile.color, this.colorsTakenBy(client.sessionId));
    player.hat = profile.hat;
    if (this.state.hostId === client.sessionId) this.publishMetadata();
  }

  /** Queues an InputFrame; only players (not spectators) in the 'playing' phase move (§15.3). */
  private handleInput(client: Client, message: unknown): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.spectator || this.state.phase !== 'playing') return;
    this.movement.receive(player, message);
  }

  // --- Debug messages (KEKE_DEBUG=1 only, §17) -----------------------------------------------------

  /** Gives the sender a weapon by id; e2e specs use it to test one weapon without rolling for it. */
  private handleDebugGiveWeapon(client: Client, message: unknown): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.spectator) return;
    if (this.state.phase !== 'playing' || !player.alive) {
      return this.refuse(client, DebugMessage.giveWeapon, 'wrong_phase');
    }
    const weapon = (message as { weapon?: unknown } | null)?.weapon;
    if (typeof weapon !== 'string' || !this.combat.giveWeapon(client.sessionId, weapon)) {
      return this.refuse(client, DebugMessage.giveWeapon, 'invalid_payload');
    }
  }

  /** Moves the sender's body to `{ x, y }`; e2e specs use it to script a pickup and a deposit. */
  private handleDebugTeleport(client: Client, message: unknown): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.spectator) return;
    if (this.state.phase !== 'playing') return this.refuse(client, DebugMessage.teleport, 'wrong_phase');
    const { x, y } = (message ?? {}) as { x?: unknown; y?: unknown };
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
      return this.refuse(client, DebugMessage.teleport, 'invalid_payload');
    }
    if (aabbOverlapsSolid(this.map.collision, { x, y }, playerHalfSize(this.config))) {
      return this.refuse(client, DebugMessage.teleport, 'invalid_payload');
    }
    player.x = x;
    player.y = y;
    player.vx = 0;
    player.vy = 0;
  }

  /** Sets the banked points of the sender's van; race e2e specs reach the quota with one deposit. */
  private handleDebugVanPoints(client: Client, message: unknown): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.spectator) return;
    if (this.state.phase !== 'playing') return this.refuse(client, DebugMessage.vanPoints, 'wrong_phase');
    const points = (message as { points?: unknown } | null)?.points;
    if (typeof points !== 'number' || !Number.isInteger(points) || points < 0 || points > 0xffff) {
      return this.refuse(client, DebugMessage.vanPoints, 'invalid_payload');
    }
    if (!this.items.setVanPoints(player, points)) {
      return this.refuse(client, DebugMessage.vanPoints, 'invalid_payload');
    }
  }

  /** Host only: ends the current phase now, so an e2e round does not take 180 s. */
  private handleDebugEndPhase(client: Client): void {
    if (client.sessionId !== this.state.hostId) return this.refuse(client, DebugMessage.endPhase, 'not_host');
    if (this.state.phase === 'lobby') return this.refuse(client, DebugMessage.endPhase, 'wrong_phase');
    this.advancePhase();
  }

  /** Holds one store worker in place for a few seconds; npcsClient e2e punches it with one swing (F7). */
  private handleDebugHoldNpc(client: Client, message: unknown): void {
    if (this.state.phase !== 'playing') return this.refuse(client, DebugMessage.holdNpc, 'wrong_phase');
    const { npc, seconds } = (message ?? {}) as { npc?: unknown; seconds?: unknown };
    if (
      typeof npc !== 'string' ||
      typeof seconds !== 'number' ||
      !Number.isFinite(seconds) ||
      seconds <= 0 ||
      seconds > 30 ||
      !this.npcs.holdForTest(npc, seconds)
    ) {
      return this.refuse(client, DebugMessage.holdNpc, 'invalid_payload');
    }
  }

  /** Host only: no store workers in this room from now on (e2e specs that are not about NPCs). */
  private handleDebugNoNpcs(client: Client): void {
    if (client.sessionId !== this.state.hostId) return this.refuse(client, DebugMessage.noNpcs, 'not_host');
    this.npcsOffForTest = true;
    this.npcs.stopForTest();
  }

  // --- Map systems (Phase 2, P1-1) ----------------------------------------------------------------

  /**
   * Builds the map-dependent systems (live map, movement, items, combat, NPCs) for one map. A rebuild
   * (P3-1: the next round is on another map) first resets every old map system, which clears what it put
   * into the synced state (items, vans, projectiles, traps, NPCs, stock carts). A new per-map system is
   * built here and added to `mapSystems`; it then resets and starts rounds with the others.
   */
  private buildMapSystems(entry: MapEntry): void {
    this.resetMapSystems();
    this.mapEntry = entry;
    // The live map: stock carts parked by stockers block movement like walls (M5-3). Items keep the
    // static map (spawns and drops never depend on a cart that is gone a few seconds later).
    const liveMap: MapModel = {
      ...entry.map,
      collision: gridWithBlocked(entry.map.collision, (tx, ty) => this.npcs.isCartTile(tx, ty)),
    };
    this.liveMap = liveMap;
    this.movement = new MovementSystem(this.config, liveMap);
    this.items = new ItemSystem(
      this.state,
      this.config,
      entry.map,
      (event) => this.broadcast(event.type, event.payload),
      entry.items,
      randomSeed(),
    );
    this.combat = new CombatSystem(
      this.state,
      this.config,
      liveMap,
      (event) => this.broadcast(event.type, event.payload),
      // §3.2/§3.3: a KO drops the carried item where the player fell (M3 review H1).
      {
        onKo: (player, now) => this.items.dropCarried(player, now, 'ko'),
        // §7 pallet jack: loose items in the dash's line scatter (M4-6).
        onScatterItems: (from, to, halfWidth, px) => this.items.scatter(from, to, halfWidth, px),
        // §7: a banana peel slip drops the carried item where the player slipped (M4-5).
        onDropCarried: (player, now) => this.items.dropCarried(player, now, 'slip'),
        // Landed hits feed the wanted rules at the end of the tick (§8; M5-3).
        onEvent: (event) => {
          if (event.type !== 'hit') return;
          this.tickCombatEvents.push(event);
          // Violence where the victim stands: customers nearby panic (Phase 2 decision 8). Hits on
          // NPCs reach the NpcSystem directly and it raises them itself.
          const victim = this.state.players.get(event.target);
          if (victim) this.npcs.violence({ x: victim.x, y: victim.y });
        },
      },
      randomSeed(),
    );
    // Store workers (§8; M5-3): player weapons hit them through the combat system, their swings land
    // through it too (blocks, KO item drops).
    this.npcs = new NpcSystem(
      this.state,
      this.config,
      liveMap,
      (event) => this.broadcast(event.type, event.payload),
      {
        hitPlayer: (hit) => this.combat.externalHit(hit),
        onNpcDamaged: (attacker, npc, damage) =>
          this.tickNpcHits.push({ attacker, victim: { kind: 'npc', id: npc }, damage }),
        wantedPlayers: () => wantedPlayers(this.wanted, this.roundSeconds()),
        dropCarried: (player, reason) => this.items.dropCarried(player, this.roundSeconds(), reason),
      },
      randomSeed(),
      this.npcsOn && !this.npcsOffForTest ? undefined : [],
      entry.npcs,
    );
    this.combat.npcTargets = this.npcs;
    // §9.2 bakery oven (P2-2): burns land through the combat damage path like a forklift's run-over.
    this.hazards = new HazardSystem(liveMap, this.config, (hit) => this.combat.externalHit(hit));
    // Every pickup rolls a weapon (§7), on its own RNG stream (M3 review H2); an order box does not
    // (plan M4-1, M6-2): the carrier keeps the weapon they hold.
    this.items.onPickup = (playerId, kind) => {
      if (kind !== 'box') this.combat.onPickup(playerId, 'item');
    };
    const npcs = this.npcs;
    this.mapSystems = [
      this.items,
      this.combat,
      this.hazards,
      // NPC counts scale with the number of players (§8).
      { reset: () => npcs.reset(), startRound: (players) => npcs.startRound(players.length) },
    ];
  }

  /** Resets every system of the current map (map switch, lobby). */
  private resetMapSystems(): void {
    for (const system of this.mapSystems) system.reset();
  }

  /** Countdown: the round's map from the `maps` setting; rebuilds the map systems when it changes. */
  private useRoundMap(): void {
    const id = mapForRound(
      this.state.settings.maps as MapChoice,
      this.state.round,
      this.state.settings.roundsPerMap,
    );
    if (this.mapEntry?.id !== id) this.buildMapSystems(this.maps.get(id));
    this.state.mapId = id;
    // Round history (P3-1): one entry per round, at its countdown.
    this.state.roundMaps.push(id);
  }

  /** The map the room simulates on now. */
  private get map(): MapModel {
    return this.currentMap.map;
  }

  /** The map entry the room's systems run on, for tests. */
  get currentMap(): MapEntry {
    if (!this.mapEntry) throw new Error('GameRoom: no map before onCreate');
    return this.mapEntry;
  }

  // --- Round state machine ---------------------------------------------------------------------

  /** Ends the current phase now. Called by the phase timer; tests and later systems may call it too. */
  advancePhase(): void {
    const phase = this.state.phase as RoundPhase;
    const next = nextPhase(phase, this.progress());
    if (phase === 'roundResults' && next === 'countdown') this.state.round += 1;
    this.enterPhase(next);
  }

  private enterPhase(phase: RoundPhase): void {
    this.phaseTimer?.clear();
    this.phaseTimer = undefined;
    this.state.phase = phase;

    if (phase === 'countdown') {
      this.useRoundMap();
      this.admitSpectators();
      this.spawnPlayers();
      this.clearRoundResults();
      this.clearDelivery();
    }
    if (phase === 'playing') this.playingSince = this.clock.currentTime;
    if (phase === 'roundResults') {
      this.scoreRound();
      this.combat.freeze();
    }
    if (phase === 'lobby') this.resetToLobby();
    this.runSimulation(phase === 'playing');

    const seconds = phaseSeconds(phase, this.state.settings.mode as GameMode, this.config);
    if (seconds === null) {
      this.phaseEndsAt = 0;
    } else {
      this.phaseEndsAt = this.clock.currentTime + seconds * 1000;
      this.phaseTimer = this.clock.setTimeout(() => this.advancePhase(), seconds * 1000);
    }
    this.refreshSecondsLeft();
    this.publishMetadata();
  }

  /**
   * Round start (countdown): assigns vans (teams share one, players keep theirs, §4.3/§15.3), puts every
   * player at their van (§3) and gives each a first target.
   */
  private spawnPlayers(): void {
    const active = [...this.state.players.values()]
      .filter((p) => !p.spectator)
      .sort((a, b) => a.joinOrder - b.joinOrder);
    const vans = assignVans(
      active.map((p) => ({ id: p.sessionId, joinOrder: p.joinOrder, team: p.team, van: p.van })),
      { teams: this.state.settings.teams, slotCount: this.map.vanSlots.length },
    );
    for (const p of active) p.van = vans.get(p.sessionId) ?? 0;
    this.movement.spawn(active);
    for (const system of this.mapSystems) system.startRound?.(active);
    this.resetWanted();
  }

  // --- Round results and session score (§4.1, §5) ---------------------------------------------

  /**
   * The round clock ran out (or something ended 'playing'): rank the players who took part on the item
   * points they deposited, give placement points and add both to the session totals. Items are frozen
   * from here on (no inputs outside 'playing'), so `deposited` is final.
   * Race mode (§4.2, M6-2) ranks the deliverer's side first and everyone else by "items you control";
   * after the time cap everyone by items they control. Player `itemPoints` stay their own deposits.
   */
  private scoreRound(): void {
    const teams = this.state.settings.teams;
    const active = [...this.state.players.values()].filter((p) => !p.spectator);
    const scores = active.map((p) => ({ id: p.sessionId, itemPoints: p.deposited, team: p.team }));
    // Race: van points drop to 0 at packing, so never teamPointsFromVans there (M6-1 handoff).
    // Timed teams: the van's banked total, so a member who left for good still counts (§3.2, §4.3; M3 review F3).
    const result =
      this.state.settings.mode === 'race'
        ? rankRaceRound(this.items.itemWorld, scores, teams, this.delivery)
        : rankTimedRound(scores, teams, teams ? teamPointsFromVans(this.state.vans.values()) : undefined);
    for (const placement of result.players) {
      const player = this.state.players.get(placement.id);
      if (!player) continue;
      player.place = placement.place;
      player.roundPoints = placementPointsFor(placement.place, this.config);
      player.sessionPoints += player.roundPoints;
      player.sessionItemPoints += placement.itemPoints;
    }
    if (teams) {
      for (const side of result.standings) {
        const team = this.teamState(side.id);
        if (!team) continue;
        team.place = side.place;
        team.itemPoints = side.itemPoints;
        team.roundPoints = placementPointsFor(side.place, this.config);
        team.sessionPoints += team.roundPoints;
        // Race: the round's itemPoints are the items the team controlled, but the session tie-break (§5)
        // counts deposits, as it does for players: everything deposited at the team's van this round,
        // including members who have left for good (as the van total does in Timed; M6 review F9).
        team.sessionItemPoints +=
          this.state.settings.mode === 'race' ? this.teamDeposits(team.team) : side.itemPoints;
      }
    }
    this.rankSessionStandings();
  }

  /** Race with Teams: item points deposited at the team's van(s) this round. */
  private teamDeposits(team: number): number {
    let sum = 0;
    this.state.vans.forEach((van) => {
      if (van.team === team) sum += this.items.depositedAt(van.van);
    });
    return sum;
  }

  /**
   * Session standings (§5): most placement points, then most item points. With Teams on the teams are
   * ranked (members take their team's place) and a player without a team stands alone.
   */
  private rankSessionStandings(): void {
    const teams = this.state.settings.teams;
    const active = [...this.state.players.values()].filter((p) => !p.spectator);
    const sides: SessionSide[] = [];
    const sideOf = (p: PlayerState): string => (teams && p.team > 0 ? teamSideId(p.team) : p.sessionId);
    if (teams) {
      this.state.teams.forEach((t) => {
        const hasMembers = active.some((p) => p.team === t.team);
        if (hasMembers || t.sessionPoints > 0 || t.sessionItemPoints > 0) {
          sides.push({ id: teamSideId(t.team), points: t.sessionPoints, itemPoints: t.sessionItemPoints });
        }
      });
    }
    for (const p of active) {
      if (sideOf(p) === p.sessionId) {
        sides.push({ id: p.sessionId, points: p.sessionPoints, itemPoints: p.sessionItemPoints });
      }
    }
    const placeOf = new Map(rankSession(sides).map((s) => [s.id, s.place]));
    this.state.teams.forEach((t) => (t.sessionPlace = placeOf.get(teamSideId(t.team)) ?? 0));
    this.state.players.forEach((p) => (p.sessionPlace = p.spectator ? 0 : (placeOf.get(sideOf(p)) ?? 0)));
  }

  /** The TeamState for a `team:<n>` standings id, or undefined for a player side. */
  private teamState(sideId: string): TeamState | undefined {
    for (const team of [1, 2]) {
      if (sideId === teamSideId(team)) return this.state.teams.get(String(team));
    }
    return undefined;
  }

  /** Countdown: the previous round's places and points are cleared; session totals stay. */
  private clearRoundResults(): void {
    this.state.players.forEach((p) => {
      p.place = 0;
      p.roundPoints = 0;
    });
    this.state.teams.forEach((t) => {
      t.place = 0;
      t.itemPoints = 0;
      t.roundPoints = 0;
    });
  }

  /** A new round or the lobby: no delivery yet. */
  private clearDelivery(): void {
    this.delivery = null;
    this.state.raceWinner = '';
    this.state.raceStolen = false;
  }

  /**
   * Race (§4.2): a box carrier whose body centre is inside the office trigger delivers; only one delivery
   * counts and it ends 'playing' in this tick. Two carriers inside in the same tick: the room's seeded RNG
   * picks the deliverer, so join order gives nobody an edge (M6 review F8, logged in Notion). True when
   * the round ended.
   */
  private checkDelivery(now: number): boolean {
    if (this.state.settings.mode !== 'race' || this.state.phase !== 'playing' || this.delivery) return false;
    const inside = [...this.state.players.values()]
      .filter(
        (p) => !p.spectator && p.alive && this.items.carriesBox(p) && inOfficeTrigger(this.map, p.x, p.y),
      )
      .sort((a, b) => a.joinOrder - b.joinOrder); // a stable list for the RNG to pick from
    while (inside.length > 0) {
      const p = this.rng.pick(inside);
      inside.splice(inside.indexOf(p), 1);
      const delivery = this.items.deliverBox(p, now);
      if (!delivery) continue;
      this.delivery = delivery;
      this.state.raceWinner = delivery.player;
      this.state.raceStolen = delivery.box.box.van !== delivery.van;
      this.advancePhase();
      return true;
    }
    return false;
  }

  /** Start of a session (and back in the lobby): every total back to 0. At Start, Teams on gets both team entries. */
  private resetSession(starting: boolean): void {
    this.state.players.forEach((p) => {
      p.place = 0;
      p.roundPoints = 0;
      p.sessionPoints = 0;
      p.sessionItemPoints = 0;
      p.sessionPlace = 0;
    });
    this.state.teams.clear();
    this.state.roundMaps.clear();
    if (starting && this.state.settings.teams) {
      for (const n of [1, 2]) {
        const team = new TeamState();
        team.team = n;
        this.state.teams.set(String(n), team);
      }
    }
  }

  /** Starts or stops the 20 Hz movement tick. Inputs queued outside 'playing' never run. */
  private runSimulation(on: boolean): void {
    this.movement.clear();
    if (!on) {
      this.simulation?.clear();
      this.simulation = undefined;
    } else if (!this.simulation) {
      this.simulation = this.clock.setInterval(() => this.tick(), 1000 / this.config.serverTickHz);
    }
  }

  /** One simulation tick. Public so tests can step the room without waiting on the clock. */
  tick(): void {
    const now = this.roundSeconds();
    this.combat.beginTick(now);
    // Customers are solid (Phase 2 decision 8): players move around them as they stood at the tick start.
    const solids = this.npcs.solidBodies();
    this.movement.tick(this.state.players.values(), {
      // Carry slowdown times stun/slow/KO/block, from synced fields only (review H1).
      modifiers: (player) => {
        const carry = this.items.modifiers(player).speedMultiplier ?? 1;
        const block = this.combat.blockSpeedMultiplier(player);
        return {
          speedMultiplier: carry * this.combat.speedMultiplier(player),
          ...(block === undefined ? {} : { blockSpeedMultiplier: block }),
          ...(solids.length === 0 ? {} : { solids }),
        };
      },
      afterFrame: (player, frame, pressed) => {
        // A KO'd player can neither pick up nor attack until the respawn (§3.3); a stunned or sliding
        // one cannot pick up or drop either (M4 review F4), but still deposits at the van.
        if (!this.combat.canAct(player)) return;
        this.items.afterFrame(player, pressed, now, this.combat.canPickUp(player));
        this.combat.afterFrame(player, frame, pressed);
      },
    });
    // NPCs move (and swing) after the players and before player attacks resolve (M4 review H4).
    this.npcs.tick(now);
    // Attacks resolve after everyone has moved this tick (M3 review H3).
    this.combat.tick(now);
    // The oven burns after attacks resolve, so a burn never cancels this tick's own swing.
    this.hazards.tick(now, this.state.players.values());
    this.items.tick(now);
    this.updateWanted(now);
    // Race: a delivery ends the round in this tick, after this tick's KOs (a KO'd carrier dropped the box).
    this.checkDelivery(now);
  }

  /**
   * End of a tick (§8; M5-2 rules): this tick's landed hits (player on player near a guard, any damage to
   * an NPC), the wantedOnEnter zones and expiry; then the flags into PlayerState and the events out.
   */
  private updateWanted(now: number): void {
    const hits = [...wantedHitsFromCombat(this.tickCombatEvents), ...this.tickNpcHits];
    this.tickCombatEvents = [];
    this.tickNpcHits = [];
    const events: WantedEvent[] = [];
    const round = [...this.state.players.values()].filter((p) => !p.spectator);
    let result = applyWantedHits(
      this.wanted,
      hits,
      {
        guards: this.npcs.guards(),
        positionOf: (id) => {
          const p = this.state.players.get(id);
          return p ? { x: p.x, y: p.y } : undefined;
        },
        // The live map: a parked cart blocks a guard's view of a fight like it blocks its chase (M5 F5).
        grid: this.liveMap.collision,
        // Customers in the line of sight block the view too (Phase 2 decision 8).
        blockers: this.npcs.solidBodies(),
      },
      now,
      this.config,
    );
    events.push(...result.events);
    result = updateWantedZones(
      result.world,
      round.map((p) => ({ id: p.sessionId, inZone: p.alive && inWantedZone(this.map.zones, p.x, p.y) })),
      now,
      this.config,
    );
    events.push(...result.events);
    // A KO ends Wanted (playtest 1): otherwise the respawn at the dock walks into the staff-door guard.
    result = clearWanted(
      result.world,
      round.filter((p) => !p.alive).map((p) => p.sessionId),
    );
    events.push(...result.events);
    result = expireWanted(result.world, now);
    events.push(...result.events);
    this.wanted = result.world;
    for (const event of events) {
      const wire = wantedEventToWire(event, now);
      if (event.type === 'wanted' && event.refreshed) {
        // A refresh only restarts the timer: other clients have the synced flag, and a spray lands a few
        // times a second. Only the Wanted player hears it, at most once a second (M5 review F8).
        const last = this.wantedRefreshSentAt.get(event.player) ?? -Infinity;
        if (now - last < WANTED_REFRESH_MIN_GAP_SECONDS) continue;
        this.wantedRefreshSentAt.set(event.player, now);
        this.clients.find((c) => c.sessionId === event.player)?.send(wire.type, wire.payload);
        continue;
      }
      this.broadcast(wire.type, wire.payload);
    }
    for (const p of round) {
      const wanted = isWanted(this.wanted, p.sessionId, now);
      if (p.wanted !== wanted) p.wanted = wanted;
      const left = wanted ? Math.min(255, Math.ceil(wantedSecondsLeft(this.wanted, p.sessionId, now))) : 0;
      if (p.wantedIn !== left) p.wantedIn = left;
    }
  }

  /** A new round or the lobby: nobody is Wanted. */
  private resetWanted(): void {
    this.wanted = createWantedWorld();
    this.wantedRefreshSentAt.clear();
    this.tickCombatEvents = [];
    this.tickNpcHits = [];
    this.state.players.forEach((p) => {
      p.wanted = false;
      p.wantedIn = 0;
    });
  }

  /** Seconds since 'playing' started: the round clock the item rules use (loose-item despawn). */
  private roundSeconds(): number {
    return Math.max(0, (this.clock.currentTime - this.playingSince) / 1000);
  }

  /** The current round's item world, for tests and later systems (M3-5 ranking). */
  get itemWorld() {
    return this.items.itemWorld;
  }

  /** The current round's combat world, for tests. */
  get combatWorld() {
    return this.combat.combatWorld;
  }

  /** The room's NPC system, for tests. */
  get npcSystem(): NpcSystem {
    return this.npcs;
  }

  /** The current round's wanted world, for tests. */
  get wantedWorld(): WantedWorld {
    return this.wanted;
  }

  /** Late joiners become players when the next round's countdown starts (§13.1). */
  private admitSpectators(): void {
    this.state.players.forEach((p) => {
      p.spectator = false;
      p.ready = false;
    });
    if (this.state.settings.teams) this.applyTeams(balanceTeams(this.activeRoster()));
  }

  private resetToLobby(): void {
    this.clearDelivery();
    this.resetMapSystems();
    this.resetWanted();
    this.resetSession(false);
    this.state.round = 0;
    this.state.totalRounds = 0;
    this.state.players.forEach((p) => {
      p.ready = false;
      p.spectator = false;
    });
    if (this.state.settings.teams) this.applyTeams(balanceTeams(this.activeRoster()));
    this.state.mapId = mapForRound(this.state.settings.maps as MapChoice, 0, 1);
  }

  private refreshSecondsLeft(): void {
    const left =
      this.phaseEndsAt === 0 ? 0 : Math.max(0, Math.ceil((this.phaseEndsAt - this.clock.currentTime) / 1000));
    if (this.state.secondsLeft !== left) this.state.secondsLeft = left;
  }

  private progress(): { round: number; totalRounds: number } {
    return { round: this.state.round, totalRounds: this.state.totalRounds };
  }

  // --- Helpers ---------------------------------------------------------------------------------

  private checkHostInLobby(client: Client, request: string): boolean {
    if (client.sessionId !== this.state.hostId) {
      this.refuse(client, request, 'not_host');
      return false;
    }
    if (this.state.phase !== 'lobby') {
      this.refuse(client, request, 'wrong_phase');
      return false;
    }
    return true;
  }

  /** Colours worn by everyone in the room except `sessionId` (spectators and dropped players too). */
  private colorsTakenBy(sessionId: string): string[] {
    const taken: string[] = [];
    this.state.players.forEach((p) => {
      if (p.sessionId !== sessionId) taken.push(p.color);
    });
    return taken;
  }

  private refuse(client: Client, request: string, code: LobbyErrorCode): void {
    const message: LobbyErrorMessage = { code, request };
    client.send(ServerMessage.lobbyError, message);
  }

  /**
   * Host role goes to the longest-connected player who is online (§13.1). When nobody is online the
   * role stays with a player inside the reconnect window, and is '' only once the room is empty.
   */
  private reassignHost(): void {
    const online = this.roster().filter((e) => this.state.players.get(e.id)?.connected === true);
    const next = pickHost(online) ?? (this.state.players.has(this.state.hostId) ? this.state.hostId : null);
    this.state.hostId = next ?? pickHost(this.roster()) ?? '';
    this.publishMetadata();
  }

  private roster(): RosterEntry[] {
    const entries: RosterEntry[] = [];
    this.state.players.forEach((p) =>
      entries.push({ id: p.sessionId, joinOrder: p.joinOrder, team: p.team }),
    );
    return entries;
  }

  /** Players taking part in rounds (not spectating). */
  private activeRoster(): RosterEntry[] {
    return this.roster().filter((e) => this.state.players.get(e.id)?.spectator === false);
  }

  private applyTeams(teams: ReadonlyMap<string, 1 | 2>): void {
    for (const [id, team] of teams) {
      const player = this.state.players.get(id);
      if (player) player.team = team;
    }
  }

  private publishMetadata(): void {
    const host = this.state.players.get(this.state.hostId);
    const metadata: GameRoomMetadata = {
      code: this.state.code,
      hostName: host?.nickname ?? '',
      mode: this.state.settings.mode,
      phase: this.state.phase,
      maps: this.state.settings.maps,
      map: this.state.mapId,
    };
    this.setMetadata(metadata).catch((error: unknown) =>
      console.error('GameRoom: setMetadata failed', error),
    );
  }
}

/** A concrete GameRoom class bound to a validated config and the server's maps, ready for `server.define`. */
export function gameRoomWithConfig(
  config: GameConfig,
  maps: MapRegistry,
  { debug = false, npcs = true }: { debug?: boolean; npcs?: boolean } = {},
): typeof GameRoom & (new () => GameRoom) {
  return class ConfiguredGameRoom extends GameRoom {
    protected readonly config = config;
    protected readonly maps = maps;
    protected override readonly debug = debug;
    protected override readonly npcsOn = npcs;
  };
}
