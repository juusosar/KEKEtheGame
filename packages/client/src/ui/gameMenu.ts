// The in-game menu (§13.3 Menu = Esc / Start; M7 review F5), an HTML layer over the game like the HUD.
// KEKE is multiplayer, so the menu never pauses anything: the round keeps running and the Game scene
// sends idle input frames while it is open. It holds Resume, the sound settings, the §13.3 controls
// table (the last-used device's column is marked) and Leave room behind a confirmation.
//
// Selectors for tests:
//   #keke-game-menu                 the layer; hidden while closed. <body data-menu="open"> while open
//   role dialog "Menu"              the panel
//   #keke-game-menu-resume          Resume
//   role group "Sound"              volume sliders and mute (shared with the corner control, audioControl.ts)
//   #keke-game-menu-controls        table "Controls", data-device keyboardMouse|gamepad,
//                                   tr[data-action] with td.kbm and td.pad; td.current is the live device
//   #keke-game-menu-leave           Leave room (offline walk mode: Back to title)
//   #keke-game-menu-confirm         role group "Leave the room?" with Leave (#keke-game-menu-confirm-leave)
//                                   and Stay (#keke-game-menu-stay)
//
// Keys: Esc opens and goes back one step; Tab / arrows move focus (the game captures Tab). Pad: Start
// opens and goes back, B back, A presses, D-pad up/down moves focus, left/right moves a slider by 5.
import { defaultThemeId, getTheme, type MapTheme } from '@keke/shared';
import { CONTROL_ACTIONS, buttonName } from '../input/controls';
import type { InputDevice } from '../input/device';
import { t, type MessageKey } from '../i18n';
import { audioFields } from './audioControl';
import { h } from './dom';
import { PadEdges, keyCommand, padCommands, stepIndex, type MenuCommand } from './menuNav';

/** Slider step for pad left/right, in the sliders' 0..100 units. */
const SLIDER_STEP = 5;

export interface GameMenuOptions {
  /** Label of the leave button: "Leave room" in a room, "Back to title" in offline walk mode. */
  leaveLabel: string;
  /** The confirmation question. */
  confirmText: string;
  /** Called once when the player confirms leaving. */
  onLeave(): void;
  /** The last-used device, for the controls table. */
  device: InputDevice;
  /** Subscribes to device changes; returns an unsubscribe function. */
  onDeviceChange(listener: (device: InputDevice) => void): () => void;
  /** The room's map (P1 review F2): its primary colour is the menu accent. Default: the first map. */
  theme?: MapTheme;
}

export class GameMenu {
  readonly root: HTMLDivElement;
  private readonly main: HTMLDivElement;
  private readonly confirm: HTMLDivElement;
  private readonly resume: HTMLButtonElement;
  private readonly leave: HTMLButtonElement;
  private readonly stay: HTMLButtonElement;
  private readonly controls: HTMLTableElement;
  private readonly edges = new PadEdges();
  private readonly cleanup: (() => void)[] = [];
  private left = false;

  constructor(private readonly opts: GameMenuOptions) {
    this.resume = h('button', { type: 'button', id: 'keke-game-menu-resume' }, t('menu.resume'));
    this.resume.addEventListener('click', () => this.close());

    const sound = audioFields();
    this.cleanup.push(sound.dispose);
    const soundGroup = h(
      'section',
      { class: 'game-menu-sound', role: 'group', 'aria-label': t('audio.panel') },
      h('h3', {}, t('audio.panel')),
      ...sound.elements,
    );

    this.controls = this.buildControls();
    const leaveButton = h(
      'button',
      { type: 'button', id: 'keke-game-menu-leave', class: 'secondary' },
      opts.leaveLabel,
    );
    leaveButton.addEventListener('click', () => this.showConfirm(true));
    this.main = h(
      'div',
      { class: 'game-menu-main' },
      this.resume,
      soundGroup,
      h('section', { class: 'game-menu-controls' }, h('h3', {}, t('menu.controls')), this.controls),
      leaveButton,
    );

    this.leave = h('button', { type: 'button', id: 'keke-game-menu-confirm-leave' }, t('menu.leaveConfirm'));
    this.leave.addEventListener('click', () => this.doLeave());
    this.stay = h(
      'button',
      { type: 'button', id: 'keke-game-menu-stay', class: 'secondary' },
      t('menu.stay'),
    );
    this.stay.addEventListener('click', () => this.showConfirm(false));
    this.confirm = h(
      'div',
      {
        id: 'keke-game-menu-confirm',
        class: 'game-menu-confirm',
        role: 'group',
        'aria-label': t('menu.leaveQuestion'),
        hidden: true,
      },
      h('p', {}, opts.confirmText),
      h('div', { class: 'actions' }, this.leave, this.stay),
    );

    const panel = h(
      'div',
      { class: 'game-menu-panel', role: 'dialog', 'aria-modal': true, 'aria-label': t('menu.title') },
      h('h2', {}, t('menu.title')),
      h('p', { class: 'game-menu-note' }, t('menu.note')),
      this.main,
      this.confirm,
    );
    this.root = h('div', { id: 'keke-game-menu', class: 'keke-game-menu', hidden: true }, panel);
    this.root.style.setProperty('--keke-accent', (opts.theme ?? getTheme(defaultThemeId)).colors.primary);
    // A click on the dimmed backdrop (not the panel) resumes.
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.close();
    });

    // Capture phase on window: runs before Phaser's keyboard listener and before the corner sound
    // control's own Esc handling, which keeps its Esc (it closes that panel instead).
    const onKey = (e: KeyboardEvent): void => {
      if (e.target instanceof Node && document.getElementById('keke-audio')?.contains(e.target)) return;
      const command = keyCommand(e, this.isOpen);
      if (command === null) return;
      e.preventDefault();
      e.stopPropagation();
      this.command(command);
    };
    window.addEventListener('keydown', onKey, true);
    this.cleanup.push(() => window.removeEventListener('keydown', onKey, true));
    this.cleanup.push(opts.onDeviceChange((device) => this.setDevice(device)));
    this.setDevice(opts.device);

    document.body.appendChild(this.root);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    if (this.isOpen || this.left) return;
    this.showConfirm(false);
    this.root.hidden = false;
    document.body.dataset['menu'] = 'open';
    this.resume.focus();
  }

  close(): void {
    if (!this.isOpen) return;
    this.root.hidden = true;
    delete document.body.dataset['menu'];
    // Enter / Space must not press a menu button that kept focus once the menu is gone.
    if (document.activeElement instanceof HTMLElement && this.root.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    this.edges.reset();
  }

  /** Feeds the pad's pressed flags (index = standard button) once per frame. */
  pollPad(pressed: readonly boolean[] | null): void {
    if (pressed === null) {
      this.edges.reset();
      return;
    }
    for (const command of padCommands(this.edges.update(pressed), this.isOpen)) this.command(command);
  }

  command(command: MenuCommand): void {
    if (command === 'menu' && !this.isOpen) {
      this.open();
      return;
    }
    if (!this.isOpen) return;
    switch (command) {
      case 'menu':
      case 'back':
        if (!this.confirm.hidden) this.showConfirm(false);
        else this.close();
        return;
      case 'prev':
      case 'next':
        this.moveFocus(command === 'next' ? 1 : -1);
        return;
      case 'dec':
      case 'inc':
        this.nudge(command === 'inc' ? SLIDER_STEP : -SLIDER_STEP);
        return;
      case 'activate': {
        const el = document.activeElement;
        if (
          el instanceof HTMLElement &&
          this.root.contains(el) &&
          !(el instanceof HTMLInputElement && el.type === 'range')
        ) {
          el.click();
        }
        return;
      }
    }
  }

  destroy(): void {
    for (const off of this.cleanup) off();
    this.cleanup.length = 0;
    this.root.remove();
    delete document.body.dataset['menu'];
  }

  private buildControls(): HTMLTableElement {
    const rows = CONTROL_ACTIONS.map((action) =>
      h(
        'tr',
        { 'data-action': action },
        h('th', { scope: 'row' }, t(`controls.${action}` as MessageKey)),
        h('td', { class: 'kbm' }, h('kbd', {}, buttonName(action, 'keyboardMouse'))),
        h('td', { class: 'pad' }, h('kbd', {}, buttonName(action, 'gamepad'))),
      ),
    );
    return h(
      'table',
      { id: 'keke-game-menu-controls', 'aria-label': t('menu.controls') },
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', { scope: 'col' }, t('controls.action')),
          h('th', { scope: 'col', class: 'kbm' }, t('controls.keyboardMouse')),
          h('th', { scope: 'col', class: 'pad' }, t('controls.gamepad')),
        ),
      ),
      h('tbody', {}, ...rows),
    );
  }

  private setDevice(device: InputDevice): void {
    this.controls.dataset['device'] = device;
    const current = device === 'gamepad' ? 'pad' : 'kbm';
    for (const cell of this.controls.querySelectorAll<HTMLElement>('.kbm, .pad')) {
      cell.classList.toggle('current', cell.classList.contains(current));
    }
  }

  private showConfirm(show: boolean): void {
    this.confirm.hidden = !show;
    this.main.hidden = show;
    if (this.isOpen) (show ? this.stay : this.resume).focus();
  }

  private doLeave(): void {
    if (this.left) return;
    this.left = true;
    this.close();
    this.opts.onLeave();
  }

  private focusables(): HTMLElement[] {
    const step = this.confirm.hidden ? this.main : this.confirm;
    return [...step.querySelectorAll<HTMLElement>('button, input')].filter((el) => !el.closest('[hidden]'));
  }

  private moveFocus(delta: number): void {
    const list = this.focusables();
    const index = stepIndex(list.indexOf(document.activeElement as HTMLElement), list.length, delta);
    list[index]?.focus();
  }

  private nudge(delta: number): void {
    const el = document.activeElement;
    if (!(el instanceof HTMLInputElement) || el.type !== 'range' || !this.root.contains(el)) return;
    el.value = String(Math.min(Number(el.max), Math.max(Number(el.min), Number(el.value) + delta)));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
