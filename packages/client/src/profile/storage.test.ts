import { DEFAULT_COLOR, DEFAULT_HAT, DEFAULT_NICKNAME, PLAYER_COLORS } from '@keke/shared';
import { describe, expect, it } from 'vitest';
import { loadProfile, PROFILE_STORAGE_KEY, saveProfile, type KeyValueStore } from './storage';

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (Object.hasOwn(data, key) ? (data[key] ?? null) : null),
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

const throwingStore: KeyValueStore = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

describe('profile storage', () => {
  it('gives defaults and saved=false on a first visit', () => {
    expect(loadProfile(memoryStore(), 16)).toEqual({
      profile: { nickname: DEFAULT_NICKNAME, color: DEFAULT_COLOR, hat: DEFAULT_HAT },
      saved: false,
    });
  });

  it('round-trips a saved profile', () => {
    const store = memoryStore();
    const color = PLAYER_COLORS[3];
    const saved = saveProfile(store, { nickname: '  Mikko  ', color, hat: 'chef' }, 16);
    expect(saved).toEqual({ nickname: 'Mikko', color, hat: 'chef' });
    expect(JSON.parse(store.data[PROFILE_STORAGE_KEY] ?? '')).toEqual(saved);
    expect(loadProfile(store, 16)).toEqual({ profile: saved, saved: true });
  });

  it('cuts the nickname to the max length', () => {
    const store = memoryStore();
    expect(saveProfile(store, { nickname: 'abcdefghij' }, 4).nickname).toBe('abcd');
  });

  it('repairs broken stored data field by field', () => {
    const store = memoryStore({
      [PROFILE_STORAGE_KEY]: JSON.stringify({ nickname: 'Juuso', color: 'red', hat: 'crown' }),
    });
    expect(loadProfile(store, 16).profile).toEqual({
      nickname: 'Juuso',
      color: DEFAULT_COLOR,
      hat: DEFAULT_HAT,
    });
  });

  it('survives unparsable JSON and a store that throws', () => {
    expect(loadProfile(memoryStore({ [PROFILE_STORAGE_KEY]: '{oops' }), 16).profile.nickname).toBe(
      DEFAULT_NICKNAME,
    );
    expect(loadProfile(throwingStore, 16).saved).toBe(false);
    expect(saveProfile(throwingStore, { nickname: 'Ok' }, 16).nickname).toBe('Ok');
    expect(loadProfile(undefined, 16).saved).toBe(false);
  });
});
