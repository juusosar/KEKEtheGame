// Input timing contract (§15.3, M1 review H1). Client prediction and the server simulation both advance
// a player by exactly one fixed step of `1 / inputHz` seconds per InputFrame, so replaying the same
// frames from the same state gives the same position on both sides.
//
// - The client samples one InputFrame per fixed step (accumulating render-frame time), predicts with
//   `applyInput`, and sends every frame, idle ones included, so sliding on ice continues on the server.
// - The server queues frames per player and, every tick, applies the frames the rate limit allows
//   (`InputRateLimiter`), each with the same fixed dt. It acks the last applied `seq`.
// - A player only moves when one of their frames is applied, so a client cannot move faster by
//   sending more frames, and a stalled client stands still instead of being extrapolated.
import type { GameConfig } from '../config';
import type { InputFrame } from '../types';
import {
  normalizeMove,
  step,
  type MovementConfig,
  type MovementMap,
  type MovementState,
  type StepModifiers,
} from './movement';

/** Seconds of simulation per InputFrame. */
export function inputStepSeconds(config: Pick<GameConfig, 'inputHz'>): number {
  return 1 / config.inputHz;
}

/** Advances a player by one InputFrame: `step()` with the fixed input dt. */
export function applyInput(
  state: MovementState,
  frame: Pick<InputFrame, 'move'>,
  map: MovementMap,
  config: MovementConfig & Pick<GameConfig, 'inputHz'>,
  modifiers: StepModifiers = {},
): MovementState {
  return step(state, frame, inputStepSeconds(config), map, config, modifiers);
}

/** Largest seq a client may use; it is synced as a uint32. */
export const MAX_INPUT_SEQ = 0xffffffff;

/**
 * Checks an untrusted input message. Returns a clean frame (move clamped to length 1, aim in range,
 * buttons as an unsigned bitmask) or null when it is malformed or its seq is not newer than `lastSeq`.
 */
export function sanitizeInputFrame(raw: unknown, lastSeq: number): InputFrame | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { seq, move, aim, buttons } = raw as Record<string, unknown>;
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq <= lastSeq || seq > MAX_INPUT_SEQ) return null;
  if (typeof move !== 'object' || move === null) return null;
  const { x, y } = move as Record<string, unknown>;
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y))
    return null;
  if (typeof aim !== 'number' || !Number.isFinite(aim)) return null;
  if (typeof buttons !== 'number' || !Number.isInteger(buttons) || buttons < 0 || buttons > MAX_INPUT_SEQ) {
    return null;
  }
  const clamped = normalizeMove({ x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) });
  const turn = 2 * Math.PI;
  return { seq, move: clamped, aim: ((aim % turn) + turn) % turn, buttons };
}

/** The config keys the input queue reads. */
export type InputQueueConfig = Pick<
  GameConfig,
  'inputHz' | 'serverTickHz' | 'maxInputsPerTick' | 'maxQueuedInputs'
>;

/**
 * One player's pending inputs on the server, plus the rate limit that decides how many run per tick.
 *
 * Each tick earns `inputHz / serverTickHz` frames of credit (1.5 at 30 Hz input, 20 Hz tick), capped at
 * `maxInputsPerTick`; each applied frame spends one. So over time a player runs at most `inputHz`
 * frames per second, and after a network hiccup a short backlog catches up at up to
 * `maxInputsPerTick` frames per tick. The queue keeps at most `maxQueuedInputs`; when a client floods,
 * the oldest frames are dropped.
 */
export class InputQueue {
  private readonly frames: InputFrame[] = [];
  private credit = 0;
  /** Highest seq accepted into the queue (applied or not). */
  private lastQueuedSeq: number;

  constructor(
    private readonly config: InputQueueConfig,
    lastSeq = 0,
  ) {
    this.lastQueuedSeq = lastSeq;
  }

  get length(): number {
    return this.frames.length;
  }

  /** Validates and queues a raw message. Returns false when it was rejected. */
  push(raw: unknown): boolean {
    const frame = sanitizeInputFrame(raw, this.lastQueuedSeq);
    if (!frame) return false;
    this.lastQueuedSeq = frame.seq;
    this.frames.push(frame);
    if (this.frames.length > this.config.maxQueuedInputs) this.frames.shift();
    return true;
  }

  /** The frames to apply this tick, in seq order, removed from the queue. */
  take(): InputFrame[] {
    const perTick = this.config.inputHz / this.config.serverTickHz;
    this.credit = Math.min(this.credit + perTick, Math.max(this.config.maxInputsPerTick, perTick));
    const count = Math.min(Math.floor(this.credit), this.frames.length);
    this.credit -= count;
    return this.frames.splice(0, count);
  }

  /** Drops queued frames and credit, e.g. when a round starts or ends. Keeps the seq high-water mark. */
  clear(): void {
    this.frames.length = 0;
    this.credit = 0;
  }
}
