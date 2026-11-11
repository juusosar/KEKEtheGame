// Reads the synced GameState into what the Game scene draws: the lobby view (roster, phase) plus each
// player's body from the movement simulation (M2-2). Read defensively, like lobbyView.
import type { RoundPhase } from '@keke/shared';
import { isBag, mapEntries, num, readLobby, str, type LobbyPlayerView } from './lobbyView';
import type { ServerBody } from './prediction';

export interface GamePlayerView extends LobbyPlayerView, ServerBody {
  /** World item id carried (M3-4); 0 = nothing. Drives the carry slowdown in prediction. */
  carrying: number;
}

export interface GameView {
  phase: RoundPhase;
  /** Sorted by join order. */
  players: GamePlayerView[];
  me: GamePlayerView | null;
  /** True once our own player is in the synced state. */
  synced: boolean;
  /** Room setting: Teams on (§4.3); bodies get a team-colour outline (M6-4). */
  teams: boolean;
}

export function readGame(state: unknown, mySessionId: string): GameView {
  const lobby = readLobby(state, mySessionId);
  const bodies = new Map<string, ServerBody & { carrying: number }>();
  if (isBag(state)) {
    for (const [key, value] of mapEntries(state['players'])) {
      if (!isBag(value)) continue;
      bodies.set(str(value, 'sessionId', key) || key, {
        x: num(value, 'x'),
        y: num(value, 'y'),
        vx: num(value, 'vx'),
        vy: num(value, 'vy'),
        ack: num(value, 'ack'),
        carrying: num(value, 'carrying'),
        // Gate stop and cooldown (phase 2 decision 9), replayed by prediction from the server's values.
        gate: {
          stop: num(value, 'gateStop'),
          gate: num(value, 'gateLast', -1),
          cooldown: num(value, 'gateCooldown'),
        },
      });
    }
  }
  const players = lobby.players.map((p): GamePlayerView => ({
    ...p,
    ...(bodies.get(p.id) ?? { x: 0, y: 0, vx: 0, vy: 0, ack: 0, carrying: 0 }),
  }));
  const me = players.find((p) => p.isMe) ?? null;
  return { phase: lobby.phase, players, me, synced: me !== null, teams: lobby.settings.teams };
}

/** Whether our player is simulated right now: the round is on and we are in it, not watching. */
export function isControlling(view: GameView): boolean {
  return view.phase === 'playing' && view.me !== null && !view.me.spectator;
}

/** Players with a body on the map: everyone in the round (spectators are not placed). */
export function isOnMap(player: LobbyPlayerView, phase: RoundPhase): boolean {
  return phase !== 'lobby' && !player.spectator;
}

/** Scene for a room in `phase`: the Lobby while it is in the lobby, the Game for every round phase. */
export function sceneForPhase(phase: RoundPhase): 'Lobby' | 'Game' {
  return phase === 'lobby' ? 'Lobby' : 'Game';
}
