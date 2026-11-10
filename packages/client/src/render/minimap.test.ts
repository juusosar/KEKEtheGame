import { loadMap } from '@keke/shared';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYERS,
  MARKER_STYLES,
  buildMinimapMarkers,
  fitMinimap,
  offlineMinimapWorld,
  projectToMinimap,
  readMinimapWorld,
  withSelfAt,
  type MinimapLayer,
  type MinimapMap,
} from './minimap';

const map: MinimapMap = {
  vanSlots: [
    { x: 96, y: 240 },
    { x: 96, y: 496 },
    { x: 96, y: 752 },
  ],
};

/** A synced state shaped like the server's (plain objects stand in for MapSchema). */
function state(
  overrides: {
    players?: Record<string, object>;
    items?: Record<string, object>;
    vans?: Record<string, object>;
  } = {},
) {
  return {
    phase: 'playing',
    players: overrides.players ?? {
      a: {
        sessionId: 'a',
        color: '#3FA9F5',
        van: 0,
        team: 0,
        joinOrder: 0,
        target: 1,
        carrying: 0,
        x: 100,
        y: 250,
      },
      b: {
        sessionId: 'b',
        color: '#E53935',
        van: 1,
        team: 0,
        joinOrder: 1,
        target: 2,
        carrying: 0,
        x: 400,
        y: 500,
      },
    },
    items: overrides.items ?? {
      '1': { id: 1, itemId: 'butter', state: 'target', x: 1000, y: 800, owner: 'a', carrier: '' },
      '2': { id: 2, itemId: 'salmon', state: 'target', x: 2000, y: 900, owner: 'b', carrier: '' },
      '3': { id: 3, itemId: 'pizza', state: 'loose', x: 1500, y: 300, owner: '', carrier: '' },
    },
    vans: overrides.vans ?? { '0': { van: 0, points: 0, team: 0 }, '1': { van: 1, points: 2, team: 0 } },
  };
}

const kinds = (markers: { kind: string; id: string }[]) => markers.map((m) => `${m.kind}:${m.id}`);

describe('fitMinimap / projectToMinimap', () => {
  it('fits the map inside the box with one scale, keeping the aspect ratio', () => {
    const fit = fitMinimap(3840, 2560, 200, 200);
    expect(fit.width).toBe(200);
    expect(fit.height).toBe(133);
    expect(fit.scale).toBeCloseTo(200 / 3840);
  });

  it('is limited by height for tall maps', () => {
    expect(fitMinimap(1000, 4000, 200, 200)).toEqual({ width: 50, height: 200, scale: 0.05 });
  });

  it('returns an empty fit for empty sizes', () => {
    expect(fitMinimap(0, 100, 200, 200)).toEqual({ width: 0, height: 0, scale: 0 });
  });

  it('projects world pixels and clamps to the minimap edges', () => {
    const fit = fitMinimap(1000, 500, 200, 200);
    expect(projectToMinimap(fit, { x: 500, y: 250 })).toEqual({ x: 100, y: 50 });
    expect(projectToMinimap(fit, { x: -50, y: 9999 })).toEqual({ x: 0, y: 100 });
  });
});

describe('readMinimapWorld', () => {
  it('reads players, items and vans in use', () => {
    const world = readMinimapWorld(state(), 'a');
    expect(world.me?.id).toBe('a');
    expect(world.players.map((p) => p.id)).toEqual(['a', 'b']);
    expect(world.items.map((i) => [i.id, i.state])).toEqual([
      [1, 'target'],
      [2, 'target'],
      [3, 'loose'],
    ]);
    expect(world.vans).toEqual([0, 1]);
  });

  it('falls back to schema defaults for a state that has not synced yet', () => {
    const world = readMinimapWorld(undefined, 'a');
    expect(world).toMatchObject({ me: null, players: [], items: [], vans: [] });
    expect(readMinimapWorld({ players: { a: {} } }, 'a').me).toMatchObject({ van: -1, target: 0 });
  });

  it('reads MapSchema-like collections through forEach', () => {
    const asSchema = (entries: Record<string, object>) => ({
      forEach: (cb: (v: object, k: string) => void) => Object.entries(entries).forEach(([k, v]) => cb(v, k)),
    });
    const s = state();
    const world = readMinimapWorld({ ...s, items: asSchema(s.items), vans: asSchema(s.vans) }, 'a');
    expect(world.items).toHaveLength(3);
    expect(world.vans).toEqual([0, 1]);
  });
});

describe('buildMinimapMarkers', () => {
  it('shows vans, our target, loose items and us, bottom to top', () => {
    const markers = buildMinimapMarkers(readMinimapWorld(state(), 'a'), map);
    expect(kinds(markers)).toEqual(['van:van:0', 'van:van:1', 'loose:item:3', 'target:item:1', 'self:self']);
  });

  it('colours each van like its player and marks ours', () => {
    const vans = buildMinimapMarkers(readMinimapWorld(state(), 'a'), map).filter((m) => m.kind === 'van');
    expect(vans).toEqual([
      { kind: 'van', id: 'van:0', x: 96, y: 240, color: '#3FA9F5', mine: true },
      { kind: 'van', id: 'van:1', x: 96, y: 496, color: '#E53935' },
    ]);
  });

  it("never shows someone else's target, only ours", () => {
    const markers = buildMinimapMarkers(readMinimapWorld(state(), 'b'), map);
    expect(markers.filter((m) => m.kind === 'target').map((m) => m.id)).toEqual(['item:2']);
  });

  it('hides the target while it is carried (by us or a thief)', () => {
    const s = state();
    s.items['1'] = { ...s.items['1'], state: 'carried', carrier: 'b' };
    expect(buildMinimapMarkers(readMinimapWorld(s, 'a'), map).some((m) => m.kind === 'target')).toBe(false);
  });

  it('shows no target while carrying (the server clears it) or when none is free', () => {
    const s = state();
    s.players['a'] = { ...s.players['a'], target: 0, carrying: 1 };
    s.items['1'] = { ...s.items['1'], state: 'carried', carrier: 'a' };
    const markers = buildMinimapMarkers(readMinimapWorld(s, 'a'), map);
    expect(markers.some((m) => m.kind === 'target')).toBe(false);
    expect(markers.find((m) => m.mine && m.kind === 'van')?.id).toBe('van:0');
  });

  it('draws our dropped target as the target, not as a loose item', () => {
    const s = state();
    s.items['1'] = { ...s.items['1'], state: 'loose' };
    const markers = buildMinimapMarkers(readMinimapWorld(s, 'a'), map);
    expect(markers.filter((m) => m.id === 'item:1').map((m) => m.kind)).toEqual(['target']);
  });

  it('gives a team one van, coloured by its first player', () => {
    const s = state({
      players: {
        a: { sessionId: 'a', color: '#3FA9F5', van: 0, team: 1, joinOrder: 0, target: 1 },
        b: { sessionId: 'b', color: '#E53935', van: 0, team: 1, joinOrder: 1, target: 2 },
        c: { sessionId: 'c', color: '#43A047', van: 1, team: 2, joinOrder: 2 },
      },
      vans: { '0': { van: 0, team: 1 }, '1': { van: 1, team: 2 } },
    });
    const vans = buildMinimapMarkers(readMinimapWorld(s, 'b'), map).filter((m) => m.kind === 'van');
    expect(vans.map((v) => [v.id, v.color, v.mine ?? false])).toEqual([
      ['van:0', '#E53935', true],
      ['van:1', '#43A047', false],
    ]);
  });

  it('shows a spectator no self, no own van and no target', () => {
    const s = state();
    s.players['c'] = { sessionId: 'c', color: '#43A047', van: -1, joinOrder: 2, spectator: true };
    const markers = buildMinimapMarkers(readMinimapWorld(s, 'c'), map);
    expect(kinds(markers)).toEqual(['van:van:0', 'van:van:1', 'loose:item:3']);
    expect(markers.some((m) => m.mine)).toBe(false);
  });

  it('skips vans the map has no slot for', () => {
    const s = state({ vans: { '0': { van: 0 }, '7': { van: 7 } } });
    const vans = buildMinimapMarkers(readMinimapWorld(s, 'a'), map).filter((m) => m.kind === 'van');
    expect(vans.map((v) => v.id)).toEqual(['van:0']);
  });

  it('offline shows us and our van', () => {
    const markers = buildMinimapMarkers(offlineMinimapWorld('#43A047', { x: 300, y: 300 }), map);
    expect(markers).toEqual([
      { kind: 'van', id: 'van:0', x: 96, y: 240, color: '#43A047', mine: true },
      { kind: 'self', id: 'self', x: 300, y: 300, color: '#43A047', mine: true },
    ]);
  });

  it('draws us at the predicted position', () => {
    const world = withSelfAt(readMinimapWorld(state(), 'a'), { x: 123, y: 456 });
    const self = buildMinimapMarkers(world, map).find((m) => m.kind === 'self');
    expect(self).toMatchObject({ x: 123, y: 456 });
    expect(world.players[0]).toMatchObject({ x: 123, y: 456 });
  });

  it('takes extra layers, sorted into place by their style', () => {
    const extra: MinimapLayer = (world) =>
      world.items
        .filter((i) => i.state === 'target')
        .map((i) => ({ kind: 'van', id: `x:${i.id}`, x: i.x, y: i.y }));
    const markers = buildMinimapMarkers(readMinimapWorld(state(), 'a'), map, [...DEFAULT_LAYERS, extra]);
    expect(kinds(markers).slice(0, 4)).toEqual(['van:van:0', 'van:van:1', 'van:x:1', 'van:x:2']);
  });

  it('works with the real map: every van slot is inside the map', () => {
    const raw: unknown = JSON.parse(
      readFileSync(new URL('../../../../maps/kespro.tmj', import.meta.url), 'utf8'),
    );
    const model = loadMap(raw, 'kespro.tmj');
    expect(model.vanSlots.length).toBeGreaterThan(0);
    const fit = fitMinimap(model.widthPx, model.heightPx, 200, 200);
    for (const slot of model.vanSlots) {
      const p = projectToMinimap(fit, slot);
      expect(p.x).toBeGreaterThan(0);
      expect(p.y).toBeGreaterThan(0);
    }
  });

  it('has a style for every marker kind, drawn in a fixed order', () => {
    const z = Object.values(MARKER_STYLES).map((s) => s.z);
    expect(new Set(z).size).toBe(z.length);
    for (const style of Object.values(MARKER_STYLES)) expect(style.color).toMatch(/^#[0-9A-F]{6}$/i);
  });
});

describe('forklift markers (M5-7)', () => {
  it('marks every NPC whose behaviour is forklift, and no other worker', () => {
    const world = readMinimapWorld(
      {
        ...state(),
        npcs: {
          forklift_1: { id: 'forklift_1', type: 'forklift', behaviour: 'forklift', x: 640, y: 320 },
          stocker_1: { id: 'stocker_1', type: 'stocker', behaviour: 'stocker', x: 10, y: 10 },
        },
      },
      'a',
    );
    const forklifts = buildMinimapMarkers(world, map).filter((m) => m.kind === 'forklift');
    expect(forklifts).toEqual([{ kind: 'forklift', id: 'npc:forklift_1', x: 640, y: 320 }]);
  });

  it('draws nothing offline', () => {
    const markers = buildMinimapMarkers(offlineMinimapWorld('#FFFFFF', { x: 0, y: 0 }), map);
    expect(markers.some((m) => m.kind === 'forklift')).toBe(false);
  });
});

describe('race markers (M6-3)', () => {
  const raceMap: MinimapMap = { ...map, office: { x: 3696, y: 1280 } };
  const raceState = (items: Record<string, object>, mode = 'race') => ({
    ...state({ items }),
    settings: { mode, teams: false },
  });

  it('marks the office in race mode only', () => {
    const race = buildMinimapMarkers(readMinimapWorld(raceState({}), 'a'), raceMap);
    expect(race.filter((m) => m.kind === 'office')).toEqual([
      { kind: 'office', id: 'office', x: 3696, y: 1280 },
    ]);
    const timed = buildMinimapMarkers(readMinimapWorld(raceState({}, 'timed'), 'a'), raceMap);
    expect(timed.some((m) => m.kind === 'office')).toBe(false);
  });

  it('marks a lying box as a box (not a loose item) and a carried one on its carrier, for everyone', () => {
    const lying = { '9': { id: 9, itemId: 'order_box', state: 'loose', x: 700, y: 600, carrier: '' } };
    const lyingMarkers = buildMinimapMarkers(readMinimapWorld(raceState(lying), 'a'), raceMap);
    expect(kinds(lyingMarkers)).toContain('box:item:9');
    expect(kinds(lyingMarkers)).not.toContain('loose:item:9');

    const carried = { '9': { id: 9, itemId: 'order_box', state: 'carried', x: 0, y: 0, carrier: 'b' } };
    const markers = buildMinimapMarkers(readMinimapWorld(raceState(carried), 'a'), raceMap);
    expect(markers.find((m) => m.kind === 'carrier')).toMatchObject({ id: 'carrier:b', x: 400, y: 500 });
    expect(markers.some((m) => m.kind === 'box')).toBe(false);
  });

  it('keeps our own carrier ring on our predicted position', () => {
    const carried = { '9': { id: 9, itemId: 'order_box', state: 'carried', x: 0, y: 0, carrier: 'a' } };
    const world = withSelfAt(readMinimapWorld(raceState(carried), 'a'), { x: 123, y: 456 });
    const ring = buildMinimapMarkers(world, raceMap).find((m) => m.kind === 'carrier');
    expect(ring).toMatchObject({ x: 123, y: 456 });
  });
});
