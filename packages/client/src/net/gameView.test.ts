import { describe, expect, it } from 'vitest';
import { isControlling, isOnMap, readGame, sceneForPhase } from './gameView';

const player = (id: string, extra: Record<string, unknown> = {}) => ({
  sessionId: id,
  nickname: id.toUpperCase(),
  color: '#FF0000',
  hat: 'cap',
  joinOrder: id.charCodeAt(0),
  spectator: false,
  connected: true,
  x: 10,
  y: 20,
  vx: 1,
  vy: 2,
  ack: 7,
  ...extra,
});

describe('readGame', () => {
  it('adds each body to the lobby view and finds us', () => {
    const view = readGame({ phase: 'playing', players: { a: player('a'), b: player('b', { x: 99 }) } }, 'b');
    expect(view.synced).toBe(true);
    expect(view.players.map((p) => p.id)).toEqual(['a', 'b']);
    expect(view.me).toMatchObject({ id: 'b', x: 99, y: 20, vx: 1, vy: 2, ack: 7, nickname: 'B' });
    expect(isControlling(view)).toBe(true);
  });

  it('is not synced before our player arrives, and falls back to zeroes for missing fields', () => {
    expect(readGame(undefined, 'a').synced).toBe(false);
    const view = readGame({ phase: 'countdown', players: { a: { sessionId: 'a' } } }, 'a');
    expect(view.me).toMatchObject({ x: 0, y: 0, vx: 0, vy: 0, ack: 0, connected: true });
    expect(isControlling(view)).toBe(false);
  });

  it('reads a MapSchema-like players map (forEach)', () => {
    const players = new Map([['a', player('a')]]);
    const view = readGame({ phase: 'playing', players }, 'a');
    expect(view.me?.x).toBe(10);
  });

  it('does not control a spectator', () => {
    const view = readGame({ phase: 'playing', players: { a: player('a', { spectator: true }) } }, 'a');
    expect(isControlling(view)).toBe(false);
  });
});

describe('isOnMap / sceneForPhase', () => {
  it('places everyone in the round except spectators, and nobody in the lobby', () => {
    const p = readGame({ phase: 'playing', players: { a: player('a') } }, 'a').players[0];
    if (!p) throw new Error('missing player');
    expect(isOnMap(p, 'playing')).toBe(true);
    expect(isOnMap(p, 'countdown')).toBe(true);
    expect(isOnMap(p, 'lobby')).toBe(false);
    expect(isOnMap({ ...p, spectator: true }, 'playing')).toBe(false);
  });

  it('picks the Lobby for the lobby phase and the Game for every round phase', () => {
    expect(sceneForPhase('lobby')).toBe('Lobby');
    for (const phase of ['countdown', 'playing', 'roundResults', 'podium'] as const) {
      expect(sceneForPhase(phase)).toBe('Game');
    }
  });
});
