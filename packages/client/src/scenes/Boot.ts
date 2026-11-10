import Phaser from 'phaser';
import { entryScene } from '../game/entryScene';
import { t } from '../i18n';
import { checkHealth } from '../net/connection';
import { serverEndpoint } from '../net/endpoint';
import { gameClient } from '../net/client';
import { readGame, sceneForPhase } from '../net/gameView';
import { ROOM_CODE_REGISTRY_KEY, markRoom, resumeRoom, waitForFirstState } from '../net/session';
import { AFTER_JOIN_SCENE } from './Play';

/** How long a resumed room may take to send its state before we fall back to the lobby. */
const RESUME_STATE_TIMEOUT_MS = 5000;

/** How often the connection badge asks the server's health check again. */
const HEALTH_POLL_MS = 5000;

export type ConnectionStatus = 'connecting' | 'connected' | 'error' | 'disconnected';

/**
 * First scene: checks the server's health (`GET /healthz`) and shows the result in the top-left corner, over the
 * scene it starts (Title, or Game with `?scene=game`). The status is mirrored to `<body data-connection="…">`
 * so e2e tests can wait on it, and checked again every few seconds so a server that goes away turns the
 * badge red. Once the player is in a room, the label also shows the room code.
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
    this.registry.events.on(`changedata-${ROOM_CODE_REGISTRY_KEY}`, () => this.render());
    this.setStatus('connecting', t('boot.connecting'));
    void this.connect();
    void this.start();
  }

  /**
   * After a reload inside the reconnect window, go straight back into the room, to the scene its phase
   * calls for (the Game mid-round, else the Lobby); otherwise to the entry scene.
   */
  private async start(): Promise<void> {
    const entry = entryScene(window.location.search);
    const resumed = entry === 'Title' ? await resumeRoom(gameClient()) : null;
    let next: string = entry;
    if (resumed !== null) {
      markRoom(this.registry, resumed);
      const { room } = resumed;
      const synced = await waitForFirstState(
        room,
        (state) => readGame(state, room.sessionId).synced,
        RESUME_STATE_TIMEOUT_MS,
      );
      // Without a state the Lobby still works: it moves on to the Game once the phase arrives.
      next = synced ? sceneForPhase(readGame(room.state, room.sessionId).phase) : AFTER_JOIN_SCENE;
    }
    this.scene.launch(next);
    this.scene.bringToTop();
  }

  private async connect(): Promise<void> {
    const endpoint = serverEndpoint(window.location, import.meta.env.DEV);
    try {
      await checkHealth(endpoint);
      this.setStatus('connected', t('boot.connected'));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[keke] the server health check failed', err);
      this.setStatus('error', t('boot.error', { message }));
    }
    this.time.addEvent({ delay: HEALTH_POLL_MS, loop: true, callback: () => void this.recheck(endpoint) });
  }

  private async recheck(endpoint: string): Promise<void> {
    try {
      await checkHealth(endpoint);
      if (document.body.dataset['connection'] !== 'connected')
        this.setStatus('connected', t('boot.connected'));
    } catch {
      if (document.body.dataset['connection'] === 'connected') {
        this.setStatus('disconnected', t('boot.disconnected'));
      }
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
