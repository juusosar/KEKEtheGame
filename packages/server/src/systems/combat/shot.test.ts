// Champagne bottle (M4-6): one cork shot, then melee swings; and the pan reflecting projectiles.
import { Button } from '@keke/shared';
import { describe, expect, it } from 'vitest';
import { config, give, idle, must, press, setup, spot, tick, weapons } from './testKit';

const bottle = weapons.require('champagne_bottle');
if (bottle.behaviour !== 'shot_then_melee') throw new Error('champagne_bottle is not shot_then_melee');
const flight = (px: number): number => px / bottle.shot.speedPxPerSecond + 0.15;

describe('shot then melee (champagne bottle)', () => {
  it('pops the cork at range for shot damage, then swings as a melee weapon', () => {
    const s = setup(2, (i) => (i === 0 ? spot() : spot(100)));
    const [a, b] = [must(s.players[0]), must(s.players[1])];
    give(s, a, 'champagne_bottle');
    press(s, a, Button.Attack);
    expect(a.weaponUses).toBe(must(bottle.uses) - 1);
    expect(s.state.projectiles.size).toBe(1);
    idle(s, flight(100));
    expect(b.hp).toBe(config.maxHp - bottle.shot.damage);
    const hit = s.events.find((e) => e.type === 'hit');
    expect(hit?.payload).toMatchObject({ weapon: 'champagne_bottle' });

    // Cork spent: the next press is a melee swing, which does not reach 100 px.
    idle(s, bottle.cooldownSeconds);
    const hpAfterCork = b.hp;
    press(s, a, Button.Attack);
    idle(s, 0.2);
    expect(s.state.projectiles.size).toBe(0);
    expect(b.hp).toBe(hpAfterCork);
    expect(a.weaponUses).toBe(must(bottle.uses) - 2);

    // Up close the swing lands for melee damage.
    idle(s, bottle.cooldownSeconds);
    b.x = a.x + 24;
    b.y = a.y;
    press(s, a, Button.Attack);
    expect(b.hp).toBe(hpAfterCork - bottle.melee.damage);
  });

  it('a raised pan reflects the cork back at the shooter', () => {
    const s = setup(2, (i) => (i === 0 ? spot() : spot(100)));
    const [a, b] = [must(s.players[0]), must(s.players[1])];
    give(s, a, 'champagne_bottle');
    give(s, b, 'cast_iron_pan');
    tick(s, () => {
      s.combat.afterFrame(b, { seq: 1, move: { x: 0, y: 0 }, aim: Math.PI, buttons: Button.Block }, 0);
      s.combat.afterFrame(a, { seq: 1, move: { x: 0, y: 0 }, aim: 0, buttons: Button.Attack }, Button.Attack);
    });
    for (let t = 0; t < flight(200) * config.serverTickHz; t++) {
      tick(s, () =>
        s.combat.afterFrame(b, { seq: 2 + t, move: { x: 0, y: 0 }, aim: Math.PI, buttons: Button.Block }, 0),
      );
    }
    expect(b.hp).toBe(config.maxHp);
    expect(a.hp).toBe(config.maxHp - bottle.shot.damage);
    const hit = s.events.find((e) => e.type === 'hit');
    expect(hit?.payload).toMatchObject({ target: a.sessionId });
  });

  it('a lowered pan does not reflect', () => {
    const s = setup(2, (i) => (i === 0 ? spot() : spot(100)));
    const [a, b] = [must(s.players[0]), must(s.players[1])];
    give(s, a, 'champagne_bottle');
    give(s, b, 'cast_iron_pan');
    press(s, a, Button.Attack);
    idle(s, flight(200));
    expect(b.hp).toBe(config.maxHp - bottle.shot.damage);
    expect(a.hp).toBe(config.maxHp);
  });
});
