// Room codes (§1 pillar 4, §15.3): 4 uppercase letters without ambiguous letters.
import type { Rng } from '../rng';

/** A–Z without I, L and O, which are easy to confuse with 1 and 0 when read aloud or off a screen. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';
export const ROOM_CODE_LENGTH = 4;

const CODE_PATTERN = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

/** True for a well-formed, already normalised code such as "KXBD". */
export function isRoomCode(value: unknown): value is string {
  return typeof value === 'string' && CODE_PATTERN.test(value);
}

/**
 * Turns what a player typed into a code: trims, drops inner spaces and dashes, uppercases.
 * Returns null when the result is not a valid code, so the client can say so before asking the server.
 */
export function normalizeRoomCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.replace(/[\s-]/g, '').toUpperCase();
  return isRoomCode(code) ? code : null;
}

/**
 * Draws a code that is not in `taken`. Throws after `maxAttempts` draws, which only happens
 * when nearly all of the 23^4 (about 280 000) codes are in use.
 */
export function generateRoomCode(
  rng: Rng,
  taken: ReadonlySet<string> = new Set(),
  maxAttempts = 1000,
): string {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += ROOM_CODE_ALPHABET[rng.int(0, ROOM_CODE_ALPHABET.length - 1)];
    }
    if (!taken.has(code)) return code;
  }
  throw new Error(`generateRoomCode: no free code found in ${maxAttempts} attempts`);
}
