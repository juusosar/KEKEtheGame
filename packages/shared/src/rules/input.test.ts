import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config';
import { InputQueue, applyInput, inputStepSeconds, sanitizeInputFrame } from './input';
import { step } from './movement';
import { mapFrom } from './testGrid';

const config = loadConfig();
const frame = (seq: number, x = 1, y = 0) => ({ seq, move: { x, y }, aim: 0, buttons: 0 });

describe('inputStepSeconds / applyInput', () => {
  it('advances one fixed step of 1 / inputHz', () => {
    expect(inputStepSeconds(config)).toBeCloseTo(1 / config.inputHz);
    const map = mapFrom(['.....', '.....']);
    const start = { x: 40, y: 32, vx: 0, vy: 0 };
    const moved = applyInput(start, frame(1), map, config);
    expect(moved).toEqual(step(start, frame(1), 1 / config.inputHz, map, config));
    expect(moved.x).toBeCloseTo(40 + config.playerSpeed / config.inputHz);
  });
});

describe('sanitizeInputFrame', () => {
  it('accepts a valid frame and clamps the move to length 1', () => {
    const f = sanitizeInputFrame({ seq: 3, move: { x: 5, y: -5 }, aim: -Math.PI / 2, buttons: 5 }, 2);
    expect(f?.seq).toBe(3);
    expect(Math.hypot(f?.move.x ?? 0, f?.move.y ?? 0)).toBeCloseTo(1);
    expect(f?.aim).toBeCloseTo((3 * Math.PI) / 2);
    expect(f?.buttons).toBe(5);
  });

  it.each([
    ['not an object', 7],
    ['null', null],
    ['old seq', frame(2)],
    ['fractional seq', { ...frame(3), seq: 3.5 }],
    ['NaN move', { ...frame(3), move: { x: NaN, y: 0 } }],
    ['missing move', { seq: 3, aim: 0, buttons: 0 }],
    ['infinite aim', { ...frame(3), aim: Infinity }],
    ['negative buttons', { ...frame(3), buttons: -1 }],
    ['string seq', { ...frame(3), seq: '3' }],
  ])('rejects %s', (_name, raw) => {
    expect(sanitizeInputFrame(raw, 2)).toBeNull();
  });
});

describe('InputQueue', () => {
  const cfg = { inputHz: 30, serverTickHz: 20, maxInputsPerTick: 3, maxQueuedInputs: 5 };

  it('rejects stale and duplicate seqs', () => {
    const q = new InputQueue(cfg);
    expect(q.push(frame(1))).toBe(true);
    expect(q.push(frame(1))).toBe(false);
    expect(q.push(frame(3))).toBe(true);
    expect(q.push(frame(2))).toBe(false);
    expect(q.length).toBe(2);
  });

  it('applies inputHz frames per second on average (1.5 per tick at 30/20)', () => {
    const q = new InputQueue({ ...cfg, maxQueuedInputs: 100 });
    for (let s = 1; s <= 60; s++) q.push(frame(s));
    const counts = Array.from({ length: 20 }, () => q.take().length);
    expect(counts.slice(0, 4)).toEqual([1, 2, 1, 2]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(30);
  });

  it('returns frames in seq order', () => {
    const q = new InputQueue(cfg);
    q.push(frame(1));
    q.push(frame(2));
    q.take();
    expect(q.take().map((f) => f.seq)).toEqual([2]);
  });

  it('lets a short backlog catch up, but never more than maxInputsPerTick in one tick', () => {
    const q = new InputQueue(cfg);
    for (let i = 0; i < 4; i++) q.take(); // idle ticks build up credit
    for (let s = 1; s <= 5; s++) q.push(frame(s));
    expect(q.take()).toHaveLength(3);
  });

  it('keeps only the newest maxQueuedInputs frames when flooded', () => {
    const q = new InputQueue(cfg);
    for (let s = 1; s <= 8; s++) q.push(frame(s));
    expect(q.length).toBe(5);
    q.take();
    q.take();
    expect(q.take()[0]?.seq).toBeGreaterThanOrEqual(4);
  });

  it('clear() drops frames but still refuses old seqs', () => {
    const q = new InputQueue(cfg, 10);
    expect(q.push(frame(10))).toBe(false);
    q.push(frame(11));
    q.clear();
    expect(q.length).toBe(0);
    expect(q.push(frame(11))).toBe(false);
    expect(q.push(frame(12))).toBe(true);
  });
});
