// The in-round HUD (§13.2), drawn as HTML over the canvas like the menus (ui/dom.ts): crisp text at any
// zoom, and e2e specs find each part by id or role instead of reading pixels.
//
//   #keke-hud            root, pointer-events none
//   #keke-hud-arrow      target arrow at the screen edge (data-kind target|van)
//   #keke-hud-target     target card: icon, name, description, zone
//   #keke-hud-carry      carry slot
//   #keke-hud-timer      round timer, role timer, data-seconds
//   #keke-hud-scores     mini scoreboard (top 5 + you): li[data-player-id][data-place][data-points]
//   #keke-hud-board      full scoreboard while Tab / pad View is held: tr[data-player-id]
//   #keke-hud-feed       event feed, role log
//
// Layout: target + carry top-left, timer top-centre, scores and feed top-right, minimap (M3-8) owns the
// bottom-right corner. The Game scene owns one Hud and feeds it from state patches and item events.
import type { Vec2 } from '@keke/shared';
import { renderConfig } from '../game/renderConfig';
import { t, type MessageKey } from '../i18n';
import { h } from '../ui/dom';
import { placeArrow } from './edgeArrow';
import type { FeedLine } from './feed';
import { formatClock, miniRows, type HudItem, type HudModel, type HudPlayerRow } from './hudState';

export interface HudDeps {
  /** Image URL for an `items` atlas frame, or null when it cannot be drawn. */
  iconFor(sprite: string): string | null;
}

interface FeedEntry {
  el: HTMLLIElement;
  expires: number;
}

/** Zone label for the target card; unknown zones show their id. */
function zoneLabel(zone: string): string {
  return zone === '' ? '' : t(`zone.${zone}` as MessageKey);
}

export class Hud {
  readonly root: HTMLDivElement;
  private readonly arrow: HTMLDivElement;
  private readonly target: HTMLElement;
  private readonly targetIcon: HTMLImageElement;
  private readonly targetName: HTMLElement;
  private readonly targetDesc: HTMLElement;
  private readonly targetZone: HTMLElement;
  private readonly carry: HTMLElement;
  private readonly carryIcon: HTMLImageElement;
  private readonly carryName: HTMLElement;
  private readonly timer: HTMLElement;
  private readonly scores: HTMLOListElement;
  private readonly board: HTMLElement;
  private readonly boardBody: HTMLTableSectionElement;
  private readonly boardHead: HTMLTableRowElement;
  private readonly feed: HTMLOListElement;
  private feedEntries: FeedEntry[] = [];
  private model: HudModel | null = null;
  private scoresKey = '';
  private boardKey = '';
  private boardOpen = false;

  constructor(private readonly deps: HudDeps) {
    this.arrow = h('div', { id: 'keke-hud-arrow', class: 'hud-arrow', role: 'img', hidden: true });

    this.targetIcon = h('img', { class: 'hud-icon', alt: '' });
    this.targetName = h('strong', { class: 'hud-name' });
    this.targetDesc = h('span', { class: 'hud-desc' });
    this.targetZone = h('span', { class: 'hud-zone' });
    this.target = h(
      'section',
      { id: 'keke-hud-target', class: 'hud-card', 'aria-label': t('hud.target'), hidden: true },
      this.targetIcon,
      h('div', { class: 'hud-text' }, this.targetName, this.targetDesc, this.targetZone),
    );

    this.carryIcon = h('img', { class: 'hud-icon', alt: '' });
    this.carryName = h('span', { class: 'hud-name' });
    this.carry = h(
      'section',
      { id: 'keke-hud-carry', class: 'hud-carry', 'aria-label': t('hud.carry'), hidden: true },
      h('div', { class: 'hud-slot' }, this.carryIcon),
      h('div', { class: 'hud-text' }, h('span', { class: 'hud-label' }, t('hud.carry')), this.carryName),
    );

    this.timer = h('div', {
      id: 'keke-hud-timer',
      class: 'hud-timer',
      role: 'timer',
      'aria-label': t('hud.timer'),
      hidden: true,
    });

    this.scores = h('ol', { id: 'keke-hud-scores', class: 'hud-scores', 'aria-label': t('hud.scores') });
    this.feed = h('ol', { id: 'keke-hud-feed', class: 'hud-feed', role: 'log', 'aria-label': t('hud.feed') });

    this.boardHead = h('tr');
    this.boardBody = h('tbody');
    this.board = h(
      'section',
      {
        id: 'keke-hud-board',
        class: 'hud-board',
        role: 'dialog',
        'aria-label': t('hud.board'),
        hidden: true,
      },
      h('h2', {}, t('hud.board')),
      h('table', {}, h('thead', {}, this.boardHead), this.boardBody),
    );

    this.root = h(
      'div',
      { id: 'keke-hud', class: 'keke-hud', 'aria-label': t('hud.label') },
      h('div', { class: 'hud-left' }, this.target, this.carry),
      this.timer,
      h('div', { class: 'hud-right' }, this.scores, this.feed),
      this.board,
      this.arrow,
    );
    document.body.appendChild(this.root);
  }

  /** Every state patch. */
  render(model: HudModel): void {
    this.model = model;
    this.renderTarget(model.target);
    this.renderCarry(model);
    this.renderTimer(model.secondsLeft);
    this.renderScores(model);
    if (this.boardOpen) this.renderBoard(model);
  }

  /**
   * Every frame: puts the arrow on the screen edge (or above the destination when it is in view).
   * `toScreen` maps world pixels to CSS pixels in the viewport.
   */
  updateArrow(toScreen: (world: Vec2) => Vec2, size: { width: number; height: number }): void {
    const dest = this.model?.arrow ?? null;
    if (dest === null) {
      this.arrow.hidden = true;
      return;
    }
    const at = placeArrow(
      size,
      toScreen(dest.at),
      renderConfig.hudArrowMarginPx,
      renderConfig.hudArrowHoverPx,
    );
    this.arrow.hidden = false;
    if (this.arrow.dataset['kind'] !== dest.kind) {
      this.arrow.dataset['kind'] = dest.kind;
      this.arrow.setAttribute('aria-label', t(dest.kind === 'van' ? 'hud.arrow.van' : 'hud.arrow.target'));
    }
    this.arrow.dataset['onScreen'] = String(at.onScreen);
    this.arrow.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px) rotate(${at.angle.toFixed(3)}rad)`;
  }

  /** Shows the full scoreboard while Tab / pad View is held (§13.3). */
  setBoardOpen(open: boolean): void {
    if (open === this.boardOpen) return;
    this.boardOpen = open;
    this.board.hidden = !open;
    if (open && this.model) this.renderBoard(this.model);
  }

  pushFeed(line: FeedLine, nowMs: number): void {
    const el = h('li', { class: `feed-${line.kind}`, 'data-kind': line.kind }, line.text);
    this.feed.append(el);
    this.feedEntries.push({ el, expires: nowMs + renderConfig.hudFeedSeconds * 1000 });
    while (this.feedEntries.length > renderConfig.hudFeedLines) this.feedEntries.shift()?.el.remove();
  }

  /** Every frame: drops expired feed lines. */
  tick(nowMs: number): void {
    while (this.feedEntries.length > 0 && (this.feedEntries[0]?.expires ?? Infinity) <= nowMs) {
      this.feedEntries.shift()?.el.remove();
    }
  }

  destroy(): void {
    this.root.remove();
    this.feedEntries = [];
  }

  // --- parts ----------------------------------------------------------------------------------------

  private setIcon(img: HTMLImageElement, item: HudItem | null): void {
    const src = item ? this.deps.iconFor(item.sprite) : null;
    if (src === null) {
      img.hidden = true;
      img.removeAttribute('src');
      return;
    }
    img.hidden = false;
    if (img.getAttribute('src') !== src) img.src = src;
    img.classList.toggle('joke', item?.rarity === 'joke');
  }

  private renderTarget(item: HudItem | null): void {
    const show =
      item !== null && this.model !== null && !this.model.spectator && this.model.phase !== 'lobby';
    this.target.hidden = !show;
    if (!show) {
      delete this.target.dataset['itemId'];
      return;
    }
    if (this.target.dataset['itemId'] === item.itemId && this.target.dataset['worldId'] === String(item.id))
      return;
    this.target.dataset['itemId'] = item.itemId;
    this.target.dataset['worldId'] = String(item.id);
    this.target.classList.toggle('joke', item.rarity === 'joke');
    this.setIcon(this.targetIcon, item);
    this.targetName.textContent = item.name;
    this.targetDesc.textContent = item.desc;
    this.targetZone.textContent = zoneLabel(item.zone);
  }

  private renderCarry(model: HudModel): void {
    const show = !model.spectator && model.phase !== 'lobby' && model.synced;
    this.carry.hidden = !show;
    if (!show) return;
    const item = model.carried;
    const id = item === null ? '' : String(item.id);
    if (this.carry.dataset['worldId'] === id) return;
    this.carry.dataset['worldId'] = id;
    if (item === null) delete this.carry.dataset['itemId'];
    else this.carry.dataset['itemId'] = item.itemId;
    this.carry.classList.toggle('empty', item === null);
    this.carry.classList.toggle('joke', item?.rarity === 'joke');
    this.setIcon(this.carryIcon, item);
    this.carryName.textContent = item === null ? t('hud.carry.empty') : item.name;
  }

  private renderTimer(seconds: number | null): void {
    this.timer.hidden = seconds === null;
    if (seconds === null) return;
    const text = formatClock(seconds);
    if (this.timer.textContent !== text) this.timer.textContent = text;
    this.timer.dataset['seconds'] = String(seconds);
    this.timer.classList.toggle('warn', seconds <= renderConfig.hudTimerWarnSeconds);
  }

  private renderScores(model: HudModel): void {
    const rows = miniRows(model.rows, renderConfig.hudMiniRows);
    const key = JSON.stringify([
      model.teamRows,
      rows.map((r) => [r.id, r.place, r.points, r.nickname, r.color]),
    ]);
    if (key === this.scoresKey) return;
    this.scoresKey = key;
    const items: HTMLLIElement[] = model.teamRows.map((team) =>
      h(
        'li',
        {
          class: `team team-${team.team}`,
          'data-team': team.team,
          'data-place': team.place,
          'data-points': team.points,
        },
        h(
          'span',
          { class: 'name' },
          t('hud.score.row', { place: team.place, name: t('hud.score.team', { team: team.team }) }),
        ),
        h('span', { class: 'points' }, String(team.points)),
      ),
    );
    for (const row of rows) items.push(this.scoreItem(row));
    this.scores.replaceChildren(...items);
  }

  private scoreItem(row: HudPlayerRow): HTMLLIElement {
    const li = h(
      'li',
      {
        class: row.isMe ? 'me' : '',
        'data-player-id': row.id,
        'data-place': row.place,
        'data-points': row.points,
      },
      h('i', { class: 'swatch', 'aria-hidden': true }),
      h('span', { class: 'name' }, t('hud.score.row', { place: row.place, name: row.nickname })),
      h('span', { class: 'points' }, String(row.points)),
    );
    li.querySelector<HTMLElement>('.swatch')?.style.setProperty('background', row.color || '#888');
    if (!row.connected) li.classList.add('away');
    return li;
  }

  private renderBoard(model: HudModel): void {
    const key = JSON.stringify([model.teams, model.hasSession, model.rows]);
    if (key === this.boardKey) return;
    this.boardKey = key;
    const head: HTMLTableCellElement[] = [
      h('th', { scope: 'col' }, t('hud.board.place')),
      h('th', { scope: 'col' }, t('hud.board.player')),
    ];
    if (model.teams) head.push(h('th', { scope: 'col' }, t('hud.board.team')));
    head.push(h('th', { scope: 'col' }, t('hud.board.items')));
    if (model.hasSession) {
      head.push(
        h('th', { scope: 'col' }, t('hud.board.session')),
        h('th', { scope: 'col' }, t('hud.board.sessionItems')),
      );
    }
    this.boardHead.replaceChildren(...head);

    this.boardBody.replaceChildren(
      ...model.rows.map((row) => {
        const cells: HTMLTableCellElement[] = [
          h('td', { class: 'place' }, String(row.place)),
          h('td', { class: 'player' }, row.nickname),
        ];
        if (model.teams) cells.push(h('td', { class: 'team' }, row.team > 0 ? String(row.team) : '–'));
        cells.push(h('td', { class: 'items' }, String(row.points)));
        if (model.hasSession) {
          cells.push(
            h('td', { class: 'session' }, String(row.sessionPoints ?? 0)),
            h('td', { class: 'session-items' }, String(row.sessionItemPoints ?? 0)),
          );
        }
        const tr = h('tr', { class: row.isMe ? 'me' : '', 'data-player-id': row.id }, ...cells);
        if (!row.connected) tr.classList.add('away');
        return tr;
      }),
    );
  }
}
