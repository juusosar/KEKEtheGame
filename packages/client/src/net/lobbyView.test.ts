import { describe, expect, it } from 'vitest';
import { lobbyErrorKey, readLobby } from './lobbyView';

/** A MapSchema-like map: only forEach is used. */
function schemaMap<V>(entries: Record<string, V>): { forEach(cb: (v: V, k: string) => void): void } {
  return { forEach: (cb) => Object.entries(entries).forEach(([k, v]) => cb(v, k)) };
}

const player = (sessionId: string, joinOrder: number, extra: Record<string, unknown> = {}) => ({
  sessionId,
  nickname: sessionId.toUpperCase(),
  color: '#3FA9F5',
  hat: 'cap',
  ready: false,
  team: 0,
  joinOrder,
  spectator: false,
  connected: true,
  ...extra,
});

describe('readLobby', () => {
  it('copes with the empty state before the first patch', () => {
    for (const state of [undefined, null, {}]) {
      const view = readLobby(state, 'me');
      expect(view.synced).toBe(false);
      expect(view.phase).toBe('lobby');
      expect(view.players).toEqual([]);
      expect(view.settings).toEqual({ mode: 'timed', roundsPerMap: 1, teams: false });
      expect(view.isHost).toBe(false);
      expect(view.everyoneReady).toBe(false);
    }
  });

  it('lists players in join order and marks host and self', () => {
    const view = readLobby(
      {
        code: 'KXBD',
        phase: 'lobby',
        hostId: 'a',
        settings: { mode: 'race', roundsPerMap: 3, teams: true },
        players: schemaMap({ b: player('b', 2, { team: 2 }), a: player('a', 1, { ready: true, team: 1 }) }),
      },
      'b',
    );
    expect(view.code).toBe('KXBD');
    expect(view.players.map((p) => p.id)).toEqual(['a', 'b']);
    expect(view.players[0]).toMatchObject({ isHost: true, isMe: false, ready: true, team: 1 });
    expect(view.me).toMatchObject({ id: 'b', isMe: true, isHost: false, team: 2 });
    expect(view.isHost).toBe(false);
    expect(view.synced).toBe(true);
    expect(view.settings).toEqual({ mode: 'race', roundsPerMap: 3, teams: true });
  });

  it('applies the server Start rule: every non-spectator ready', () => {
    const state = (bReady: boolean, bSpectator = false) => ({
      hostId: 'a',
      players: {
        a: player('a', 1, { ready: true }),
        b: player('b', 2, { ready: bReady, spectator: bSpectator }),
      },
    });
    expect(readLobby(state(false), 'a').everyoneReady).toBe(false);
    expect(readLobby(state(true), 'a').everyoneReady).toBe(true);
    expect(readLobby(state(false, true), 'a').everyoneReady).toBe(true);
    expect(readLobby(state(true), 'a').isHost).toBe(true);
  });

  it('falls back to defaults for unknown values', () => {
    const view = readLobby({ phase: 'warmup', settings: { mode: 'deathmatch' } }, 'me');
    expect(view.phase).toBe('lobby');
    expect(view.settings.mode).toBe('timed');
  });

  it('reports a running round', () => {
    expect(readLobby({ phase: 'playing', players: { me: player('me', 1) } }, 'me').phase).toBe('playing');
  });
});

describe('lobbyErrorKey', () => {
  it('maps every server refusal to a message', () => {
    expect(lobbyErrorKey('not_ready')).toBe('lobby.error.not_ready');
    expect(lobbyErrorKey('teams_off')).toBe('lobby.error.teams_off');
    expect(lobbyErrorKey('debug_off')).toBe('lobby.error.debug_off');
    expect(lobbyErrorKey('something_new')).toBe('lobby.error.unknown');
    expect(lobbyErrorKey(undefined)).toBe('lobby.error.unknown');
  });
});
