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
