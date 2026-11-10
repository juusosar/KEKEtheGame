import { describe, expect, it } from 'vitest';
import { ConfigError } from '../config';
import npcsJson from '../data/npcs.json';
import { getNpcCatalogue, loadNpcCatalogue, npcCount, type NpcCount } from './catalogue';

const raw = (): typeof npcsJson => structuredClone(npcsJson);

/** The value, or a test failure when it is missing. */
function must<T>(value: T | undefined | null, what = 'value'): T {
  if (value === undefined || value === null) throw new Error(`missing ${what}`);
  return value;
}

function issuesOf(data: unknown): readonly string[] {
  try {
    loadNpcCatalogue(data, 'test');
  } catch (e) {
    expect(e).toBeInstanceOf(ConfigError);
    return (e as ConfigError).issues;
  }
  throw new Error('expected loadNpcCatalogue to throw');
}

describe('bundled npcs.json', () => {
  const npcs = getNpcCatalogue();

  it('has the four §8 store workers', () => {
    expect(npcs.npcs.map((n) => n.id)).toEqual(['stocker', 'security', 'forklift', 'butcher']);
    expect(npcs.npcs.map((n) => n.behaviour)).toEqual(['stocker', 'security', 'forklift', 'butcher']);
  });

  it('matches the §8 HP and damage numbers', () => {
    const stocker = npcs.ofBehaviour('stocker')[0];
    const security = npcs.ofBehaviour('security')[0];
    const forklift = npcs.ofBehaviour('forklift')[0];
    const butcher = npcs.ofBehaviour('butcher')[0];
    expect(stocker).toMatchObject({ hp: 60, retaliation: { seconds: 10, melee: { damage: 8 } } });
    expect(security).toMatchObject({ hp: 120, attack: { melee: { damage: 15, stunSeconds: 0.5 } } });
    expect(forklift).toMatchObject({ hp: null, contact: { damage: 25, dropsCarried: true } });
    expect(forklift?.contact.knockdownSeconds).toBeGreaterThan(0);
    expect(forklift?.cornerStopSeconds).toBeGreaterThan(0);
    expect(butcher).toMatchObject({
      hp: 100,
      guardZone: 'behind_counter',
      homeZone: 'meat_fish',
      attack: { melee: { damage: 20 } },
    });
  });

  it('scales counts as §8 says', () => {
    const count = (id: string, players: number): number => npcCount(npcs.require(id).count, players);
    for (const players of [0, 1, 2, 4, 6, 7, 8, 11, 12, 16]) {
      expect(count('stocker', players), `stocker ${players}`).toBe(Math.max(3, Math.floor(players / 2)));
      expect(count('security', players), `security ${players}`).toBe(2 + Math.floor(players / 6));
      expect(count('forklift', players)).toBe(2);
      expect(count('butcher', players)).toBe(1);
    }
  });

  it('fills sprite with the id and freezes everything', () => {
    const stocker = npcs.require('stocker');
    expect(stocker.sprite).toBe('stocker');
    expect(Object.isFrozen(stocker)).toBe(true);
    expect(Object.isFrozen(npcs.npcs)).toBe(true);
    expect(() => npcs.require('customer')).toThrow(/Unknown NPC id "customer"/);
    expect(npcs.get('customer')).toBeUndefined();
  });
});

describe('npcCount', () => {
  const c = (count: NpcCount, players: number): number => npcCount(count, players);

  it('applies base, per, min and max', () => {
    expect(c({ base: 1, min: 0 }, 10)).toBe(1);
    expect(c({ base: 1, per: { players: 4, add: 2 }, min: 0 }, 9)).toBe(5);
    expect(c({ base: 0, per: { players: 4, add: 1 }, min: 2 }, 3)).toBe(2);
    expect(c({ base: 0, per: { players: 1, add: 1 }, min: 0, max: 5 }, 16)).toBe(5);
  });

  it('treats negative or fractional player counts sanely', () => {
    expect(c({ base: 2, per: { players: 2, add: 1 }, min: 0 }, -4)).toBe(2);
    expect(c({ base: 0, per: { players: 2, add: 1 }, min: 0 }, 5.9)).toBe(2);
  });
});

describe('loadNpcCatalogue validation', () => {
  it('accepts the bundled data and a custom sprite', () => {
    const data = raw();
    (data.npcs[0] as Record<string, unknown>)['sprite'] = 'stocker_alt';
    expect(loadNpcCatalogue(data).require('stocker').sprite).toBe('stocker_alt');
  });

  it('rejects duplicate ids', () => {
    const data = raw();
    (data.npcs[1] as { id: string }).id = 'stocker';
    expect(issuesOf(data).join('\n')).toMatch(/duplicate NPC id "stocker"/);
  });

  it('only lets forklifts be invulnerable', () => {
    const data = raw();
    (data.npcs[0] as { hp: number | null }).hp = null;
    expect(issuesOf(data).join('\n')).toMatch(/only forklifts may be invulnerable/);
  });

  it('rejects unknown behaviours, unknown keys and bad numbers', () => {
    const data = raw();
    (data.npcs[3] as { behaviour: string }).behaviour = 'customer';
    expect(issuesOf(data).length).toBeGreaterThan(0);

    const extra = raw();
    (extra.npcs[0] as Record<string, unknown>)['speed'] = 1;
    expect(issuesOf(extra).length).toBeGreaterThan(0);

    const negative = raw();
    (negative.npcs[1] as { speedPxPerSecond: number }).speedPxPerSecond = -1;
    expect(issuesOf(negative).length).toBeGreaterThan(0);
  });

  it('rejects a pause range with min above max and a count with max below min', () => {
    const pause = raw();
    must(must(pause.npcs[0]).wander).pauseSeconds = { min: 5, max: 1 };
    expect(issuesOf(pause).join('\n')).toMatch(/min must not be greater than max/);

    const count = raw();
    (must(count.npcs[0]).count as Record<string, unknown>)['max'] = 1;
    expect(issuesOf(count).join('\n')).toMatch(/max must not be less than min/);
  });

  it('rejects an empty list', () => {
    expect(issuesOf({ npcs: [] }).length).toBeGreaterThan(0);
  });
});
