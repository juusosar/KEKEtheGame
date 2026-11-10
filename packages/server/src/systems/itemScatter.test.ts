// ItemSystem.scatter (pallet jack, M4-6): lying items in a dash's band move out of the line, synced.
import { describe, expect, it } from 'vitest';
import { defaultThemeId } from '@keke/shared';
import { GameState, PlayerState } from '../schema/GameState';
import { ItemSystem } from './items';
import { config, kesproMap, must } from './combat/testKit';

describe('ItemSystem.scatter', () => {
  it('pushes a lying target out of a dash line and mirrors it into the schema; nothing before a round', () => {
    const state = new GameState();
    const p = new PlayerState();
    p.sessionId = 'a';
    p.van = 0;
    state.players.set('a', p);
    const items = new ItemSystem(state, config, kesproMap(), () => undefined, defaultThemeId, 7);
    const before = new ItemSystem(state, config, kesproMap(), () => undefined, defaultThemeId, 7);
    before.scatter({ x: 0, y: 0 }, { x: 10, y: 0 }, 14, 48); // not running: no-op, no throw

    items.startRound([p]);
    const target = must(items.itemWorld.items[0]);
    // A horizontal line a few pixels above the item: it is pushed down (its own side).
    const from = { x: target.x - 60, y: target.y - 4 };
    const to = { x: target.x + 60, y: target.y - 4 };
    items.scatter(from, to, 14, 48);
    const moved = must(items.itemWorld.items.find((i) => i.id === target.id));
    expect(moved.state).toBe('target');
    expect(moved.y).toBeGreaterThan(target.y);
    expect(moved.x).toBeCloseTo(target.x);
    expect(must(state.items.get(String(target.id))).y).toBe(moved.y);
  });
});
