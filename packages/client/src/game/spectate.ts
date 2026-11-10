// Spectator camera (§13.1): late joiners watch the round, and the camera cycles between players
// until the next round starts. Pure logic; the Game scene feeds it the synced roster each frame.

/** The roster facts the spectator camera needs about one player. */
export interface SpectateEntry {
  readonly sessionId: string;
  readonly joinOrder: number;
  readonly spectator: boolean;
  readonly connected: boolean;
}

/** Players worth watching, in join order: in the round, online, and not the viewer. */
export function spectateCandidates(players: Iterable<SpectateEntry>, selfId: string): string[] {
  return [...players]
    .filter((p) => p.sessionId !== selfId && !p.spectator && p.connected)
    .sort((a, b) => a.joinOrder - b.joinOrder)
    .map((p) => p.sessionId);
}

/**
 * Which player the camera follows. Moves to the next player every `cycleSeconds`, or at once on
 * `next()` (click / gamepad A). When the watched player leaves, the camera moves to whoever came
 * after them in join order, so the view does not jump back to the start.
 */
export class SpectatorCycle {
  private current: string | null = null;
  /** Where `current` sat in the last list, to resume from when that player vanishes. */
  private index = -1;
  private elapsed = 0;

  constructor(private readonly cycleSeconds: number) {
    if (!(cycleSeconds > 0)) throw new Error('SpectatorCycle: cycleSeconds must be positive');
  }

  /** The player being watched, or null when there is nobody to watch. */
  get target(): string | null {
    return this.current;
  }

  /** Advances the timer; returns the player to follow this frame. */
  update(candidates: readonly string[], dtSeconds: number): string | null {
    this.settle(candidates);
    if (this.current === null) return null;
    this.elapsed += Math.max(0, dtSeconds);
    if (this.elapsed >= this.cycleSeconds) this.step(candidates);
    return this.current;
  }

  /** Skips to the next player now and restarts the timer. */
  next(candidates: readonly string[]): string | null {
    this.settle(candidates);
    if (this.current !== null) this.step(candidates);
    return this.current;
  }

  private step(candidates: readonly string[]): void {
    this.elapsed = 0;
    this.index = (this.index + 1) % candidates.length;
    this.current = candidates[this.index] ?? null;
  }

  /** Keeps following the same player if they are still there, otherwise picks the next one. */
  private settle(candidates: readonly string[]): void {
    if (candidates.length === 0) {
      this.current = null;
      this.index = -1;
      this.elapsed = 0;
      return;
    }
    const at = this.current === null ? -1 : candidates.indexOf(this.current);
    if (at >= 0) {
      this.index = at;
      return;
    }
    // Lost the target (or never had one): the player now at its old place came after it.
    this.index = this.index < 0 ? 0 : this.index % candidates.length;
    this.current = candidates[this.index] ?? null;
    this.elapsed = 0;
  }
}
