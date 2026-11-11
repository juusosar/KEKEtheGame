// Bot players picker (host settings `bots`, `botLevel`): a − count + stepper and an Easy / Normal / Hard
// choice. Used by the room setup menu (Play) and the lobby. It only shows and edits values; the owner
// keeps them (setup menu) or sends them to the server (lobby).
import { BOT_LEVELS, type BotLevel } from '@keke/shared';
import { t, type MessageKey } from '../i18n';
import { h } from './dom';

export const BOT_LEVEL_LABEL: Record<BotLevel, MessageKey> = {
  easy: 'lobby.botLevel.easy',
  normal: 'lobby.botLevel.normal',
  hard: 'lobby.botLevel.hard',
};

export interface BotPickerOptions {
  /** Most bots the room can hold (`maxBots(config)`). */
  max: number;
  /** Prefix for element ids, so two pickers never share one. */
  idPrefix: string;
  onChange: (change: { bots?: number; botLevel?: BotLevel }) => void;
}

export class BotPicker {
  /** Label + stepper, then label + level choice; append to a `.settings` grid. */
  readonly elements: HTMLElement[];
  private readonly input: HTMLInputElement;
  private readonly lower: HTMLButtonElement;
  private readonly raise: HTMLButtonElement;
  private readonly levels = new Map<BotLevel, HTMLButtonElement>();
  private bots = 0;

  constructor(private readonly opts: BotPickerOptions) {
    const id = `${opts.idPrefix}-count`;
    this.input = h('input', {
      type: 'number',
      id,
      min: 0,
      max: opts.max,
      step: 1,
      inputmode: 'numeric',
      'data-bots-input': 'true',
    });
    this.lower = h('button', { type: 'button', class: 'step', 'aria-label': t('lobby.botsLower') }, '−');
    this.raise = h('button', { type: 'button', class: 'step', 'aria-label': t('lobby.botsRaise') }, '+');
    this.lower.addEventListener('click', () => this.change(this.bots - 1));
    this.raise.addEventListener('click', () => this.change(this.bots + 1));
    this.input.addEventListener('change', () => {
      const n = Number(this.input.value);
      this.change(Number.isFinite(n) && this.input.value.trim() !== '' ? Math.round(n) : this.bots);
    });

    const levels = h('div', {
      class: 'choice',
      role: 'group',
      'aria-label': t('lobby.botLevelLabel'),
      id: `${opts.idPrefix}-level`,
    });
    for (const level of BOT_LEVELS) {
      const button = h('button', { type: 'button', 'data-bot-level': level }, t(BOT_LEVEL_LABEL[level]));
      button.addEventListener('click', () => opts.onChange({ botLevel: level }));
      this.levels.set(level, button);
      levels.append(button);
    }

    this.elements = [
      h('label', { for: id }, t('lobby.botsLabel')),
      h('span', { class: 'rule-input bots-input' }, this.lower, this.input, this.raise),
      h('label', {}, t('lobby.botLevelLabel')),
      levels,
    ];
  }

  /** Shows the values; `enabled` false (not the host) leaves them visible without working controls. */
  set(bots: number, botLevel: BotLevel, enabled: boolean): void {
    this.bots = bots;
    if (document.activeElement !== this.input || !enabled) this.input.value = String(bots);
    this.input.readOnly = !enabled;
    this.lower.disabled = !enabled || bots <= 0;
    this.raise.disabled = !enabled || bots >= this.opts.max;
    for (const [level, button] of this.levels) {
      button.setAttribute('aria-pressed', String(level === botLevel));
      button.disabled = !enabled;
    }
  }

  private change(n: number): void {
    const bots = Math.max(0, Math.min(this.opts.max, n));
    this.input.value = String(bots);
    if (bots !== this.bots) this.opts.onChange({ bots });
  }
}
