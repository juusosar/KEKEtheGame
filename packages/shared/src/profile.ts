// Player profile (§13.1): nickname, colour and hat. Shared so the client's Profile scene
// and the server's join validation apply the same rules.

/** Hat overlays from §11.1, in picker order. */
export const HAT_IDS = ['chef', 'cap', 'beanie', 'hairnet', 'hardhat'] as const;
export type HatId = (typeof HAT_IDS)[number];

/** Colour picker palette. Body sprites are greyscale and tinted with one of these at runtime. */
export const PLAYER_COLORS = [
  '#3FA9F5',
  '#E53935',
  '#43A047',
  '#FDD835',
  '#8E24AA',
  '#FB8C00',
  '#00ACC1',
  '#D81B60',
  '#6D4C41',
  '#7CB342',
  '#3949AB',
  '#F5F5F5',
] as const;
export type PlayerColor = (typeof PLAYER_COLORS)[number];

export const DEFAULT_NICKNAME = 'Player';
export const DEFAULT_COLOR: PlayerColor = PLAYER_COLORS[0];
export const DEFAULT_HAT: HatId = 'cap';

export interface PlayerProfile {
  nickname: string;
  color: PlayerColor;
  hat: HatId;
}

export function isHatId(value: unknown): value is HatId {
  return typeof value === 'string' && (HAT_IDS as readonly string[]).includes(value);
}

export function isPlayerColor(value: unknown): value is PlayerColor {
  return typeof value === 'string' && (PLAYER_COLORS as readonly string[]).includes(value.toUpperCase());
}

/**
 * Cleans a nickname: drops control characters, collapses whitespace, trims and cuts it to
 * `maxLength` characters (code points, so emoji are not split). Empty → DEFAULT_NICKNAME.
 */
export function sanitizeNickname(raw: unknown, maxLength: number): string {
  if (typeof raw !== 'string') return DEFAULT_NICKNAME;
  const cleaned = raw
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const cut = Array.from(cleaned).slice(0, Math.max(0, maxLength)).join('').trim();
  return cut === '' ? DEFAULT_NICKNAME : cut;
}

/**
 * Returns a valid profile from untrusted input (localStorage, join options).
 * Every field falls back to its default on its own, so one bad field never loses the others.
 * `maxLength` is `config.nicknameMaxLength`.
 */
export function sanitizeProfile(raw: unknown, maxLength: number): PlayerProfile {
  const obj = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const color = obj['color'];
  return {
    nickname: sanitizeNickname(obj['nickname'], maxLength),
    color: isPlayerColor(color) ? (color.toUpperCase() as PlayerColor) : DEFAULT_COLOR,
    hat: isHatId(obj['hat']) ? obj['hat'] : DEFAULT_HAT,
  };
}
