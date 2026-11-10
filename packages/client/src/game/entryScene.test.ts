import { describe, expect, it } from 'vitest';
import { entryScene } from './entryScene';

describe('entryScene', () => {
  it('starts on the title screen', () => {
    expect(entryScene('')).toBe('Title');
    expect(entryScene('?debug=1')).toBe('Title');
  });

  it('jumps to the game with ?scene=game', () => {
    expect(entryScene('?scene=game')).toBe('Game');
    expect(entryScene('?debug=1&scene=game')).toBe('Game');
  });
});
