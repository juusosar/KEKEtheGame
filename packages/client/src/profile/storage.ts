// The player's profile (§13.1) lives in localStorage so it survives reloads. Everything read back goes
// through the shared sanitizeProfile, the same rules the server applies to join options.
import { sanitizeProfile, type PlayerProfile } from '@keke/shared';

export const PROFILE_STORAGE_KEY = 'keke.profile';

/** The part of the Web Storage API we use; tests pass an in-memory stand-in. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface LoadedProfile {
  profile: PlayerProfile;
  /** False on the first visit (nothing stored yet, or storage unreadable). */
  saved: boolean;
}

/** Reads the saved profile. Missing, unparsable or invalid data falls back to defaults field by field. */
export function loadProfile(store: KeyValueStore | undefined, maxLength: number): LoadedProfile {
  let raw: string | null = null;
  try {
    raw = store?.getItem(PROFILE_STORAGE_KEY) ?? null;
  } catch {
    // Storage can throw (privacy mode, blocked site data); play on with defaults.
  }
  if (raw === null) return { profile: sanitizeProfile({}, maxLength), saved: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }
  return { profile: sanitizeProfile(parsed, maxLength), saved: true };
}

/** Cleans and stores the profile, returning what was stored. A failing store is ignored. */
export function saveProfile(
  store: KeyValueStore | undefined,
  profile: unknown,
  maxLength: number,
): PlayerProfile {
  const clean = sanitizeProfile(profile, maxLength);
  try {
    store?.setItem(PROFILE_STORAGE_KEY, JSON.stringify(clean));
  } catch {
    // See loadProfile: the profile still works for this visit.
  }
  return clean;
}

/** window.localStorage, or undefined where reading it throws. */
export function browserStorage(): KeyValueStore | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
