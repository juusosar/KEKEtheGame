// Player movement system (§15.3): per-player input queues, applied every server tick with the shared
// movement rules, so client prediction (M2-3) replays exactly what the server runs.
import {
  InputQueue,
  applyInput,
  playerHalfSize,
  vanSpawn,
  type GameConfig,
  type MapModel,
  type InputFrame,
  type MovementState,
  type StepModifiers,
} from '@keke/shared';
import type { PlayerState } from '../schema/GameState';

/** Per-frame hooks other systems plug into the movement tick (items now, combat later). */
export interface FrameHooks {
  /** Modifiers for this player's next frame, from synced state only, so prediction can match (review H1). */
  modifiers?(player: PlayerState): StepModifiers;
  /**
   * Runs after each applied frame, with the player already moved and acked. `pressed` holds the
   * buttons that went down in this frame compared with the player's previous applied frame (review H2).
   */
  afterFrame?(player: PlayerState, frame: InputFrame, pressed: number): void;
}

export class MovementSystem {
  private readonly queues = new Map<string, InputQueue>();
  /** Buttons held in each player's last applied frame, for edge detection. */
  private readonly lastButtons = new Map<string, number>();

  constructor(
    private readonly config: GameConfig,
    private readonly map: MapModel,
  ) {}

  /** Queues a raw input message from `player`. Returns false when it was rejected (bad or stale). */
  receive(player: PlayerState, raw: unknown): boolean {
    let queue = this.queues.get(player.sessionId);
    if (!queue) {
      // Start from the last ack so a reconnecting client cannot replay frames that already ran.
      queue = new InputQueue(this.config, player.ack);
      this.queues.set(player.sessionId, queue);
    }
    return queue.push(raw);
  }

  /**
   * A player's client reconnected: restart their seq check from their ack, so a reloaded page's first
   * frames are not refused because the old socket's frames went further (M2 review F2), and forget the
   * buttons held on the old page.
   */
  resume(player: PlayerState): void {
    this.queues.get(player.sessionId)?.rewind(player.ack);
    // A button held when the old socket dropped counts as a new press on the new page (M3 review F6).
    this.lastButtons.delete(player.sessionId);
  }

  /** Puts each player at their own van (`player.van`, set by the room before), at rest. */
  spawn(players: readonly PlayerState[]): void {
    const half = playerHalfSize(this.config);
    players.forEach((player) => {
      const pos = vanSpawn(this.map, Math.max(0, player.van), half);
      player.x = pos.x;
      player.y = pos.y;
      player.vx = 0;
      player.vy = 0;
    });
  }

  /**
   * One server tick: applies each active player's allowed inputs in seq order, one frame at a time,
   * so a pickup in one frame slows the frames after it, the same way prediction replays them.
   */
  tick(players: Iterable<PlayerState>, hooks: FrameHooks = {}): void {
    for (const player of players) {
      if (player.spectator) continue;
      const frames = this.queues.get(player.sessionId)?.take() ?? [];
      for (const frame of frames) {
        const modifiers = hooks.modifiers?.(player) ?? {};
        const start: MovementState = { x: player.x, y: player.y, vx: player.vx, vy: player.vy };
        const state = applyInput(start, frame, this.map, this.config, modifiers);
        player.x = state.x;
        player.y = state.y;
        player.vx = state.vx;
        player.vy = state.vy;
        player.aim = frame.aim;
        player.ack = frame.seq;
        const previous = this.lastButtons.get(player.sessionId) ?? 0;
        this.lastButtons.set(player.sessionId, frame.buttons);
        hooks.afterFrame?.(player, frame, frame.buttons & ~previous);
      }
    }
  }

  /** Drops every queued input, e.g. when a round starts or ends. Seq high-water marks are kept. */
  clear(): void {
    for (const queue of this.queues.values()) queue.clear();
    this.lastButtons.clear();
  }

  /** Forgets a player who left for good. */
  remove(sessionId: string): void {
    this.queues.delete(sessionId);
    this.lastButtons.delete(sessionId);
  }
}
