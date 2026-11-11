import Phaser from 'phaser';
import { debugFpsLimit } from './game/debugFlag';
import { BootScene } from './scenes/Boot';
import { GameScene } from './scenes/Game';
import { LobbyScene } from './scenes/Lobby';
import { PlayScene } from './scenes/Play';
import { ProfileScene } from './scenes/Profile';
import { TitleScene } from './scenes/Title';
import { mountAudioControl } from './ui/audioControl';
import './ui/ui.css';

// Client entry point (loaded by index.html).
const fpsLimit = debugFpsLimit(window.location.search);
new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#1a1a1a',
  pixelArt: true,
  // §13.3: gamepads are read through Phaser's gamepad plugin by the InputManager.
  input: { gamepad: true },
  // Uncapped by default; e2e specs with many pages pass `?debug=1&fps=N` (debugFlag.ts).
  ...(fpsLimit === undefined ? {} : { fps: { limit: fpsLimit } }),
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: '100%',
    height: '100%',
  },
  // Boot starts Title (or Game with ?scene=game) and stays on top as the connection status overlay.
  // Flow (§13.1): Title → Profile → Play → Lobby → Game.
  scene: [BootScene, TitleScene, ProfileScene, PlayScene, LobbyScene, GameScene],
});
// §12: the sound settings button stays in the bottom-left corner on every screen.
mountAudioControl();
