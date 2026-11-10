import { describe, expect, it } from 'vitest';
import { animKey, facingFromMove } from './facing';

describe('facingFromMove', () => {
  it('keeps the previous facing when not moving', () => {
    expect(facingFromMove({ x: 0, y: 0 }, 'left')).toBe('left');
  });

  it('follows the dominant axis', () => {
    expect(facingFromMove({ x: 0, y: 1 }, 'left')).toBe('down');
    expect(facingFromMove({ x: 0, y: -1 }, 'left')).toBe('up');
    expect(facingFromMove({ x: -1, y: 0.2 }, 'down')).toBe('left');
    expect(facingFromMove({ x: 0.3, y: -0.9 }, 'down')).toBe('up');
  });

  it('shows the side view on exact diagonals', () => {
    expect(facingFromMove({ x: 0.7, y: 0.7 }, 'up')).toBe('right');
    expect(facingFromMove({ x: -0.7, y: -0.7 }, 'down')).toBe('left');
  });
});

describe('animKey', () => {
  it('builds §11.1 keys', () => {
    expect(animKey('body', true, 'down')).toBe('body/walk_down');
    expect(animKey('hat_cap', false, 'left')).toBe('hat_cap/idle_left');
  });
});
