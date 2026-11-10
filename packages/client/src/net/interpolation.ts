// Remote players are drawn a little in the past (§15.3: ~100 ms), between the two state patches that
// bracket that moment, so their motion is smooth even though patches arrive only every 50 ms.

export interface Snapshot {
  /** Receive time in ms (performance.now()). */
  readonly t: number;
  readonly x: number;
  readonly y: number;
}

export interface InterpolationOptions {
  /** How far behind real time remote players are drawn, ms. */
  readonly delayMs: number;
  /** A jump longer than this (spawn, respawn) snaps instead of sliding, px. */
  readonly snapDistance: number;
  /**
   * Usual time between patches, ms. When a player stood still long enough that no patch carried them,
   * the next move starts from one interval back instead of crawling across the whole quiet gap.
   */
  readonly patchIntervalMs: number;
}

/** Snapshots kept per player; at 20 Hz this is a few seconds, far more than the delay needs. */
const MAX_SNAPSHOTS = 64;

export class SnapshotBuffer {
  private readonly snapshots: Snapshot[] = [];

  constructor(private readonly options: InterpolationOptions) {}

  get size(): number {
    return this.snapshots.length;
  }

  /** Records where the player was at `t`. Times must not go backwards. */
  push(t: number, x: number, y: number): void {
    const last = this.snapshots[this.snapshots.length - 1];
    if (last) {
      if (t < last.t) return;
      if (Math.hypot(x - last.x, y - last.y) > this.options.snapDistance) {
        this.snapshots.length = 0;
      } else if (last.x === x && last.y === y) {
        // Standing still: one snapshot is enough, and keeping the old time lets the gap rule below work.
        return;
      } else if (t - last.t > 2 * this.options.patchIntervalMs) {
        this.snapshots.push({ t: t - this.options.patchIntervalMs, x: last.x, y: last.y });
      }
    }
    this.snapshots.push({ t, x, y });
    if (this.snapshots.length > MAX_SNAPSHOTS)
      this.snapshots.splice(0, this.snapshots.length - MAX_SNAPSHOTS);
  }

  /**
   * Position to draw at time `now`, or null before the first snapshot. Holds the newest one; never
   * extrapolates. `now` must not go backwards between calls: snapshots behind it are dropped.
   */
  sample(now: number): { x: number; y: number } | null {
    const list = this.snapshots;
    const first = list[0];
    if (!first) return null;
    const at = now - this.options.delayMs;
    if (at <= first.t) return { x: first.x, y: first.y };

    // Newest snapshot not after `at`; drop everything before it except one, which interpolation needs.
    let i = list.length - 1;
    while (i > 0 && (list[i] as Snapshot).t > at) i--;
    if (i > 0) list.splice(0, i);
    const a = list[0] as Snapshot;
    const b = list[1];
    if (!b) return { x: a.x, y: a.y };
    if (b.t <= a.t) return { x: b.x, y: b.y };
    const k = (at - a.t) / (b.t - a.t);
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  }

  clear(): void {
    this.snapshots.length = 0;
  }
}
