import Phaser from 'phaser';
import { t } from '../i18n';
import { joinHelloRoom } from '../net/connection';
import { serverEndpoint } from '../net/endpoint';

export type ConnectionStatus = 'connecting' | 'connected' | 'error' | 'disconnected';

/**
 * First scene: connects to the server's hello room and shows the result in the top-left corner, over the
 * Game scene it starts. The status is mirrored to `<body data-connection="…">` so e2e tests can wait on it.
 * Until the lobby flow (M2) exists, the Game scene runs locally whatever the connection does.
 */
export class BootScene extends Phaser.Scene {
  private label!: Phaser.GameObjects.Text;

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
    this.scene.launch('Game');
    this.scene.bringToTop();

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
    this.label.setText(text);
    this.label.setColor(status === 'connected' ? '#7CFC00' : status === 'connecting' ? '#ffffff' : '#ff5555');
  }
}
