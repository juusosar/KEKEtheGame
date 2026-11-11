import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config';
import { createRng } from '../rng';
import { ANY_ZONE } from '../items/catalogue';
import {
  eligibleSpawns,
  modelCAssigner,
  preferredSpawnsForItem,
  spawnsForItem,
  type TargetItemDef,
  type TargetMap,
} from './targets';

const config = loadConfig();
const T = 32;

// One van at the origin; spawns at increasing distances (in tiles) along x.
const map: TargetMap = {
  tileSize: T,
  vanSlots: [{ x: 0, y: 0 }],
  itemSpawns: [
    { x: 7 * T, y: 0, zone: 'dry_goods' }, // too close to the van (7 < 8 tiles)
    { x: 8 * T, y: 0, zone: 'dry_goods' }, // exactly 8 tiles: allowed
    { x: 20 * T, y: 0, zone: 'cold_room' },
    { x: 30 * T, y: 0, zone: 'beverages' },
  ],
};

const catalogue: TargetItemDef[] = [
  { id: 'flour', zone: 'dry_goods', rarity: 'normal' },
  { id: 'butter', zone: 'cold_room', rarity: 'normal' },
  { id: 'cola', zone: 'beverages', rarity: 'normal' },
  { id: 'gnome', zone: ANY_ZONE, rarity: 'joke' },
];

describe('eligibleSpawns (§3.1)', () => {
  it('keeps only spawns at least targetMinDistanceFromVanTiles from every van', () => {
    const xs = eligibleSpawns(map, [], config).map((s) => s.x / T);
    expect(xs).toEqual([8, 20, 30]);
  });

  it('checks the distance to every van slot, not just one', () => {
    const twoVans = {
      ...map,
      vanSlots: [
        { x: 0, y: 0 },
        { x: 25 * T, y: 0 },
      ],
    };
    expect(eligibleSpawns(twoVans, [], config).map((s) => s.x / T)).toEqual([8]);
  });

  it('skips spawns occupied by an item (within half a tile)', () => {
    const occupied = [{ x: 20 * T + 10, y: 0 }];
    expect(eligibleSpawns(map, occupied, config).map((s) => s.x / T)).toEqual([8, 30]);
    const nearby = [{ x: 20 * T + T / 2, y: 0 }]; // exactly half a tile away: not occupied
    expect(eligibleSpawns(map, nearby, config).map((s) => s.x / T)).toEqual([8, 20, 30]);
  });
});

describe('spawnsForItem', () => {
  it('matches the item zone, or any spawn for joke items', () => {
    const spawns = eligibleSpawns(map, [], config);
    expect(spawnsForItem(catalogue[1] as TargetItemDef, spawns).map((s) => s.zone)).toEqual(['cold_room']);
    expect(spawnsForItem(catalogue[3] as TargetItemDef, spawns)).toHaveLength(3);
  });
});

describe('modelCAssigner (§3.1, §10.1)', () => {
  const place = (seed: number, overrides: Partial<Parameters<typeof modelCAssigner.place>[0]> = {}) =>
    modelCAssigner.place({ catalogue, map, occupied: [], rng: createRng(seed), config, ...overrides });

  it('places a normal item at an eligible spawn of its own zone', () => {
    const noJokes = { ...config, jokeItemChance: 0 };
    for (let seed = 0; seed < 50; seed++) {
      const p = place(seed, { config: noJokes });
      expect(p).toBeDefined();
      expect(p?.item.rarity).toBe('normal');
      expect(p?.zone).toBe(p?.item.zone);
      expect(p?.x).toBeGreaterThanOrEqual(8 * T);
    }
  });

  it('makes a joke item with jokeItemChance, placed at any eligible spawn', () => {
    const p = place(1, { config: { ...config, jokeItemChance: 1 } });
    expect(p?.item.id).toBe('gnome');
    expect(['dry_goods', 'cold_room', 'beverages']).toContain(p?.zone);
  });

  it('rolls joke items at about jokeItemChance (8%)', () => {
    const rng = createRng(1234);
    let jokes = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const p = modelCAssigner.place({ catalogue, map, occupied: [], rng, config });
      if (p?.item.rarity === 'joke') jokes++;
    }
    expect(jokes / n).toBeGreaterThan(0.07);
    expect(jokes / n).toBeLessThan(0.09);
  });

  it('is deterministic for a seed', () => {
    expect(place(42)).toEqual(place(42));
  });

  it('never uses an occupied spawn', () => {
    const occupied = [
      { x: 8 * T, y: 0 },
      { x: 30 * T, y: 0 },
    ];
    for (let seed = 0; seed < 30; seed++) {
      const p = place(seed, { occupied, config: { ...config, jokeItemChance: 0 } });
      expect(p?.item.id).toBe('butter');
    }
  });

  it('falls back to the other rarity when the rolled one cannot be placed', () => {
    const onlyJoke = catalogue.filter((i) => i.rarity === 'joke');
    expect(place(3, { catalogue: onlyJoke, config: { ...config, jokeItemChance: 0 } })?.item.id).toBe(
      'gnome',
    );
    const onlyNormal = catalogue.filter((i) => i.rarity === 'normal');
    expect(place(3, { catalogue: onlyNormal, config: { ...config, jokeItemChance: 1 } })?.item.rarity).toBe(
      'normal',
    );
  });

  it('returns undefined when no spawn is free', () => {
    const occupied = map.itemSpawns.map((s) => ({ x: s.x, y: s.y }));
    expect(place(1, { occupied })).toBeUndefined();
  });
});

describe('odd spots (§10.1, phase 2 decision 11)', () => {
  // Same map plus two odd spots: one in dry goods, one in beverages; one more too close to the van.
  const oddMap: TargetMap = {
    ...map,
    itemSpawns: [
      ...map.itemSpawns,
      { x: 6 * T, y: 0, zone: 'dry_goods', oddSpot: true }, // too close to the van: never eligible
      { x: 12 * T, y: 0, zone: 'dry_goods', oddSpot: true },
      { x: 40 * T, y: 0, zone: 'beverages', oddSpot: true },
    ],
  };
  const gnome = catalogue[3] as TargetItemDef;
  const flour = catalogue[0] as TargetItemDef;
  const jokes = { ...config, jokeItemChance: 1 };
  const noJokes = { ...config, jokeItemChance: 0 };
  const place = (seed: number, occupied: { x: number; y: number }[], cfg = jokes) =>
    modelCAssigner.place({ catalogue, map: oddMap, occupied, rng: createRng(seed), config: cfg });

  it('preferredSpawnsForItem gives a joke item only the free odd spots', () => {
    const free = eligibleSpawns(oddMap, [], config);
    expect(preferredSpawnsForItem(gnome, free).map((s) => s.x / T)).toEqual([12, 40]);
  });

  it('preferredSpawnsForItem leaves normal items alone, odd spots of their zone included', () => {
    const free = eligibleSpawns(oddMap, [], config);
    expect(preferredSpawnsForItem(flour, free).map((s) => s.x / T)).toEqual([8, 12]);
  });

  it('puts joke items on a free odd spot every time', () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < 60; seed++) {
      const p = place(seed, []);
      expect(p?.item.id).toBe('gnome');
      expect([12, 40]).toContain((p?.x ?? 0) / T);
      seen.add((p?.x ?? 0) / T);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([12, 40]); // uniform among the odd spots
  });

  it('uses the remaining odd spot when the other is taken', () => {
    for (let seed = 0; seed < 20; seed++) {
      expect(place(seed, [{ x: 12 * T, y: 0 }])?.x).toBe(40 * T);
    }
  });

  it('falls back to any free spawn when every odd spot is taken', () => {
    const occupied = [
      { x: 12 * T, y: 0 },
      { x: 40 * T, y: 0 },
    ];
    const xs = new Set<number>();
    for (let seed = 0; seed < 60; seed++) {
      const p = place(seed, occupied);
      expect(p?.item.id).toBe('gnome');
      xs.add((p?.x ?? 0) / T);
    }
    expect([...xs].sort((a, b) => a - b)).toEqual([8, 20, 30]);
  });

  it('a map without odd spots behaves as before', () => {
    for (let seed = 0; seed < 20; seed++) {
      const before = modelCAssigner.place({
        catalogue,
        map,
        occupied: [],
        rng: createRng(seed),
        config: jokes,
      });
      expect([8, 20, 30]).toContain((before?.x ?? 0) / T);
    }
  });

  it('normal items still use odd spots in their own zone', () => {
    const xs = new Set<number>();
    for (let seed = 0; seed < 80; seed++) {
      const p = place(seed, [], noJokes);
      if (p?.item.id === 'flour') xs.add(p.x / T);
    }
    expect([...xs].sort((a, b) => a - b)).toEqual([8, 12]);
  });
});
