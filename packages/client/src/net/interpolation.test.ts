import { describe, expect, it } from 'vitest';
import { SnapshotBuffer } from './interpolation';

const options = { delayMs: 100, snapDistance: 64, patchIntervalMs: 50 };

describe('SnapshotBuffer', () => {
  it('has nothing to draw before the first snapshot', () => {
    expect(new SnapshotBuffer(options).sample(1000)).toBeNull();
  });

  it('draws delayMs in the past, between the two snapshots around that moment', () => {
    const buf = new SnapshotBuffer(options);
    buf.push(1000, 0, 0);
    buf.push(1050, 10, 0);
    buf.push(1100, 20, 4);
    expect(buf.sample(1125)).toEqual({ x: 5, y: 0 }); // t = 1025
    expect(buf.sample(1175)).toEqual({ x: 15, y: 2 }); // t = 1075
  });

  it('holds the oldest snapshot before it and the newest after it, without extrapolating', () => {
    const buf = new SnapshotBuffer(options);
    buf.push(1000, 0, 0);
    buf.push(1050, 10, 0);
    expect(buf.sample(1050)).toEqual({ x: 0, y: 0 });
    expect(buf.sample(2000)).toEqual({ x: 10, y: 0 });
  });

  it('snaps on a jump longer than snapDistance (spawn) instead of sliding across the map', () => {
    const buf = new SnapshotBuffer(options);
    buf.push(1000, 0, 0);
    buf.push(1050, 500, 0);
    expect(buf.size).toBe(1);
    expect(buf.sample(1100)).toEqual({ x: 500, y: 0 });
  });

  it('starts a move after standing still from one patch back, not from the start of the quiet gap', () => {
    const buf = new SnapshotBuffer(options);
    buf.push(1000, 0, 0);
    buf.push(1050, 0, 0); // standing: not stored again
    expect(buf.size).toBe(1);
    buf.push(3000, 8, 0);
    // Without the inserted point this would be 97.5 % of the way already. Samples go forward in time.
    expect(buf.sample(3050)).toEqual({ x: 0, y: 0 });
    expect(buf.sample(3075)).toEqual({ x: 4, y: 0 });
    expect(buf.sample(3100)).toEqual({ x: 8, y: 0 });
  });

  it('ignores snapshots that go back in time and trims old ones as it samples', () => {
    const buf = new SnapshotBuffer(options);
    for (let i = 0; i < 10; i++) buf.push(1000 + i * 50, i, 0);
    buf.push(900, 99, 0);
    expect(buf.size).toBe(10);
    expect(buf.sample(1525)).toEqual({ x: 8.5, y: 0 });
    expect(buf.size).toBe(2);
  });
});

describe('SnapshotBuffer after a hitch (M5 review F1)', () => {
  /** Largest drawn speed in px/ms, sampling every `step` ms from `from` to `to`. */
  function fastest(buf: SnapshotBuffer, from: number, to: number, step = 1): number {
    let prev = buf.sample(from);
    let max = 0;
    for (let now = from + step; now <= to; now += step) {
      const cur = buf.sample(now);
      if (prev && cur) max = Math.max(max, Math.hypot(cur.x - prev.x, cur.y - prev.y) / step);
      prev = cur;
    }
    return max;
  }

  it('spaces patches handled a few ms apart at least 0.8 intervals apart', () => {
    const buf = new SnapshotBuffer(options);
    buf.push(1000, 0, 0);
    buf.push(1050, 8, 0);
    // A hitch: the next three patches are handled 2 ms apart.
    buf.push(1150, 16, 0);
    buf.push(1152, 24, 0);
    buf.push(1154, 32, 0);
    expect(buf.size).toBe(5);
    // Stamped 1150, 1190, 1230 instead of 1150, 1152, 1154.
    expect(buf.sample(1290)).toEqual({ x: 24, y: 0 });
    expect(buf.sample(1310)).toEqual({ x: 28, y: 0 });
    // Walking speed is 8 px per 50 ms = 0.16 px/ms; the burst is replayed at no more than 1.25 times that.
    expect(fastest(buf, 1100, 1500)).toBeLessThanOrEqual(0.2 + 1e-9);
  });

  it('never stamps a snapshot more than delayMs after it arrived', () => {
    const buf = new SnapshotBuffer(options);
    buf.push(1000, 0, 0);
    for (let i = 1; i <= 20; i++) buf.push(1000 + i, i, 0); // 20 patches in 20 ms
    // The last one would be 1000 + 20 * 40 = 1800 by spacing alone; it is held at 1020 + 100.
    expect(buf.sample(1120 + 100)).toEqual({ x: 20, y: 0 });
  });

  it('loses the lead again at the normal patch rate', () => {
    const buf = new SnapshotBuffer(options);
    buf.push(1000, 0, 0);
    buf.push(1001, 1, 0); // stamped 1040
    for (let i = 1; i <= 10; i++) buf.push(1001 + i * 50, 1 + i, 0);
    // 1040 + 40 = 1080 > 1051: stamped late; each later patch gains 10 ms back until on time again.
    expect(buf.sample(1501 + 100)).toEqual({ x: 11, y: 0 });
  });

  it('still snaps on a long jump even when the buffer runs ahead of real time', () => {
    const buf = new SnapshotBuffer(options);
    buf.push(1000, 0, 0);
    buf.push(1002, 8, 0); // stamped 1040
    buf.push(1004, 500, 0);
    expect(buf.size).toBe(1);
    expect(buf.sample(1104)).toEqual({ x: 500, y: 0 });
  });
});
