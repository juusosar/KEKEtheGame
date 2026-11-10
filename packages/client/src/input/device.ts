export type InputDevice = 'keyboardMouse' | 'gamepad';

/**
 * Tracks the last-used device so the UI can show matching button prompts (§13.3).
 * Gamepad wins a frame where both are active: a stick resting on the desk can't produce
 * activity past its deadzone, while a mouse nudged by accident can.
 */
export class DeviceTracker {
  private current: InputDevice;
  private readonly listeners = new Set<(device: InputDevice) => void>();

  constructor(initial: InputDevice = 'keyboardMouse') {
    this.current = initial;
  }

  get device(): InputDevice {
    return this.current;
  }

  /** Feeds one frame's activity. Returns the device after the update. */
  update(keyboardMouseActive: boolean, gamepadActive: boolean): InputDevice {
    const next: InputDevice = gamepadActive
      ? 'gamepad'
      : keyboardMouseActive
        ? 'keyboardMouse'
        : this.current;
    if (next !== this.current) {
      this.current = next;
      for (const listener of this.listeners) listener(next);
    }
    return this.current;
  }

  /** Subscribes to device changes. Returns an unsubscribe function. */
  onChange(listener: (device: InputDevice) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
