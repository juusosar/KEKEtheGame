import { describe, expect, it, vi } from 'vitest';

// Phaser needs a browser; the manager only touches a few constants and the scene's plugins,
// so a minimal stand-in is enough to check that it cleans up after itself.
vi.mock('phaser', () => ({
  default: {
    Input: {
      Keyboard: {
        Events: { ANY_KEY_DOWN: 'keydown', ANY_KEY_UP: 'keyup' },
        KeyCodes: { TAB: 9 },
      },
    },
    Core: { Events: { BLUR: 'blur' } },
    Scenes: { Events: { SHUTDOWN: 'shutdown' } },
  },
}));

const { CAPTURED_KEYS, InputManager } = await import('./InputManager');

/** Mimics Phaser's game-wide capture list, which outlives any one scene. */
function fakeScene() {
  const captures = new Set<number>();
  const listeners = new Map<string, unknown>();
  const once = new Map<string, () => void>();
  const keyboard = {
    on: (event: string, fn: unknown) => listeners.set(event, fn),
    off: (event: string) => listeners.delete(event),
    addCapture: (keys: number[]) => keys.forEach((k) => captures.add(k)),
    removeCapture: (keys: number[]) => keys.forEach((k) => captures.delete(k)),
  };
  const scene = {
    input: { keyboard, mouse: { disableContextMenu: () => undefined } },
    game: { events: { on: () => undefined, off: () => undefined } },
    events: { once: (event: string, fn: () => void) => once.set(event, fn) },
  };
  return { scene, captures, listeners, shutdown: () => once.get('shutdown')?.() };
}

describe('InputManager key capture', () => {
  it('captures Tab while the scene runs', () => {
    const f = fakeScene();
    new InputManager(f.scene as never);
    expect(CAPTURED_KEYS).toContain(9);
    expect([...f.captures]).toEqual([...CAPTURED_KEYS]);
  });

  it('releases the captures and listeners when the scene shuts down', () => {
    const f = fakeScene();
    new InputManager(f.scene as never);
    f.shutdown();
    expect(f.captures.size).toBe(0);
    expect(f.listeners.size).toBe(0);
  });
});
