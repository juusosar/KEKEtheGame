// M4 review F8: at round end (roundResults) the simulation stops; CombatSystem.freeze clears what would
// otherwise stay frozen on screen (projectiles, peels, slides, dashes and the block/charge/slide flags).
import { Button } from '@keke/shared';
import { describe, expect, it } from 'vitest';
import type { PlayerState } from '../../schema/GameState';
import { frame, give, idle, press, setup, tick } from './testKit';

describe('CombatSystem.freeze (M4 review F8)', () => {
  it('clears projectiles, peels and the block, charge and slide flags; keeps HP', () => {
    const s = setup(3);
    const [a, b, c] = s.players as [PlayerState, PlayerState, PlayerState];
    give(s, a, 'banana_peels');
    press(s, a, Button.Attack);
    expect(s.state.traps.size).toBe(1);
    idle(s, 0.6);
    give(s, b, 'cast_iron_pan');
    press(s, b, 0, Button.Block);
    give(s, c, 'pallet_jack');
    give(s, a, 'egg_carton');
    tick(s, () => {
      s.combat.afterFrame(c, frame(Button.Attack, 0), Button.Attack);
      s.combat.afterFrame(a, frame(Button.Attack, Math.PI / 2), Button.Attack);
    });
    expect(s.state.projectiles.size).toBeGreaterThan(0);
    expect(b.blocking).toBe(true);
    expect(c.charging).toBe(true);
    b.sliding = true;
    const hp = [a.hp, b.hp, c.hp];

    s.combat.freeze();
    expect(s.state.projectiles.size).toBe(0);
    expect(s.state.traps.size).toBe(0);
    expect([a, b, c].map((p) => [p.blocking, p.charging, p.sliding])).toEqual([
      [false, false, false],
      [false, false, false],
      [false, false, false],
    ]);
    expect([a.hp, b.hp, c.hp]).toEqual(hp);
  });

  it('a dashing pallet jack is not shoved off its line', () => {
    const s = setup(2);
    const [a, b] = s.players as [PlayerState, PlayerState];
    give(s, b, 'pallet_jack');
    // b dashes up; a punches b (fists shove 16 px) in the same tick.
    tick(s, () => {
      s.combat.afterFrame(b, frame(Button.Attack, -Math.PI / 2), Button.Attack);
      s.combat.afterFrame(a, frame(Button.Attack, 0), Button.Attack);
    });
    expect(b.charging).toBe(true);
    expect(b.hp, 'the punch landed').toBeLessThan(100);
    const x0 = b.x;
    idle(s, 0.2);
    expect(Math.abs(b.x - x0), 'no sideways shove during the dash').toBeLessThan(0.5);
  });
});
