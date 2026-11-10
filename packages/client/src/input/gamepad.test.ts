import { Button, buttonsOf } from '@keke/shared';
import { describe, expect, it } from 'vitest';
import type { InputConfig } from './config';
import { readGamepad, STANDARD, type GamepadSnapshot } from './gamepad';

const cfg: InputConfig = {
  stickDeadzone: 0.2,
  aimStickDeadzone: 0.3,
  triggerThreshold: 0.3,
  aimAssistConeDegrees: 30,
  mouseActivityPixels: 4,
};

function pad(axes: number[] = [0, 0, 0, 0], pressed: Record<number, number> = {}): GamepadSnapshot {
  const buttons = Array.from({ length: 17 }, (_, i) => {
    const value = pressed[i] ?? 0;
    // Like the browser: digital buttons report pressed at 1, analog triggers report a value.
    return { pressed: value === 1, value };
  });
  return { axes, buttons };
}

describe('readGamepad (standard mapping)', () => {
  it('is inactive when sticks rest inside their deadzones', () => {
    const r = readGamepad(pad([0.1, -0.15, 0.25, 0.1]), cfg);
    expect(r).toMatchObject({ move: { x: 0, y: 0 }, aim: null, buttons: 0, active: false });
  });

  it('maps the left stick to move', () => {
    const r = readGamepad(pad([1, 0, 0, 0]), cfg);
    expect(r.move).toEqual({ x: 1, y: 0 });
    expect(r.active).toBe(true);
  });

  it('maps the right stick to aim with the InputFrame angle convention', () => {
    expect(readGamepad(pad([0, 0, 0, 1]), cfg).aim).toBeCloseTo(Math.PI / 2);
    expect(readGamepad(pad([0, 0, -1, 0]), cfg).aim).toBeCloseTo(Math.PI);
  });

  it('maps RT/LT/A/B/View/Start to the §13.3 actions', () => {
    const b = STANDARD.buttons;
    const r = readGamepad(
      pad(undefined, { [b.rt]: 1, [b.lt]: 1, [b.a]: 1, [b.b]: 1, [b.view]: 1, [b.start]: 1 }),
      cfg,
    );
    expect(r.buttons).toBe(
      buttonsOf(Button.Attack, Button.Block, Button.Interact, Button.Drop, Button.Scoreboard, Button.Menu),
    );
  });

  it('treats a trigger as held from the threshold value, not only when fully pulled', () => {
    expect(readGamepad(pad(undefined, { [STANDARD.buttons.rt]: 0.2 }), cfg).buttons).toBe(0);
    expect(readGamepad(pad(undefined, { [STANDARD.buttons.rt]: 0.5 }), cfg).buttons).toBe(Button.Attack);
  });

  it('tolerates pads that report fewer axes or buttons', () => {
    expect(readGamepad({ axes: [], buttons: [] }, cfg)).toMatchObject({
      buttons: 0,
      aim: null,
      active: false,
    });
  });
});
