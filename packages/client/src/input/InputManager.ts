import type { InputFrame, Vec2 } from '@keke/shared';
import Phaser from 'phaser';
import type { AimAssist } from './aim';
import { inputConfig, type InputConfig } from './config';
import type { InputDevice } from './device';
import { InputFrameBuilder } from './frame';
import { STANDARD, type GamepadSnapshot } from './gamepad';
import { KEY_BINDINGS } from './keyboardMouse';

/**
 * Phaser glue for §13.3: reads keyboard, mouse and the first connected gamepad (Phaser gamepad
 * plugin, enabled with `input: { gamepad: true }` in the game config) and turns them into one
 * InputFrame per `sample()` call. All mapping logic lives in the pure modules next to this file.
 *
 * Usage in a scene:
 *   this.inputManager = new InputManager(this);
 *   // each update: inputManager.setOrigin(player); const frame = inputManager.sample();
 */
/** Keys the game captures (preventDefault) while it runs. Released again in `destroy()`. */
export const CAPTURED_KEYS: readonly number[] = [
  // Tab is the scoreboard key; without capture the browser moves focus out of the canvas.
  Phaser.Input.Keyboard.KeyCodes.TAB,
];

export class InputManager {
  private readonly builder: InputFrameBuilder;
  private readonly keys = new Set<string>();
  private origin: Vec2 = { x: 0, y: 0 };
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    this.keys.add(event.code);
  };
  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };
  // Keys released while the tab is unfocused never send keyup; drop everything instead of sticking.
  private readonly onBlur = (): void => {
    this.keys.clear();
  };

  constructor(
    private readonly scene: Phaser.Scene,
    cfg: InputConfig = inputConfig,
  ) {
    this.builder = new InputFrameBuilder(cfg);

    const keyboard = scene.input.keyboard;
    if (keyboard) {
      keyboard.on(Phaser.Input.Keyboard.Events.ANY_KEY_DOWN, this.onKeyDown);
      keyboard.on(Phaser.Input.Keyboard.Events.ANY_KEY_UP, this.onKeyUp);
      keyboard.addCapture([...CAPTURED_KEYS]);
    }
    // Right mouse is Block, so the context menu must not open over the game.
    scene.input.mouse?.disableContextMenu();
    scene.game.events.on(Phaser.Core.Events.BLUR, this.onBlur);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  /** Player position in world space; mouse aim and aim assist are measured from here. */
  setOrigin(position: Vec2): void {
    this.origin = { x: position.x, y: position.y };
  }

  /** Installs the aim-assist hook used when the right stick is idle (see `coneAimAssist`). */
  setAimAssist(assist: AimAssist): void {
    this.builder.aimAssist = assist;
  }

  /** The last-used device, for button prompts. */
  get device(): InputDevice {
    return this.builder.devices.device;
  }

  /** Subscribes to last-used device changes. Returns an unsubscribe function. */
  onDeviceChange(listener: (device: InputDevice) => void): () => void {
    return this.builder.devices.onChange(listener);
  }

  /** Reads all devices and returns the next InputFrame (seq increases by one per call). */
  sample(): InputFrame {
    const pointer = this.scene.input.activePointer;
    const world = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    return this.builder.build({
      keyboardMouse: {
        keys: this.keys,
        leftMouse: pointer.leftButtonDown(),
        rightMouse: pointer.rightButtonDown(),
        pointer: { x: world.x, y: world.y },
      },
      pointerScreen: { x: pointer.x, y: pointer.y },
      gamepad: this.readPad(),
      origin: this.origin,
    });
  }

  /**
   * True while the scoreboard key (Tab) or pad View is held (§13.3). Read every frame by the HUD,
   * also while the player is not simulated (countdown, spectating), so it does not go through `sample()`.
   */
  scoreboardHeld(): boolean {
    if (this.keys.has(KEY_BINDINGS.scoreboard)) return true;
    const pad = this.scene.input.gamepad?.getAll().find((p) => p.connected);
    return pad?.buttons[STANDARD.buttons.view]?.pressed ?? false;
  }

  /**
   * Pressed flags of the first connected pad's buttons (standard mapping index), or null without a pad.
   * The in-game menu reads Start, A, B and the D-pad from here (F5).
   */
  padPressed(): boolean[] | null {
    const pad = this.scene.input.gamepad?.getAll().find((p) => p.connected);
    return pad ? pad.buttons.map((b) => b.pressed) : null;
  }

  destroy(): void {
    const keyboard = this.scene.input.keyboard;
    keyboard?.off(Phaser.Input.Keyboard.Events.ANY_KEY_DOWN, this.onKeyDown);
    keyboard?.off(Phaser.Input.Keyboard.Events.ANY_KEY_UP, this.onKeyUp);
    // Captures live on the game-wide KeyboardManager and survive scene shutdown; without this,
    // Tab stays blocked in the HTML menus (title, profile, lobby) after a match.
    keyboard?.removeCapture([...CAPTURED_KEYS]);
    this.scene.game.events.off(Phaser.Core.Events.BLUR, this.onBlur);
    this.keys.clear();
  }

  private readPad(): GamepadSnapshot | null {
    const pad = this.scene.input.gamepad?.getAll().find((p) => p.connected);
    if (!pad) return null;
    return {
      axes: pad.axes.map((a) => a.value),
      buttons: pad.buttons.map((b) => ({ pressed: b.pressed, value: b.value })),
    };
  }
}
