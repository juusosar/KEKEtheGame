import { describe, expect, it } from 'vitest';
import { CombatEventMessage, combatEventToWire } from './combatEvents';
import { ItemEventMessage } from './itemEvents';

describe('combatEventToWire', () => {
  it('uses message types distinct from the item events', () => {
    const items = new Set<string>(Object.values(ItemEventMessage));
    for (const type of Object.values(CombatEventMessage)) expect(items.has(type)).toBe(false);
  });

  it('turns round-clock times into seconds from now', () => {
    const source = { kind: 'player', id: 'a' } as const;
    expect(
      combatEventToWire({ type: 'ko', player: 'b', source, weapon: 'baguette', respawnAt: 13 }, 10),
    ).toEqual({ type: 'ko', payload: { player: 'b', source, weapon: 'baguette', respawnInSeconds: 3 } });
    expect(combatEventToWire({ type: 'respawn', player: 'b', protectedUntil: 14.5 }, 13)).toEqual({
      type: 'respawn',
      payload: { player: 'b', protectedSeconds: 1.5 },
    });
    expect(
      combatEventToWire({ type: 'hit', source, target: 'b', damage: 10, weapon: 'baguette', hp: 90 }, 0),
    ).toEqual({ type: 'hit', payload: { source, target: 'b', damage: 10, weapon: 'baguette', hp: 90 } });
  });
});
