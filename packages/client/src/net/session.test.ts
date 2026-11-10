import type { Client, Room } from '@colyseus/sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  RESUME_STORAGE_KEY,
  currentRoom,
  loadResumeTicket,
  resumeRoom,
  saveResumeTicket,
  setCurrentRoom,
  waitForFirstState,
} from './session';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: () => null,
    get length() {
      return data.size;
    },
  };
}

/** Just enough of an SDK Room: a token and the two signals session.ts listens to. */
function fakeRoom(token: string) {
  const leave: (() => void)[] = [];
  const reconnect: (() => void)[] = [];
  const room = {
    reconnectionToken: token,
    sessionId: 'S1',
    onLeave: (cb: () => void) => leave.push(cb),
    onReconnect: (cb: () => void) => reconnect.push(cb),
  };
  return {
    room: room as unknown as Room,
    fireLeave: () => leave.forEach((cb) => cb()),
    fireReconnect: (next: string) => {
      room.reconnectionToken = next;
      reconnect.forEach((cb) => cb());
    },
  };
}

describe('resume ticket', () => {
  it('is saved on entering a room, follows token changes and is cleared on a real leave', () => {
    const storage = memoryStorage();
    const fake = fakeRoom('t1');
    setCurrentRoom({ room: fake.room, code: 'ABCD' }, storage);
    expect(loadResumeTicket(storage)).toEqual({ token: 't1', code: 'ABCD' });
    fake.fireReconnect('t2');
    expect(loadResumeTicket(storage)).toEqual({ token: 't2', code: 'ABCD' });
    fake.fireLeave();
    expect(loadResumeTicket(storage)).toBeNull();
  });

  it('ignores junk in storage', () => {
    const storage = memoryStorage();
    storage.setItem(RESUME_STORAGE_KEY, '{not json');
    expect(loadResumeTicket(storage)).toBeNull();
    storage.setItem(RESUME_STORAGE_KEY, JSON.stringify({ token: '', code: 'ABCD' }));
    expect(loadResumeTicket(storage)).toBeNull();
  });

  it('resumes the room with the saved token', async () => {
    const storage = memoryStorage();
    saveResumeTicket(storage, { token: 'tok', code: 'WXYZ' });
    const fake = fakeRoom('tok-2');
    const reconnect = vi.fn(() => Promise.resolve(fake.room));
    const resumed = await resumeRoom({ reconnect } as unknown as Client, storage);
    expect(reconnect).toHaveBeenCalledWith('tok');
    expect(resumed).toEqual({ room: fake.room, code: 'WXYZ' });
    expect(currentRoom()).toEqual(resumed);
    expect(loadResumeTicket(storage)).toEqual({ token: 'tok-2', code: 'WXYZ' });
  });

  it('clears the ticket when the seat is gone, and does nothing without one', async () => {
    const storage = memoryStorage();
    const reconnect = vi.fn(() => Promise.reject(new Error('expired')));
    const client = { reconnect } as unknown as Client;
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    expect(await resumeRoom(client, storage)).toBeNull();
    expect(reconnect).not.toHaveBeenCalled();

    saveResumeTicket(storage, { token: 'old', code: 'ABCD' });
    expect(await resumeRoom(client, storage)).toBeNull();
    expect(loadResumeTicket(storage)).toBeNull();
  });
});

describe('waitForFirstState', () => {
  function fakeRoom(state: unknown) {
    const listeners = new Set<(s: unknown) => void>();
    const onStateChange = Object.assign((cb: (s: unknown) => void) => listeners.add(cb), {
      remove: (cb: (s: unknown) => void) => listeners.delete(cb),
    });
    return {
      sessionId: 'me',
      state,
      onStateChange,
      listeners,
      emit(next: unknown) {
        this.state = next;
        for (const cb of [...listeners]) cb(next);
      },
    };
  }
  const hasMe = (s: unknown) => typeof s === 'object' && s !== null && 'me' in s;

  it('resolves at once when the state is already there', async () => {
    const room = fakeRoom({ me: 1 });
    await expect(waitForFirstState(room as never, hasMe, 1000)).resolves.toBe(true);
  });

  it('waits for the patch that brings the state, then stops listening', async () => {
    const room = fakeRoom({});
    const done = waitForFirstState(room as never, hasMe, 1000);
    room.emit({});
    room.emit({ me: 1 });
    await expect(done).resolves.toBe(true);
    expect(room.listeners.size).toBe(0);
  });

  it('gives up after the timeout', async () => {
    vi.useFakeTimers();
    const room = fakeRoom({});
    const done = waitForFirstState(room as never, hasMe, 1000);
    vi.advanceTimersByTime(1000);
    await expect(done).resolves.toBe(false);
    expect(room.listeners.size).toBe(0);
    vi.useRealTimers();
  });
});
