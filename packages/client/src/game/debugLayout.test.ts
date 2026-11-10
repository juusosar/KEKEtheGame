import type { Zone } from '@keke/shared';
import { describe, expect, it } from 'vitest';
import { DEBUG_LABEL_HEIGHT, placeZoneLabels } from './debugLayout';

function zone(id: string, minX: number, minY: number, maxX: number, maxY: number): Zone {
  const polygon = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
  return {
    id,
    polygon,
    bounds: { minX, minY, maxX, maxY },
    area: (maxX - minX) * (maxY - minY),
    wantedOnEnter: false,
  };
}

describe('placeZoneLabels', () => {
  it('puts a lone label at the centre of its zone', () => {
    expect(placeZoneLabels([zone('dock', 0, 0, 100, 200)])).toEqual([
      { id: 'dock', x: 50, y: 100 - DEBUG_LABEL_HEIGHT / 2 },
    ]);
  });

  it('stacks labels of zones whose centres coincide instead of overlapping them', () => {
    const [a, b] = placeZoneLabels([
      zone('meat_fish', 0, 0, 400, 400),
      zone('behind_counter', 0, 150, 400, 250),
    ]);
    expect(a?.x).toBe(b?.x);
    expect(Math.abs((a?.y ?? 0) - (b?.y ?? 0))).toBeGreaterThanOrEqual(DEBUG_LABEL_HEIGHT);
  });

  it('leaves labels that are far apart where they are', () => {
    const labels = placeZoneLabels([zone('a', 0, 0, 100, 100), zone('b', 1000, 0, 1100, 100)]);
    expect(labels.map((l) => l.y)).toEqual([50 - DEBUG_LABEL_HEIGHT / 2, 50 - DEBUG_LABEL_HEIGHT / 2]);
  });
});
