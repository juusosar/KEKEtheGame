// Player movement system (§15.3): per-player input queues, applied every server tick with the shared
// movement rules, so client prediction (M2-3) replays exactly what the server runs.
import {
  InputQueue,
  applyInput,
  playerHalfSize,
  vanSpawn,
  type GameConfig,
  type MapModel,
  type MovementState,
} from '@keke/shared';
import type { PlayerState } from '../schema/GameState';

export class MovementSystem {
  private readonly queues = new Map<string, InputQueue>();

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
   * frames are not refused because the old socket's frames went further (M2 review F2).
   */
  resume(player: PlayerState): void {
    this.queues.get(player.sessionId)?.rewind(player.ack);
  }

  /** Puts each player at their van, at rest. `players` in spawn order (join order until M3-4 assigns vans). */
  spawn(players: readonly PlayerState[]): void {
    const half = playerHalfSize(this.config);
    players.forEach((player, i) => {
      const pos = vanSpawn(this.map, i, half);
      player.x = pos.x;
      player.y = pos.y;
      player.vx = 0;
      player.vy = 0;
    });
  }

  /** One server tick: applies each active player's allowed inputs in seq order and acks the last one. */
  tick(players: Iterable<PlayerState>): void {
    for (const player of players) {
      if (player.spectator) continue;
      const frames = this.queues.get(player.sessionId)?.take() ?? [];
      const last = frames[frames.length - 1];
      if (!last) continue;
      let state: MovementState = { x: player.x, y: player.y, vx: player.vx, vy: player.vy };
      for (const frame of frames) state = applyInput(state, frame, this.map, this.config);
      player.x = state.x;
      player.y = state.y;
      player.vx = state.vx;
      player.vy = state.vy;
      player.aim = last.aim;
      player.ack = last.seq;
    }
  }

  /** Drops every queued input, e.g. when a round starts or ends. Seq high-water marks are kept. */
  clear(): void {
    for (const queue of this.queues.values()) queue.clear();
  }

  /** Forgets a player who left for good. */
  remove(sessionId: string): void {
    this.queues.delete(sessionId);
  }
}
