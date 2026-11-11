import { describe, expect, it } from 'vitest';
import { SFX_NAMES } from './names';
import {
  ATTACK_SOUNDS,
  CueGate,
  HIT_SOUNDS,
  OTHERS_COMBAT_VOLUME,
  combatCues,
  cueVolume,
  ducksMusic,
  itemCues,
  npcCues,
  roundCues,
} from './sfxPlan';

const ctx = { me: 'me', blocking: (id: string) => id === 'panner' };

describe('combat cues', () => {
  it('our own attack is full volume, others play where they happened', () => {
    const attack = { player: 'me', weapon: 'fists', mode: 'melee', x: 10, y: 20, aim: 0 };
    expect(combatCues('attack', attack, ctx)).toEqual([{ name: 'swing', source: { kind: 'me' } }]);
    expect(combatCues('attack', { ...attack, player: 'b', mode: 'thrown' }, ctx)).toEqual([
      { name: 'throw', source: { kind: 'point', x: 10, y: 20 } },
    ]);
  });

  it('hits punch, splat, slip, or clang on a pan', () => {
    const hit = (weapon: string | null, target = 'b', damage = 10) =>
      combatCues('hit', { source: { kind: 'player', id: 'x' }, target, damage, weapon, hp: 50 }, ctx);
    expect(hit(null)).toEqual([{ name: 'hit', source: { kind: 'player', id: 'b' } }]);
    expect(hit('baguette', 'me')).toEqual([{ name: 'hit', source: { kind: 'me' } }]);
    expect(hit('egg_carton')[0]?.name).toBe('splat');
    expect(hit('banana_peels')[0]?.name).toBe('slip');
    expect(hit('fire_extinguisher')).toEqual([]);
    expect(hit('baguette', 'panner', 0)[0]?.name).toBe('block');
    expect(hit('baguette', 'panner', 5)[0]?.name).toBe('hit');
  });

  it('KO for anyone, respawn only for us', () => {
    expect(combatCues('ko', { player: 'b' }, ctx)).toEqual([
      { name: 'ko', source: { kind: 'player', id: 'b' } },
    ]);
    expect(combatCues('respawn', { player: 'b' }, ctx)).toEqual([]);
    expect(combatCues('respawn', { player: 'me' }, ctx)).toEqual([
      { name: 'respawn', source: { kind: 'me' } },
    ]);
    expect(combatCues('weaponRolled', { player: 'me' }, ctx)).toEqual([]);
    expect(combatCues('hit', null, ctx)).toEqual([]);
  });

  it('every sound named in the tables exists', () => {
    const named = [...Object.values(ATTACK_SOUNDS), ...Object.values(HIT_SOUNDS)].filter((n) => n !== null);
    for (const name of named) expect(SFX_NAMES).toContain(name);
  });
});

describe('store worker cues', () => {
  const by = (id: string) => ({ kind: 'player', id });
  it('only our own hits and knockouts on workers', () => {
    expect(npcCues('npcHit', { npc: 's1', source: by('me'), damage: 5, weapon: null, hp: 1 }, 'me')).toEqual([
      { name: 'hit', source: { kind: 'me' } },
    ]);
    expect(npcCues('npcHit', { npc: 's1', source: by('b'), damage: 5, weapon: null, hp: 1 }, 'me')).toEqual(
      [],
    );
    expect(npcCues('npcKo', { npc: 's1', source: by('me') }, 'me')).toEqual([
      { name: 'ko', source: { kind: 'me' } },
    ]);
    expect(npcCues('npcAttack', { npc: 's1', source: by('me') }, 'me')).toEqual([]);
  });
});

describe('item cues', () => {
  it('pickup, drop and deposit, ours loud', () => {
    expect(itemCues('deposit', { player: 'me' }, 'me')).toEqual([
      { name: 'deposit', source: { kind: 'me' } },
    ]);
    expect(itemCues('pickup', { player: 'b' }, 'me')).toEqual([
      { name: 'pickup', source: { kind: 'player', id: 'b' } },
    ]);
    expect(itemCues('drop', { player: 'me' }, 'me')[0]?.name).toBe('drop');
    expect(itemCues('despawn', { player: 'me' }, 'me')).toEqual([]);
  });
});

describe('round cues', () => {
  const names = (prev: Parameters<typeof roundCues>[0], next: Parameters<typeof roundCues>[1]) =>
    roundCues(prev, next).map((c) => c.name);

  it('ticks the last three intro seconds once each, then go, then the buzzer', () => {
    expect(names(null, { phase: 'countdown', seconds: 3 })).toEqual([]);
    expect(names({ phase: 'countdown', seconds: 5 }, { phase: 'countdown', seconds: 4 })).toEqual([]);
    expect(names({ phase: 'countdown', seconds: 4 }, { phase: 'countdown', seconds: 3 })).toEqual([
      'countdown',
    ]);
    expect(names({ phase: 'countdown', seconds: 3 }, { phase: 'countdown', seconds: 3 })).toEqual([]);
    expect(names({ phase: 'lobby', seconds: 0 }, { phase: 'countdown', seconds: 3 })).toEqual(['countdown']);
    expect(names({ phase: 'countdown', seconds: 1 }, { phase: 'playing', seconds: 0 })).toEqual([
      'countdownGo',
    ]);
    expect(names({ phase: 'playing', seconds: 0 }, { phase: 'roundResults', seconds: 0 })).toEqual([
      'roundEnd',
    ]);
    expect(names({ phase: 'roundResults', seconds: 0 }, { phase: 'podium', seconds: 0 })).toEqual([]);
  });
});

describe('cue gate', () => {
  it('drops rapid repeats per sound and source', () => {
    const gate = new CueGate();
    const spray = { name: 'spray', source: { kind: 'player', id: 'b' } } as const;
    expect(gate.allow(spray, 1)).toBe(true);
    expect(gate.allow(spray, 1.1)).toBe(false);
    expect(gate.allow({ ...spray, source: { kind: 'player', id: 'c' } }, 1.1)).toBe(true);
    expect(gate.allow(spray, 1.3)).toBe(true);
    const hit = { name: 'hit', source: { kind: 'me' } } as const;
    expect(gate.allow(hit, 2)).toBe(true);
    expect(gate.allow(hit, 2.1)).toBe(true);
  });
});

describe('mix (playtest 1 audio pass)', () => {
  it('plays other players’ combat sounds at half their distance volume, ours in full', () => {
    expect(cueVolume('swing', 'me', 1)).toBe(1);
    expect(cueVolume('swing', 'player', 0.8)).toBeCloseTo(0.8 * OTHERS_COMBAT_VOLUME);
    expect(cueVolume('hit', 'point', 1)).toBeCloseTo(OTHERS_COMBAT_VOLUME);
    // Not combat: only the distance counts.
    expect(cueVolume('deposit', 'player', 0.6)).toBe(0.6);
    expect(cueVolume('countdown', 'global', 1)).toBe(1);
  });

  it('ducks the music only for key sounds about us', () => {
    expect(ducksMusic('ko', 1)).toBe(true);
    expect(ducksMusic('deposit', 1)).toBe(true);
    expect(ducksMusic('delivery', 1)).toBe(true);
    expect(ducksMusic('deposit', 0.4)).toBe(false);
    expect(ducksMusic('swing', 1)).toBe(false);
  });
});
