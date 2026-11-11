// Which theme a room or the offline walk plays (P1-5). The synced `GameState.mapId` names it; the
// offline walk takes `?map=`. Every theme has its map file in the client bundle (mapSource.test.ts); a
// missing one fails loudly rather than drawing another map under its name (P1 review F8).
import { defaultThemeId, getTheme, themes, type MapTheme, type ThemeId } from '@keke/shared';

/** True for a known theme id. */
export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(themes, value);
}

/** The theme with this id; the default theme for anything else ('' before the first patch, junk). */
export function themeFor(id: unknown): MapTheme {
  return getTheme(isThemeId(id) ? id : defaultThemeId);
}

/** The offline walk's theme from the page query: `?map=<theme id>`. */
export function themeFromQuery(search: string): MapTheme {
  return themeFor(new URLSearchParams(search).get('map'));
}

/** The synced map id from a room state ('' when the state has not arrived yet). */
export function stateMapId(state: unknown): string {
  if (typeof state !== 'object' || state === null) return '';
  const id = (state as Record<string, unknown>)['mapId'];
  return typeof id === 'string' ? id : '';
}
