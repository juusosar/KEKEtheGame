// Pallet jack charge (M4-6): one press dashes 6 tiles along the aim and knocks down whoever it sweeps.
import { Button, moveAabb, playerHalfSize } from '@keke/shared';
import { describe, expect, it } from 'vitest';
import { config, give, idle, kesproMap, press, setup, spot, tick, weapons, must } from './testKit';

const jack = weapons.require('pallet_jack');
if (jack.behaviour !== 'charge') throw new Error('pallet_jack is not a charge weapon');
const stats = jack.charge;
const dashPx = stats.distanceTiles * kesproMap().collision.tileSize;

/** How far the open floor lets a body slide right from `spot()` (the dash ends at a wall). */
function openRight(): number {
  const from = spot();
  return moveAabb(kesproMap().collision, from, playerHalfSize(config), { x: dashPx, y: 0 }).x - from.x;
}

describe('charge (pallet jack)', () => {
  it('dashes along the aim over a few ticks, then stops; input does not move a charging body', () => {
    const s = setup(1);
    const a = must(s.players[0]);
    give(s, a, 'pallet_jack');
    const x0 = a.x;
    press(s, a, Button.Attack);
    expect(a.charging).toBe(true);
    expect(s.combat.speedMultiplier(a)).toBe(0);
    expect(a.weaponUses).toBe(must(jack.uses) - 1);
    expect(s.events.some((e) => e.type === 'attack')).toBe(true);
    idle(s, dashPx / stats.speedPxPerSecond + 0.2);
    expect(a.charging).toBe(false);
    expect(a.x - x0).toBeCloseTo(Math.min(dashPx, openRight()), 0);
    expect(s.combat.speedMultiplier(a)).toBe(1);
  });

  it('hits every body in its line once: damage, knockdown, flung aside; misses bodies off the line', () => {
    const s = setup(4, (i) => [spot(), spot(40, 6), spot(80, -6), spot(40, 80)][i] ?? spot());
    const [a, b, c, d] = s.players as [
      (typeof s.players)[0],
      (typeof s.players)[0],
      (typeof s.players)[0],
      (typeof s.players)[0],
    ];
    expect(openRight()).toBeGreaterThan(100);
    give(s, a, 'pallet_jack');
    press(s, a, Button.Attack);
    idle(s, 0.2);
    for (const p of [b, c]) {
      expect(p.hp).toBe(config.maxHp - stats.damage);
      expect(p.stunned).toBe(true);
    }
    expect(d.hp).toBe(config.maxHp);
    // b stood below the line (y + 6), c above: each is flung to its own side.
    expect(b.y).toBeGreaterThan(spot().y + 6);
    expect(c.y).toBeLessThan(spot().y - 6);
    const hits = s.events.filter((e) => e.type === 'hit');
    expect(hits).toHaveLength(2);
    idle(s, stats.knockdownSeconds + 0.1);
    expect(b.stunned).toBe(false);
  });

  it('scatters lying items along its path and respects the cooldown between charges', () => {
    const s = setup(1);
    const a = must(s.players[0]);
    give(s, a, 'pallet_jack');
    press(s, a, Button.Attack);
    expect(s.scatters.length).toBeGreaterThan(0);
    expect(s.scatters[0]).toMatchObject({ halfWidth: stats.widthPx / 2, px: stats.scatterPx });
    idle(s, 0.6);
    const uses = a.weaponUses;
    press(s, a, Button.Attack); // still cooling down (1.5 s)
    expect(a.weaponUses).toBe(uses);
    expect(a.charging).toBe(false);
    idle(s, jack.cooldownSeconds);
    press(s, a, Button.Attack);
    expect(a.weaponUses).toBe(uses - 1);
  });

  it('a stun or KO ends the dash; reset clears the flag', () => {
    const s = setup(2, (i) => [spot(), spot(0, 60)][i] ?? spot());
    const [a, b] = s.players as [(typeof s.players)[0], (typeof s.players)[0]];
    give(s, a, 'pallet_jack');
    give(s, b, 'rolling_pin');
    press(s, a, Button.Attack);
    expect(a.charging).toBe(true);
    // b swings up at a: rolling pin stun.
    b.x = a.x;
    b.y = a.y + 20;
    tick(s, () =>
      s.combat.afterFrame(
        b,
        { seq: 99, move: { x: 0, y: 0 }, aim: -Math.PI / 2, buttons: Button.Attack },
        Button.Attack,
      ),
    );
    expect(a.stunned).toBe(true);
    expect(a.charging).toBe(false);

    const t = setup(1);
    const c = must(t.players[0]);
    give(t, c, 'pallet_jack');
    press(t, c, Button.Attack);
    expect(c.charging).toBe(true);
    t.combat.reset();
    expect(c.charging).toBe(false);
  });
});
