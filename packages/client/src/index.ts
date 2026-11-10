import Phaser from 'phaser';
import { BootScene } from './scenes/Boot';

// Client entry point (loaded by index.html).
new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#1a1a1a',
  pixelArt: true,
  // §13.3: gamepads are read through Phaser's gamepad plugin by the InputManager.
  input: { gamepad: true },
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: '100%',
    height: '100%',
  },
  scene: [BootScene],
});
