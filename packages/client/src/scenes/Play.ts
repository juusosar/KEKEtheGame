import type { Room } from '@colyseus/sdk';
import {
  ROOM_CODE_LENGTH,
  ROOM_NAMES,
  isRoomCode,
  loadConfig,
  normalizeRoomCode,
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
import { createMenuLayer, h } from '../ui/dom';

/** Scene that takes over once we're in a room. The Lobby scene (M2-5) replaces the Game stand-in. */
export const AFTER_JOIN_SCENE = 'Game';

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

  constructor() {
    super('Play');
  }

  create(): void {
    this.busy = false;
    this.closed = false;
    this.rooms = [];
    this.buttons = [];
    this.profile = loadProfile(browserStorage(), loadConfig().nicknameMaxLength).profile;
    this.createPanel();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.closeListing());
    void this.openListing();
  }

  private createPanel(): void {
    const layer = createMenuLayer(this, 'play');
    const panel = h('div', { class: 'panel', role: 'region', 'aria-labelledby': 'keke-play-heading' });
    panel.append(h('h2', { id: 'keke-play-heading' }, t('play.heading')));

    const edit = this.button(t('play.editProfile'), 'link', () => this.scene.start('Profile'));
    panel.append(
      h('p', { class: 'muted' }, t('play.playingAs', { name: this.profile.nickname }), ' · ', edit),
    );

    panel.append(this.button(t('play.create'), 'wide', () => void this.create_()));

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
    this.updateJoinEnabled();
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
    try {
      const room = await createGameRoom(gameClient(), this.profile);
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
    this.status.textContent = message;
    this.status.classList.toggle('error', error);
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
