import Phaser from 'phaser';
import { t } from '../i18n';
import { joinHelloRoom } from '../net/connection';
import { serverEndpoint } from '../net/endpoint';

export type ConnectionStatus = 'connecting' | 'connected' | 'error' | 'disconnected';

/**
 * First scene: connects to the server's hello room and shows the result.
 * The status is mirrored to `<body data-connection="…">` so e2e tests can wait on it.
 */
export class BootScene extends Phaser.Scene {
  private label!: Phaser.GameObjects.Text;

  constructor() {
    super('Boot');
  }

  create(): void {
    const { width, height } = this.scale;
    this.label = this.add
      .text(width / 2, height / 2, '', { fontFamily: 'monospace', fontSize: '32px', color: '#ffffff' })
      .setOrigin(0.5);
    this.scale.on(Phaser.Scale.Events.RESIZE, (size: Phaser.Structs.Size) => {
      this.label.setPosition(size.width / 2, size.height / 2);
    });

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
