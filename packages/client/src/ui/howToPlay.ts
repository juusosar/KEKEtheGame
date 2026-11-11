// How to play: five illustrated pages (the goal and modes, controls, fighting, store staff and Wanted,
// the second store), drawn with the game's own sprites, key caps and a gamepad diagram rather than
// paragraphs. One component for both places it shows: the How to play screen off the title menu
// (variant 'page') and the first-time tutorial over the lobby (variant 'tutorial').
//
// Selectors for tests:
//   .howto[data-variant]              the panel; role dialog "How to play"
//   role tablist "How to play pages"  one tab per page, button[data-page], aria-selected on the open one
//   #keke-howto-page[data-page]       the open page (role tabpanel)
//   #keke-howto-prev / -next          step back / on ("next" on the last page closes)
//   #keke-howto-close                 close (Back to title / Skip)
//   [data-action] in .howto-keys / .howto-pad   the control diagrams, one entry per §13.3 action
//
// Keys: ←/→ page, Esc closes, Tab/Enter work as usual. Pad: D-pad left/right or LB/RB page, A goes on,
// B or Start closes. The pad is polled here, so it works on screens without the game's InputManager.
import {
  TEAM_COLORS,
  defaultThemeId,
  getTheme,
  getWeaponCatalogue,
  loadConfig,
  type GameConfig,
  type WeaponDef,
} from '@keke/shared';
import { CONTROL_ACTIONS, buttonName, type ControlAction } from '../input/controls';
import { t, type MessageKey } from '../i18n';
import { h } from './dom';
import {
  HOW_TO_PAGES,
  howToKeyCommand,
  howToPadCommands,
  stepPage,
  type HowToCommand,
  type HowToPage,
} from './howToNav';
import { PadEdges } from './menuNav';
import { character, sprite } from './sprite';

export interface HowToPlayOptions {
  /** 'page': the title menu screen; 'tutorial': the first-time card over the lobby. */
  variant: 'page' | 'tutorial';
  /**
   * The values the pages quote (round time, quota, respawn, Wanted): the room's config with the host's
   * rules in the lobby, the shipped config on the title screen.
   */
  config?: GameConfig;
  /** Label of the close button ("Back", "Skip"). */
  closeLabel: string;
  /** Label of "next" on the last page ("Done", "Let's play"). */
  doneLabel: string;
  /** Called once when the player closes the pages (close button, Esc, pad B, or next on the last page). */
  onClose(): void;
  /** Heading over the tabs (default "How to play"). */
  heading?: string;
  /** The player's look, so the illustrations show their own character. */
  look?: { color: string; hat: string | null };
}

const PAGE_TITLE: Record<HowToPage, MessageKey> = {
  goal: 'howto.tab.goal',
  controls: 'howto.tab.controls',
  fight: 'howto.tab.fight',
  staff: 'howto.tab.staff',
  store2: 'howto.tab.store2',
};

const ACTION_LABEL: Record<ControlAction, MessageKey> = {
  move: 'controls.move',
  aim: 'controls.aim',
  attack: 'controls.attack',
  block: 'controls.block',
  interact: 'controls.interact',
  drop: 'controls.drop',
  scoreboard: 'controls.scoreboard',
  menu: 'controls.menu',
};

const SECOND_STORE = 'prisma' as const;

export class HowToPlay {
  readonly root: HTMLDivElement;
  private readonly tabs: HTMLButtonElement[] = [];
  private readonly pages: HTMLElement[] = [];
  private readonly prev: HTMLButtonElement;
  private readonly next: HTMLButtonElement;
  private readonly close: HTMLButtonElement;
  private readonly edges = new PadEdges();
  private padPrimed = false;
  private frame = 0;
  private index = 0;
  private closed = false;
  private readonly look: { color: string; hat: string | null };
  private readonly config: GameConfig;

  constructor(private readonly opts: HowToPlayOptions) {
    this.look = opts.look ?? { color: '#3FA9F5', hat: 'cap' };
    this.config = opts.config ?? loadConfig();
    const heading = h('h2', { id: 'keke-howto-heading' }, opts.heading ?? t('howto.heading'));
    const tablist = h('div', { class: 'howto-tabs', role: 'tablist', 'aria-label': t('howto.tabs') });
    const body = h('div', { class: 'howto-body' });
    HOW_TO_PAGES.forEach((page, i) => {
      const tab = h(
        'button',
        {
          type: 'button',
          role: 'tab',
          id: `keke-howto-tab-${page}`,
          'data-page': page,
          'aria-controls': 'keke-howto-page',
          'aria-selected': 'false',
        },
        h('span', { class: 'howto-tab-num', 'aria-hidden': 'true' }, String(i + 1)),
        t(PAGE_TITLE[page]),
      );
      tab.addEventListener('click', () => this.show(i));
      this.tabs.push(tab);
      tablist.append(tab);
      const content = this.buildPage(page);
      content.hidden = true;
      this.pages.push(content);
      body.append(content);
    });

    this.prev = h('button', { type: 'button', id: 'keke-howto-prev', class: 'secondary' }, t('howto.prev'));
    this.prev.addEventListener('click', () => this.command('prev'));
    this.next = h('button', { type: 'button', id: 'keke-howto-next' }, t('howto.next'));
    this.next.addEventListener('click', () => this.command('next'));
    this.close = h('button', { type: 'button', id: 'keke-howto-close', class: 'secondary' }, opts.closeLabel);
    this.close.addEventListener('click', () => this.command('close'));

    const hint = h(
      'p',
      { class: 'howto-hint muted' },
      glyph('←'),
      glyph('→'),
      ' ',
      padGlyph('LB'),
      padGlyph('RB'),
      ` ${t('howto.hintPage')} · `,
      glyph('Esc'),
      ' ',
      padGlyph('B'),
      ` ${t('howto.hintClose')}`,
    );

    this.root = h(
      'div',
      {
        class: 'howto',
        role: 'dialog',
        'aria-label': t('howto.heading'),
        'data-variant': opts.variant,
      },
      h('div', { class: 'howto-head' }, heading, this.close),
      tablist,
      body,
      h('div', { class: 'howto-foot' }, this.prev, hint, this.next),
    );

    window.addEventListener('keydown', this.onKey);
    this.frame = requestAnimationFrame(this.pollPad);
    this.show(0);
  }

  /** The open page's index. */
  get current(): number {
    return this.index;
  }

  /** Opens page `index` (clamped). */
  show(index: number): void {
    this.index = Math.max(0, Math.min(HOW_TO_PAGES.length - 1, index));
    this.tabs.forEach((tab, i) => {
      const on = i === this.index;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
    });
    this.pages.forEach((page, i) => {
      const on = i === this.index;
      page.hidden = !on;
      if (on) page.id = 'keke-howto-page';
      else page.removeAttribute('id');
    });
    this.prev.disabled = this.index === 0;
    const last = this.index === HOW_TO_PAGES.length - 1;
    this.next.textContent = last ? this.opts.doneLabel : t('howto.next');
    this.next.classList.toggle('done', last);
  }

  /** Puts keyboard focus on the main button, so Enter goes on. */
  focus(): void {
    this.next.focus();
  }

  /** Removes listeners and the element. Safe to call twice. */
  destroy(): void {
    this.closed = true;
    cancelAnimationFrame(this.frame);
    window.removeEventListener('keydown', this.onKey);
    this.root.remove();
  }

  private command(command: HowToCommand): void {
    if (this.closed) return;
    if (command === 'close' || (command === 'next' && this.index === HOW_TO_PAGES.length - 1)) {
      this.destroy();
      this.opts.onClose();
      return;
    }
    this.show(stepPage(this.index, command));
  }

  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.target instanceof HTMLInputElement) return;
    const command = howToKeyCommand(event);
    if (command === null) return;
    event.preventDefault();
    event.stopPropagation();
    this.command(command);
  };

  private readonly pollPad = (): void => {
    if (this.closed) return;
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    const pad = Array.from(pads).find((p) => p !== null && p.connected);
    const pressed = pad ? pad.buttons.map((b) => b.pressed) : [];
    const fresh = this.edges.update(pressed);
    // A button still held from the press that opened these pages must not turn the first page.
    if (this.padPrimed) for (const command of howToPadCommands(fresh)) this.command(command);
    this.padPrimed = true;
    if (!this.closed) this.frame = requestAnimationFrame(this.pollPad);
  };

  // --- pages -------------------------------------------------------------------------------------

  private buildPage(page: HowToPage): HTMLElement {
    const section = h('section', {
      class: `howto-page howto-${page}`,
      role: 'tabpanel',
      'data-page': page,
      'aria-labelledby': `keke-howto-tab-${page}`,
    });
    switch (page) {
      case 'goal':
        section.append(...this.goalPage());
        break;
      case 'controls':
        section.append(...this.controlsPage());
        break;
      case 'fight':
        section.append(...this.fightPage());
        break;
      case 'staff':
        section.append(...this.staffPage());
        break;
      case 'store2':
        section.append(...this.store2Page());
        break;
    }
    return section;
  }

  private me(frame = 'idle_down_0', scale = 2): HTMLSpanElement {
    return character(this.look.color, this.look.hat, frame, scale);
  }

  private goalPage(): HTMLElement[] {
    const cfg = this.config;
    const theme = getTheme(defaultThemeId);
    const target = h(
      'span',
      { class: 'howto-target' },
      sprite('items', 'milk_valio', { size: { w: 24, h: 24 }, scale: 3 }),
    );
    const carrying = h(
      'span',
      { class: 'howto-carry' },
      sprite('items', 'milk_valio', { size: { w: 24, h: 24 }, scale: 2, className: 'carried' }),
      this.me('walk_right_1'),
    );
    const steps = strip(
      step('1', [this.me(), arrowGlyph(), target], t('howto.goal.find')),
      step(
        '2',
        [
          this.me('idle_right_0'),
          sprite('items', 'milk_valio', { size: { w: 24, h: 24 }, scale: 2 }),
          keyCap(buttonName('interact', 'keyboardMouse')),
          padGlyph(buttonName('interact', 'gamepad'), true),
        ],
        t('howto.goal.pickUp'),
      ),
      step(
        '3',
        [carrying, arrowGlyph(), sprite('van', 'slot_1', { size: { w: 64, h: 96 }, scale: 1 })],
        t('howto.goal.bank', { tiles: cfg.depositRangeTiles }),
      ),
      step(
        '4',
        [
          h('span', { class: 'howto-plus' }, '+1'),
          h('span', { class: 'howto-target' }, sprite('items', 'cola', { size: { w: 24, h: 24 }, scale: 3 })),
        ],
        t('howto.goal.again'),
      ),
    );

    const joke = h(
      'p',
      { class: 'howto-note' },
      sprite('items', 'flamingo', { size: { w: 24, h: 24 }, scale: 2, className: 'sparkle' }),
      h('span', {}, t('howto.goal.joke', { points: cfg.jokeItemValue })),
    );

    const clock = h(
      'span',
      { class: 'howto-clock', 'aria-hidden': 'true' },
      formatClock(cfg.timedRoundSeconds),
    );
    const timed = card(
      'timed',
      t('lobby.mode.timed'),
      h(
        'div',
        { class: 'howto-row' },
        clock,
        arrowGlyph(),
        h('span', { class: 'howto-trophy', 'aria-hidden': 'true' }, '1st'),
      ),
      t('howto.mode.timed', { clock: formatClock(cfg.timedRoundSeconds) }),
    );
    const race = card(
      'race',
      t('lobby.mode.race'),
      h(
        'div',
        { class: 'howto-row' },
        h('span', { class: 'howto-quota', 'aria-hidden': 'true' }, `${cfg.raceQuota}/${cfg.raceQuota}`),
        arrowGlyph(),
        sprite('order_box', 'order_box', { scale: 2 }),
        arrowGlyph(),
        h('span', { class: 'howto-office', 'aria-hidden': 'true' }, t('howto.office')),
      ),
      t('howto.mode.race', { quota: cfg.raceQuota }),
    );
    const [red, blue] = TEAM_COLORS;
    const teams = card(
      'teams',
      t('lobby.teamsLabel'),
      h(
        'div',
        { class: 'howto-row' },
        teamMember(red, 'chef'),
        teamMember(red, 'beanie'),
        h('span', { class: 'howto-vs', 'aria-hidden': 'true' }, 'vs'),
        teamMember(blue, 'cap'),
        teamMember(blue, 'hardhat'),
      ),
      t('howto.mode.teams'),
    );
    const points = cfg.placementPoints.join(', ');
    return [
      h('h3', {}, t('howto.goal.heading', { store: theme.brand.storeName })),
      steps,
      h('div', { class: 'howto-cards three' }, timed, race, teams),
      h(
        'div',
        { class: 'howto-notes' },
        joke,
        h('p', { class: 'howto-note' }, podium(), h('span', {}, t('howto.goal.session', { points }))),
      ),
    ];
  }

  private controlsPage(): HTMLElement[] {
    return [
      h('h3', {}, t('howto.controls.heading')),
      h('div', { class: 'howto-cards two' }, this.keyboardDiagram(), this.padDiagram()),
      h('p', { class: 'howto-note muted' }, t('howto.controls.note')),
    ];
  }

  private keyboardDiagram(): HTMLElement {
    const label = (action: ControlAction): string => t(ACTION_LABEL[action]);
    const key = (action: ControlAction, text: string, extra = ''): HTMLElement =>
      h(
        'span',
        { class: `howto-key ${extra}`.trim(), 'data-action': action, title: label(action) },
        h('kbd', {}, text),
        h('small', {}, label(action)),
      );
    const move = buttonName('move', 'keyboardMouse').split('');
    // A real keyboard's corner: Esc and Tab on the left, Q W E over A S D.
    const keys = h(
      'div',
      { class: 'howto-keys' },
      key('menu', buttonName('menu', 'keyboardMouse'), 'k-esc'),
      key('drop', buttonName('drop', 'keyboardMouse'), 'k-q'),
      key('move', move[0] ?? 'W', 'k-w move'),
      key('interact', buttonName('interact', 'keyboardMouse'), 'k-e'),
      key('scoreboard', buttonName('scoreboard', 'keyboardMouse'), 'k-tab'),
      key('move', move[1] ?? 'A', 'k-a move'),
      key('move', move[2] ?? 'S', 'k-s move'),
      key('move', move[3] ?? 'D', 'k-d move'),
    );
    const mouse = h(
      'div',
      { class: 'howto-mouse' },
      mouseSvg(),
      h(
        'span',
        { class: 'm-left', 'data-action': 'attack' },
        h('b', {}, t('howto.mouse.left')),
        ' ',
        label('attack'),
      ),
      h(
        'span',
        { class: 'm-right', 'data-action': 'block' },
        h('b', {}, t('howto.mouse.right')),
        ' ',
        label('block'),
      ),
      h(
        'span',
        { class: 'm-aim', 'data-action': 'aim' },
        h('b', {}, t('howto.mouse.move')),
        ' ',
        label('aim'),
      ),
    );
    return card('keyboard', t('controls.keyboardMouse'), h('div', { class: 'howto-kbm' }, keys, mouse));
  }

  private padDiagram(): HTMLElement {
    const label = (action: ControlAction): string => t(ACTION_LABEL[action]);
    const list = h('ul', { class: 'howto-pad-list' });
    for (const action of CONTROL_ACTIONS) {
      list.append(
        h(
          'li',
          { 'data-action': action },
          padGlyph(buttonName(action, 'gamepad')),
          h('span', {}, label(action)),
        ),
      );
    }
    return card('gamepad', t('controls.gamepad'), h('div', { class: 'howto-pad' }, padSvg(label), list));
  }

  private fightPage(): HTMLElement[] {
    const cfg = this.config;
    const groups = new Map<string, WeaponDef[]>();
    for (const weapon of getWeaponCatalogue().rollable) {
      const kind = weapon.behaviour === 'shot_then_melee' ? 'thrown' : weapon.behaviour;
      groups.set(kind, [...(groups.get(kind) ?? []), weapon]);
    }
    const kindLabel: Record<string, MessageKey> = {
      melee: 'howto.weapons.melee',
      thrown: 'howto.weapons.thrown',
      spray: 'howto.weapons.spray',
      trap: 'howto.weapons.trap',
      charge: 'howto.weapons.charge',
    };
    const weapons = h('div', { class: 'howto-weapons' });
    for (const [kind, list] of groups) {
      const label = kindLabel[kind];
      weapons.append(
        h(
          'div',
          { class: 'howto-weapon-group', 'data-kind': kind },
          h('small', {}, label ? t(label) : kind),
          h(
            'div',
            { class: 'howto-row' },
            ...list.map((w) =>
              h(
                'span',
                { class: 'howto-weapon', title: t(`weapon.${w.id}` as MessageKey) },
                sprite('weapons', w.id, { scale: 2 }),
              ),
            ),
          ),
        ),
      );
    }

    const roll = strip(
      step(
        '1',
        [
          sprite('items', 'milk_valio', { size: { w: 24, h: 24 }, scale: 2 }),
          arrowGlyph(),
          h('span', { class: 'howto-dice', 'aria-hidden': 'true' }, '?'),
          arrowGlyph(),
          sprite('weapons', 'frozen_salmon', { scale: 2 }),
        ],
        t('howto.fight.roll'),
      ),
      step(
        '2',
        [
          mouseSvg('left'),
          padGlyph(buttonName('attack', 'gamepad'), true),
          sprite('fx', 'hit_spark', { scale: 2 }),
        ],
        t('howto.fight.attack'),
      ),
      step(
        '3',
        [
          mouseSvg('right'),
          padGlyph(buttonName('block', 'gamepad'), true),
          sprite('weapons', 'cast_iron_pan', { scale: 2 }),
        ],
        t('howto.fight.block'),
      ),
    );
    const ko = strip(
      step(
        '',
        [
          h('span', { class: 'howto-hp', 'aria-hidden': 'true' }, h('span', {})),
          arrowGlyph(),
          h(
            'span',
            { class: 'howto-ko' },
            this.me('ko_down_0'),
            sprite('fx', 'ko_stars', { scale: 2, className: 'stars' }),
          ),
        ],
        t('howto.fight.ko'),
      ),
      step(
        '',
        [
          sprite('items', 'milk_valio', { size: { w: 24, h: 24 }, scale: 2, className: 'dropped' }),
          h('span', { class: 'howto-drop-arrow', 'aria-hidden': 'true' }, '↓'),
        ],
        t('howto.fight.drops'),
      ),
      step(
        '',
        [sprite('van', 'slot_1', { size: { w: 64, h: 96 }, scale: 0.75 }), this.me()],
        t('howto.fight.respawn', { seconds: cfg.respawnSeconds }),
      ),
    );
    return [
      h('h3', {}, t('howto.fight.heading')),
      roll,
      weapons,
      h('p', { class: 'howto-note muted' }, t('howto.fight.wear')),
      h('h3', {}, t('howto.fight.koHeading')),
      ko,
    ];
  }

  private staffPage(): HTMLElement[] {
    const cfg = this.config;
    const staff = h(
      'div',
      { class: 'howto-cards four' },
      card(
        'stocker',
        t('howto.staff.stocker'),
        sprite('stocker', 'walk_down_1', { scale: 2 }),
        t('howto.staff.stockerText'),
      ),
      card(
        'security',
        t('howto.staff.guard'),
        sprite('security', 'idle_down_0', { scale: 2 }),
        t('howto.staff.guardText'),
      ),
      card(
        'butcher',
        t('howto.staff.butcher'),
        sprite('butcher', 'attack_down_1', { scale: 2 }),
        t('howto.staff.butcherText'),
      ),
      card(
        'forklift',
        t('howto.staff.forklift'),
        sprite('forklift', 'drive_right_0', { size: { w: 64, h: 32 }, scale: 2 }),
        t('howto.staff.forkliftText'),
      ),
    );
    const wantedBadge = h('span', { class: 'howto-wanted', 'aria-hidden': 'true' }, t('howto.wanted.badge'));
    const wanted = strip(
      step(
        '',
        [
          this.me('attack_right_1'),
          sprite('fx', 'hit_spark', { scale: 1 }),
          sprite('stocker', 'hit_left_0', { scale: 2 }),
        ],
        t('howto.wanted.hitWorker'),
      ),
      step(
        '',
        [
          sprite('security', 'idle_down_0', { scale: 2 }),
          h('span', { class: 'howto-alert', 'aria-hidden': 'true' }, '!'),
          this.me('attack_right_0'),
        ],
        t('howto.wanted.seen'),
      ),
      step(
        '',
        [h('span', { class: 'howto-staffonly', 'aria-hidden': 'true' }, t('howto.wanted.staffOnly'))],
        t('howto.wanted.enter'),
      ),
    );
    const chase = strip(
      step(
        '',
        [wantedBadge, h('span', { class: 'howto-timer', 'aria-hidden': 'true' }, `${cfg.wantedSeconds} s`)],
        t('howto.wanted.lasts', { seconds: cfg.wantedSeconds }),
      ),
      step(
        '',
        [
          this.me('walk_right_2'),
          sprite('security', 'walk_right_1', { scale: 2 }),
          sprite('security', 'walk_right_3', { scale: 2 }),
        ],
        t('howto.wanted.chase'),
      ),
      step(
        '',
        [this.me('ko_down_0'), arrowGlyph(), h('span', { class: 'howto-clear', 'aria-hidden': 'true' }, '✓')],
        t('howto.wanted.ends'),
      ),
    );
    return [
      h('h3', {}, t('howto.staff.heading')),
      staff,
      h('h3', {}, t('howto.wanted.heading')),
      h('p', { class: 'howto-note muted' }, t('howto.wanted.how')),
      wanted,
      chase,
    ];
  }

  private store2Page(): HTMLElement[] {
    const cfg = this.config;
    const store = getTheme(SECOND_STORE);
    const oven = h(
      'span',
      { class: 'howto-oven' },
      h('span', { class: 'heat', 'aria-hidden': 'true' }),
      sprite('items', 'cinnamon_buns', { size: { w: 24, h: 24 }, scale: 2 }),
    );
    const cards = h(
      'div',
      { class: 'howto-cards four' },
      card(
        'gates',
        t('howto.store2.gates'),
        h(
          'div',
          { class: 'howto-row' },
          sprite('gate_prisma', 'closed_s', { scale: 2 }),
          arrowGlyph('↓'),
          sprite('gate_prisma', 'open_s', { scale: 2 }),
        ),
        t('howto.store2.gatesText', { stop: cfg.gateStopSeconds, carry: cfg.gateCarryStopSeconds }),
      ),
      card('oven', t('howto.store2.oven'), oven, t('howto.store2.ovenText')),
      card(
        'customers',
        t('howto.store2.customers'),
        h(
          'div',
          { class: 'howto-row tight' },
          sprite('customer', 'walk_down_1', { scale: 2 }),
          sprite('customer_3', 'idle_down_0', { scale: 2 }),
          sprite('customer_5', 'walk_left_2', { scale: 2 }),
        ),
        t('howto.store2.customersText'),
      ),
      card(
        'carts',
        t('howto.store2.carts'),
        h(
          'div',
          { class: 'howto-row' },
          this.me('walk_right_1'),
          sprite('cart_prisma', 'cart_right', { scale: 2 }),
        ),
        t('howto.store2.cartsText'),
      ),
    );
    const lot = h(
      'p',
      { class: 'howto-note' },
      sprite('van_prisma', 'slot_7', { size: { w: 64, h: 96 }, scale: 0.6 }),
      h('span', {}, t('howto.store2.lot', { store: store.brand.storeName })),
    );
    const section = [h('h3', {}, t('howto.store2.heading', { store: store.brand.storeName })), cards, lot];
    for (const el of section) el.style.setProperty('--keke-accent', store.colors.primary);
    return section;
  }
}

// --- small builders ---------------------------------------------------------------------------------

function strip(...steps: HTMLElement[]): HTMLElement {
  return h('ol', { class: 'howto-strip' }, ...steps);
}

function step(num: string, art: (Node | string)[], caption: string): HTMLElement {
  return h(
    'li',
    { class: 'howto-step' },
    num === '' ? null : h('span', { class: 'howto-step-num', 'aria-hidden': 'true' }, num),
    h('div', { class: 'howto-art' }, ...art),
    h('p', {}, caption),
  );
}

function card(id: string, title: string, art: HTMLElement, caption?: string): HTMLElement {
  return h(
    'div',
    { class: 'howto-card', 'data-card': id },
    h('h4', {}, title),
    h('div', { class: 'howto-art' }, art),
    caption === undefined ? null : h('p', {}, caption),
  );
}

function keyCap(text: string): HTMLElement {
  return h('kbd', { class: 'howto-cap' }, text);
}

function glyph(text: string): HTMLElement {
  return h('kbd', {}, text);
}

/** A gamepad button glyph: face buttons in their usual colours, the rest as pills. */
export function padGlyph(name: string, big = false): HTMLElement {
  const face = ['A', 'B', 'X', 'Y'].includes(name);
  const cls = face ? `pad pad-face pad-${name.toLowerCase()}` : 'pad';
  return h('kbd', { class: big ? `${cls} big` : cls }, name);
}

function arrowGlyph(text = '→'): HTMLElement {
  return h('span', { class: 'howto-arrow', 'aria-hidden': 'true' }, text);
}

function teamMember(color: string, hat: string): HTMLElement {
  const el = character(color, hat);
  el.classList.add('team');
  el.style.setProperty('--team', color);
  return el;
}

function podium(): HTMLElement {
  return h(
    'span',
    { class: 'howto-podium', 'aria-hidden': 'true' },
    h('span', { class: 'p2' }, '2'),
    h('span', { class: 'p1' }, '1'),
    h('span', { class: 'p3' }, '3'),
  );
}

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(
  tag: string,
  attrs: Record<string, string | number>,
  ...children: (Node | string)[]
): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const child of children) el.append(child);
  return el;
}

/** A mouse; with `only`, just that button is coloured (the small icons in the Fighting steps). */
function mouseSvg(only?: 'left' | 'right'): SVGElement {
  return svg(
    'svg',
    {
      viewBox: '0 0 60 90',
      class: only === undefined ? 'howto-mouse-svg' : `howto-mouse-svg small only-${only}`,
      'aria-hidden': 'true',
    },
    svg('rect', { x: 4, y: 4, width: 52, height: 82, rx: 26, class: 'body' }),
    svg('path', { d: 'M30 4 A26 26 0 0 0 4 30 L4 36 L29 36 L29 4 Z', class: 'btn left' }),
    svg('path', { d: 'M31 4 A26 26 0 0 1 56 30 L56 36 L31 36 L31 4 Z', class: 'btn right' }),
    svg('rect', { x: 27, y: 12, width: 6, height: 14, rx: 3, class: 'wheel' }),
  );
}

/** A standard-layout pad with each control labelled with its action. */
function padSvg(label: (action: ControlAction) => string): SVGElement {
  const text = (x: number, y: number, s: string, anchor = 'middle'): SVGElement =>
    svg('text', { x, y, 'text-anchor': anchor, class: 'lbl' }, s);
  const name = (action: ControlAction): string => buttonName(action, 'gamepad');
  return svg(
    'svg',
    { viewBox: '-12 0 352 190', class: 'howto-pad-svg', 'aria-hidden': 'true' },
    // Triggers.
    svg('rect', { x: 62, y: 30, width: 54, height: 20, rx: 8, class: 'trigger' }),
    svg('rect', { x: 204, y: 30, width: 54, height: 20, rx: 8, class: 'trigger' }),
    text(89, 45, name('block'), 'middle'),
    text(231, 45, name('attack'), 'middle'),
    text(89, 22, label('block')),
    text(231, 22, label('attack')),
    // Body.
    svg('path', {
      d: 'M70 52 H250 C285 52 300 90 306 130 C312 168 290 182 270 168 L236 140 H84 L50 168 C30 182 8 168 14 130 C20 90 35 52 70 52 Z',
      class: 'body',
    }),
    // Sticks.
    svg('circle', { cx: 86, cy: 88, r: 17, class: 'stick' }),
    svg('circle', { cx: 196, cy: 122, r: 17, class: 'stick' }),
    text(86, 93, 'L'),
    text(196, 127, 'R'),
    // D-pad (unused in a round, pages menus).
    svg('path', { d: 'M118 112 h10 v10 h10 v10 h-10 v10 h-10 v-10 h-10 v-10 h10 Z', class: 'dpad' }),
    // Face buttons.
    svg('circle', { cx: 238, cy: 104, r: 9, class: 'face a' }),
    svg('circle', { cx: 256, cy: 86, r: 9, class: 'face b' }),
    svg('circle', { cx: 220, cy: 86, r: 9, class: 'face x' }),
    svg('circle', { cx: 238, cy: 68, r: 9, class: 'face y' }),
    text(238, 108, 'A'),
    text(256, 90, 'B'),
    text(220, 90, 'X'),
    text(238, 72, 'Y'),
    // View and Start.
    svg('rect', { x: 136, y: 76, width: 14, height: 8, rx: 4, class: 'small' }),
    svg('rect', { x: 170, y: 76, width: 14, height: 8, rx: 4, class: 'small' }),
    // Callouts.
    text(40, 92, label('move'), 'end'),
    text(196, 160, label('aim')),
    text(270, 112, label('interact'), 'start'),
    text(270, 82, label('drop'), 'start'),
    text(143, 70, label('scoreboard'), 'end'),
    text(177, 70, label('menu'), 'start'),
  );
}
