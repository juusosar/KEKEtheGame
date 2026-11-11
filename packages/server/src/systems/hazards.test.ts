// The bakery oven (P2-2) on a real CombatSystem and the real 'prisma' map, without a network.
import {
  getTheme,
  hazardZones,
  loadConfig,
  wantedHitsFromCombat,
  type CombatEvent,
  type CombatEventWire,
} from '@keke/shared';
import { describe, expect, it } from 'vitest';
import { loadThemeMap } from '../maps';
import { GameState, PlayerState } from '../schema/GameState';
import { CombatSystem } from './combat/CombatSystem';
import { HazardSystem } from './hazards';

const config = loadConfig();
const TICK = 1 / config.serverTickHz;
const prisma = loadThemeMap(getTheme('prisma'));
const kespro = loadThemeMap(getTheme('kespro'));
const oven = prisma.zones.find((z) => z.id === 'oven');
if (!oven) throw new Error('prisma map has no oven');
const OVEN = { x: (oven.bounds.minX + oven.bounds.maxX) / 2, y: (oven.bounds.minY + oven.bounds.maxY) / 2 };
/** Bakery floor next to the oven, outside the hot floor. */
const BAKERY = { x: oven.bounds.maxX + 3 * config.tileSize, y: OVEN.y };

function setup(count: number, teams = false) {
  const state = new GameState();
  state.settings.teams = teams;
  const players: PlayerState[] = [];
  for (let i = 0; i < count; i++) {
    const p = new PlayerState();
    p.sessionId = `p${i}`;
    p.joinOrder = i;
    p.team = teams ? 1 : 0;
    p.x = OVEN.x;
    p.y = OVEN.y;
    state.players.set(p.sessionId, p);
    players.push(p);
  }
  const wire: CombatEventWire[] = [];
  const events: CombatEvent[] = [];
  const kos: string[] = [];
  const combat = new CombatSystem(
    state,
    config,
    prisma,
    (e) => wire.push(e),
    { onKo: (p) => kos.push(p.sessionId), onEvent: (e) => events.push(e) },
    1,
  );
  combat.startRound(players);
  const hazards = new HazardSystem(prisma, config, (h) => combat.externalHit(h));
  const s = { state, players, combat, hazards, wire, events, kos, now: 0 };
  const step = (seconds: number) => {
    const until = s.now + seconds;
    while (s.now < until - 1e-9) {
      s.now += TICK;
      combat.beginTick(s.now);
      combat.tick(s.now);
      hazards.tick(s.now, state.players.values());
    }
  };
  return { ...s, step };
}

const burns = (events: readonly CombatEvent[], target: string) =>
  events.filter((e) => e.type === 'hit' && e.target === target && e.source.kind === 'hazard');

describe('HazardSystem: the bakery oven (P2-2)', () => {
  it('the prisma oven is the only hazard, at 8 HP/s; the first map has none', () => {
    expect(hazardZones(prisma.zones).map((z) => [z.id, z.damagePerSecond])).toEqual([['oven', 8]]);
    expect(hazardZones(kespro.zones)).toEqual([]);
    expect(new HazardSystem(kespro, config, () => true).active).toBe(false);
    expect(config.hazardTickSeconds).toBe(0.5);
  });

  it('burns 4 HP every 0.5 s, the first at once, from the oven as a hazard source', () => {
    const s = setup(1);
    const [p] = s.players as [PlayerState];
    s.step(TICK);
    expect(p.hp).toBe(96);
    s.step(2);
    // Burns at 0.05, 0.55, 1.05, 1.55 and 2.05 s.
    expect(burns(s.events, 'p0')).toHaveLength(5);
    expect(p.hp).toBe(80);
    expect(s.wire.find((e) => e.type === 'hit')?.payload).toMatchObject({
      source: { kind: 'hazard', id: 'oven' },
      target: 'p0',
      damage: 4,
      weapon: null,
    });
  });

  it('stops burning outside the oven', () => {
    const s = setup(1);
    const [p] = s.players as [PlayerState];
    s.step(TICK);
    p.x = BAKERY.x;
    s.step(2);
    expect(burns(s.events, 'p0')).toHaveLength(1);
    expect(p.hp).toBe(96);
  });

  it('can KO: normal KO (item drop hook, respawn), then spawn protection keeps the next burn off', () => {
    const s = setup(1);
    const [p] = s.players as [PlayerState];
    s.combat.externalHit({
      source: { kind: 'npc', id: 'stocker_1' },
      target: 'p0',
      damage: 98,
      delivery: 'melee',
    });
    s.step(TICK);
    expect(p.alive).toBe(false);
    expect(s.kos).toEqual(['p0']);
    const ko = s.events.find((e) => e.type === 'ko');
    expect(ko).toMatchObject({ player: 'p0', source: { kind: 'hazard', id: 'oven' } });
    // KO'd in the oven: no more burns until the respawn moves them to their van.
    s.step(1);
    expect(burns(s.events, 'p0')).toHaveLength(1);
    s.step(config.respawnSeconds);
    expect(p.alive).toBe(true);
    // Put back in the oven while protected: refused.
    p.x = OVEN.x;
    p.y = OVEN.y;
    s.step(TICK);
    expect(p.hp).toBe(config.maxHp);
  });

  it('never makes anyone Wanted and ignores team rules', () => {
    const s = setup(2, true);
    s.step(1);
    expect(burns(s.events, 'p0').length).toBeGreaterThan(0);
    expect(burns(s.events, 'p1').length).toBeGreaterThan(0);
    expect(wantedHitsFromCombat(s.events)).toEqual([]);
  });

  it('ignores spectators, dropped players and bodies outside the round', () => {
    const s = setup(2);
    const [, dropped] = s.players as [PlayerState, PlayerState];
    dropped.connected = false;
    const spectator = new PlayerState();
    spectator.sessionId = 'spec';
    spectator.spectator = true;
    spectator.x = OVEN.x;
    spectator.y = OVEN.y;
    s.state.players.set('spec', spectator);
    s.step(1);
    expect(burns(s.events, 'p0').length).toBeGreaterThan(0);
    expect(burns(s.events, 'p1')).toEqual([]);
    expect(burns(s.events, 'spec')).toEqual([]);
    expect(dropped.hp).toBe(config.maxHp);
  });

  it('a new round forgets the clock', () => {
    const s = setup(1);
    s.step(TICK);
    s.hazards.reset();
    s.step(TICK);
    expect(burns(s.events, 'p0')).toHaveLength(2);
  });
});
