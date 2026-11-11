import type { Room } from '@colyseus/sdk';
import {
  GAME_MODES,
  MAP_CHOICES,
  ROOM_CODE_LENGTH,
  ROOM_NAMES,
  isRoomCode,
  loadConfig,
  maxBots,
  normalizeRoomCode,
  type GameConfig,
  type GameMode,
  type LobbySettings,
  type PlayerProfile,
} from '@keke/shared';
import Phaser from 'phaser';
import { t } from '../i18n';
import { gameClient } from '../net/client';
import { addRoom, isJoinable, removeRoom, setRooms, type RoomSummary } from '../net/roomList';
import {
  classifyJoinError,
  createGameRoom,
  errorMessage,
  joinGameRoomByCode,
  cleanCodeInput,
  waitForRoomCode,
} from '../net/rooms';
import { markRoom, setCurrentRoom } from '../net/session';
import { browserStorage, loadProfile } from '../profile/storage';
import { themeFor } from '../game/mapTheme';
import { createMenuLayer, h } from '../ui/dom';
import { BotPicker } from '../ui/botPicker';
import { ROOM_SETUP_KEY, readRoomSetup } from '../ui/rules';
import { RulesEditor } from '../ui/rulesEditor';
import { MODE_LABEL, mapChoiceLabel, type PlaySceneData } from './Lobby';

/** Scene that takes over once we're in a room (§13.1 step 4). */
export const AFTER_JOIN_SCENE = 'Lobby';

/**
 * §13.1 step 3: create a room (the server hands out a 4-letter code), join one by code, or pick one
 * from the live list of open rooms on this server (the LobbyRoom listing).
 */
export class PlayScene extends Phaser.Scene {
  private profile!: PlayerProfile;
  private busy = false;
  private listing: Room | null = null;
  private closed = false;
  private rooms: RoomSummary[] = [];
  private buttons: HTMLButtonElement[] = [];
  private codeInput!: HTMLInputElement;
  private joinButton!: HTMLButtonElement;
  private roomList!: HTMLUListElement;
  private roomsNote!: HTMLParagraphElement;
  private status!: HTMLParagraphElement;
  private config!: GameConfig;
  private mainPanel!: HTMLDivElement;
  /** The room setup menu (Create room opens it): stores, mode, rounds, teams and the rules. */
  private setupPanel!: HTMLDivElement;
  private setup!: LobbySettings;
  private setupButtons: { button: HTMLButtonElement; pressed: () => boolean }[] = [];
  private rulesEditor!: RulesEditor;
  private setupStatus!: HTMLParagraphElement;
  private botPicker: BotPicker | undefined;

  constructor() {
    super('Play');
  }

  private notice = '';

  init(data: PlaySceneData | undefined): void {
    this.notice = data?.notice ?? '';
  }

  create(): void {
    this.busy = false;
    this.closed = false;
    this.rooms = [];
    this.buttons = [];
    this.setupButtons = [];
    this.config = loadConfig();
    this.profile = loadProfile(browserStorage(), this.config.nicknameMaxLength).profile;
    this.setup = readRoomSetup(storedSetup(), this.config.maxRoundsPerMap, maxBots(this.config));
    this.createPanel();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.closeListing());
    void this.openListing();
    if (this.notice !== '') this.setStatus(this.notice, true);
  }

  private createPanel(): void {
    const layer = createMenuLayer(this, 'play');
    const panel = h('div', { class: 'panel', role: 'region', 'aria-labelledby': 'keke-play-heading' });
    this.mainPanel = panel;
    panel.append(h('h2', { id: 'keke-play-heading' }, t('play.heading')));

    const edit = this.button(t('play.editProfile'), 'link', () => this.scene.start('Profile'));
    panel.append(
      h('p', { class: 'muted' }, t('play.playingAs', { name: this.profile.nickname }), ' · ', edit),
    );

    const create = this.button(t('play.create'), 'wide', () => this.openSetup());
    create.id = 'keke-play-create';
    panel.append(create);

    panel.append(h('h3', {}, t('play.joinHeading')));
    this.codeInput = h('input', {
      type: 'text',
      id: 'keke-room-code',
      class: 'code',
      maxlength: ROOM_CODE_LENGTH,
      autocomplete: 'off',
      spellcheck: false,
      'aria-label': t('play.codeLabel'),
      placeholder: 'ABCD',
    });
    this.joinButton = this.button(t('play.join'), '', () => void this.joinByCode(this.codeInput.value));
    const joinForm = h('form', { class: 'row' }, this.codeInput, this.joinButton);
    this.joinButton.type = 'submit';
    joinForm.addEventListener('submit', (event) => event.preventDefault());
    this.codeInput.addEventListener('input', () => {
      this.codeInput.value = cleanCodeInput(this.codeInput.value);
      this.updateJoinEnabled();
    });
    panel.append(joinForm);

    panel.append(h('h3', {}, t('play.roomsHeading')));
    this.roomsNote = h('p', { class: 'muted' }, t('play.roomsLoading'));
    this.roomList = h('ul', { class: 'rooms', 'aria-label': t('play.roomsHeading') });
    panel.append(this.roomsNote, this.roomList);

    this.status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
    panel.append(this.status);

    layer.append(panel);
    this.setupPanel = this.createSetupPanel();
    this.setupPanel.hidden = true;
    layer.append(this.setupPanel);
    this.updateJoinEnabled();
    this.codeInput.focus();
  }

  // --- room setup ------------------------------------------------------------------------------------

  private createSetupPanel(): HTMLDivElement {
    const panel = h('div', {
      class: 'panel setup-panel',
      id: 'keke-setup',
      role: 'region',
      'aria-labelledby': 'keke-setup-heading',
    });
    panel.append(h('h2', { id: 'keke-setup-heading' }, t('play.setupHeading')));
    panel.append(h('p', { class: 'muted' }, t('play.setupIntro')));

    const settings = h('div', { class: 'settings' });
    const group = (label: string, buttons: HTMLButtonElement[]): void => {
      const row = h('div', { class: 'choice', role: 'group', 'aria-label': label }, ...buttons);
      settings.append(h('label', {}, label), row);
    };
    group(
      t('lobby.mapsLabel'),
      MAP_CHOICES.map((choice) =>
        this.setupChoice(mapChoiceLabel(choice), { maps: choice }, () => this.setup.maps === choice, {
          'data-map-choice': choice,
        }),
      ),
    );
    group(
      t('lobby.modeLabel'),
      GAME_MODES.map((mode: GameMode) =>
        this.setupChoice(t(MODE_LABEL[mode]), { mode }, () => this.setup.mode === mode),
      ),
    );
    const rounds: HTMLButtonElement[] = [];
    for (let n = 1; n <= this.config.maxRoundsPerMap; n++) {
      rounds.push(
        this.setupChoice(String(n), { roundsPerMap: n }, () => this.setup.roundsPerMap === n, {
          'aria-label': t('lobby.roundsOption', { n }),
        }),
      );
    }
    group(t('lobby.roundsLabel'), rounds);
    group(t('lobby.teamsLabel'), [
      this.setupChoice(t('lobby.teamsOff'), { teams: false }, () => !this.setup.teams),
      this.setupChoice(t('lobby.teamsOn'), { teams: true }, () => this.setup.teams),
    ]);
    // Bot players: how many and how good; they take the seats nobody else needs.
    this.botPicker = new BotPicker({
      max: maxBots(this.config),
      idPrefix: 'keke-setup-bots',
      onChange: (change) => {
        this.setup = { ...this.setup, ...change };
        this.renderSetup();
      },
    });
    settings.append(...this.botPicker.elements);
    panel.append(settings);

    panel.append(h('h3', {}, t('play.rulesHeading')));
    this.rulesEditor = new RulesEditor({
      base: this.config,
      rules: this.setup.rules,
      idPrefix: 'keke-setup-rule',
      onChange: (rules) => (this.setup = { ...this.setup, rules }),
    });
    panel.append(this.rulesEditor.root);

    const open = this.button(t('play.setupCreate'), 'wide start', () => void this.create_());
    open.id = 'keke-setup-create';
    const back = this.button(t('play.setupBack'), 'secondary', () => this.closeSetup());
    back.id = 'keke-setup-back';
    this.setupStatus = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
    panel.append(open, this.setupStatus, h('div', { class: 'actions' }, back));
    this.renderSetup();
    return panel;
  }

  private setupChoice(
    label: string,
    change: Partial<LobbySettings>,
    pressed: () => boolean,
    attrs: Record<string, string> = {},
  ): HTMLButtonElement {
    const button = this.button(label, '', () => {
      this.setup = { ...this.setup, ...change };
      this.renderSetup();
    });
    for (const [name, value] of Object.entries(attrs)) button.setAttribute(name, value);
    this.setupButtons.push({ button, pressed });
    return button;
  }

  private renderSetup(): void {
    for (const { button, pressed } of this.setupButtons)
      button.setAttribute('aria-pressed', String(pressed()));
    this.botPicker?.set(this.setup.bots, this.setup.botLevel, true);
  }

  private openSetup(): void {
    if (this.busy) return;
    this.mainPanel.hidden = true;
    this.setupPanel.hidden = false;
    this.setStatus('', false);
    document.getElementById('keke-setup-create')?.focus();
  }

  private closeSetup(): void {
    if (this.busy) return;
    this.setupPanel.hidden = true;
    this.mainPanel.hidden = false;
    this.codeInput.focus();
  }

  private button(label: string, className: string, onClick: () => void): HTMLButtonElement {
    const button = h('button', { type: 'button', class: className }, label);
    button.addEventListener('click', onClick);
    this.buttons.push(button);
    return button;
  }

  // --- create / join ---------------------------------------------------------------------------------

  private async create_(): Promise<void> {
    if (!this.begin(t('play.creating'))) return;
    const settings: LobbySettings = { ...this.setup, rules: this.rulesEditor.rules };
    try {
      const room = await createGameRoom(gameClient(), this.profile, settings);
      storeSetup(settings);
      this.enter(room, await waitForRoomCode(room));
    } catch (err) {
      console.error('[keke] could not create a room', err);
      this.fail(t('play.error.create', { message: errorMessage(err) }));
    }
  }

  private async joinByCode(input: string): Promise<void> {
    const code = normalizeRoomCode(input);
    if (code === null) {
      this.setStatus(t('play.error.codeIncomplete'), true);
      return;
    }
    if (!this.begin(t('play.joining', { code }))) return;
    try {
      const room = await joinGameRoomByCode(gameClient(), code, this.profile);
      this.enter(room, await waitForRoomCode(room, code));
    } catch (err) {
      console.error(`[keke] could not join room ${code}`, err);
      this.fail(
        classifyJoinError(err) === 'noRoom'
          ? t('play.error.noRoom', { code })
          : t('play.error.join', { code, message: errorMessage(err) }),
      );
    }
  }

  private begin(message: string): boolean {
    if (this.busy) return false;
    this.busy = true;
    for (const button of this.buttons) button.disabled = true;
    this.setStatus(message, false);
    return true;
  }

  private fail(message: string): void {
    this.busy = false;
    for (const button of this.buttons) button.disabled = false;
    this.renderRooms();
    this.updateJoinEnabled();
    this.setStatus(message, true);
  }

  private enter(room: Room, code: string): void {
    if (!this.scene.isActive()) {
      // The player left this screen while the request was in flight.
      void room.leave();
      return;
    }
    setCurrentRoom({ room, code });
    markRoom(this.registry, { room, code });
    this.scene.start(AFTER_JOIN_SCENE);
  }

  private setStatus(message: string, error: boolean): void {
    // The setup menu has its own status line under its button; the main panel's is hidden with it.
    for (const status of [this.status, this.setupStatus]) {
      status.textContent = message;
      status.classList.toggle('error', error);
    }
  }

  private updateJoinEnabled(): void {
    this.joinButton.disabled = this.busy || !isRoomCode(this.codeInput.value);
  }

  // --- room list --------------------------------------------------------------------------------------

  private async openListing(): Promise<void> {
    try {
      const listing = await gameClient().joinOrCreate(ROOM_NAMES.lobby);
      if (this.closed) {
        void listing.leave();
        return;
      }
      this.listing = listing;
      listing.onMessage('rooms', (rooms: unknown) => this.showRooms(setRooms(rooms)));
      listing.onMessage('+', (entry: unknown) => this.showRooms(addRoom(this.rooms, entry)));
      listing.onMessage('-', (roomId: unknown) => this.showRooms(removeRoom(this.rooms, roomId)));
    } catch (err) {
      console.error('[keke] could not open the room list', err);
      if (!this.closed)
        this.roomsNote.textContent = t('play.roomsUnavailable', { message: errorMessage(err) });
    }
  }

  private closeListing(): void {
    this.closed = true;
    void this.listing?.leave();
    this.listing = null;
  }

  private showRooms(rooms: RoomSummary[]): void {
    this.rooms = rooms;
    this.renderRooms();
  }

  private renderRooms(): void {
    if (this.closed) return;
    this.buttons = this.buttons.filter((b) => b.isConnected && !this.roomList.contains(b));
    this.roomList.replaceChildren();
    this.roomsNote.textContent = this.rooms.length === 0 ? t('play.roomsEmpty') : '';
    this.roomsNote.hidden = this.rooms.length > 0;
    for (const room of this.rooms) {
      const join = this.button(t('play.join'), 'secondary', () => void this.joinByCode(room.code));
      join.setAttribute('aria-label', t('play.roomJoin', { code: room.code }));
      join.disabled = this.busy || !isJoinable(room);
      const info = t('play.roomInfo', {
        host: room.hostName,
        // The store the room plays now (P1-5); the default one from a server without the field.
        map: themeFor(room.map).brand.storeName,
        players: room.clients,
        max: room.maxClients,
        phase: t(room.phase === null || room.phase === 'lobby' ? 'play.phase.lobby' : 'play.phase.playing'),
      });
      this.roomList.append(
        h(
          'li',
          { 'data-room-code': room.code },
          h('span', { class: 'code' }, room.code),
          h('span', { class: 'info' }, info),
          join,
        ),
      );
    }
  }
}

function storedSetup(): string | null {
  try {
    return browserStorage()?.getItem(ROOM_SETUP_KEY) ?? null;
  } catch {
    return null;
  }
}

function storeSetup(settings: LobbySettings): void {
  try {
    browserStorage()?.setItem(ROOM_SETUP_KEY, JSON.stringify(settings));
  } catch {
    // Storage off (private mode): the menu starts from the defaults next time.
  }
}
