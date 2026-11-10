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
  const cfg = {
    inputHz: 30,
    serverTickHz: 20,
    maxInputsPerTick: 3,
    maxQueuedInputs: 5,
    maxInputCreditSeconds: 0.3,
    inputQueueTargetDepth: 3,
    inputQueueTrimSeconds: 1,
  };
  // The shipped values, for the timing cases.
  const live = { ...cfg, maxQueuedInputs: 15 };

  /** A client sending at exactly inputHz: 1, 2, 1, 2, ... frames per 20 Hz tick. */
  function steadySender(q: InputQueue, firstSeq = 1) {
    let seq = firstSeq;
    let tick = 0;
    return {
      get seq() {
        return seq;
      },
      /** Sends this tick's frames and returns how many it produced. */
      produce(): number {
        const n = tick++ % 2 === 0 ? 1 : 2;
        for (let i = 0; i < n; i++) q.push(frame(seq++));
        return n;
      },
      /** One frame more than the steady rate, as a client clock that runs fast would send. */
      extra(): void {
        q.push(frame(seq++));
      },
      /** Frames produced during a stall arrive here all at once. */
      skip(): number {
        const n = tick++ % 2 === 0 ? 1 : 2;
        seq += n;
        return n;
      },
    };
  }

  it('rejects stale and duplicate seqs', () => {
    const q = new InputQueue(cfg);
    expect(q.push(frame(1))).toBe(true);
    expect(q.push(frame(1))).toBe(false);
    expect(q.push(frame(3))).toBe(true);
    expect(q.push(frame(2))).toBe(false);
    expect(q.length).toBe(2);
  });

  it('applies inputHz frames per second on average (1.5 per tick at 30/20)', () => {
    const q = new InputQueue({ ...cfg, maxQueuedInputs: 100, inputQueueTrimSeconds: 100 });
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

  it('drains a stall-then-burst backlog within about 10 ticks (M2 review F1)', () => {
    const q = new InputQueue(live);
    const client = steadySender(q);
    for (let t = 0; t < 40; t++) {
      client.produce();
      q.take();
    }
    // A 300 ms stall: 6 ticks with nothing arriving, then the 9 held-back frames arrive together.
    const held: number[] = [];
    for (let t = 0; t < 6; t++) {
      const from = client.seq;
      client.skip();
      for (let s = from; s < client.seq; s++) held.push(s);
      q.take();
    }
    expect(held).toHaveLength(9);
    for (const s of held) q.push(frame(s));

    const depths: number[] = [];
    for (let t = 0; t < 100; t++) {
      client.produce();
      q.take();
      depths.push(q.length);
    }
    expect(Math.max(...depths.slice(10))).toBeLessThanOrEqual(2);
  });

  it('never runs a flooding client faster than inputHz plus the saved allowance', () => {
    const q = new InputQueue(live);
    let seq = 1;
    let applied = 0;
    const ticks = 400;
    for (let t = 0; t < ticks; t++) {
      for (let i = 0; i < 10; i++) q.push(frame(seq++));
      const taken = q.take();
      expect(taken.length).toBeLessThanOrEqual(live.maxInputsPerTick);
      applied += taken.length;
    }
    const allowance = live.maxInputCreditSeconds * live.inputHz;
    expect(applied).toBeLessThanOrEqual((ticks * live.inputHz) / live.serverTickHz + allowance);
  });

  it('can only spend saved credit once: idling then flooding gains at most the allowance', () => {
    const q = new InputQueue(live);
    for (let t = 0; t < 100; t++) q.take(); // a long idle builds the most credit there is
    let seq = 1;
    let applied = 0;
    for (let t = 0; t < 20; t++) {
      for (let i = 0; i < 10; i++) q.push(frame(seq++));
      applied += q.take().length;
    }
    expect(applied).toBeLessThanOrEqual(20 * 1.5 + live.maxInputCreditSeconds * live.inputHz);
  });

  it('trims a backlog from a fast client clock back to the target depth', () => {
    const q = new InputQueue(live);
    const client = steadySender(q);
    let maxDepth = 0;
    for (let t = 0; t < 2000; t++) {
      client.produce();
      // About 3% fast: one extra frame every 20 ticks, so the queue grows until it is trimmed.
      if (t % 20 === 19) client.extra();
      q.take();
      maxDepth = Math.max(maxDepth, q.length);
    }
    expect(maxDepth).toBeLessThanOrEqual(live.inputQueueTargetDepth + 2);
  });

  it('keeps the buttons of dropped frames on the oldest kept frame', () => {
    const q = new InputQueue({ ...cfg, maxQueuedInputs: 3 });
    q.push({ ...frame(1), buttons: 0b01 });
    q.push(frame(2));
    q.push(frame(3));
    q.push({ ...frame(4), buttons: 0b10 }); // overflow drops seq 1
    const first = q.take()[0];
    expect(first?.seq).toBe(2);
    expect(first?.buttons).toBe(0b01);
  });

  it('rewind() restarts the seq check from the ack and drops queued frames', () => {
    const q = new InputQueue(cfg);
    for (let s = 1; s <= 40; s++) q.push(frame(s)); // high-water mark 40, most dropped
    q.rewind(3);
    expect(q.length).toBe(0);
    expect(q.push(frame(3))).toBe(false);
    expect(q.push(frame(20))).toBe(true);
  });
});
