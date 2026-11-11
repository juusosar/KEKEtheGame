// The in-round HUD (§13.2), drawn as HTML over the canvas like the menus (ui/dom.ts): crisp text at any
// zoom, and e2e specs find each part by id or role instead of reading pixels.
//
//   #keke-hud            root, pointer-events none
//   #keke-hud-arrow      target arrow at the screen edge (data-kind target|van|office|box)
//   #keke-hud-target     target card: icon, name, description, zone; data-lost loose|taken while it shows
//                        our side's lost order box (race)
//   #keke-hud-carry      carry slot
//   #keke-hud-quota      race only (M6-3): role meter "Order quota", data-points, data-quota, data-state
//                        collecting|deliver|stolen
//   #keke-hud-timer      round timer, role timer, data-seconds
//   #keke-hud-scores     mini scoreboard (top 5 + you): li[data-player-id][data-place][data-points]
//   #keke-hud-board      full scoreboard while Tab / pad View is held: tr[data-player-id]
//   #keke-hud-feed       event feed, role log (li[data-kind] steal|joke|deposit|slip|runover|hit|ko|wanted|
//                        box|packed|delivery|team)
//   #keke-hud-combat     bottom-centre: HP bar and weapon slot (M4-7)
//   #keke-hud-hp         role meter "Health", data-hp, data-max, data-level ok|warn|low
//   #keke-hud-weapon     region "Weapon", data-weapon (id), data-uses (number, or 'inf'), class .new after a roll
//   #keke-hud-ko         KO overlay, role status, data-respawn-in (whole seconds)
//   #keke-hud-wanted     Wanted indicator (M5-7), role status, data-seconds; hidden when not wanted
//   #keke-hud-prompts    button prompts (F6), top of #keke-hud-combat, list "Button prompts", data-device;
//                        li[data-action] with kbd (key or button name) and the action
//
// Layout: target + carry top-left, timer top-centre, scores and feed top-right, HP and weapon
// bottom-centre, KO overlay in the middle, minimap (M3-8) owns the bottom-right corner. The Game scene owns one Hud and feeds it from state patches and item events.
import { defaultThemeId, getTheme, teamColor, type MapTheme, type Vec2 } from '@keke/shared';
import { renderConfig } from '../game/renderConfig';
import { t, type MessageKey } from '../i18n';
import { h } from '../ui/dom';
import { placeArrow, type ScreenRect } from './edgeArrow';
import type { CombatHudModel } from './combatHud';
import type { FeedLine } from './feed';
import { promptsKey, type Prompt } from './prompts';
import type { InputDevice } from '../input/device';
import {
  formatClock,
  miniRows,
  type HudItem,
  type HudLostBox,
  type HudModel,
  type HudPlayerRow,
  type HudRace,
} from './hudState';

export interface HudDeps {
  /** Image URL for a frame of `atlas` (`items`, or `order_box`), or null when it cannot be drawn. */
  iconFor(sprite: string, atlas: string): string | null;
  /** Image URL for a `weapons` atlas frame, or null when it cannot be drawn. */
  weaponIconFor(sprite: string): string | null;
  /** The room's map (P1 review F2): its primary colour is the HUD accent. Default: the first map. */
  theme?: MapTheme;
}

interface FeedEntry {
  el: HTMLLIElement;
  expires: number;
  merge?: FeedLine['merge'];
  mine: boolean;
}

/**
 * What the target arrow keeps clear of (playtest 1): the HUD panels, the minimap, the sound button, and
 * anything else on screen marked `data-arrow-avoid` (menus and prompts added later can opt in).
 */
const ARROW_AVOID_SELECTOR = [
  '#keke-hud-target',
  '#keke-hud-carry',
  '#keke-hud-quota',
  '#keke-hud-timer',
  '#keke-hud-scores',
  '#keke-hud-feed',
  '#keke-hud-combat',
  '#keke-minimap',
  '#keke-audio',
  '[data-arrow-avoid]',
].join(',');

/** Panels move only when their content changes; their boxes are read again this often. */
const ARROW_AVOID_REFRESH_MS = 250;

/** A small square in a team's colour. */
function teamSwatch(team: number): HTMLElement {
  const el = h('i', { class: 'swatch', 'aria-hidden': true });
  el.style.setProperty('background', teamColor(team) ?? '#888');
  return el;
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
  private readonly quota: HTMLElement;
  private readonly quotaFill: HTMLElement;
  private readonly quotaText: HTMLElement;
  private quotaKey = '';
  private readonly scores: HTMLOListElement;
  private readonly board: HTMLElement;
  private readonly boardBody: HTMLTableSectionElement;
  private readonly boardHead: HTMLTableRowElement;
  private readonly feed: HTMLOListElement;
  private readonly combat: HTMLElement;
  private readonly prompts: HTMLOListElement;
  private promptKey = '';
  private readonly hp: HTMLElement;
  private readonly hpFill: HTMLElement;
  private readonly hpText: HTMLElement;
  private readonly weapon: HTMLElement;
  private readonly weaponIcon: HTMLImageElement;
  private readonly weaponName: HTMLElement;
  private readonly weaponUses: HTMLElement;
  private readonly status: HTMLElement;
  private readonly wanted: HTMLElement;
  private wantedSeconds: number | null = null;
  private readonly ko: HTMLElement;
  private readonly koBy: HTMLElement;
  private readonly koCount: HTMLElement;
  private combatKey = '';
  private weaponFlashUntil = 0;
  private feedEntries: FeedEntry[] = [];
  private model: HudModel | null = null;
  private scoresKey = '';
  private boardKey = '';
  private boardOpen = false;
  private avoidRects: ScreenRect[] = [];
  private avoidReadAt = -Infinity;

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

    this.quotaFill = h('div', { class: 'hud-quota-fill' });
    this.quotaText = h('span', { class: 'hud-quota-text' });
    this.quota = h(
      'div',
      {
        id: 'keke-hud-quota',
        class: 'hud-quota',
        role: 'meter',
        'aria-label': t('hud.quota'),
        'aria-valuemin': 0,
        hidden: true,
      },
      h('div', { class: 'hud-quota-bar' }, this.quotaFill),
      this.quotaText,
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

    this.hpFill = h('div', { class: 'hud-hp-fill' });
    this.hpText = h('span', { class: 'hud-hp-text' });
    this.hp = h(
      'div',
      {
        id: 'keke-hud-hp',
        class: 'hud-hp',
        role: 'meter',
        'aria-label': t('hud.hp'),
        'aria-valuemin': 0,
      },
      this.hpFill,
      this.hpText,
    );
    this.weaponIcon = h('img', { class: 'hud-icon', alt: '' });
    this.weaponName = h('span', { class: 'hud-name' });
    this.weaponUses = h('span', { class: 'hud-uses', 'aria-label': t('hud.weapon.uses') });
    this.weapon = h(
      'section',
      { id: 'keke-hud-weapon', class: 'hud-weapon', 'aria-label': t('hud.weapon') },
      h('div', { class: 'hud-slot' }, this.weaponIcon),
      h('div', { class: 'hud-text' }, h('span', { class: 'hud-label' }, t('hud.weapon')), this.weaponName),
      this.weaponUses,
    );
    this.status = h('div', { class: 'hud-status' });
    this.wanted = h('div', {
      id: 'keke-hud-wanted',
      class: 'hud-wanted',
      role: 'status',
      'aria-label': t('hud.wanted'),
      hidden: true,
    });
    this.prompts = h('ol', {
      id: 'keke-hud-prompts',
      class: 'hud-prompts',
      'aria-label': t('hud.prompts'),
      hidden: true,
    });
    this.combat = h(
      'div',
      { id: 'keke-hud-combat', class: 'hud-combat', hidden: true },
      this.prompts,
      this.wanted,
      this.status,
      this.hp,
      this.weapon,
    );
    this.koBy = h('span', { class: 'hud-ko-by' });
    this.koCount = h('span', { class: 'hud-ko-count' });
    this.ko = h(
      'div',
      { id: 'keke-hud-ko', class: 'hud-ko', role: 'status', 'aria-label': t('hud.ko'), hidden: true },
      h('strong', {}, t('hud.ko.title')),
      this.koBy,
      this.koCount,
    );

    this.root = h(
      'div',
      { id: 'keke-hud', class: 'keke-hud', 'aria-label': t('hud.label') },
      h('div', { class: 'hud-left' }, this.target, this.carry, this.quota),
      this.timer,
      h('div', { class: 'hud-right' }, this.scores, this.feed),
      this.combat,
      this.ko,
      this.board,
      this.arrow,
    );
    this.root.style.setProperty('--keke-accent', (deps.theme ?? getTheme(defaultThemeId)).colors.primary);
    document.body.appendChild(this.root);
  }

  /** Every state patch. */
  render(model: HudModel): void {
    this.model = model;
    this.renderTarget(model.target, model.lostBox);
    this.renderCarry(model);
    this.renderQuota(model.race);
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
      {
        rects: this.panelRects(),
        radius: renderConfig.hudArrowAvoidPx,
        minFromCentre: renderConfig.hudArrowMinFromCentrePx,
      },
    );
    this.arrow.hidden = false;
    if (this.arrow.dataset['kind'] !== dest.kind) {
      this.arrow.dataset['kind'] = dest.kind;
      this.arrow.setAttribute(
        'aria-label',
        t(
          dest.kind === 'van'
            ? 'hud.arrow.van'
            : dest.kind === 'office'
              ? 'hud.arrow.office'
              : dest.kind === 'box'
                ? 'hud.arrow.box'
                : 'hud.arrow.target',
        ),
      );
    }
    this.arrow.dataset['onScreen'] = String(at.onScreen);
    this.arrow.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px) rotate(${at.angle.toFixed(3)}rad)`;
  }

  /** Screen boxes of the visible panels the arrow keeps clear of, read a few times a second. */
  private panelRects(): ScreenRect[] {
    const now = performance.now();
    if (now - this.avoidReadAt < ARROW_AVOID_REFRESH_MS) return this.avoidRects;
    this.avoidReadAt = now;
    this.avoidRects = [];
    for (const el of document.querySelectorAll<HTMLElement>(ARROW_AVOID_SELECTOR)) {
      const r = el.getBoundingClientRect();
      // Hidden panels (display: none) have an empty box.
      if (r.width > 0 && r.height > 0)
        this.avoidRects.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    }
    return this.avoidRects;
  }

  /** Shows the full scoreboard while Tab / pad View is held (§13.3). */
  setBoardOpen(open: boolean): void {
    if (open === this.boardOpen) return;
    this.boardOpen = open;
    this.board.hidden = !open;
    if (open && this.model) this.renderBoard(this.model);
  }

  pushFeed(line: FeedLine, nowMs: number): void {
    const expires = nowMs + renderConfig.hudFeedSeconds * 1000;
    if (line.merge) {
      // Fold into the live line with the same key (repeated spray ticks) and move it to the bottom.
      const key = line.merge.key;
      const i = this.feedEntries.findIndex((e) => e.merge?.key === key);
      const old = i >= 0 ? this.feedEntries[i] : undefined;
      if (old?.merge) {
        this.feedEntries.splice(i, 1);
        const amount = old.merge.amount + line.merge.amount;
        old.merge = { ...line.merge, amount };
        old.el.textContent = line.merge.render(amount);
        old.expires = expires;
        this.feed.append(old.el);
        this.feedEntries.push(old);
        return;
      }
    }
    // The same line twice in a row ("Aino is hauling a …" for a pickup, a drop and a pickup again) shows
    // once, kept on screen a little longer (playtest 1 problem 8).
    const last = this.feedEntries[this.feedEntries.length - 1];
    if (last !== undefined && !line.merge && last.el.textContent === line.text) {
      last.expires = expires;
      return;
    }
    const el = h('li', { class: `feed-${line.kind}`, 'data-kind': line.kind }, line.text);
    if (line.mine) el.classList.add('mine');
    this.feed.append(el);
    this.feedEntries.push({ el, expires, merge: line.merge, mine: line.mine === true });
    // Full: the oldest line about someone else makes room first, so lines about us stay up.
    while (this.feedEntries.length > renderConfig.hudFeedLines) {
      const i = this.feedEntries.findIndex((e) => !e.mine);
      const [gone] = this.feedEntries.splice(i >= 0 ? i : 0, 1);
      gone?.el.remove();
    }
  }

  /** Our Wanted status (§8, §13.2 "Wanted indicator"): seconds left, or null when not wanted. */
  renderWanted(seconds: number | null): void {
    if (seconds === this.wantedSeconds) return;
    this.wantedSeconds = seconds;
    this.wanted.hidden = seconds === null;
    if (seconds === null) {
      delete this.wanted.dataset['seconds'];
      return;
    }
    this.wanted.dataset['seconds'] = String(seconds);
    this.wanted.textContent = t('hud.wanted.value', { seconds });
  }

  /** Every frame: drops expired feed lines and ends the new-weapon glow. */
  tick(nowMs: number): void {
    // Lines move to the end when they merge, so expiry is not in order: check them all.
    if (this.feedEntries.some((e) => e.expires <= nowMs)) {
      this.feedEntries = this.feedEntries.filter((e) => {
        if (e.expires > nowMs) return true;
        e.el.remove();
        return false;
      });
    }
    if (this.weaponFlashUntil !== 0 && nowMs >= this.weaponFlashUntil) {
      this.weaponFlashUntil = 0;
      this.weapon.classList.remove('new');
    }
  }

  /**
   * HP bar, weapon slot and KO overlay (§13.2). Every state patch. `koBy` names who knocked us out (from
   * the last `ko` broadcast about us) while we are down.
   */
  renderCombat(model: CombatHudModel, koBy: { name: string; weapon: string | null } | null): void {
    const show = model.show;
    this.combat.hidden = !show;
    this.ko.hidden = !show || model.ko === null;
    if (!show) return;
    const key = JSON.stringify([model, koBy]);
    if (key === this.combatKey) return;
    this.combatKey = key;

    this.hp.dataset['hp'] = String(model.hp);
    this.hp.dataset['max'] = String(model.maxHp);
    this.hp.dataset['level'] = model.level;
    this.hp.setAttribute('aria-valuemax', String(model.maxHp));
    this.hp.setAttribute('aria-valuenow', String(model.hp));
    this.hpFill.style.width = `${(model.fill * 100).toFixed(1)}%`;
    this.hpText.textContent = t('hud.hp.value', { hp: model.hp, max: model.maxHp });

    const w = model.weapon;
    this.weapon.dataset['weapon'] = w.id;
    this.weapon.dataset['uses'] = w.uses === null ? 'inf' : String(w.uses);
    this.weaponName.textContent = w.name;
    this.weaponUses.textContent = w.usesText;
    this.weaponUses.title = w.uses === null ? t('hud.weapon.unlimited') : '';
    const src = this.deps.weaponIconFor(w.sprite);
    this.weaponIcon.hidden = src === null;
    if (src !== null && this.weaponIcon.getAttribute('src') !== src) this.weaponIcon.src = src;

    const status: string[] = [];
    if (model.stunned) status.push(t('hud.status.stunned'));
    if (model.blocking) status.push(t('hud.status.blocking'));
    if (model.protected) status.push(t('hud.status.protected'));
    this.status.textContent = status.join(' · ');
    this.status.hidden = status.length === 0;

    if (model.ko !== null) {
      this.ko.dataset['respawnIn'] = String(model.ko.respawnIn);
      this.koBy.hidden = koBy === null;
      this.koBy.textContent =
        koBy === null
          ? ''
          : koBy.weapon === null
            ? t('hud.ko.byPlain', { name: koBy.name })
            : t('hud.ko.by', { name: koBy.name, weapon: koBy.weapon });
      this.koCount.textContent =
        model.ko.respawnIn > 0
          ? t('hud.ko.respawn', { seconds: model.ko.respawnIn })
          : t('hud.ko.respawnNow');
    } else {
      delete this.ko.dataset['respawnIn'];
    }
  }

  /** Our weapon changed to a newly rolled one: the slot glows for a moment. */
  flashWeapon(nowMs: number): void {
    this.weaponFlashUntil = nowMs + renderConfig.hudWeaponFlashSeconds * 1000;
    this.weapon.classList.remove('new');
    // Restart the CSS animation.
    void this.weapon.offsetWidth;
    this.weapon.classList.add('new');
  }

  /** Button prompts for the last-used device (§13.3, F6); rebuilt only when they change. */
  renderPrompts(prompts: readonly Prompt[], device: InputDevice): void {
    const key = `${device}/${promptsKey(prompts)}`;
    if (key === this.promptKey) return;
    this.promptKey = key;
    this.prompts.dataset['device'] = device;
    this.prompts.replaceChildren(
      ...prompts.map((p) =>
        h('li', { 'data-action': p.action }, h('kbd', {}, p.button), h('span', {}, t(p.label))),
      ),
    );
    this.prompts.hidden = prompts.length === 0;
  }

  destroy(): void {
    this.root.remove();
    this.feedEntries = [];
  }

  // --- parts ----------------------------------------------------------------------------------------

  private setIcon(img: HTMLImageElement, item: HudItem | null): void {
    const src = item ? this.deps.iconFor(item.sprite, item.atlas) : null;
    if (src === null) {
      img.hidden = true;
      img.removeAttribute('src');
      return;
    }
    img.hidden = false;
    if (img.getAttribute('src') !== src) img.src = src;
    img.classList.toggle('joke', item?.rarity === 'joke');
  }

  private renderTarget(target: HudItem | null, lost: HudLostBox | null): void {
    const item = lost?.item ?? target;
    const show =
      item !== null && this.model !== null && !this.model.spectator && this.model.phase !== 'lobby';
    this.target.hidden = !show;
    if (!show) {
      delete this.target.dataset['itemId'];
      return;
    }
    // Race (playtest 1 problem 6): our lost order box takes the card over until our side has it back.
    const lostState = lost?.how ?? '';
    const desc =
      lost === null
        ? item.desc
        : lost.how === 'loose'
          ? t('hud.box.loose')
          : t('hud.box.taken', { name: lost.by });
    if (
      this.target.dataset['itemId'] === item.itemId &&
      this.target.dataset['worldId'] === String(item.id) &&
      (this.target.dataset['lost'] ?? '') === lostState &&
      this.targetDesc.textContent === desc
    )
      return;
    this.target.dataset['itemId'] = item.itemId;
    this.target.dataset['worldId'] = String(item.id);
    if (lostState === '') delete this.target.dataset['lost'];
    else this.target.dataset['lost'] = lostState;
    this.target.classList.toggle('joke', item.rarity === 'joke');
    this.target.classList.toggle('lost-box', lost !== null);
    this.setIcon(this.targetIcon, item);
    this.targetName.textContent = lost === null ? item.name : t('hud.box.title');
    this.targetDesc.textContent = desc;
    this.targetZone.textContent = lost === null ? zoneLabel(item.zone) : '';
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
    this.carry.classList.toggle('box', item?.box != null);
    this.setIcon(this.carryIcon, item);
    this.carryName.textContent = item === null ? t('hud.carry.empty') : item.name;
  }

  /** Race (§4.2): our van's progress to the next order box, or the delivery call while carrying one. */
  private renderQuota(race: HudRace | null): void {
    this.quota.hidden = race === null;
    if (race === null) {
      this.quotaKey = '';
      return;
    }
    const state = !race.carryingBox ? 'collecting' : race.stolen ? 'stolen' : 'deliver';
    const key = JSON.stringify([race.points, race.quota, state]);
    if (key === this.quotaKey) return;
    this.quotaKey = key;
    this.quota.dataset['points'] = String(race.points);
    this.quota.dataset['quota'] = String(race.quota);
    this.quota.dataset['state'] = state;
    this.quota.setAttribute('aria-valuemax', String(race.quota));
    this.quota.setAttribute('aria-valuenow', String(Math.min(race.points, race.quota)));
    const fill = race.quota > 0 ? Math.min(1, race.points / race.quota) : 0;
    this.quotaFill.style.width = `${(fill * 100).toFixed(1)}%`;
    this.quotaText.textContent =
      state === 'collecting'
        ? t('hud.quota.value', { points: race.points, quota: race.quota })
        : t(state === 'stolen' ? 'hud.quota.stolen' : 'hud.quota.deliver');
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
        teamSwatch(team.team),
        h(
          'span',
          { class: 'name' },
          t('hud.score.row', { place: team.place, name: t('hud.score.team', { team: team.team }) }),
        ),
        h('span', { class: 'points' }, String(team.points)),
      ),
    );
    for (const row of rows) items.push(this.scoreItem(row, model.teams));
    this.scores.replaceChildren(...items);
  }

  private scoreItem(row: HudPlayerRow, teams: boolean): HTMLLIElement {
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
    // With Teams on the swatch is the team's colour (playtest 1 problem 7), else the player's.
    const swatch = (teams ? teamColor(row.team) : undefined) ?? (row.color || '#888');
    li.querySelector<HTMLElement>('.swatch')?.style.setProperty('background', swatch);
    if (teams && row.team > 0) li.dataset['team'] = String(row.team);
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
        if (model.teams) {
          cells.push(
            h(
              'td',
              { class: 'team' },
              row.team > 0 ? teamSwatch(row.team) : '',
              row.team > 0 ? String(row.team) : '–',
            ),
          );
        }
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
