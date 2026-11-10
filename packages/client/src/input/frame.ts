import type { InputFrame, Vec2 } from '@keke/shared';
import { noAimAssist, resolveGamepadAim, type AimAssist } from './aim';
import type { InputConfig } from './config';
import { DeviceTracker, type InputDevice } from './device';
import { readGamepad, type GamepadSnapshot } from './gamepad';
import { readKeyboardMouse, type KeyboardMouseState } from './keyboardMouse';

/** Everything the builder needs for one frame. No Phaser types, so it is unit-testable. */
export interface RawInput {
  keyboardMouse: KeyboardMouseState;
  /** Pointer position in screen space, used only to detect mouse activity. */
  pointerScreen: Vec2;
  /** First connected pad, or null. */
  gamepad: GamepadSnapshot | null;
  /** Player position in world space: the origin for mouse aim and aim assist. */
  origin: Vec2;
}

/**
 * Merges keyboard/mouse and gamepad into one InputFrame (§13.3, §15.3).
 * Buttons from both devices are OR-ed, a deflected left stick overrides WASD, and aim follows the
 * last-used device.
 */
export class InputFrameBuilder {
  readonly devices: DeviceTracker;
  aimAssist: AimAssist = noAimAssist;
  private seq = 0;
  private aim = 0;
  private lastPointer: Vec2 | null = null;

  constructor(
    private readonly cfg: InputConfig,
    initialDevice: InputDevice = 'keyboardMouse',
  ) {
    this.devices = new DeviceTracker(initialDevice);
  }

  get lastSeq(): number {
    return this.seq;
  }

  build(raw: RawInput): InputFrame {
    const kbm = readKeyboardMouse(raw.keyboardMouse, raw.origin);
    const pad = raw.gamepad ? readGamepad(raw.gamepad, this.cfg) : null;

    const device = this.devices.update(this.keyboardMouseActive(raw), pad?.active ?? false);

    const padMoving = pad !== null && (pad.move.x !== 0 || pad.move.y !== 0);
    const move = padMoving ? pad.move : kbm.move;

    if (device === 'keyboardMouse') {
      if (kbm.aim !== null) this.aim = kbm.aim;
    } else if (pad !== null) {
      this.aim = resolveGamepadAim(pad.aim, move, this.aim, raw.origin, this.aimAssist);
    }

    this.seq += 1;
    return {
      seq: this.seq,
      move: { x: move.x, y: move.y },
      aim: this.aim,
      buttons: kbm.buttons | (pad?.buttons ?? 0),
    };
  }

  private keyboardMouseActive(raw: RawInput): boolean {
    const { keys, leftMouse, rightMouse } = raw.keyboardMouse;
    const prev = this.lastPointer;
    this.lastPointer = { x: raw.pointerScreen.x, y: raw.pointerScreen.y };
    const moved =
      prev !== null &&
      Math.hypot(raw.pointerScreen.x - prev.x, raw.pointerScreen.y - prev.y) >= this.cfg.mouseActivityPixels;
    return keys.size > 0 || leftMouse || rightMouse || moved;
  }
}
