// Pan block (M4-6): hold Block with the cast-iron pan.
import { Button } from '@keke/shared';
import { describe, expect, it } from 'vitest';
import { config, give, idle, press, setup, tick, weapons, must } from './testKit';

const pan = weapons.require('cast_iron_pan');
const block = must(pan.block);

describe('block (cast-iron pan)', () => {
  it('raises the pan only while Block is held with a pan, and slows the holder', () => {
    const s = setup(1);
    const [a] = s.players as [(typeof s.players)[0]];
    press(s, a, 0, Button.Block);
    expect(a.blocking).toBe(false); // fists cannot block
    give(s, a, 'cast_iron_pan');
    press(s, a, 0, Button.Block);
    expect(a.blocking).toBe(true);
    expect(s.combat.speedMultiplier(a)).toBeCloseTo(block.moveSpeedMultiplier);
    press(s, a, 0, 0);
    expect(a.blocking).toBe(false);
    expect(s.combat.speedMultiplier(a)).toBe(1);
  });

  it('takes melee hits at 30% damage with less knockback and no stun', () => {
    const s = setup(3);
    const [a, b, c] = s.players as [(typeof s.players)[0], (typeof s.players)[0], (typeof s.players)[0]];
    give(s, b, 'cast_iron_pan');
    give(s, c, 'rolling_pin');
    press(s, b, 0, Button.Block);
    // a (fists, 5) hits b from the left: 5 × 0.3.
    const bx = b.x;
    tick(s, () => {
      s.combat.afterFrame(b, { seq: 1, move: { x: 0, y: 0 }, aim: Math.PI, buttons: Button.Block }, 0);
      s.combat.afterFrame(a, { seq: 1, move: { x: 0, y: 0 }, aim: 0, buttons: Button.Attack }, Button.Attack);
    });
    idle(s, 0.3);
    expect(must(s.combat.combatWorld.players.find((p) => p.id === b.sessionId)).hp).toBeCloseTo(
      config.maxHp - 5 * block.meleeDamageMultiplier,
    );
    const fistsKnock = weapons.require('fists');
    if (!('melee' in fistsKnock)) throw new Error('fists');
    expect(b.x - bx).toBeLessThan(fistsKnock.melee.knockbackPx * block.meleeDamageMultiplier + 0.5);

    // The rolling pin's stun does not land through a raised pan (c stands to b's right, swings left).
    tick(s, () => {
      s.combat.afterFrame(b, { seq: 2, move: { x: 0, y: 0 }, aim: 0, buttons: Button.Block }, 0);
      s.combat.afterFrame(
        c,
        { seq: 2, move: { x: 0, y: 0 }, aim: Math.PI, buttons: Button.Attack },
        Button.Attack,
      );
    });
    expect(b.stunned).toBe(false);
    expect(b.blocking).toBe(true);
  });

  it('cannot swing while blocking; swings again once Block is released', () => {
    const s = setup(2);
    const [a, b] = s.players as [(typeof s.players)[0], (typeof s.players)[0]];
    give(s, a, 'cast_iron_pan');
    press(s, a, Button.Attack, Button.Attack | Button.Block);
    expect(b.hp).toBe(config.maxHp);
    press(s, a, Button.Attack, Button.Attack);
    expect(b.hp).toBe(config.maxHp - 15);
  });

  it('does not soften non-melee hits (a pallet jack dash lands in full)', () => {
    const s = setup(2);
    const [a, b] = s.players as [(typeof s.players)[0], (typeof s.players)[0]];
    give(s, a, 'pallet_jack');
    give(s, b, 'cast_iron_pan');
    tick(s, () => {
      s.combat.afterFrame(b, { seq: 3, move: { x: 0, y: 0 }, aim: Math.PI, buttons: Button.Block }, 0);
      s.combat.afterFrame(a, { seq: 3, move: { x: 0, y: 0 }, aim: 0, buttons: Button.Attack }, Button.Attack);
    });
    idle(s, 0.5);
    expect(b.hp).toBe(config.maxHp - 25);
  });

  it('lowers the pan when its holder is stunned or loses the pan', () => {
    const s = setup(2);
    const b = must(s.players[1]);
    give(s, b, 'cast_iron_pan');
    press(s, b, 0, Button.Block);
    expect(b.blocking).toBe(true);
    give(s, b, 'baguette');
    tick(s);
    expect(b.blocking).toBe(false);

    // Stunned by a rolling pin from the left: the pan cannot go up until the stun ends.
    const a = must(s.players[0]);
    give(s, a, 'rolling_pin');
    give(s, b, 'cast_iron_pan');
    press(s, a, Button.Attack);
    expect(b.stunned).toBe(true);
    press(s, b, 0, Button.Block);
    expect(b.blocking).toBe(false);
    idle(s, 1);
    press(s, b, 0, Button.Block);
    expect(b.blocking).toBe(true);
  });
});
