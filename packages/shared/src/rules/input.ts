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
import { Button, type InputFrame } from '../types';
import { NO_GATE_TIMERS, passGates, type GateConfig } from './gates';
import {
  normalizeMove,
  playerHalfSize,
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

/**
 * Advances a player by one InputFrame: `step()` with the fixed input dt, then the map's one-way gates
 * (`passGates`). A player stopped at a gate stands still for the frame (velocity zero) and the stop
 * counts down by one frame; the gate cooldown counts down every frame.
 */
export function applyInput(
  state: MovementState,
  frame: Pick<InputFrame, 'move'> & { readonly buttons?: number },
  map: MovementMap,
  config: MovementConfig & GateConfig,
  modifiers: StepModifiers = {},
): MovementState {
  const gates = map.gates ?? [];
  const timers = state.gate ?? NO_GATE_TIMERS;
  if (timers.stop > 0) {
    return {
      x: state.x,
      y: state.y,
      vx: 0,
      vy: 0,
      gate: { ...timers, stop: timers.stop - 1, cooldown: Math.max(0, timers.cooldown - 1) },
    };
  }
  const moved = step(
    state,
    frame,
    inputStepSeconds(config),
    map,
    config,
    frameModifiers(modifiers, frame.buttons ?? 0),
  );
  if (gates.length === 0 && state.gate === undefined) return moved;
  const ticked = timers.cooldown > 0 ? { ...timers, cooldown: timers.cooldown - 1 } : timers;
  const passed = passGates(
    gates,
    state,
    moved,
    playerHalfSize(config),
    ticked,
    modifiers.carrying === true,
    config,
  );
  return { x: passed.x, y: passed.y, vx: passed.vx, vy: passed.vy, gate: passed.timers };
}

/** The modifiers one frame moves with: `blockSpeedMultiplier` applies while that frame holds Block. */
export function frameModifiers(modifiers: StepModifiers, buttons: number): StepModifiers {
  const block = modifiers.blockSpeedMultiplier;
  if (block === undefined || (buttons & Button.Block) === 0) return modifiers;
  return { ...modifiers, speedMultiplier: (modifiers.speedMultiplier ?? 1) * block };
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
  | 'inputHz'
  | 'serverTickHz'
  | 'maxInputsPerTick'
  | 'maxQueuedInputs'
  | 'maxInputCreditSeconds'
  | 'inputQueueTargetDepth'
  | 'inputQueueTrimSeconds'
>;

/**
 * One player's pending inputs on the server, plus the rate limit that decides how many run per tick.
 *
 * Each tick earns `inputHz / serverTickHz` frames of credit (1.5 at 30 Hz input, 20 Hz tick) and each
 * applied frame spends one. Credit is saved up to `maxInputCreditSeconds` worth of frames while the
 * queue is empty (a network stall), so when the held-back frames arrive together the backlog drains
 * at up to `maxInputsPerTick` frames per tick instead of staying queued as extra latency. Over any
 * window a player runs at most `inputHz` frames per second plus that small saved allowance, so sending
 * faster never gives more speed.
 *
 * A backlog the credit cannot clear (a long stall, or a client clock that runs slightly fast) is
 * trimmed: when the queue has held more than `inputQueueTargetDepth` frames after every tick for
 * `inputQueueTrimSeconds`, the oldest frames are dropped down to that depth. The queue never holds more
 * than `maxQueuedInputs`. Buttons of dropped frames are merged into the oldest kept frame, so a press
 * is never lost to a drop.
 */
export class InputQueue {
  private readonly frames: InputFrame[] = [];
  private credit = 0;
  /** Ticks in a row that ended with more than `inputQueueTargetDepth` frames queued. */
  private ticksOverTarget = 0;
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
    if (this.frames.length > this.config.maxQueuedInputs) this.dropOldest(1);
    return true;
  }

  /** The frames to apply this tick, in seq order, removed from the queue. */
  take(): InputFrame[] {
    const { inputHz, serverTickHz, maxInputsPerTick } = this.config;
    const perTick = inputHz / serverTickHz;
    const maxCredit = Math.max(this.config.maxInputCreditSeconds * inputHz, maxInputsPerTick, perTick);
    this.credit = Math.min(this.credit + perTick, maxCredit);
    const count = Math.min(
      Math.floor(this.credit),
      Math.max(maxInputsPerTick, Math.floor(perTick)),
      this.frames.length,
    );
    this.credit -= count;
    const taken = this.frames.splice(0, count);
    this.trimBacklog();
    return taken;
  }

  /** Drops queued frames and credit, e.g. when a round starts or ends. Keeps the seq high-water mark. */
  clear(): void {
    this.frames.length = 0;
    this.credit = 0;
    this.ticksOverTarget = 0;
  }

  /**
   * Restarts the seq check from `lastSeq` (the player's ack) and drops queued frames, for a client that
   * reconnected. A reloaded page restarts its seq a fixed distance past its ack and must not be refused
   * because frames from the old socket (applied, queued or dropped) went further. Saved credit is kept,
   * so frames the SDK buffered during the drop still catch up.
   */
  rewind(lastSeq: number): void {
    this.frames.length = 0;
    this.ticksOverTarget = 0;
    this.lastQueuedSeq = lastSeq;
  }

  private trimBacklog(): void {
    const target = this.config.inputQueueTargetDepth;
    if (this.frames.length <= target) {
      this.ticksOverTarget = 0;
      return;
    }
    this.ticksOverTarget++;
    if (this.ticksOverTarget < this.config.inputQueueTrimSeconds * this.config.serverTickHz) return;
    this.dropOldest(this.frames.length - target);
    this.ticksOverTarget = 0;
  }

  /** Drops the `count` oldest frames, keeping their buttons on the oldest frame that stays. */
  private dropOldest(count: number): void {
    const dropped = this.frames.splice(0, count);
    const kept = this.frames[0];
    if (!kept) return;
    let buttons = kept.buttons;
    for (const frame of dropped) buttons |= frame.buttons;
    this.frames[0] = { ...kept, buttons: buttons >>> 0 };
  }
}
