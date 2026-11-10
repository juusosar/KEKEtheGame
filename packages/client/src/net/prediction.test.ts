import { applyInput, loadConfig, type InputFrame, type MovementMap, type MovementState } from '@keke/shared';
import { describe, expect, it } from 'vitest';
import { FixedStepClock, InputSequence, Predictor, inputSequenceFor } from './prediction';

const config = loadConfig();

// 10×10 tiles of floor inside a wall ring; an icy zone on the right half.
const rows = ['##########', ...Array.from({ length: 8 }, () => '#........#'), '##########'];
const map: MovementMap = {
  collision: { width: 10, height: 10, tileSize: 32, isSolid: (tx, ty) => rows[ty]?.[tx] === '#' },
  zoneAt: (x) => (x >= 160 ? { friction: 0.92 } : undefined),
};
const start: MovementState = { x: 64, y: 64, vx: 0, vy: 0 };
const frame = (seq: number, x: number, y = 0): InputFrame => ({ seq, move: { x, y }, aim: 0, buttons: 0 });

/** What the server would hold after applying `frames` from `from`. */
function serverRun(from: MovementState, frames: InputFrame[]): MovementState {
  return frames.reduce((s, f) => applyInput(s, f, map, config), from);
}

describe('Predictor', () => {
  it('predicts with the shared rules, one fixed input step per frame', () => {
    const p = new Predictor(map, config, start);
    p.apply(frame(1, 1));
    expect(p.state).toEqual(applyInput(start, frame(1, 1), map, config));
    expect(p.pendingCount).toBe(1);
  });

  it('agrees with the server when nothing went wrong: acked frames drop, no correction', () => {
    const p = new Predictor(map, config, start);
    const frames = [1, 2, 3, 4, 5].map((s) => frame(s, 1, 0.5));
    for (const f of frames) p.apply(f);
    const before = p.state;

    p.reconcile({ ...serverRun(start, frames.slice(0, 3)), ack: 3 });
    expect(p.pendingCount).toBe(2);
    expect(p.lastCorrection).toBe(0);
    expect(p.state.x).toBeCloseTo(before.x, 9);
    expect(p.state.y).toBeCloseTo(before.y, 9);
  });

  it('replays unacked frames on top of a corrected server body', () => {
    const p = new Predictor(map, config, start);
    const frames = [1, 2, 3, 4].map((s) => frame(s, 1));
    for (const f of frames) p.apply(f);

    // The server says we were knocked 20 px down after frame 2 (e.g. a hit we did not predict).
    const server = serverRun(start, frames.slice(0, 2));
    const knocked = { ...server, y: server.y + 20 };
    p.reconcile({ ...knocked, ack: 2 });

    const expected = serverRun(knocked, frames.slice(2));
    expect(p.state).toEqual(expected);
    expect(p.lastCorrection).toBeCloseTo(20, 6);
    expect(p.pendingCount).toBe(2);
  });

  it('keeps sliding on ice the same way the server does', () => {
    const icy = { x: 200, y: 64, vx: 0, vy: 0 };
    const p = new Predictor(map, config, icy);
    const frames = [frame(1, 1), frame(2, 1), frame(3, 0), frame(4, 0), frame(5, 0)];
    for (const f of frames) p.apply(f);
    expect(p.state.vx).toBeGreaterThan(0); // still sliding after the stick was released
    p.reconcile({ ...serverRun(icy, frames), ack: 5 });
    expect(p.lastCorrection).toBe(0);
    expect(p.pendingCount).toBe(0);
  });

  it('caps pending frames when the server stops acking', () => {
    const p = new Predictor(map, config, start, 3);
    for (let s = 1; s <= 10; s++) p.apply(frame(s, 0));
    expect(p.pendingCount).toBe(3);
  });

  it('does not track frames applied offline', () => {
    const p = new Predictor(map, config, start);
    p.apply(frame(1, 1), false);
    expect(p.pendingCount).toBe(0);
    expect(p.state.x).toBeGreaterThan(start.x);
  });

  it('interpolates the drawn position between the last two fixed steps', () => {
    const p = new Predictor(map, config, start);
    const after = p.apply(frame(1, 1));
    expect(p.renderPosition(0)).toEqual({ x: start.x, y: start.y });
    expect(p.renderPosition(1)).toEqual({ x: after.x, y: after.y });
    expect(p.renderPosition(0.5).x).toBeCloseTo((start.x + after.x) / 2, 9);
    expect(p.renderPosition(7)).toEqual({ x: after.x, y: after.y });
  });

  it('shifts the interpolation base with a correction, so it shows once instead of stuttering', () => {
    const p = new Predictor(map, config, start);
    p.apply(frame(1, 1));
    const midBefore = p.renderPosition(0.5);
    p.reconcile({ x: start.x + 10, y: start.y, vx: 0, vy: 0, ack: 0 });
    expect(p.renderPosition(0.5).x).toBeCloseTo(midBefore.x + 10, 9);
  });

  it('reset puts the body down and forgets pending frames', () => {
    const p = new Predictor(map, config, start);
    p.apply(frame(1, 1));
    p.reset({ x: 100, y: 100, vx: 0, vy: 0 });
    expect(p.pendingCount).toBe(0);
    expect(p.renderPosition(0.3)).toEqual({ x: 100, y: 100 });
  });
});

describe('FixedStepClock', () => {
  it('turns frame time into whole steps and carries the rest', () => {
    const clock = new FixedStepClock(1 / 30);
    expect(clock.advance(1 / 60)).toBe(0);
    expect(clock.alpha).toBeCloseTo(0.5, 9);
    expect(clock.advance(1 / 60)).toBe(1);
    expect(clock.alpha).toBeCloseTo(0, 9);
    expect(clock.advance(0.1)).toBe(3);
  });

  it('drops a backlog bigger than maxSteps instead of burst-sending it', () => {
    const clock = new FixedStepClock(1 / 30, 4);
    expect(clock.advance(1)).toBe(4);
    expect(clock.alpha).toBe(0);
  });

  it('rejects a non-positive step', () => {
    expect(() => new FixedStepClock(0)).toThrow();
  });
});

describe('InputSequence', () => {
  it('starts past the synced ack by the margin and then counts up', () => {
    const seq = new InputSequence(15);
    expect(seq.started).toBe(false);
    expect(() => seq.next()).toThrow();
    seq.sync(40);
    expect(seq.next()).toBe(56);
    expect(seq.next()).toBe(57);
  });

  it('ignores later syncs, since our own numbering runs ahead of the ack', () => {
    const seq = new InputSequence(15);
    seq.sync(0);
    seq.next();
    seq.sync(16);
    expect(seq.next()).toBe(17);
  });

  it('is kept per room connection', () => {
    const room = {};
    const a = inputSequenceFor(room, 15);
    a.sync(0);
    a.next();
    expect(inputSequenceFor(room, 15)).toBe(a);
    expect(inputSequenceFor({}, 15)).not.toBe(a);
  });
});
