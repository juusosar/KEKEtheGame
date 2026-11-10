import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config';
import { createRng } from '../rng';
import { getWeaponCatalogue, loadWeaponCatalogue } from '../weapons/catalogue';
import weaponsJson from '../data/weapons.json';
import { createItemWorld, addCarryPlayer, pickup, findCarryPlayer, type ItemWorld } from './carry';
import {
  addCombatant,
  armOnPickup,
  attackBlocked,
  canHit,
  combatSpeedMultiplier,
  createCombatWorld,
  dropItemsOnKo,
  findCombatant,
  hit,
  hitBlocked,
  regenerate,
  respawnDue,
  rollWeapon,
  useWeapon,
  type CombatWorld,
  type HitSource,
} from './combat';

const config = loadConfig();
const weapons = getWeaponCatalogue();
const by = (id: string): HitSource => ({ kind: 'player', id });

function world(...players: [string, number][]): CombatWorld {
  let w = createCombatWorld();
  for (const [id, team] of players) w = addCombatant(w, id, team, weapons, config);
  return w;
}

const get = (w: CombatWorld, id: string) => {
  const p = findCombatant(w, id);
  if (!p) throw new Error(`missing ${id}`);
  return p;
};

function holding(w: CombatWorld, id: string, weapon: string, uses?: number): CombatWorld {
  const def = weapons.require(weapon);
  return {
    players: w.players.map((p) =>
      p.id === id ? { ...p, weapon: { id: weapon, uses: uses ?? def.uses, readyAt: 0 } } : p,
    ),
  };
}

describe('combatants', () => {
  it('start at full HP with fists and no protection', () => {
    const p = get(world(['a', 0]), 'a');
    expect(p).toMatchObject({ hp: 100, alive: true, protectedUntil: 0, weapon: { id: 'fists', uses: null } });
  });

  it('refuse a duplicate id', () => {
    expect(() => addCombatant(world(['a', 0]), 'a', 0, weapons, config)).toThrow();
  });
});

describe('weapon roll (§7)', () => {
  it('weights rarities 55 / 33 / 12 and never rolls fists', () => {
    const rng = createRng(1234);
    const counts = { common: 0, uncommon: 0, rare: 0 } as Record<string, number>;
    const ids = new Set<string>();
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const w = rollWeapon(weapons, rng, config);
      counts[w.rarity] = (counts[w.rarity] ?? 0) + 1;
      ids.add(w.id);
    }
    expect((counts.common ?? 0) / n).toBeCloseTo(0.55, 1);
    expect((counts.uncommon ?? 0) / n).toBeCloseTo(0.33, 1);
    expect((counts.rare ?? 0) / n).toBeCloseTo(0.12, 1);
    expect(ids.has('fists')).toBe(false);
    expect(ids.size).toBe(11);
  });

  it('is deterministic for a seed', () => {
    const a = createRng(7);
    const b = createRng(7);
    const seqA = Array.from({ length: 20 }, () => rollWeapon(weapons, a, config).id);
    const seqB = Array.from({ length: 20 }, () => rollWeapon(weapons, b, config).id);
    expect(seqA).toEqual(seqB);
  });

  it('skips a rarity that has no weapons', () => {
    const raw = JSON.parse(JSON.stringify(weaponsJson)) as { weapons: { rarity: string }[] };
    raw.weapons = raw.weapons.filter((w) => w.rarity !== 'rare');
    const noRares = loadWeaponCatalogue(raw);
    const rng = createRng(3);
    for (let i = 0; i < 500; i++) expect(rollWeapon(noRares, rng, config).rarity).not.toBe('rare');
  });

  it('only rare weapons when the other weights are 0', () => {
    const rng = createRng(9);
    const weights = { weaponRarityWeights: { common: 0, uncommon: 0, rare: 1 } };
    for (let i = 0; i < 50; i++) expect(rollWeapon(weapons, rng, weights).rarity).toBe('rare');
  });

  it('arms the player on an item pickup, replacing the current weapon with full uses', () => {
    let w = holding(world(['a', 0]), 'a', 'baguette', 3);
    const r = armOnPickup(w, 'a', 'item', weapons, createRng(5), config, 10);
    w = r.world;
    const held = get(w, 'a').weapon;
    expect(held.readyAt).toBe(10);
    expect(held.uses).toBe(weapons.require(held.id).uses);
    expect(r.events).toEqual([
      { type: 'weaponRolled', player: 'a', weapon: held.id, uses: held.uses, previous: 'baguette' },
    ]);
  });

  it('does not roll for an order box', () => {
    const w = holding(world(['a', 0]), 'a', 'baguette', 3);
    const r = armOnPickup(w, 'a', 'order_box', weapons, createRng(5), config, 10);
    expect(r.world).toBe(w);
    expect(r.events).toEqual([]);
  });

  it('rejects an unknown player', () => {
    expect(armOnPickup(world(), 'x', 'item', weapons, createRng(1), config, 0).rejected).toBe(
      'unknown_player',
    );
  });
});

describe('using a weapon', () => {
  it('spends a use and starts the cooldown', () => {
    const w = holding(world(['a', 0]), 'a', 'baguette');
    const r = useWeapon(w, 'a', weapons, 5);
    expect(get(r.world, 'a').weapon).toEqual({ id: 'baguette', uses: 19, readyAt: 5.35 });
    expect(attackBlocked(r.world, 'a', 5.2)).toBe('cooldown');
    expect(useWeapon(r.world, 'a', weapons, 5.2).rejected).toBe('cooldown');
    expect(attackBlocked(r.world, 'a', 5.35)).toBeNull();
  });

  it('fists never run out', () => {
    let w = world(['a', 0]);
    for (let t = 0; t < 50; t++) w = useWeapon(w, 'a', weapons, t).world;
    expect(get(w, 'a').weapon).toEqual({ id: 'fists', uses: null, readyAt: 49.4 });
  });

  it('goes back to fists when the last use is spent (§7)', () => {
    const w = holding(world(['a', 0]), 'a', 'pallet_jack', 1);
    const r = useWeapon(w, 'a', weapons, 2);
    expect(get(r.world, 'a').weapon).toEqual({ id: 'fists', uses: null, readyAt: 3.5 });
    expect(r.events).toEqual([{ type: 'weaponSpent', player: 'a', weapon: 'pallet_jack' }]);
  });

  it('sprays spend seconds and run dry after their spray time', () => {
    let w = holding(world(['a', 0]), 'a', 'ketchup_bottle');
    const step = 1 / config.inputHz;
    let spent = false;
    let t = 0;
    for (let i = 0; i < 3 * config.inputHz; i++) {
      const r = useWeapon(w, 'a', weapons, t, step);
      w = r.world;
      t += step;
      if (r.events.some((e) => e.type === 'weaponSpent')) spent = i === 3 * config.inputHz - 1;
    }
    expect(spent).toBe(true);
    expect(get(w, 'a').weapon.id).toBe('fists');
  });

  it('cannot attack while KO or stunned', () => {
    let w = world(['a', 0], ['b', 0]);
    w = hit(w, { source: by('a'), target: 'b', damage: 1, stunSeconds: 0.8 }, 1, weapons, config).world;
    expect(attackBlocked(w, 'b', 1.5)).toBe('stunned');
    expect(attackBlocked(w, 'b', 1.8)).toBeNull();
    w = hit(w, { source: by('a'), target: 'b', damage: 500 }, 2, weapons, config).world;
    expect(attackBlocked(w, 'b', 2)).toBe('ko');
    expect(attackBlocked(w, 'nobody', 2)).toBe('unknown_player');
  });
});

describe('hits, KO and respawn (§3.3)', () => {
  it('takes damage off HP and reports the new HP', () => {
    const r = hit(
      world(['a', 0], ['b', 0]),
      { source: by('a'), target: 'b', damage: 18, weapon: 'frozen_salmon' },
      1,
      weapons,
      config,
    );
    expect(get(r.world, 'b').hp).toBe(82);
    expect(r.events).toEqual([
      { type: 'hit', source: by('a'), target: 'b', damage: 18, weapon: 'frozen_salmon', hp: 82 },
    ]);
  });

  it('KOs at 0 HP: weapon lost, respawn after respawnSeconds', () => {
    let w = holding(world(['a', 0], ['b', 0]), 'b', 'champagne_bottle');
    w = hit(w, { source: by('a'), target: 'b', damage: 95, stunSeconds: 1 }, 1, weapons, config).world;
    const r = hit(w, { source: by('a'), target: 'b', damage: 10, weapon: 'baguette' }, 2, weapons, config);
    const b = get(r.world, 'b');
    expect(b).toMatchObject({
      hp: 0,
      alive: false,
      respawnAt: 5,
      stunnedUntil: 0,
      weapon: { id: 'fists', uses: null },
    });
    expect(r.events.map((e) => e.type)).toEqual(['hit', 'ko']);
    expect(r.events[1]).toEqual({
      type: 'ko',
      player: 'b',
      source: by('a'),
      weapon: 'baguette',
      respawnAt: 5,
    });
    expect(hit(r.world, { source: by('a'), target: 'b', damage: 5 }, 3, weapons, config).rejected).toBe('ko');
  });

  it('respawns with full HP, fists and spawn protection', () => {
    let w = world(['a', 0], ['b', 0]);
    w = hit(w, { source: by('a'), target: 'b', damage: 100 }, 10, weapons, config).world;
    expect(respawnDue(w, 12.9, weapons, config).events).toEqual([]);
    const r = respawnDue(w, 13, weapons, config);
    expect(r.events).toEqual([{ type: 'respawn', player: 'b', protectedUntil: 14.5 }]);
    expect(get(r.world, 'b')).toMatchObject({ hp: 100, alive: true, respawnAt: null, protectedUntil: 14.5 });
    expect(hitBlocked(r.world, by('a'), 'b', 14)).toBe('protected');
    expect(hitBlocked(r.world, { kind: 'hazard', id: 'forklift' }, 'b', 14)).toBe('protected');
    expect(canHit(r.world, by('a'), 'b', 14.5)).toBe(true);
  });

  it('can be KOd by NPCs and hazards too', () => {
    const r = hit(
      world(['a', 0]),
      { source: { kind: 'npc', id: 'security' }, target: 'a', damage: 120 },
      1,
      weapons,
      config,
    );
    expect(r.events[1]).toMatchObject({ type: 'ko', player: 'a', source: { kind: 'npc', id: 'security' } });
  });

  it('rejects an unknown target and does not change the world', () => {
    const w = world(['a', 0]);
    const r = hit(w, { source: by('a'), target: 'x', damage: 5 }, 0, weapons, config);
    expect(r).toEqual({ world: w, events: [], rejected: 'unknown_player' });
  });
});

describe('teams and self (§3.3)', () => {
  it('teammates cannot hurt each other, opponents can', () => {
    const w = world(['a', 1], ['b', 1], ['c', 2]);
    expect(hitBlocked(w, by('a'), 'b', 0)).toBe('friendly');
    expect(hit(w, { source: by('a'), target: 'b', damage: 10 }, 0, weapons, config).world).toBe(w);
    expect(canHit(w, by('a'), 'c', 0)).toBe(true);
  });

  it('team 0 (free-for-all) is never friendly', () => {
    expect(canHit(world(['a', 0], ['b', 0]), by('a'), 'b', 0)).toBe(true);
  });

  it('NPCs hit anyone regardless of team', () => {
    expect(canHit(world(['a', 1]), { kind: 'npc', id: 'butcher' }, 'a', 0)).toBe(true);
  });

  it('a player cannot hit themselves unless the hit allows it', () => {
    const w = world(['a', 1]);
    expect(hitBlocked(w, by('a'), 'a', 0)).toBe('self');
    expect(
      hit(w, { source: by('a'), target: 'a', damage: 0, allowSelf: true }, 0, weapons, config).rejected,
    ).toBeUndefined();
  });
});

describe('stun and slow', () => {
  it('stun stops movement; the longer stun wins', () => {
    let w = world(['a', 0], ['b', 0]);
    w = hit(w, { source: by('a'), target: 'b', damage: 0, stunSeconds: 0.8 }, 1, weapons, config).world;
    w = hit(w, { source: by('a'), target: 'b', damage: 0, stunSeconds: 0.2 }, 1.1, weapons, config).world;
    expect(get(w, 'b').stunnedUntil).toBeCloseTo(1.8);
    expect(combatSpeedMultiplier(get(w, 'b'), 1.5)).toBe(0);
    expect(combatSpeedMultiplier(get(w, 'b'), 1.8)).toBe(1);
  });

  it('slow multiplies speed until it wears off; stronger slows replace weaker ones', () => {
    let w = world(['a', 0], ['b', 0]);
    w = hit(
      w,
      { source: by('a'), target: 'b', damage: 3, slow: { multiplier: 0.6, seconds: 1.5 } },
      0,
      weapons,
      config,
    ).world;
    expect(combatSpeedMultiplier(get(w, 'b'), 1)).toBe(0.6);
    w = hit(
      w,
      { source: by('a'), target: 'b', damage: 3, slow: { multiplier: 0.6, seconds: 1.5 } },
      1,
      weapons,
      config,
    ).world;
    expect(get(w, 'b').slowUntil).toBe(2.5);
    w = hit(
      w,
      { source: by('a'), target: 'b', damage: 0, slow: { multiplier: 0.8, seconds: 5 } },
      1.2,
      weapons,
      config,
    ).world;
    expect(get(w, 'b')).toMatchObject({ slowMultiplier: 0.6, slowUntil: 2.5 });
    w = hit(
      w,
      { source: by('a'), target: 'b', damage: 0, slow: { multiplier: 0.3, seconds: 0.5 } },
      1.3,
      weapons,
      config,
    ).world;
    expect(get(w, 'b')).toMatchObject({ slowMultiplier: 0.3, slowUntil: 1.8 });
    expect(combatSpeedMultiplier(get(w, 'b'), 2)).toBe(1);
  });

  it('KO players do not move', () => {
    const w = hit(
      world(['a', 0], ['b', 0]),
      { source: by('a'), target: 'b', damage: 100 },
      0,
      weapons,
      config,
    ).world;
    expect(combatSpeedMultiplier(get(w, 'b'), 1)).toBe(0);
  });
});

describe('item drop on KO (§3.2)', () => {
  function carrying(): ItemWorld {
    let items = createItemWorld();
    items = addCarryPlayer(items, 'a', 1);
    items = addCarryPlayer(items, 'b', 2);
    items = {
      ...items,
      nextItemId: 2,
      items: [
        {
          id: 1,
          itemId: 'x',
          rarity: 'normal',
          state: 'loose',
          x: 0,
          y: 0,
          owner: null,
          carrier: null,
          looseSince: 0,
        },
      ],
    };
    return pickup(items, 'b', 1).world;
  }

  it("drops the KOd carrier's item loose where they fell", () => {
    const ko = hit(
      world(['a', 0], ['b', 0]),
      { source: by('a'), target: 'b', damage: 100 },
      7,
      weapons,
      config,
    );
    const r = dropItemsOnKo(carrying(), ko.events, () => ({ x: 64, y: 96 }), 7);
    expect(findCarryPlayer(r.world, 'b')?.carrying).toBeNull();
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({
      type: 'drop',
      player: 'b',
      reason: 'ko',
      item: { state: 'loose', x: 64, y: 96, looseSince: 7 },
    });
  });

  it('does nothing for a KO without a carried item or for plain hits', () => {
    const items = carrying();
    const hitOnly = hit(
      world(['a', 0], ['b', 0]),
      { source: by('a'), target: 'b', damage: 5 },
      0,
      weapons,
      config,
    );
    expect(dropItemsOnKo(items, hitOnly.events, () => ({ x: 0, y: 0 }), 0).world).toBe(items);
    const koA = hit(
      world(['a', 0], ['b', 0]),
      { source: by('b'), target: 'a', damage: 100 },
      0,
      weapons,
      config,
    );
    expect(dropItemsOnKo(items, koA.events, () => ({ x: 0, y: 0 }), 0)).toEqual({ world: items, events: [] });
  });
});

describe('regeneration', () => {
  it('does nothing at hpRegenPerSec 0 (v1 default)', () => {
    const w = hit(
      world(['a', 0], ['b', 0]),
      { source: by('a'), target: 'b', damage: 50 },
      0,
      weapons,
      config,
    ).world;
    expect(regenerate(w, 1, config)).toBe(w);
  });

  it('heals living players up to maxHp when turned on', () => {
    let w = hit(
      world(['a', 0], ['b', 0]),
      { source: by('a'), target: 'b', damage: 10 },
      0,
      weapons,
      config,
    ).world;
    const regen = { ...config, hpRegenPerSec: 4 };
    w = regenerate(w, 2, regen);
    expect(get(w, 'b').hp).toBe(98);
    w = regenerate(w, 2, regen);
    expect(get(w, 'b').hp).toBe(100);
  });
});
