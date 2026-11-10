import Phaser from 'phaser';
import { BootScene } from './scenes/Boot';
import { GameScene } from './scenes/Game';
import { LobbyScene } from './scenes/Lobby';
import { PlayScene } from './scenes/Play';
import { ProfileScene } from './scenes/Profile';
import { TitleScene } from './scenes/Title';
import './ui/ui.css';

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
  // Boot starts Title (or Game with ?scene=game) and stays on top as the connection status overlay.
  // Flow (§13.1): Title → Profile → Play → Lobby → Game.
  scene: [BootScene, TitleScene, ProfileScene, PlayScene, LobbyScene, GameScene],
});
