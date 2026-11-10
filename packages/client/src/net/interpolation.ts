// Remote players are drawn a little in the past (§15.3: ~100 ms), between the two state patches that
// bracket that moment, so their motion is smooth even though patches arrive only every 50 ms.

export interface Snapshot {
  /**
   * Time in ms (performance.now()) the position counts for: when it was first seen, pushed later when
   * patches arrive in a burst so that two snapshots are never closer than MIN_GAP intervals.
   */
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

/**
 * Least spacing of two snapshots, in patch intervals. After a main-thread hitch several patches are
 * handled a few ms apart; stamped as received, the drawn avatar would cross them at many times walking
 * speed. Spacing them out replays the burst at (at most) 1.25x the real pace instead. Below 1 so that
 * the extra lead this adds shrinks again at the normal patch rate.
 */
const MIN_GAP = 0.8;

export class SnapshotBuffer {
  private readonly snapshots: Snapshot[] = [];
  /** Newest receive time pushed (snapshot times can run ahead of it). */
  private lastReceived = -Infinity;

  constructor(private readonly options: InterpolationOptions) {}

  get size(): number {
    return this.snapshots.length;
  }

  /**
   * Records where the player was at receive time `t`. Receive times must not go backwards. A snapshot
   * that follows the previous one too closely (a burst after a hitch) is stamped later, at most
   * `delayMs` past `t`, so the drawn motion never runs faster than about the real speed.
   */
  push(t: number, x: number, y: number): void {
    if (t < this.lastReceived) return;
    this.lastReceived = t;
    const last = this.snapshots[this.snapshots.length - 1];
    if (last) {
      if (Math.hypot(x - last.x, y - last.y) > this.options.snapDistance) {
        this.snapshots.length = 0;
      } else if (last.x === x && last.y === y) {
        // Standing still: one snapshot is enough, and keeping the old time lets the gap rule below work.
        return;
      } else if (t - last.t > 2 * this.options.patchIntervalMs) {
        this.snapshots.push({ t: t - this.options.patchIntervalMs, x: last.x, y: last.y });
      } else {
        const earliest = last.t + MIN_GAP * this.options.patchIntervalMs;
        if (t < earliest) {
          // A snapshot already stamped ahead of real time may be later than `t`; never go backwards.
          t = Math.max(Math.min(earliest, t + this.options.delayMs), last.t);
          if (t === last.t) return;
        }
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
    this.lastReceived = -Infinity;
  }
}
