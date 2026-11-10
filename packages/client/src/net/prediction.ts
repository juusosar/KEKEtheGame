// Client-side prediction for the local player (§15.3). Each fixed input step the client applies its own
// InputFrame with the shared rules at once (no waiting for the server) and keeps the frame until the
// server acks it. On every state patch the server's authoritative body is taken as the new base and
// the frames it has not applied yet are replayed on top, so a misprediction is corrected without
// throwing away input the server will still run.
import {
  applyInput,
  type GameConfig,
  type InputFrame,
  type MovementConfig,
  type MovementMap,
  type MovementState,
} from '@keke/shared';

/** The server's view of our player, read from a state patch. */
export interface ServerBody extends MovementState {
  /** `seq` of the last InputFrame the server applied. */
  readonly ack: number;
}

export type PredictionConfig = MovementConfig & Pick<GameConfig, 'inputHz'>;

/** Below this many pixels a correction counts as agreement (float maths can differ between engines). */
export const CORRECTION_EPSILON_PX = 0.01;

export class Predictor {
  private pending: InputFrame[] = [];
  private body: MovementState;
  /** The fixed state before the last step, for render interpolation between fixed steps. */
  private previous: MovementState;
  private correction = 0;

  constructor(
    private readonly map: MovementMap,
    private readonly config: PredictionConfig,
    start: MovementState,
    /** Unacked frames kept at most; older ones are dropped (the server can never have more queued). */
    private readonly maxPending = 2 * config.inputHz,
  ) {
    this.body = start;
    this.previous = start;
  }

  /** The predicted body after every frame applied so far. */
  get state(): MovementState {
    return this.body;
  }

  /** Frames sent but not yet acked by the server. */
  get pendingCount(): number {
    return this.pending.length;
  }

  /** Distance in pixels the last reconcile moved the prediction (0 when the server agreed). */
  get lastCorrection(): number {
    return this.correction;
  }

  /** Predicts one fixed step. `track` false applies the frame without waiting for an ack (offline play). */
  apply(frame: InputFrame, track = true): MovementState {
    this.previous = this.body;
    this.body = applyInput(this.body, frame, this.map, this.config);
    if (track) {
      this.pending.push(frame);
      if (this.pending.length > this.maxPending)
        this.pending.splice(0, this.pending.length - this.maxPending);
    }
    return this.body;
  }

  /**
   * Takes the server's body as the truth: drops acked frames and replays the rest. The render
   * interpolation base moves by the same amount, so a correction shows once instead of stuttering.
   */
  reconcile(server: ServerBody): MovementState {
    this.pending = this.pending.filter((f) => f.seq > server.ack);
    let replayed: MovementState = { x: server.x, y: server.y, vx: server.vx, vy: server.vy };
    for (const frame of this.pending) replayed = applyInput(replayed, frame, this.map, this.config);

    const dx = replayed.x - this.body.x;
    const dy = replayed.y - this.body.y;
    const moved = Math.hypot(dx, dy);
    this.correction = moved < CORRECTION_EPSILON_PX ? 0 : moved;
    this.previous = { ...this.previous, x: this.previous.x + dx, y: this.previous.y + dy };
    this.body = replayed;
    return this.body;
  }

  /** Puts the body somewhere without prediction (spawn, round end, spectating) and forgets pending frames. */
  reset(state: MovementState): void {
    this.pending = [];
    this.correction = 0;
    this.body = state;
    this.previous = state;
  }

  /** Position to draw: `alpha` (0..1) of the way from the previous fixed step to the current one. */
  renderPosition(alpha: number): { x: number; y: number } {
    const a = Math.min(1, Math.max(0, alpha));
    return {
      x: this.previous.x + (this.body.x - this.previous.x) * a,
      y: this.previous.y + (this.body.y - this.previous.y) * a,
    };
  }
}

/**
 * Turns render-frame time into whole fixed input steps (§15.3: one InputFrame per 1 / inputHz s).
 * The remainder carries over; `alpha` is how far the next step has come, for interpolation.
 */
export class FixedStepClock {
  private accumulated = 0;

  constructor(
    readonly stepSeconds: number,
    /** Steps run at most per render frame, so a stalled tab does not burst-send a backlog. */
    private readonly maxSteps = 4,
  ) {
    if (!(stepSeconds > 0)) throw new Error('FixedStepClock: stepSeconds must be positive');
  }

  /** Adds frame time; returns how many fixed steps to run now. */
  advance(dtSeconds: number): number {
    this.accumulated += Math.max(0, dtSeconds);
    let steps = Math.floor(this.accumulated / this.stepSeconds);
    if (steps > this.maxSteps) {
      steps = this.maxSteps;
      this.accumulated = 0;
    } else {
      this.accumulated -= steps * this.stepSeconds;
    }
    return steps;
  }

  get alpha(): number {
    return this.accumulated / this.stepSeconds;
  }

  reset(): void {
    this.accumulated = 0;
  }
}

/**
 * Input sequence numbers for one room connection (keep one per Room object, see `inputSequenceFor`). The server refuses any seq at or below the highest
 * it has queued, also across a reconnect (its queue for us survives the drop). It can hold at most
 * `maxQueuedInputs` frames we have not seen acked, so starting `maxQueuedInputs` past our ack is always
 * new to it. Gaps are fine: seq only has to increase.
 */
export class InputSequence {
  private last: number | null = null;

  constructor(private readonly margin: number) {}

  /** Starts numbering from the first synced ack. Later calls do nothing: our own numbering is ahead. */
  sync(ack: number): void {
    if (this.last === null) this.last = ack + this.margin;
  }

  get started(): boolean {
    return this.last !== null;
  }

  /** The next seq; call `sync` first. */
  next(): number {
    if (this.last === null) throw new Error('InputSequence: sync() before next()');
    this.last += 1;
    return this.last;
  }
}

const sequences = new WeakMap<object, InputSequence>();

/** The InputSequence of a room connection; a new Game scene on the same connection keeps numbering. */
export function inputSequenceFor(room: object, margin: number): InputSequence {
  let seq = sequences.get(room);
  if (!seq) {
    seq = new InputSequence(margin);
    sequences.set(room, seq);
  }
  return seq;
}
