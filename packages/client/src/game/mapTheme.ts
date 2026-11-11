// Which theme a room or the offline walk plays (P1-5). The synced `GameState.mapId` names it; the
// offline walk takes `?map=`. A theme whose map file the client does not have yet (a map still being
// built, served by the e2e server's stand-in fixture map) draws the default map instead, so its brand
// name and colours show while the tiles, items and music come from a map that exists.
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

/**
 * The theme whose map file, tileset, item catalogue and music to load for `theme`: itself when the
 * client has its map file, else the default theme.
 */
export function assetTheme(theme: MapTheme, hasMap: (theme: MapTheme) => boolean): MapTheme {
  return hasMap(theme) ? theme : getTheme(defaultThemeId);
}

/** The synced map id from a room state ('' when the state has not arrived yet). */
export function stateMapId(state: unknown): string {
  if (typeof state !== 'object' || state === null) return '';
  const id = (state as Record<string, unknown>)['mapId'];
  return typeof id === 'string' ? id : '';
}
