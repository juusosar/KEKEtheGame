// `window.__KEKE__`: a test/debug hook installed only with `?debug=1` (§17). E2E specs read state through
// it instead of reading pixels off the canvas. Grows with later milestones (scripted pickup, deposit, …).
// Types only (no DOM), so the Playwright specs can import them too.

export interface KekePlayerSnapshot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: string;
  /** Zone id under the player, or null outside every zone. */
  zone: string | null;
}

/** A remote player as the Game scene draws them (online only). */
export interface KekeRemoteSnapshot {
  /** Session id (same as the lobby's data-player-id). */
  id: string;
  nickname: string;
  /** Drawn (interpolated, ~100 ms behind) position. */
  x: number;
  y: number;
  /** Latest authoritative position from the server. */
  serverX: number;
  serverY: number;
  connected: boolean;
}

/** Netcode state of the local player, or null offline (`?scene=game`). */
export interface KekeNetSnapshot {
  code: string;
  sessionId: string;
  /** RoundPhase. */
  phase: string;
  /** True while the local player is predicted and sending inputs (phase 'playing', not spectating). */
  controlling: boolean;
  spectator: boolean;
  /** Session id the spectator camera follows, or null. */
  spectating: string | null;
  /** Inputs sent and not yet acked. */
  pendingInputs: number;
  /** Last acked input seq from the server. */
  ack: number;
  /** Pixels the last reconcile moved our prediction (0 = the server agreed). */
  lastCorrection: number;
}

export interface KekeHook {
  /** Active scene key, e.g. `Game`. */
  scene: string;
  /** Map size in pixels and the theme id. */
  map: { theme: string; widthPx: number; heightPx: number; tileSize: number };
  player(): KekePlayerSnapshot;
  /**
   * Moves the local player (pixels, body centre). Ignored when the spot is inside a wall, and always
   * refused in a room, where the server owns positions. Returns true if moved.
   */
  teleport(x: number, y: number): boolean;
  /** Zone id at a pixel position, or null. */
  zoneAt(x: number, y: number): string | null;
  /** Room and prediction state; null offline. */
  net(): KekeNetSnapshot | null;
  /** Other players on the map, in join order; empty offline. */
  remotePlayers(): KekeRemoteSnapshot[];
}
