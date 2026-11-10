// The game room (§15.3): lobby, host role, ready-up, host settings and the round state machine.
// Gameplay systems (movement, items, combat, …) plug into the 'playing' phase in later tasks.
import { Room, ServerError, type AuthContext, type Client, type Delayed } from '@colyseus/core';
import {
  ClientMessage,
  ServerMessage,
  balanceTeams,
  canStart,
  createRng,
  generateRoomCode,
  nextPhase,
  normalizeRoomCode,
  phaseSeconds,
  pickHost,
  sanitizeProfile,
  settingsUpdateSchema,
  shuffleTeams,
  teamForJoiner,
  totalRounds,
  type GameConfig,
  type GameJoinOptions,
  type GameMode,
  type MapModel,
  type GameRoomMetadata,
  type LobbyErrorCode,
  type LobbyErrorMessage,
  type Rng,
  type RosterEntry,
  type RoundPhase,
} from '@keke/shared';
import { GameState, PlayerState } from '../schema/GameState';
import { MovementSystem } from '../systems/movement';

/** Close/auth error code for a join with a missing or wrong room code. */
export const WRONG_CODE_ERROR = 4404;

/** How often `secondsLeft` is refreshed, in ms. Only whole seconds are synced, so 4 Hz is plenty. */
const TIMER_REFRESH_MS = 250;

/** Codes of the rooms alive in this process. One process serves every room in v1 (§16). */
const codesInUse = new Set<string>();

/** Seeds for room RNGs. The server may read the clock; shared rules get the RNG passed in. */
function randomSeed(): number {
  return Math.floor(Math.random() * 0x100000000);
}

export abstract class GameRoom extends Room<{ state: GameState; metadata: GameRoomMetadata }> {
  /** Validated game config; `gameRoomWithConfig` supplies it. */
  protected abstract readonly config: GameConfig;
  /** The map this room simulates on; `gameRoomWithConfig` supplies it. */
  protected abstract readonly map: MapModel;

  override state = new GameState();

  private rng: Rng = createRng(randomSeed());
  private joinCounter = 0;
  private phaseTimer: Delayed | undefined;
  private phaseEndsAt = 0;
  private movement!: MovementSystem;
  private simulation: Delayed | undefined;

  override onCreate(): void {
    this.maxClients = this.config.maxPlayersPerRoom;
    this.state.code = generateRoomCode(this.rng, codesInUse);
    codesInUse.add(this.state.code);

    this.onMessage(ClientMessage.ready, (client, message: unknown) => this.handleReady(client, message));
    this.onMessage(ClientMessage.settings, (client, message: unknown) =>
      this.handleSettings(client, message),
    );
    this.onMessage(ClientMessage.shuffleTeams, (client) => this.handleShuffle(client));
    this.onMessage(ClientMessage.start, (client) => this.handleStart(client));
    this.onMessage(ClientMessage.profile, (client, message: unknown) => this.handleProfile(client, message));
    this.onMessage(ClientMessage.input, (client, message: unknown) => this.handleInput(client, message));

    this.movement = new MovementSystem(this.config, this.map);
    // One state patch per simulation tick.
    this.setPatchRate(1000 / this.config.serverTickHz);

    this.clock.setInterval(() => this.refreshSecondsLeft(), TIMER_REFRESH_MS);
    this.publishMetadata();
  }

  /** The creator joins without a code; everyone after them must name this room's code. */
  override onAuth(_client: Client, options: GameJoinOptions | undefined, _context: AuthContext): boolean {
    if (this.state.players.size === 0) return true;
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
    player.color = profile.color;
    player.hat = profile.hat;
    player.joinOrder = this.joinCounter++;
    player.spectator = spectator;
    if (this.state.settings.teams && !spectator) player.team = teamForJoiner(this.activeRoster());
    this.state.players.set(client.sessionId, player);

    if (this.state.hostId === '') this.state.hostId = client.sessionId;
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
    // Later systems drop the carried item here (§15.3, M3-4).
    if (this.state.hostId === client.sessionId) this.reassignHost();
    this.allowReconnection(client, seconds);
  }

  override onReconnect(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    player.connected = true;
    // Everyone was away: the first one back takes the host role if its holder is still away.
    if (this.state.players.get(this.state.hostId)?.connected !== true) this.reassignHost();
  }

  /** A consented leave, or a reconnect window that ran out. */
  override onLeave(client: Client): void {
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
    const { mode, roundsPerMap, teams } = parsed.data;
    const settings = this.state.settings;
    if (mode !== undefined) settings.mode = mode;
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
    this.state.totalRounds = totalRounds(this.state.settings.roundsPerMap);
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
    player.color = profile.color;
    player.hat = profile.hat;
    if (this.state.hostId === client.sessionId) this.publishMetadata();
  }

  /** Queues an InputFrame; only players (not spectators) in the 'playing' phase move (§15.3). */
  private handleInput(client: Client, message: unknown): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.spectator || this.state.phase !== 'playing') return;
    this.movement.receive(player, message);
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
      this.admitSpectators();
      this.spawnPlayers();
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

  /** Every player starts the round at their van (§3). Until M3-4 assigns vans, van order = join order. */
  private spawnPlayers(): void {
    const active = [...this.state.players.values()]
      .filter((p) => !p.spectator)
      .sort((a, b) => a.joinOrder - b.joinOrder);
    this.movement.spawn(active);
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
    this.movement.tick(this.state.players.values());
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
    this.state.round = 0;
    this.state.totalRounds = 0;
    this.state.players.forEach((p) => {
      p.ready = false;
      p.spectator = false;
    });
    if (this.state.settings.teams) this.applyTeams(balanceTeams(this.activeRoster()));
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
    };
    this.setMetadata(metadata).catch((error: unknown) =>
      console.error('GameRoom: setMetadata failed', error),
    );
  }
}

/** A concrete GameRoom class bound to a validated config and map, ready for `server.define`. */
export function gameRoomWithConfig(
  config: GameConfig,
  map: MapModel,
): typeof GameRoom & (new () => GameRoom) {
  return class ConfiguredGameRoom extends GameRoom {
    protected readonly config = config;
    protected readonly map = map;
  };
}
