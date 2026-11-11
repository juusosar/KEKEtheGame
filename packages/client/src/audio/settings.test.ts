import { describe, expect, it } from 'vitest';
import type { KeyValueStore } from '../profile/storage';
import {
  AUDIO_STORAGE_KEY,
  DEFAULT_AUDIO_SETTINGS,
  busGains,
  loadAudioSettings,
  sanitizeAudioSettings,
  saveAudioSettings,
} from './settings';

function memory(initial: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

describe('audio settings', () => {
  it('defaults on first visit and when storage is missing or broken', () => {
    expect(loadAudioSettings(memory())).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(loadAudioSettings(undefined)).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(loadAudioSettings(memory({ [AUDIO_STORAGE_KEY]: '{not json' }))).toEqual(DEFAULT_AUDIO_SETTINGS);
    const throwing: KeyValueStore = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadAudioSettings(throwing)).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(saveAudioSettings(throwing, { master: 0.2 }).master).toBe(0.2);
  });

  it('round-trips through storage', () => {
    const store = memory();
    saveAudioSettings(store, { master: 0.3, music: 0, sfx: 1, muted: true });
    expect(loadAudioSettings(store)).toEqual({ master: 0.3, music: 0, sfx: 1, muted: true });
  });

  it('cleans fields one by one', () => {
    expect(sanitizeAudioSettings({ master: 2, music: -1, sfx: 'loud', muted: 'yes' })).toEqual({
      master: 1,
      music: 0,
      sfx: DEFAULT_AUDIO_SETTINGS.sfx,
      muted: false,
    });
    expect(sanitizeAudioSettings({ master: 0.123456 }).master).toBe(0.12);
    expect(sanitizeAudioSettings({ music: Number.NaN }).music).toBe(DEFAULT_AUDIO_SETTINGS.music);
  });

  it('scales each bus by master and silences both when muted', () => {
    expect(busGains({ master: 0.5, music: 0.4, sfx: 1, muted: false })).toEqual({ music: 0.2, sfx: 0.5 });
    expect(busGains({ master: 1, music: 1, sfx: 1, muted: true })).toEqual({ music: 0, sfx: 0 });
  });
});
