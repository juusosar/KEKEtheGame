// M4 review F6: attacks of one tick are simultaneous. Before, intents resolved in join order, so the
// earlier joiner's stun or KO cancelled the other's attack in the same tick and the host won every trade.
import { Button } from '@keke/shared';
import { describe, expect, it } from 'vitest';
import type { PlayerState } from '../../schema/GameState';
import { config, frame, give, idle, setup, spot, tick } from './testKit';

const MAX = config.maxHp;

function both(s: ReturnType<typeof setup>, a: PlayerState, b: PlayerState): void {
  tick(s, () => {
    s.combat.afterFrame(a, frame(Button.Attack, 0), Button.Attack);
    s.combat.afterFrame(b, frame(Button.Attack, Math.PI), Button.Attack);
  });
}

describe('simultaneous attacks (M4 review F6)', () => {
  it('two rolling pins swung in the same tick both land and both stun', () => {
    const s = setup(2);
    const [a, b] = s.players as [PlayerState, PlayerState];
    give(s, a, 'rolling_pin');
    give(s, b, 'rolling_pin');
    both(s, a, b);
    expect(b.hp).toBe(MAX - 12);
    expect(a.hp, 'the later joiner is not cancelled by the stun').toBe(MAX - 12);
    expect(a.stunned).toBe(true);
    expect(b.stunned).toBe(true);
  });

  it('a finishing blow does not cancel the victim’s own swing in the same tick', () => {
    const s = setup(2);
    const [a, b] = s.players as [PlayerState, PlayerState];
    give(s, b, 'rolling_pin');
    give(s, a, 'baguette');
    // Bring b down to one baguette hit, putting b back in reach after each shove.
    for (let i = 0; i < 20 && b.hp > 10; i++) {
      const at = spot(30);
      b.x = at.x;
      b.y = at.y;
      tick(s, () => s.combat.afterFrame(a, frame(Button.Attack, 0), Button.Attack));
      idle(s, 0.4);
    }
    expect(b.hp).toBeLessThanOrEqual(10);
    const at = spot(30);
    b.x = at.x;
    b.y = at.y;
    both(s, a, b);
    expect(b.alive).toBe(false);
    expect(a.hp, 'b’s rolling pin landed').toBe(MAX - 12);
    expect(a.stunned).toBe(true);
    expect(b.weapon, 'a KO still loses the weapon').toBe('fists');
  });

  it('a player stunned in an earlier tick still cannot attack', () => {
    const s = setup(2);
    const [a, b] = s.players as [PlayerState, PlayerState];
    give(s, a, 'rolling_pin');
    tick(s, () => s.combat.afterFrame(a, frame(Button.Attack, 0), Button.Attack));
    expect(b.stunned).toBe(true);
    tick(s, () => s.combat.afterFrame(b, frame(Button.Attack, Math.PI), Button.Attack));
    expect(a.hp).toBe(MAX);
  });
});
