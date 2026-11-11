// Volume settings (§12): master, music and SFX volume plus mute, saved in localStorage so they survive
// reloads. Pure apart from the store passed in; anything read back is cleaned field by field.
import type { KeyValueStore } from '../profile/storage';

export const AUDIO_STORAGE_KEY = 'keke.audio';

export interface AudioSettings {
  /** 0..1 */
  master: number;
  /** 0..1, scaled by master. */
  music: number;
  /** 0..1, scaled by master. */
  sfx: number;
  muted: boolean;
}

export const DEFAULT_AUDIO_SETTINGS: Readonly<AudioSettings> = {
  master: 0.8,
  // Playtest 1: at 0.5 the loop sat as loud as the KO, deposit and swing sounds.
  music: 0.35,
  sfx: 0.8,
  muted: false,
};

function level(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  // Two decimals: the sliders step by 0.01, and stored values stay readable.
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
}

/** Cleans anything into settings: missing or invalid fields take the default. */
export function sanitizeAudioSettings(raw: unknown): AudioSettings {
  const bag = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    master: level(bag['master'], DEFAULT_AUDIO_SETTINGS.master),
    music: level(bag['music'], DEFAULT_AUDIO_SETTINGS.music),
    sfx: level(bag['sfx'], DEFAULT_AUDIO_SETTINGS.sfx),
    muted: typeof bag['muted'] === 'boolean' ? bag['muted'] : DEFAULT_AUDIO_SETTINGS.muted,
  };
}

export function loadAudioSettings(store: KeyValueStore | undefined): AudioSettings {
  let raw: string | null = null;
  try {
    raw = store?.getItem(AUDIO_STORAGE_KEY) ?? null;
  } catch {
    // Unreadable storage: defaults for this visit.
  }
  if (raw === null) return sanitizeAudioSettings({});
  try {
    return sanitizeAudioSettings(JSON.parse(raw));
  } catch {
    return sanitizeAudioSettings({});
  }
}

/** Cleans and stores the settings, returning what was stored. A failing store is ignored. */
export function saveAudioSettings(store: KeyValueStore | undefined, settings: unknown): AudioSettings {
  const clean = sanitizeAudioSettings(settings);
  try {
    store?.setItem(AUDIO_STORAGE_KEY, JSON.stringify(clean));
  } catch {
    // The settings still apply for this visit.
  }
  return clean;
}

/** The gain each bus gets: master times its own level, or silence while muted. */
export function busGains(s: AudioSettings): { music: number; sfx: number } {
  if (s.muted) return { music: 0, sfx: 0 };
  return { music: s.master * s.music, sfx: s.master * s.sfx };
}
