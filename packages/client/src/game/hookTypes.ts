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

export interface KekeHook {
  /** Active scene key, e.g. `Game`. */
  scene: string;
  /** Map size in pixels and the theme id. */
  map: { theme: string; widthPx: number; heightPx: number; tileSize: number };
  player(): KekePlayerSnapshot;
  /** Moves the local player (pixels, body centre). Ignored when the spot is inside a wall. Returns true if moved. */
  teleport(x: number, y: number): boolean;
  /** Zone id at a pixel position, or null. */
  zoneAt(x: number, y: number): string | null;
}
