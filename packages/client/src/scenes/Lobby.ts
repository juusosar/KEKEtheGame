import type { Room } from '@colyseus/sdk';
import {
  ClientMessage,
  GAME_MODES,
  ServerMessage,
  loadConfig,
  teamColor,
  type GameMode,
  type LobbySettingsUpdate,
} from '@keke/shared';
import Phaser from 'phaser';
import { t, type MessageKey } from '../i18n';
import { lobbyErrorKey, readLobby, type LobbyPlayerView, type LobbyView } from '../net/lobbyView';
import { ROOM_CODE_REGISTRY_KEY, currentRoom, setCurrentRoom } from '../net/session';
import { createMenuLayer, h } from '../ui/dom';

/** Scene that takes over when the host starts (or when we join a room that is already playing). */
export const AFTER_LOBBY_SCENE = 'Game';

/** Data the Play scene accepts: a notice to show, e.g. after losing the room. */
export interface PlaySceneData {
  notice?: string;
}

const MODE_LABEL: Record<GameMode, MessageKey> = {
  timed: 'lobby.mode.timed',
  race: 'lobby.mode.race',
};

/**
 * §13.1 step 4: player list with ready toggles, host settings (mode, rounds per map, teams, shuffle)
 * and Start. Everything is drawn from the synced room state; buttons only send requests, and the
 * server's answer arrives as a state patch (or a lobbyError for a refusal).
 */
export class LobbyScene extends Phaser.Scene {
  private room!: Room;
  private view!: LobbyView;
  private leaving = false;
  private unsubscribe: (() => void)[] = [];

  private codeEl!: HTMLElement;
  private playerList!: HTMLUListElement;
  private readyButton!: HTMLButtonElement;
  private modeButtons = new Map<GameMode, HTMLButtonElement>();
  private roundButtons: HTMLButtonElement[] = [];
  private teamsButtons!: { off: HTMLButtonElement; on: HTMLButtonElement };
  private shuffleButton!: HTMLButtonElement;
  private settingsNote!: HTMLParagraphElement;
  private startButton!: HTMLButtonElement;
  private startNote!: HTMLParagraphElement;
  private status!: HTMLParagraphElement;

  constructor() {
    super('Lobby');
  }

  create(): void {
    const current = currentRoom();
    if (current === null) {
      // Opened without a room (e.g. a stale scene start): go back and pick one.
      this.scene.start('Play');
      return;
    }
    this.room = current.room;
    this.leaving = false;
    this.unsubscribe = [];
    this.modeButtons = new Map();
    this.roundButtons = [];

    this.createPanel(current.code);
    this.listen();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.stopListening());
    this.render();
  }

  // --- room events --------------------------------------------------------------------------------

  private listen(): void {
    const room = this.room;
    const onState = (): void => this.render();
    const onLeave = (): void => this.lost();
    room.onStateChange(onState);
    room.onLeave(onLeave);
    this.unsubscribe.push(
      () => room.onStateChange.remove(onState),
      () => room.onLeave.remove(onLeave),
      room.onMessage(ServerMessage.lobbyError, (message: unknown) => {
        const code =
          typeof message === 'object' && message !== null && 'code' in message ? message.code : null;
        this.setStatus(t(lobbyErrorKey(code)), true);
      }),
    );
  }

  private stopListening(): void {
    for (const off of this.unsubscribe) off();
    this.unsubscribe = [];
  }

  /** The connection dropped (or the server closed the room) while we were in the lobby. */
  private lost(): void {
    if (this.leaving) return;
    this.leaving = true;
    this.forgetRoom();
    const data: PlaySceneData = { notice: t('lobby.lost') };
    this.scene.start('Play', data);
  }

  private leave(): void {
    if (this.leaving) return;
    this.leaving = true;
    this.stopListening();
    void this.room.leave();
    this.forgetRoom();
    this.scene.start('Play');
  }

  private forgetRoom(): void {
    setCurrentRoom(null);
    this.registry.remove(ROOM_CODE_REGISTRY_KEY);
    delete document.body.dataset['room'];
  }

  private send(type: string, payload?: unknown): void {
    this.setStatus('', false);
    this.room.send(type, payload);
  }

  private sendSettings(update: LobbySettingsUpdate): void {
    this.send(ClientMessage.settings, update);
  }

  // --- panel -------------------------------------------------------------------------------------

  private createPanel(code: string): void {
    const layer = createMenuLayer(this, 'lobby');
    const panel = h('div', { class: 'panel', role: 'region', 'aria-labelledby': 'keke-lobby-heading' });

    panel.append(h('h2', { id: 'keke-lobby-heading' }, t('lobby.heading')));
    this.codeEl = h('span', { class: 'code', id: 'keke-lobby-code' }, code);
    panel.append(h('p', { class: 'room-code' }, t('lobby.codeLabel'), ' ', this.codeEl));
    panel.append(h('p', { class: 'muted' }, t('lobby.codeHint')));

    panel.append(h('h3', { id: 'keke-lobby-players' }, t('lobby.playersHeading')));
    this.playerList = h('ul', { class: 'players', 'aria-labelledby': 'keke-lobby-players' });
    panel.append(this.playerList);

    this.readyButton = this.button(t('lobby.ready'), 'wide', () =>
      this.send(ClientMessage.ready, { ready: !(this.view.me?.ready ?? false) }),
    );
    this.readyButton.setAttribute('aria-pressed', 'false');
    panel.append(this.readyButton);

    panel.append(h('h3', {}, t('lobby.settingsHeading')));
    panel.append(this.createSettings());
    this.settingsNote = h('p', { class: 'muted' });
    panel.append(this.settingsNote);

    this.startButton = this.button(t('lobby.start'), 'wide start', () => this.send(ClientMessage.start));
    this.startNote = h('p', { class: 'muted' });
    this.status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
    const leave = this.button(t('lobby.leave'), 'secondary', () => this.leave());
    panel.append(this.startButton, this.startNote, this.status, h('div', { class: 'actions' }, leave));

    layer.append(panel);
  }

  private createSettings(): HTMLElement {
    const settings = h('div', { class: 'settings' });

    const modes = h('div', { class: 'choice', role: 'group', 'aria-label': t('lobby.modeLabel') });
    for (const mode of GAME_MODES) {
      const button = this.button(t(MODE_LABEL[mode]), '', () => this.sendSettings({ mode }));
      this.modeButtons.set(mode, button);
      modes.append(button);
    }
    settings.append(h('label', {}, t('lobby.modeLabel')), modes);

    const rounds = h('div', { class: 'choice', role: 'group', 'aria-label': t('lobby.roundsLabel') });
    const max = loadConfig().maxRoundsPerMap;
    for (let n = 1; n <= max; n++) {
      const button = this.button(String(n), '', () => this.sendSettings({ roundsPerMap: n }));
      button.setAttribute('aria-label', t('lobby.roundsOption', { n }));
      this.roundButtons.push(button);
      rounds.append(button);
    }
    settings.append(h('label', {}, t('lobby.roundsLabel')), rounds);

    const teams = h('div', { class: 'choice', role: 'group', 'aria-label': t('lobby.teamsLabel') });
    this.teamsButtons = {
      off: this.button(t('lobby.teamsOff'), '', () => this.sendSettings({ teams: false })),
      on: this.button(t('lobby.teamsOn'), '', () => this.sendSettings({ teams: true })),
    };
    this.shuffleButton = this.button(t('lobby.shuffle'), 'secondary', () =>
      this.send(ClientMessage.shuffleTeams),
    );
    teams.append(this.teamsButtons.off, this.teamsButtons.on);
    settings.append(h('label', {}, t('lobby.teamsLabel')), teams, this.shuffleButton);

    return settings;
  }

  private button(label: string, className: string, onClick: () => void): HTMLButtonElement {
    const button = h('button', { type: 'button', class: className }, label);
    button.addEventListener('click', onClick);
    return button;
  }

  // --- render ------------------------------------------------------------------------------------

  private render(): void {
    if (this.leaving) return;
    const view = readLobby(this.room.state, this.room.sessionId);
    this.view = view;

    if (view.synced && view.phase !== 'lobby') {
      // Host pressed Start, or we joined a running round (we spectate until the next one, §13.1).
      this.leaving = true;
      this.scene.start(AFTER_LOBBY_SCENE);
      return;
    }

    if (view.code !== '') this.codeEl.textContent = view.code;
    this.renderPlayers(view);

    const me = view.me;
    this.readyButton.disabled = me === null || me.spectator;
    this.readyButton.setAttribute('aria-pressed', String(me?.ready ?? false));

    const host = view.isHost;
    for (const [mode, button] of this.modeButtons) this.pressed(button, view.settings.mode === mode, host);
    this.roundButtons.forEach((button, i) =>
      this.pressed(button, view.settings.roundsPerMap === i + 1, host),
    );
    this.pressed(this.teamsButtons.off, !view.settings.teams, host);
    this.pressed(this.teamsButtons.on, view.settings.teams, host);
    this.shuffleButton.hidden = !view.settings.teams;
    this.shuffleButton.disabled = !host;
    this.settingsNote.textContent = host ? '' : t('lobby.hostOnly');
    this.settingsNote.hidden = host;

    this.startButton.hidden = !host;
    this.startButton.disabled = !host || !view.everyoneReady;
    this.startNote.textContent = host
      ? view.everyoneReady
        ? ''
        : t('lobby.waitingReady')
      : t('lobby.waitingHost', { host: view.players.find((p) => p.isHost)?.nickname ?? '' });
    this.startNote.hidden = this.startNote.textContent === '';
  }

  private pressed(button: HTMLButtonElement, on: boolean, enabled: boolean): void {
    button.setAttribute('aria-pressed', String(on));
    button.disabled = !enabled;
  }

  private renderPlayers(view: LobbyView): void {
    this.playerList.replaceChildren(...view.players.map((p) => this.playerRow(p, view.settings.teams)));
  }

  private playerRow(p: LobbyPlayerView, teams: boolean): HTMLLIElement {
    const tags: string[] = [];
    if (p.isMe) tags.push(t('lobby.tag.you'));
    if (p.isHost) tags.push(t('lobby.tag.host'));
    if (teams && p.team > 0) tags.push(t('lobby.tag.team', { team: p.team }));
    if (p.spectator) tags.push(t('lobby.tag.spectator'));
    if (!p.connected) tags.push(t('lobby.tag.reconnecting'));

    const swatch = h('span', { class: 'swatch-dot', 'aria-hidden': 'true' });
    swatch.style.background = p.color || '#888';
    // Teams (§4.3, M6-4): a ring in the team colour, as the outline drawn round the body in a round.
    const ring = teams ? teamColor(p.team) : undefined;
    if (ring) swatch.style.boxShadow = `0 0 0 2px ${ring}`;
    const state = p.spectator ? '' : p.ready ? t('lobby.state.ready') : t('lobby.state.notReady');

    return h(
      'li',
      {
        'data-player-id': p.id,
        'data-ready': String(p.ready),
        'data-host': String(p.isHost),
        'data-team': p.team,
        class: [p.ready ? 'is-ready' : '', p.isMe ? 'is-me' : ''].join(' ').trim(),
      },
      swatch,
      h('span', { class: 'name' }, p.nickname),
      h('span', { class: 'tags' }, tags.join(' · ')),
      h('span', { class: 'state' }, state),
    );
  }

  private setStatus(message: string, error: boolean): void {
    this.status.textContent = message;
    this.status.classList.toggle('error', error);
  }
}
