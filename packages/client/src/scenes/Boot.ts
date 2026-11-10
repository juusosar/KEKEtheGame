import Phaser from 'phaser';
import { entryScene } from '../game/entryScene';
import { t } from '../i18n';
import { joinHelloRoom } from '../net/connection';
import { serverEndpoint } from '../net/endpoint';
import { ROOM_CODE_REGISTRY_KEY } from '../net/session';

export type ConnectionStatus = 'connecting' | 'connected' | 'error' | 'disconnected';

/**
 * First scene: connects to the server's hello room and shows the result in the top-left corner, over the
 * scene it starts (Title, or Game with `?scene=game`). The status is mirrored to `<body data-connection="…">`
 * so e2e tests can wait on it. Once the player is in a room, the label also shows the room code.
 */
export class BootScene extends Phaser.Scene {
  private label!: Phaser.GameObjects.Text;
  private statusText = '';

  constructor() {
    super('Boot');
  }

  create(): void {
    this.label = this.add.text(8, 8, '', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#ffffff',
      backgroundColor: 'rgba(0,0,0,0.6)',
      padding: { x: 6, y: 3 },
    });
    this.scene.launch(entryScene(window.location.search));
    this.scene.bringToTop();
    this.registry.events.on(`changedata-${ROOM_CODE_REGISTRY_KEY}`, () => this.render());

    this.setStatus('connecting', t('boot.connecting'));
    void this.connect();
  }

  private async connect(): Promise<void> {
    try {
      const room = await joinHelloRoom(serverEndpoint(window.location, import.meta.env.DEV));
      // The server greets each client with a "hello" message; nothing to do with it yet.
      room.onMessage('hello', () => undefined);
      room.onLeave(() => this.setStatus('disconnected', t('boot.disconnected')));
      this.setStatus('connected', t('boot.connected'));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[keke] could not join the hello room', err);
      this.setStatus('error', t('boot.error', { message }));
    }
  }

  private setStatus(status: ConnectionStatus, text: string): void {
    document.body.dataset['connection'] = status;
    this.statusText = text;
    this.render();
    this.label.setColor(status === 'connected' ? '#7CFC00' : status === 'connecting' ? '#ffffff' : '#ff5555');
  }

  private render(): void {
    const code: unknown = this.registry.get(ROOM_CODE_REGISTRY_KEY);
    const room = typeof code === 'string' && code !== '' ? `  ·  ${t('room.joined', { code })}` : '';
    this.label.setText(this.statusText + room);
  }
}
