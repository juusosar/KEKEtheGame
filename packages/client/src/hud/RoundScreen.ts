// The full-screen round panels (§13.1), HTML over the canvas like the HUD (Hud.ts) and the menus:
//
//   #keke-intro          Round intro, phase 'countdown': map, mode, round n of N and the 3-2-1
//     #keke-intro-count  role timer, data-seconds
//   #keke-results        Round results, phase 'roundResults'
//     .results-teams tr[data-team]          (Teams on) place, items, points, total, members
//     .results-players tr[data-player-id]   cells .place .player .team .items .round-points .session
//     #keke-results-next                    data-seconds until the next round (or the podium)
//   #keke-podium         Session podium, phase 'podium': li[data-side-id][data-place], then the lobby
//
// Each is a role dialog named by its heading. The Game scene owns one and renders it on every patch.
import { getTheme, defaultThemeId } from '@keke/shared';
import { t, type MessageKey } from '../i18n';
import { h } from '../ui/dom';
import type { PodiumRow, ResultRow, ResultTeamRow, RoundScreenModel } from './roundScreens';

const modeLabel = (mode: string): string => t(`lobby.mode.${mode}` as MessageKey);
const teamName = (team: number): string => t('hud.score.team', { team });

export class RoundScreen {
  readonly root: HTMLDivElement;
  private key = '';

  constructor() {
    this.root = h('div', { id: 'keke-round', class: 'keke-round' });
    const theme = getTheme(defaultThemeId);
    this.root.style.setProperty('--keke-accent', theme.colors.primary);
    document.body.appendChild(this.root);
  }

  /** Every state patch; rebuilds only when something shown changed. */
  render(model: RoundScreenModel): void {
    const key = JSON.stringify(model);
    if (key === this.key) return;
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

  destroy(): void {
    this.root.remove();
  }

  // --- Round intro ----------------------------------------------------------------------------------

  private intro(model: Extract<RoundScreenModel, { kind: 'intro' }>): HTMLElement {
    const theme = getTheme(defaultThemeId);
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
      h('p', { class: 'intro-map' }, t('round.intro.map', { store: theme.brand.storeName })),
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
      model.teams && model.teamRows.length > 0 ? this.teamTable(model.teamRows) : null,
      this.playerTable(model.rows, model.teams),
      next,
    );
  }

  private teamTable(rows: readonly ResultTeamRow[]): HTMLTableElement {
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
          h('th', { scope: 'col' }, t('hud.board.items')),
          h('th', { scope: 'col' }, t('round.results.earned')),
          h('th', { scope: 'col' }, t('round.results.total')),
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
            },
            h('td', { class: 'place' }, placeText(r.place)),
            h(
              'td',
              { class: 'player' },
              h('strong', {}, teamName(r.team)),
              h('span', { class: 'members' }, r.members.join(', ')),
            ),
            h('td', { class: 'items' }, String(r.itemPoints)),
            h('td', { class: 'round-points' }, `+${r.roundPoints}`),
            h('td', { class: 'session' }, String(r.sessionPoints)),
          ),
        ),
      ),
    );
  }

  private playerTable(rows: readonly ResultRow[], teams: boolean): HTMLTableElement {
    const head = [
      h('th', { scope: 'col' }, t('hud.board.place')),
      h('th', { scope: 'col' }, t('hud.board.player')),
      teams ? h('th', { scope: 'col' }, t('hud.board.team')) : null,
      h('th', { scope: 'col' }, t('hud.board.items')),
      h('th', { scope: 'col' }, t('round.results.earned')),
      h('th', { scope: 'col' }, t('round.results.total')),
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
            { class: r.isMe ? 'me' : '', 'data-player-id': r.id, 'data-place': r.place },
            h('td', { class: 'place' }, placeText(r.place)),
            h('td', { class: 'player' }, swatch, r.nickname),
            teams ? h('td', { class: 'team' }, r.team > 0 ? String(r.team) : '–') : null,
            h('td', { class: 'items' }, String(r.deposited)),
            h('td', { class: 'round-points' }, `+${r.roundPoints}`),
            h('td', { class: 'session' }, String(r.sessionPoints)),
          );
        }),
      ),
    );
  }

  // --- Session podium -------------------------------------------------------------------------------

  private podium(model: Extract<RoundScreenModel, { kind: 'podium' }>): HTMLElement {
    return h(
      'section',
      {
        id: 'keke-podium',
        class: 'round-panel round-podium',
        role: 'dialog',
        'aria-labelledby': 'keke-podium-title',
      },
      h('h2', { id: 'keke-podium-title' }, t('round.podium.title')),
      h(
        'ol',
        { class: 'podium-list', 'aria-label': t('round.podium.title') },
        ...model.rows.map((r) => podiumItem(r)),
      ),
      h(
        'p',
        { id: 'keke-podium-next', class: 'round-next', 'data-seconds': model.seconds },
        t('round.podium.next', { seconds: model.seconds }),
      ),
    );
  }
}

function placeText(place: number): string {
  return place > 0 ? String(place) : '–';
}

function podiumItem(r: PodiumRow): HTMLLIElement {
  const name = r.team > 0 ? teamName(r.team) : r.name;
  return h(
    'li',
    {
      class: `place-${Math.min(r.place, 4)}${r.mine ? ' me' : ''}`,
      'data-side-id': r.id,
      'data-place': r.place,
      'data-points': r.points,
    },
    h('span', { class: 'place' }, placeText(r.place)),
    h('span', { class: 'name' }, name),
    h('span', { class: 'points' }, t('round.podium.points', { points: r.points })),
  );
}
