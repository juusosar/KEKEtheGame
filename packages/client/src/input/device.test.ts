import { describe, expect, it } from 'vitest';
import { DeviceTracker, type InputDevice } from './device';

describe('DeviceTracker', () => {
  it('starts on keyboard/mouse and stays put while nothing is used', () => {
    const t = new DeviceTracker();
    expect(t.update(false, false)).toBe('keyboardMouse');
  });

  it('switches to the device that was used last and notifies only on change', () => {
    const t = new DeviceTracker();
    const seen: InputDevice[] = [];
    t.onChange((d) => seen.push(d));
    t.update(false, true);
    t.update(false, true);
    t.update(false, false);
    t.update(true, false);
    expect(t.device).toBe('keyboardMouse');
    expect(seen).toEqual(['gamepad', 'keyboardMouse']);
  });

  it('prefers the gamepad when both are active in one frame', () => {
    expect(new DeviceTracker().update(true, true)).toBe('gamepad');
  });

  it('stops notifying after unsubscribe', () => {
    const t = new DeviceTracker();
    let calls = 0;
    const off = t.onChange(() => calls++);
    off();
    t.update(false, true);
    expect(calls).toBe(0);
  });
});
