// The full-screen round panels (§13.1), HTML over the canvas like the HUD (Hud.ts) and the menus:
//
//   #keke-intro          Round intro, phase 'countdown': map, mode, round n of N and the 3-2-1
//     .intro-map[data-map]  the round's store; data-new-map + .intro-new-map when the map changed (P3-2)
//     #keke-intro-count  role timer, data-seconds
//   #keke-results        Round results, phase 'roundResults'
//     .results-map[data-map]                the store the round was played in (P3-2)
//     .results-race                         race only (M6-3): data-outcome delivered|stolen|timeUp,
//                                           data-winner (session id, '' at the time cap)
//     .results-teams tr[data-team]          (Teams on) place, items, points, total, members
//     .results-players tr[data-player-id]   cells .place .player .team .items .round-points .session
//                                           .standing; data-session-place. Items = own deposits, or in
//                                           a Race without Teams the items the van controls (M7-1)
//     #keke-results-next                    data-seconds until the next round (or the podium)
//   #keke-podium         Session podium, phase 'podium' (M7-1), then the lobby
//     .podium-winner                        "X wins the session!" (data-shared when places tie)
//     .podium-maps li[data-map][data-first][data-last]  which store each run of rounds was in (P3-2)
//     .podium-stage .podium-step[data-step=1|2|3]  steps; DOM order 1, 2, 3, drawn 2-1-3
//     li[data-side-id][data-place][data-points][data-items]   every side, best first (steps, then
//                                           .podium-rest); .tie-break when item points decided it
//
// Each is a role dialog named by its heading. The Game scene owns one and renders it on every patch.
import { defaultThemeId, getTheme, type MapTheme } from '@keke/shared';
import { themeFor } from '../game/mapTheme';
import { t, type MessageKey } from '../i18n';
import { h } from '../ui/dom';
import {
  podiumSteps,
  type MapStretch,
  type PodiumRow,
  type RaceOutcome,
  type ResultRow,
  type ResultTeamRow,
  type RoundScreenModel,
} from './roundScreens';

const modeLabel = (mode: string): string => t(`lobby.mode.${mode}` as MessageKey);
const teamName = (team: number): string => t('hud.score.team', { team });

export class RoundScreen {
  readonly root: HTMLDivElement;
  private key = '';

  /** `theme`: the room's map (P1-5), for the accent colour and the store named in the intro. */
  constructor(private readonly theme: MapTheme = getTheme(defaultThemeId)) {
    this.root = h('div', { id: 'keke-round', class: 'keke-round' });
    this.root.style.setProperty('--keke-accent', theme.colors.primary);
    document.body.appendChild(this.root);
  }

  /** Every state patch; rebuilds only when something shown changed. */
  render(model: RoundScreenModel): void {
    // The podium animates in, so a clock tick only updates its countdown line instead of rebuilding it.
    const key = JSON.stringify(model.kind === 'podium' ? { ...model, seconds: -1 } : model);
    if (key === this.key) {
      if (model.kind === 'podium') this.podiumSeconds(model.seconds);
      return;
    }
    this.key = key;
    switch (model.kind) {
      case 'none':
        this.root.replaceChildren();
        break;
      case 'intro':
        this.root.replaceChildren(this.intro(model));
        break;
      case 'results':
        this.root.replaceChildren(this.results(model));
        break;
      case 'podium':
        this.root.replaceChildren(this.podium(model));
        break;
    }
  }

  private podiumSeconds(seconds: number): void {
    const next = this.root.querySelector<HTMLElement>('#keke-podium-next');
    if (!next || next.dataset['seconds'] === String(seconds)) return;
    next.dataset['seconds'] = String(seconds);
    next.textContent = t('round.podium.next', { seconds });
  }

  destroy(): void {
    this.root.remove();
  }

  // --- Round intro ----------------------------------------------------------------------------------

  private intro(model: Extract<RoundScreenModel, { kind: 'intro' }>): HTMLElement {
    const theme = this.theme;
    const count = h(
      'div',
      {
        id: 'keke-intro-count',
        class: 'intro-count',
        role: 'timer',
        'aria-label': t('round.intro.count'),
        'data-seconds': model.seconds,
      },
      model.seconds > 0 ? String(model.seconds) : t('round.intro.go'),
    );
    return h(
      'section',
      {
        id: 'keke-intro',
        class: 'round-panel round-intro',
        role: 'dialog',
        'aria-labelledby': 'keke-intro-title',
      },
      h('h2', { id: 'keke-intro-title' }, t('round.intro.title')),
      h(
        'p',
        { class: 'intro-map', 'data-map': theme.id, 'data-new-map': model.newMap },
        theme.brand.storeDescription,
      ),
      // P3-2: the session moved to the other store this round.
      model.newMap
        ? h('p', { class: 'intro-new-map' }, t('round.intro.newMap', { store: theme.brand.storeName }))
        : null,
      h('p', { class: 'intro-mode' }, modeLabel(model.mode)),
      model.totalRounds > 0
        ? h('p', { class: 'intro-round' }, t('round.of', { round: model.round, total: model.totalRounds }))
        : null,
      count,
    );
  }

  // --- Round results --------------------------------------------------------------------------------

  private results(model: Extract<RoundScreenModel, { kind: 'results' }>): HTMLElement {
    const title = model.final
      ? t('round.results.finalTitle', { round: model.round })
      : t('round.results.title', { round: model.round });
    const next = h(
      'p',
      { id: 'keke-results-next', class: 'round-next', 'data-seconds': model.seconds },
      t(model.final ? 'round.results.toPodium' : 'round.results.next', { seconds: model.seconds }),
    );
    return h(
      'section',
      {
        id: 'keke-results',
        class: 'round-panel round-results',
        role: 'dialog',
        'aria-labelledby': 'keke-results-title',
      },
      h('h2', { id: 'keke-results-title' }, title),
      h(
        'p',
        { class: 'results-map', 'data-map': model.mapId },
        t('round.results.map', { store: themeFor(model.mapId).brand.storeName }),
      ),
      model.race ? raceBanner(model.race) : null,
      model.teams && model.teamRows.length > 0 ? this.teamTable(model.teamRows, model.race !== null) : null,
      this.playerTable(model.rows, model.teams, playerItemsHeader(model)),
      next,
    );
  }

  private teamTable(rows: readonly ResultTeamRow[], race: boolean): HTMLTableElement {
    return h(
      'table',
      { class: 'results-teams', 'aria-label': t('round.results.teams') },
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', { scope: 'col' }, t('hud.board.place')),
          h('th', { scope: 'col' }, t('hud.board.team')),
          // Race ranks teams on the items their van controls (M6-2); Timed on the van's banked points.
          h('th', { scope: 'col' }, t(race ? 'round.results.controlled' : 'hud.board.items')),
          h('th', { scope: 'col' }, t('round.results.earned')),
          h('th', { scope: 'col' }, t('round.results.total')),
          h('th', { scope: 'col' }, t('round.results.standing')),
        ),
      ),
      h(
        'tbody',
        {},
        ...rows.map((r) =>
          h(
            'tr',
            {
              class: `team team-${r.team}${r.mine ? ' me' : ''}`,
              'data-team': r.team,
              'data-place': r.place,
              'data-session-place': r.sessionPlace,
              'data-delivered': r.delivered ? 'true' : false,
            },
            h('td', { class: 'place' }, placeText(r.place)),
            h(
              'td',
              { class: 'player' },
              h('strong', {}, teamName(r.team)),
              h('span', { class: 'members' }, r.members.join(', ')),
            ),
            itemsCell(r.itemPoints, r.delivered),
            h('td', { class: 'round-points' }, `+${r.roundPoints}`),
            h('td', { class: 'session' }, String(r.sessionPoints)),
            h('td', { class: 'standing' }, placeText(r.sessionPlace)),
          ),
        ),
      ),
    );
  }

  private playerTable(rows: readonly ResultRow[], teams: boolean, itemsHeader: MessageKey): HTMLTableElement {
    const head = [
      h('th', { scope: 'col' }, t('hud.board.place')),
      h('th', { scope: 'col' }, t('hud.board.player')),
      teams ? h('th', { scope: 'col' }, t('hud.board.team')) : null,
      h('th', { scope: 'col' }, t(itemsHeader)),
      h('th', { scope: 'col' }, t('round.results.earned')),
      h('th', { scope: 'col' }, t('round.results.total')),
      h('th', { scope: 'col' }, t('round.results.standing')),
    ];
    return h(
      'table',
      { class: 'results-players', 'aria-label': t('round.results.players') },
      h('thead', {}, h('tr', {}, ...head)),
      h(
        'tbody',
        {},
        ...rows.map((r) => {
          const swatch = h('i', { class: 'swatch', 'aria-hidden': true });
          swatch.style.setProperty('background', r.color || '#888');
          return h(
            'tr',
            {
              class: r.isMe ? 'me' : '',
              'data-player-id': r.id,
              'data-place': r.place,
              'data-session-place': r.sessionPlace,
              'data-delivered': r.delivered ? 'true' : false,
            },
            h('td', { class: 'place' }, placeText(r.place)),
            h('td', { class: 'player' }, swatch, r.nickname),
            teams ? h('td', { class: 'team' }, r.team > 0 ? String(r.team) : '–') : null,
            itemsCell(r.items, r.delivered),
            h('td', { class: 'round-points' }, `+${r.roundPoints}`),
            h('td', { class: 'session' }, String(r.sessionPoints)),
            h('td', { class: 'standing' }, placeText(r.sessionPlace)),
          );
        }),
      ),
    );
  }

  // --- Session podium -------------------------------------------------------------------------------

  private podium(model: Extract<RoundScreenModel, { kind: 'podium' }>): HTMLElement {
    const { steps, rest } = podiumSteps(model.rows);
    const winners = steps[0] ?? [];
    const stage = h(
      'div',
      { class: 'podium-stage' },
      ...steps.map((sides, i) =>
        h(
          'div',
          { class: `podium-step step-${i + 1}${sides.length === 0 ? ' empty' : ''}`, 'data-step': i + 1 },
          h(
            'ul',
            { class: 'podium-sides', 'aria-label': ordinalLabel(i + 1) },
            ...sides.map((r) => podiumItem(r)),
          ),
          h('div', { class: 'podium-block', 'aria-hidden': true }, String(i + 1)),
        ),
      ),
    );
    return h(
      'section',
      {
        id: 'keke-podium',
        class: 'round-panel round-podium',
        role: 'dialog',
        'aria-labelledby': 'keke-podium-title',
      },
      h('h2', { id: 'keke-podium-title' }, t('round.podium.title')),
      model.totalRounds > 0
        ? h(
            'p',
            { class: 'podium-rounds' },
            model.totalRounds === 1
              ? t('round.podium.oneRound')
              : t('round.podium.rounds', { rounds: model.totalRounds }),
          )
        : null,
      model.maps.length > 0 ? mapList(model.maps) : null,
      winners.length > 0 ? winnerLine(winners) : null,
      stage,
      rest.length > 0
        ? h(
            'ol',
            { class: 'podium-rest', 'aria-label': t('round.podium.others'), start: rest[0]?.place || 4 },
            ...rest.map((r) => podiumItem(r)),
          )
        : null,
      // Playtest 1: the ★ was not explained when the tie was not at the top.
      [...model.rows].some((r) => r.tieBroken)
        ? h('p', { class: 'podium-note' }, t('round.podium.tieNote'))
        : null,
      h(
        'p',
        { id: 'keke-podium-next', class: 'round-next', 'data-seconds': model.seconds },
        t('round.podium.next', { seconds: model.seconds }),
      ),
    );
  }
}

/** The podium's list of stores and the rounds played in each (P3-2): "Rounds 1–3: <store>". */
function mapList(maps: readonly MapStretch[]): HTMLElement {
  return h(
    'ul',
    { class: 'podium-maps', 'aria-label': t('round.podium.maps') },
    ...maps.map((m) =>
      h(
        'li',
        { 'data-map': m.mapId, 'data-first': m.first, 'data-last': m.last },
        m.first === m.last
          ? t('round.podium.mapRound', { round: m.first, store: themeFor(m.mapId).brand.storeName })
          : t('round.podium.mapRounds', {
              first: m.first,
              last: m.last,
              store: themeFor(m.mapId).brand.storeName,
            }),
      ),
    ),
  );
}

/**
 * The player Items column header: what the number counts. Race without Teams ranks players on the items
 * their van controls; Race with Teams ranks the team (its table says Controlled), so the player rows there
 * are each member's own deposits and say so; Timed is plain Items (deposits).
 */
function playerItemsHeader(model: Extract<RoundScreenModel, { kind: 'results' }>): MessageKey {
  if (model.items === 'controlled') return 'round.results.controlled';
  return model.race !== null ? 'round.results.deposited' : 'hud.board.items';
}

/** Items cell; the deliverer's row gets a Delivered tag, since the delivered box no longer counts. */
function itemsCell(items: number, delivered: boolean): HTMLElement {
  return h(
    'td',
    { class: 'items' },
    String(items),
    delivered ? h('span', { class: 'tag delivered' }, t('round.results.deliveredTag')) : null,
  );
}

function raceBanner(race: RaceOutcome): HTMLElement {
  const text =
    race.outcome === 'timeUp'
      ? t('round.results.race.timeUp')
      : t(race.outcome === 'stolen' ? 'round.results.race.stolen' : 'round.results.race.delivered', {
          name: race.name,
        });
  return h(
    'p',
    {
      class: `results-race${race.mine ? ' me' : ''}`,
      'data-outcome': race.outcome,
      'data-winner': race.winner,
    },
    text,
  );
}

function placeText(place: number): string {
  return place > 0 ? String(place) : '–';
}

const sideName = (r: PodiumRow): string => (r.team > 0 ? teamName(r.team) : r.name);

function ordinalLabel(place: number): string {
  return t('round.podium.step', { place });
}

function winnerLine(winners: readonly PodiumRow[]): HTMLElement {
  const shared = winners.length > 1;
  const text = shared
    ? t('round.podium.sharedWin', { names: winners.map(sideName).join(', ') })
    : winners[0]?.mine
      ? t('round.podium.youWin')
      : t('round.podium.winner', { name: winners[0] ? sideName(winners[0]) : '' });
  return h('p', { class: 'podium-winner', 'data-shared': shared }, text);
}

function podiumItem(r: PodiumRow): HTMLLIElement {
  const token = h('i', { class: 'token', 'aria-hidden': true });
  token.style.setProperty('--side-color', r.color || '#888');
  return h(
    'li',
    {
      class: `side place-${Math.min(Math.max(r.place, 1), 4)}${r.team > 0 ? ` team team-${r.team}` : ''}${
        r.mine ? ' me' : ''
      }${r.tieBroken ? ' tie-break' : ''}`,
      'data-side-id': r.id,
      'data-place': r.place,
      'data-points': r.points,
      'data-items': r.itemPoints,
    },
    token,
    h('span', { class: 'place' }, placeText(r.place)),
    h(
      'span',
      { class: 'name' },
      sideName(r),
      r.members.length > 0 ? h('span', { class: 'members' }, r.members.join(', ')) : null,
    ),
    h('span', { class: 'points' }, t('round.podium.points', { points: r.points })),
    h(
      'span',
      r.tieBroken ? { class: 'items', title: t('round.podium.tieBreak') } : { class: 'items' },
      r.itemPoints === 1 ? t('round.podium.oneItem') : t('round.podium.items', { items: r.itemPoints }),
    ),
  );
}
