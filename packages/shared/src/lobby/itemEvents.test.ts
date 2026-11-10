import { describe, expect, it } from 'vitest';
import type { WorldItem } from '../rules/carry';
import { ItemEventMessage, itemEventToWire } from './itemEvents';

const item: WorldItem = {
  id: 7,
  itemId: 'some_item',
  rarity: 'joke',
  state: 'carried',
  x: 10,
  y: 20,
  owner: null,
  carrier: 'a',
  looseSince: null,
};
const wire = { id: 7, itemId: 'some_item', rarity: 'joke', x: 10, y: 20 };

describe('itemEventToWire', () => {
  it('sends only the catalogue id and position of the item, under the event type', () => {
    expect(
      itemEventToWire({ type: 'pickup', player: 'a', item, kind: 'other_target', targetOwner: 'b' }),
    ).toEqual({
      type: ItemEventMessage.pickup,
      payload: { player: 'a', item: wire, kind: 'other_target', targetOwner: 'b' },
    });
    expect(itemEventToWire({ type: 'deposit', player: 'a', item, van: 3, points: 2, vanTotal: 5 })).toEqual({
      type: 'deposit',
      payload: { player: 'a', item: wire, van: 3, points: 2, vanTotal: 5 },
    });
    expect(itemEventToWire({ type: 'drop', player: 'a', item, reason: 'disconnect' }).payload).toEqual({
      player: 'a',
      item: wire,
      reason: 'disconnect',
    });
    expect(itemEventToWire({ type: 'despawn', item })).toEqual({ type: 'despawn', payload: { item: wire } });
    expect(itemEventToWire({ type: 'targetAssigned', player: 'b', item }).type).toBe('targetAssigned');
  });
});
