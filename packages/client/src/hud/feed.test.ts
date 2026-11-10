import { getItemCatalogue } from '@keke/shared';
import { describe, expect, it } from 'vitest';
import { feedLine, type FeedContext } from './feed';

const names: Record<string, string> = { a: 'Juuso', b: 'Mikko' };
const ctx: FeedContext = { catalogue: getItemCatalogue('kespro'), nameOf: (id) => names[id] ?? id };
const voi = { id: 4, itemId: 'coffee_juhla_mokka', rarity: 'normal', x: 0, y: 0 };
const mopo = { id: 5, itemId: 'kurkkumopo', rarity: 'joke', x: 0, y: 0 };

describe('feedLine', () => {
  it('announces a stolen target', () => {
    expect(
      feedLine('pickup', { player: 'a', item: voi, kind: 'other_target', targetOwner: 'b' }, ctx),
    ).toEqual({
      kind: 'steal',
      text: 'Juuso stole Paulig Juhla Mokka 500 g from Mikko',
    });
  });

  it('announces a joke item haul in capitals', () => {
    expect(
      feedLine('pickup', { player: 'b', item: mopo, kind: 'own_target', targetOwner: null }, ctx),
    ).toEqual({
      kind: 'joke',
      text: 'Mikko is hauling a KURKKUMOPO',
    });
  });

  it('stays quiet for an ordinary pickup', () => {
    expect(feedLine('pickup', { player: 'a', item: voi, kind: 'loose', targetOwner: null }, ctx)).toBeNull();
  });

  it('announces deposits with their points', () => {
    expect(feedLine('deposit', { player: 'a', item: mopo, van: 0, points: 2, vanTotal: 3 }, ctx)?.text).toBe(
      'Juuso banked Kurkkumopo (+2)',
    );
  });

  it('ignores other events and malformed messages', () => {
    expect(feedLine('drop', { player: 'a', item: voi, reason: 'drop' }, ctx)).toBeNull();
    expect(feedLine('pickup', null, ctx)).toBeNull();
    expect(feedLine('pickup', { player: 'a' }, ctx)).toBeNull();
  });
});
