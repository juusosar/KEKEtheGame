// One-way gates (phase 2 decision 9): self-checkout gates and entrance doors. A gate is a rectangle
// from the map's `gates` layer with the one direction a player may cross it. Crossing that way stops a
// self-checkout crosser for a moment ("unexpected item in bagging area" while carrying); the other way
// is a wall. Pure and deterministic, shared by the server simulation and client prediction: timers
// count input frames (integers), so both sides agree to the frame.
import type { GameConfig } from '../config';
import type { Vec2 } from '../types';
import type { HalfSize } from './collision';

/** The one direction a gate lets players cross: north, east, south or west (screen +y is south). */
export const GATE_DIRS = ['n', 'e', 's', 'w'] as const;
export type GateDir = (typeof GATE_DIRS)[number];

/** `checkout` stops a crosser (§9.2 self-checkout); `door` (entrance sliding doors) never does. */
export const GATE_KINDS = ['checkout', 'door'] as const;
export type GateKind = (typeof GATE_KINDS)[number];

/** A one-way gate in pixels. `index` is its position in `MapModel.gates`. */
export interface Gate {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly dir: GateDir;
  readonly kind: GateKind;
}

/**
 * A player's gate timers, in input frames (one frame = 1 / inputHz s). Synced, so prediction replays
 * from the server's values.
 */
export interface GateTimers {
  /** Frames the player still stands stopped at a gate; 0 = free. */
  readonly stop: number;
  /** Index of the gate that stopped the player last; -1 = none. */
  readonly gate: number;
  /** Frames until `gate` may stop the player again; 0 = it may. */
  readonly cooldown: number;
}

export const NO_GATE_TIMERS: GateTimers = Object.freeze({ stop: 0, gate: -1, cooldown: 0 });

export type GateConfig = Pick<
  GameConfig,
  'inputHz' | 'gateStopSeconds' | 'gateCarryStopSeconds' | 'gateCooldownSeconds'
>;

/** Frames a crossing of `kind` stops the player for: 0 for doors, longer while carrying. */
export function gateStopFrames(kind: GateKind, carrying: boolean, config: GateConfig): number {
  if (kind === 'door') return 0;
  const seconds = carrying ? config.gateCarryStopSeconds : config.gateStopSeconds;
  return Math.max(0, Math.round(seconds * config.inputHz));
}

/** Frames before the same gate may stop a player again. */
export function gateCooldownFrames(config: GateConfig): number {
  return Math.max(0, Math.round(config.gateCooldownSeconds * config.inputHz));
}

/** True while the player stands stopped at a gate: no moving, attacking, picking up or dropping. */
export function gateStopped(timers: GateTimers | undefined): boolean {
  return (timers?.stop ?? 0) > 0;
}

interface Axis {
  /** The axis a crossing moves along. */
  readonly along: 'x' | 'y';
  readonly across: 'x' | 'y';
  /** +1 when the allowed direction is +along (east or south), else -1. */
  readonly sign: 1 | -1;
}

const AXES: Readonly<Record<GateDir, Axis>> = {
  n: { along: 'y', across: 'x', sign: -1 },
  s: { along: 'y', across: 'x', sign: 1 },
  e: { along: 'x', across: 'y', sign: 1 },
  w: { along: 'x', across: 'y', sign: -1 },
};

/** The unit vector of a gate's allowed direction. */
export function gateDirVector(dir: GateDir): Vec2 {
  const a = AXES[dir];
  return a.along === 'x' ? { x: a.sign, y: 0 } : { x: 0, y: a.sign };
}

/** Centre of a gate's rectangle. */
export function gateCentre(gate: Gate): Vec2 {
  return { x: gate.x + gate.width / 2, y: gate.y + gate.height / 2 };
}

/**
 * Which side of the gate's centre line a body centre is on, measured in the allowed direction: < 0 before
 * the line, >= 0 on or past it. NaN when the body is not level with the gate (its box does not overlap
 * the gate's span across the crossing axis), so it is not crossing this gate.
 */
function sideOf(gate: Gate, p: Vec2, half: HalfSize): number {
  const a = AXES[gate.dir];
  const c = gateCentre(gate);
  const spanHalf = (a.across === 'x' ? gate.width : gate.height) / 2;
  const bodyHalf = a.across === 'x' ? half.hw : half.hh;
  if (Math.abs(p[a.across] - c[a.across]) >= spanHalf + bodyHalf) return Number.NaN;
  return a.sign * (p[a.along] - c[a.along]);
}

/** A body moved by `before → after`, after the gates had their say. */
export interface GatePass {
  /** Position and velocity: moved back onto the line of any gate it tried to cross the wrong way. */
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly timers: GateTimers;
  /** The gate that just stopped the body, if any. */
  readonly stoppedAt?: Gate;
}

/**
 * Applies the gates to one move of a body from `before` to `after` (its centre; velocity from `after`).
 *
 * - Crossing a gate's centre line against its direction is refused: the body stays on the line and its
 *   velocity along the gate axis is zeroed, as at a wall.
 * - Crossing it in its direction is allowed. A checkout gate then stops the body (velocity zero, `stop`
 *   frames from `gateStopFrames`) unless the same gate stopped it less than `gateCooldownSeconds` ago.
 *
 * Gates are checked in index order; at most one stop starts per move.
 */
export function passGates(
  gates: readonly Gate[],
  before: Vec2,
  after: { readonly x: number; readonly y: number; readonly vx: number; readonly vy: number },
  half: HalfSize,
  timers: GateTimers,
  carrying: boolean,
  config: GateConfig,
): GatePass {
  let pos = { x: after.x, y: after.y };
  let vel = { x: after.vx, y: after.vy };
  let next = timers;
  let stoppedAt: Gate | undefined;
  for (const gate of gates) {
    const s1 = sideOf(gate, pos, half);
    if (Number.isNaN(s1)) continue;
    const a = AXES[gate.dir];
    const s0 = a.sign * (before[a.along] - gateCentre(gate)[a.along]);
    if (s0 >= 0 && s1 < 0) {
      // The wrong way: hold the body on the line, like a wall.
      pos = { ...pos, [a.along]: gateCentre(gate)[a.along] };
      vel = { ...vel, [a.along]: 0 };
    } else if (s0 < 0 && s1 >= 0 && stoppedAt === undefined) {
      const frames = gateStopFrames(gate.kind, carrying, config);
      const cooling = next.gate === gate.index && next.cooldown > 0;
      if (frames > 0 && !cooling) {
        next = { stop: frames, gate: gate.index, cooldown: gateCooldownFrames(config) };
        vel = { x: 0, y: 0 };
        stoppedAt = gate;
      }
    }
  }
  return { x: pos.x, y: pos.y, vx: vel.x, vy: vel.y, timers: next, ...(stoppedAt && { stoppedAt }) };
}

/**
 * How far before a checkout gate's line `holdAtGates` leaves a body that something else pushed at it the
 * right way: just short of the line, so the body's own next step crosses it and gets the stop.
 */
export const GATE_HOLD_PX = 0.5;

/**
 * Keeps a body that something else moved (a shove, a slide, a pallet jack dash) from going through a
 * gate without the gate having its say (phase 2 decision 9):
 *
 * - the wrong way through any gate: the body stays on the line, as at a wall;
 * - the right way through a checkout gate: the body stops `GATE_HOLD_PX` short of the line, so it has to
 *   walk through and gets the stop ("unexpected item" while carrying) like everyone else (P2 review F2);
 * - the right way through a door: allowed, doors never stop anyone.
 *
 * Returns the corrected position. Callers end the forced move when it differs from `after`.
 */
export function holdAtGates(
  gates: readonly Gate[] | undefined,
  before: Vec2,
  after: Vec2,
  half: HalfSize,
): Vec2 {
  if (!gates || gates.length === 0) return after;
  let pos = { x: after.x, y: after.y };
  for (const gate of gates) {
    const s1 = sideOf(gate, pos, half);
    if (Number.isNaN(s1)) continue;
    const a = AXES[gate.dir];
    const line = gateCentre(gate)[a.along];
    const s0 = a.sign * (before[a.along] - line);
    if (s0 >= 0 && s1 < 0) pos = { ...pos, [a.along]: line };
    else if (gate.kind === 'checkout' && s0 < 0 && s1 >= 0) {
      // Never move the body backwards: one already within the hold distance stays where it was.
      const held = Math.max(-GATE_HOLD_PX, s0);
      pos = { ...pos, [a.along]: line + a.sign * held };
    }
  }
  return pos;
}

/**
 * True when walking straight from `a` to `b` would cross a gate the wrong way (pathfinding for bots:
 * a route into the store goes through the entrance doors, out through the checkout).
 */
export function crossesGateWrongWay(gates: readonly Gate[], a: Vec2, b: Vec2, half: HalfSize): boolean {
  for (const gate of gates) {
    const ax = AXES[gate.dir];
    const c = gateCentre(gate);
    const s0 = ax.sign * (a[ax.along] - c[ax.along]);
    const s1 = ax.sign * (b[ax.along] - c[ax.along]);
    if (!(s0 >= 0 && s1 < 0)) continue;
    // Where the segment meets the line, is it level with the gate?
    const t = s0 / (s0 - s1);
    const at = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    const spanHalf = (ax.across === 'x' ? gate.width : gate.height) / 2;
    const bodyHalf = ax.across === 'x' ? half.hw : half.hh;
    if (Math.abs(at[ax.across] - c[ax.across]) < spanHalf + bodyHalf) return true;
  }
  return false;
}
