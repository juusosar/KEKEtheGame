import type { Gate } from '@keke/shared';
import { describe, expect, it } from 'vitest';
import { gateFrame, gateLook, gateTileCentres } from './gateLook';

const lane: Gate = { index: 0, x: 448, y: 1248, width: 32, height: 32, dir: 's', kind: 'checkout' };

describe('gate look (P2-1)', () => {
  it('opens for a body walking through and stays closed for one waiting at it or passing by', () => {
    expect(gateLook(lane, [], 10)).toBe('closed');
    expect(gateLook(lane, [{ x: 464, y: 1270, stopped: false }], 10)).toBe('open');
    expect(gateLook(lane, [{ x: 464, y: 1270, stopped: true }], 10)).toBe('closed');
    expect(gateLook(lane, [{ x: 464, y: 1200, stopped: false }], 10)).toBe('closed');
    expect(gateLook(lane, [{ x: 500, y: 1264, stopped: false }], 10)).toBe('closed');
  });

  it('draws one sheet frame per tile, named by look and direction', () => {
    expect(gateFrame(lane, 'open')).toBe('open_s');
    expect(gateFrame({ ...lane, dir: 'n' }, 'closed')).toBe('closed_n');
    expect(gateTileCentres(lane, 32)).toEqual([{ x: 464, y: 1264 }]);
    expect(gateTileCentres({ ...lane, width: 128 }, 32).map((c) => c.x)).toEqual([464, 496, 528, 560]);
  });
});
