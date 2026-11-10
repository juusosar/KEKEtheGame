// Reads each player's Wanted status from the synced GameState (`PlayerState.wanted`, `wantedIn`; M5-3)
// for the ❗ icon and the HUD Wanted indicator (M5-7). Read defensively, like lobbyView.
import { bool, isBag, mapEntries, num, str } from './lobbyView';

export interface WantedView {
  wanted: boolean;
  /** Whole seconds left (held at the full time while inside a staff-only zone); 0 when not wanted. */
  seconds: number;
}

/** Players by session id; players who are not wanted are left out. */
export function readWanted(state: unknown): Map<string, WantedView> {
  const out = new Map<string, WantedView>();
  if (!isBag(state)) return out;
  for (const [key, value] of mapEntries(state['players'])) {
    if (!isBag(value) || !bool(value, 'wanted')) continue;
    out.set(str(value, 'sessionId', key) || key, {
      wanted: true,
      seconds: Math.max(0, num(value, 'wantedIn')),
    });
  }
  return out;
}
