import { Button, buttonsOf } from '@keke/shared';
import { describe, expect, it } from 'vitest';
import { coneAimAssist } from './aim';
import type { InputConfig } from './config';
import { InputFrameBuilder, type RawInput } from './frame';
import { STANDARD, type GamepadSnapshot } from './gamepad';

const cfg: InputConfig = {
  stickDeadzone: 0.2,
  aimStickDeadzone: 0.3,
  triggerThreshold: 0.3,
  aimAssistConeDegrees: 30,
  mouseActivityPixels: 4,
};

function pad(axes: number[] = [0, 0, 0, 0], pressed: number[] = []): GamepadSnapshot {
  return {
    axes,
    buttons: Array.from({ length: 17 }, (_, i) => ({
      pressed: pressed.includes(i),
      value: pressed.includes(i) ? 1 : 0,
    })),
  };
}

function raw(
  over: Partial<RawInput> & { keys?: string[]; pointer?: { x: number; y: number } } = {},
): RawInput {
  const pointer = over.pointer ?? { x: 0, y: 0 };
  return {
    keyboardMouse: { keys: new Set(over.keys ?? []), leftMouse: false, rightMouse: false, pointer },
    pointerScreen: over.pointerScreen ?? pointer,
    gamepad: over.gamepad ?? null,
    origin: over.origin ?? { x: 0, y: 0 },
  };
}

describe('InputFrameBuilder', () => {
  it('numbers frames with an increasing seq', () => {
    const b = new InputFrameBuilder(cfg);
    expect([b.build(raw()).seq, b.build(raw()).seq, b.build(raw()).seq]).toEqual([1, 2, 3]);
    expect(b.lastSeq).toBe(3);
  });

  it('produces keyboard movement and mouse aim with no pad connected', () => {
    const b = new InputFrameBuilder(cfg);
    const f = b.build(raw({ keys: ['KeyD'], pointer: { x: 0, y: 50 } }));
    expect(f.move).toEqual({ x: 1, y: 0 });
    expect(f.aim).toBeCloseTo(Math.PI / 2);
    expect(b.devices.device).toBe('keyboardMouse');
  });

  it('switches to the gamepad when it is used, and back when a key is pressed', () => {
    const b = new InputFrameBuilder(cfg);
    b.build(raw({ gamepad: pad([0, 1, 0, 0]) }));
    expect(b.devices.device).toBe('gamepad');
    b.build(raw({ gamepad: pad(), keys: ['KeyW'] }));
    expect(b.devices.device).toBe('keyboardMouse');
  });

  it('switches back to keyboard/mouse on mouse movement past the activity threshold only', () => {
    const b = new InputFrameBuilder(cfg);
    b.build(raw({ gamepad: pad([1, 0, 0, 0]), pointerScreen: { x: 10, y: 10 } }));
    b.build(raw({ gamepad: pad(), pointerScreen: { x: 12, y: 10 } }));
    expect(b.devices.device).toBe('gamepad');
    b.build(raw({ gamepad: pad(), pointerScreen: { x: 30, y: 10 } }));
    expect(b.devices.device).toBe('keyboardMouse');
  });

  it('lets a deflected left stick override WASD and ORs buttons from both devices', () => {
    const b = new InputFrameBuilder(cfg);
    const f = b.build(raw({ keys: ['KeyD', 'KeyQ'], gamepad: pad([-1, 0, 0, 0], [STANDARD.buttons.a]) }));
    expect(f.move).toEqual({ x: -1, y: 0 });
    expect(f.buttons).toBe(buttonsOf(Button.Interact, Button.Drop));
  });

  it('on gamepad, aims along movement with aim assist when the right stick is idle', () => {
    const b = new InputFrameBuilder(cfg);
    b.aimAssist = coneAimAssist(() => [{ x: 100, y: -15 }], cfg.aimAssistConeDegrees);
    const f = b.build(raw({ gamepad: pad([1, 0, 0, 0]) }));
    expect(f.aim).toBeCloseTo(Math.atan2(-15, 100));
  });

  it('keeps the last aim when the active device gives none', () => {
    const b = new InputFrameBuilder(cfg);
    b.build(raw({ gamepad: pad([0, 0, 0, -1]) }));
    expect(b.build(raw({ gamepad: pad() })).aim).toBeCloseTo(-Math.PI / 2);
    // Pad unplugged while it was the last-used device: aim holds.
    expect(b.build(raw()).aim).toBeCloseTo(-Math.PI / 2);
  });

  it('returns a fresh move object each frame', () => {
    const b = new InputFrameBuilder(cfg);
    const a = b.build(raw());
    const c = b.build(raw());
    expect(a.move).not.toBe(c.move);
  });
});
