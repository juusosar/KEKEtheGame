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

/**
 * Team colours (§4.3: they replace player colours on outlines; hats stay individual). Index 0 is
 * team 1, index 1 is team 2. §4.3 names no colours, so these are placeholders like the palette.
 */
export const TEAM_COLORS = ['#E53935', '#3FA9F5'] as const;

/** Outline colour for team 1 or 2, or undefined for no team (0) and anything else. */
export function teamColor(team: number): string | undefined {
  return team === 1 || team === 2 ? TEAM_COLORS[team - 1] : undefined;
}

export const DEFAULT_NICKNAME = 'Player';
export const DEFAULT_COLOR: PlayerColor = PLAYER_COLORS[0];
export const DEFAULT_HAT: HatId = 'cap';

export interface PlayerProfile {
  nickname: string;
  color: PlayerColor;
  hat: HatId;
}

/**
 * A colour nobody in `taken` wears (playtest 1: every default profile was the same blue): `wanted`
 * itself when it is free, otherwise the next free palette colour after it, wrapping round. When every
 * palette colour is taken, `wanted` is kept. Comparison ignores case.
 */
export function distinctColor(wanted: PlayerColor, taken: Iterable<string>): PlayerColor {
  const used = new Set(Array.from(taken, (c) => c.toUpperCase()));
  const start = Math.max(0, PLAYER_COLORS.indexOf(wanted));
  for (let i = 0; i < PLAYER_COLORS.length; i++) {
    const color = PLAYER_COLORS[(start + i) % PLAYER_COLORS.length] as PlayerColor;
    if (!used.has(color)) return color;
  }
  return wanted;
}

export function isHatId(value: unknown): value is HatId {
  return typeof value === 'string' && (HAT_IDS as readonly string[]).includes(value);
}

export function isPlayerColor(value: unknown): value is PlayerColor {
  return typeof value === 'string' && (PLAYER_COLORS as readonly string[]).includes(value.toUpperCase());
}

/**
 * Control and format characters a nickname drops (M2 review F4): every control character (C0, DEL,
 * C1) and every invisible format character, such as zero-width spaces, direction marks, bidi
 * overrides and isolates, and the byte order mark. U+200D ZERO WIDTH JOINER stays, because emoji
 * sequences need it.
 */
const STRIPPED_CHARACTERS = /(?!\u200d)[\p{Cc}\p{Cf}]/gu;

/** A character that shows on its own: not whitespace, a joiner or a combining mark. */
const VISIBLE_CHARACTER = /[^\s\u200d\p{M}]/u;

/**
 * Cleans a nickname: drops control and invisible format characters, collapses whitespace, trims and
 * cuts it to `maxLength` characters (code points, so emoji are not split). Nothing visible left →
 * DEFAULT_NICKNAME.
 */
export function sanitizeNickname(raw: unknown, maxLength: number): string {
  if (typeof raw !== 'string') return DEFAULT_NICKNAME;
  const cleaned = raw.replace(STRIPPED_CHARACTERS, '').replace(/\s+/g, ' ').trim();
  const cut = Array.from(cleaned).slice(0, Math.max(0, maxLength)).join('').trim();
  return VISIBLE_CHARACTER.test(cut) ? cut : DEFAULT_NICKNAME;
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
