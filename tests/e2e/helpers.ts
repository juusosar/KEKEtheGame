import {
  test as base,
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import type {
  KekeHook,
  KekeNetSnapshot,
  KekePlayerSnapshot,
  KekeRemoteSnapshot,
} from '../../packages/client/src/game/hookTypes';

// Shared steps for the menu, lobby and multiplayer specs: Title → Profile → Play, create or join a room,
// ready up and start, then read the game through the `?debug=1` hook `window.__KEKE__`.

/**
 * Opens the game (optionally with a query such as `?debug=1`) and walks Title → Profile → Play. The
 * first-time How to play tutorial over the lobby is marked seen, so it never covers a spec's lobby;
 * `{ tutorial: true }` leaves it to show (howToLobby.spec.ts).
 */
export async function toPlay(
  page: Page,
  nickname: string,
  query = '',
  { tutorial = false }: { tutorial?: boolean } = {},
): Promise<void> {
  await page.goto(`/${query}`);
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'title', { timeout: 15_000 });
  if (!tutorial) {
    await page.evaluate(() =>
      (
        globalThis as unknown as { localStorage: { setItem(k: string, v: string): void } }
      ).localStorage.setItem('keke.howToSeen', '1'),
    );
  }
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByLabel('Nickname').fill(nickname);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'play');
}

/** Lobby map choices (P1-5): a theme id or both. Specs cannot import @keke/shared's MapChoice. */
export type E2eMapChoice = 'kespro' | 'prisma' | 'both';

/** The Lobby's map picker button for a choice (found by data attribute: store names stay out of specs). */
export const mapChoice = (page: Page, choice: E2eMapChoice) =>
  page.locator(`#keke-lobby button[data-map-choice="${choice}"]`);

/**
 * From Play: creates a room, waits for the lobby and returns the room code. With `map`, the host then
 * picks that map in the lobby and waits for the server to confirm it (P1-5). Both maps are loaded, so
 * every choice can be picked.
 */
export async function createRoom(page: Page, { map }: { map?: E2eMapChoice } = {}): Promise<string> {
  const code = await createRoomOnly(page);
  if (map !== undefined) {
    const button = mapChoice(page, map);
    await expect(button).toBeEnabled();
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
  }
  return code;
}

async function createRoomOnly(page: Page): Promise<string> {
  // Create room opens the room setup menu; Open lobby there creates the room with its choices.
  await openRoomSetup(page);
  const create = page.locator('#keke-setup-create');
  await create.click();
  // On a page drawing a few fps the click was lost once or twice in many runs (M4 review F1 note): the
  // status stayed empty and the buttons enabled, so create never started. Not reproduced by hand;
  // if the click left no trace after 3 s, click again (a started create disables the button).
  // One evaluate, no auto-waiting locators: the button is gone once the Lobby has taken over.
  const noTrace = () =>
    page.evaluate(() => {
      const doc = (globalThis as unknown as { document: { body: { dataset: Record<string, string> } } })
        .document;
      const q = (sel: string) =>
        (globalThis as unknown as { document: { querySelector(s: string): unknown } }).document.querySelector(
          sel,
        ) as { textContent: string | null; disabled?: boolean } | null;
      const button = q('#keke-setup-create');
      return (
        doc.body.dataset['scene'] === 'play' &&
        button !== null &&
        button.disabled !== true &&
        (q('#keke-setup p.status')?.textContent ?? '') === ''
      );
    });
  const lost = await expect
    .poll(noTrace, { timeout: 3_000 })
    .toBe(false)
    .then(
      () => false,
      () => true,
    );
  if (lost) {
    console.warn('[e2e] Create room click left no trace; clicking again');
    await create.click();
  }
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'lobby', { timeout: 10_000 });
  await expect(page.locator('body')).toHaveAttribute('data-room', /^[A-Z]{4}$/);
  // We made this room, so we host it: only the host sees Start. A click that slipped onto another
  // spec's Join button would land us in their lobby as a guest, so fail loudly here (M5 review F7).
  await expect(
    page.getByRole('button', { name: 'Start' }),
    'createRoom: this page should host the new room, not have joined another',
  ).toBeVisible();
  return (await page.locator('body').getAttribute('data-room')) ?? '';
}

/** From Play: Create room, then wait for the room setup menu. */
export async function openRoomSetup(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Create room' }).click();
  await expect(page.locator('#keke-setup')).toBeVisible();
}

/** From Play: joins a room by its code and waits for the lobby. */
export async function joinRoom(page: Page, code: string): Promise<void> {
  await page.getByLabel('Room code').fill(code);
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'lobby', { timeout: 10_000 });
  await expect(page.locator('body')).toHaveAttribute('data-room', code);
}

export const players = (page: Page) => page.getByRole('list', { name: 'Players' }).locator('li');
export const row = (page: Page, name: string) => players(page).filter({ hasText: name });

/**
 * The Playwright `test` with a `newPlayer` fixture: a page in its own browser context (own storage, so
 * each is a separate player) whose page errors land in `pageErrors`. The contexts close when the test
 * ends; left open, their game loops keep running and slow down every later test in the worker.
 */
export const test = base.extend<{ newPlayer: (pageErrors: Error[]) => Promise<Page> }>({
  newPlayer: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [];
    await use(async (pageErrors) => {
      const context = await browser.newContext();
      contexts.push(context);
      const page = await context.newPage();
      page.on('pageerror', (err) => pageErrors.push(err));
      return page;
    });
    for (const context of contexts) await context.close();
  },
});

type WithHook = { __KEKE__?: KekeHook };

export interface GameSnapshot {
  net: KekeNetSnapshot | null;
  player: KekePlayerSnapshot;
  remotes: KekeRemoteSnapshot[];
}

/** Reads the netcode state, the local player and the remote players from `window.__KEKE__`. */
export const game = (page: Page): Promise<GameSnapshot> =>
  page.evaluate(() => {
    const hook = (globalThis as WithHook).__KEKE__;
    if (!hook) throw new Error('window.__KEKE__ is missing (load the page with ?debug=1)');
    return { net: hook.net(), player: hook.player(), remotes: hook.remotePlayers() };
  });

/** Where `page` currently draws the remote player called `nickname`, or null if it does not see them. */
export async function remoteSeen(page: Page, nickname: string): Promise<{ x: number; y: number } | null> {
  const found = (await game(page)).remotes.find((p) => p.nickname === nickname);
  return found ? { x: found.x, y: found.y } : null;
}

/**
 * The e2e server's countdown (tests/e2e/config.e2e.json, merged over config.json through KEKE_CONFIG in
 * playwright.config.ts). Copied here because specs cannot import JSON from the shared package.
 */
export const E2E_COUNTDOWN_SECONDS = 6;
/** config.e2e.json respawnSeconds: longer than config.json's 3 s, so a slow page still sees the KO screen. */
export const E2E_RESPAWN_SECONDS = 6;

/** How long to wait from Start until the round is playing: the countdown plus the scene switch. */
export const UNTIL_PLAYING_MS = (E2E_COUNTDOWN_SECONDS + 10) * 1000;

/** Waits for the countdown to end, i.e. until the local player is predicted and sends inputs. */
export async function waitControlling(page: Page): Promise<void> {
  await expect
    .poll(async () => (await game(page)).net?.controlling, { timeout: UNTIL_PLAYING_MS })
    .toBe(true);
}

/**
 * After the player lets go of the keys: the server keeps acking our (idle) inputs and agrees with the
 * prediction. The client sends a frame every fixed step even when idle, so a few inputs are always in
 * flight; waiting for exactly zero pending is a race, so this checks the ack moves on instead.
 */
export async function expectSettled(page: Page): Promise<void> {
  const ackAtRelease = (await game(page)).net?.ack ?? 0;
  await expect
    .poll(async () => (await game(page)).net?.ack ?? 0, { timeout: 5_000 })
    .toBeGreaterThan(ackAtRelease + 5);
  await expect
    .poll(async () => (await game(page)).net?.lastCorrection ?? Infinity, { timeout: 5_000 })
    .toBeLessThan(1);
  // Polled like the two above: under load a page can still be draining its queue (M6 review F3).
  await expect
    .poll(async () => (await game(page)).net?.pendingInputs ?? Infinity, { timeout: 5_000 })
    .toBeLessThan(10);
}

/**
 * Fails early, with a clear message, when the server under test does not accept the debug-only room
 * messages (teleport, end phase). Locally Playwright reuses a server already on the e2e port, and one
 * started without KEKE_DEBUG=1 refuses them (M3 review F5). Call it first in specs that use them.
 */
export async function requireDebugServer(request: APIRequestContext): Promise<void> {
  const res = await request.get('/healthz');
  expect(res.ok(), 'GET /healthz on the server under test').toBe(true);
  const health = (await res.json()) as { ok?: boolean; debug?: boolean };
  expect(
    health.debug,
    'the server on the e2e port was not started with KEKE_DEBUG=1; stop it or run with CI=1',
  ).toBe(true);
}

/**
 * Points the mouse from `from` toward `to` (world pixels), 120 CSS px out from where `from` is on screen.
 * Uses the hook's `screenPoint`, so it works when the camera is clamped at a map edge or still catching up.
 */
export async function aimMouse(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  const origin = await page.evaluate(({ x, y }) => {
    const k = (globalThis as WithHook).__KEKE__;
    if (!k) throw new Error('window.__KEKE__ is missing (load the page with ?debug=1)');
    return k.screenPoint(x, y);
  }, from);
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  await page.mouse.move(origin.x + Math.cos(angle) * 120, origin.y + Math.sin(angle) * 120);
}

/**
 * The butcher's behind_counter zone on the kespro map (maps/kespro.tmj, pixels; Playwright cannot import
 * @keke/shared). The butcher (M5-6) cleaves anyone standing there, so specs that meet up to fight or
 * count HP pick a spot outside it.
 */
const BEHIND_COUNTER = { x: 1600, y: 1312, w: 352, h: 160 };

/** True when `at` is inside the butcher's zone or within `margin` px of it. */
export function nearButcherCounter(at: { x: number; y: number }, margin = 64): boolean {
  const z = BEHIND_COUNTER;
  return at.x > z.x - margin && at.x < z.x + z.w + margin && at.y > z.y - margin && at.y < z.y + z.h + margin;
}

/**
 * Host only: asks the debug server to remove the store workers from this room for good (`__KEKE__.noNpcs()`),
 * then waits until none is synced. For specs that are not about NPCs: a stocker, guard, butcher or forklift
 * would otherwise join a scripted fight or knock a scripted walk off course (M7 review F4).
 */
export async function noNpcs(host: Page): Promise<void> {
  const asked = await host.evaluate(() => (globalThis as WithHook).__KEKE__?.noNpcs() ?? false);
  expect(asked, 'noNpcs needs an online room').toBe(true);
  await expect
    .poll(() => host.evaluate(() => (globalThis as WithHook).__KEKE__?.npcs().length ?? -1))
    .toBe(0);
}

/**
 * Asks the server to move us next to `at`, trying spots around it until one is free of walls (the
 * hook checks the map locally), then waits until our predicted body is there.
 */
export async function teleportNear(page: Page, at: { x: number; y: number }, reach: number): Promise<void> {
  const spot = await page.evaluate(
    ({ x, y, reach }) => {
      const keke = (globalThis as WithHook).__KEKE__;
      if (!keke) throw new Error('window.__KEKE__ is missing');
      const offsets: [number, number][] = [[0, 0]];
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        offsets.push([Math.cos(a) * reach, Math.sin(a) * reach]);
      }
      for (const [dx, dy] of offsets) {
        if (keke.teleport(x + dx, y + dy)) return { x: x + dx, y: y + dy };
      }
      return null;
    },
    { ...at, reach },
  );
  expect(spot, 'a free spot next to the destination').not.toBeNull();
  await expect
    .poll(async () => {
      const p = (await game(page)).player;
      return Math.hypot(p.x - (spot?.x ?? 0), p.y - (spot?.y ?? 0));
    })
    .toBeLessThan(2);
}

/**
 * Replaces navigator.getGamepads with one standard-mapping pad (Phaser polls it every frame) that the
 * spec drives through `tapPad` / `setPadAxis`. Call before `page.goto`.
 */
export async function installFakePad(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
    const axes = [0, 0, 0, 0];
    // Phaser ignores a pad whose timestamp is older than the moment it first saw it.
    const pad = {
      id: 'e2e pad',
      index: 0,
      connected: true,
      mapping: 'standard',
      timestamp: 0,
      axes,
      buttons,
    };
    const nav = (globalThis as unknown as { navigator: object }).navigator;
    Object.defineProperty(nav, 'getGamepads', { value: () => [pad, null, null, null] });
    (globalThis as unknown as { __pad: unknown }).__pad = {
      set(i: number, down: boolean): void {
        buttons[i] = { pressed: down, touched: down, value: down ? 1 : 0 };
        pad.timestamp = performance.now();
      },
      axis(i: number, value: number): void {
        axes[i] = value;
        pad.timestamp = performance.now();
      },
    };
  });
}

type FakePad = { __pad?: { set(i: number, down: boolean): void; axis(i: number, value: number): void } };

/** Presses and releases one button of the fake pad, holding each long enough for a frame to see it. */
export async function tapPad(page: Page, button: number): Promise<void> {
  await page.evaluate((i) => (globalThis as FakePad).__pad?.set(i, true), button);
  await page.waitForTimeout(150);
  await page.evaluate((i) => (globalThis as FakePad).__pad?.set(i, false), button);
  await page.waitForTimeout(150);
}

/** Sets one stick axis (standard mapping: 0/1 left stick, 2/3 right stick) of the fake pad. */
export async function setPadAxis(page: Page, axis: number, value: number): Promise<void> {
  await page.evaluate(([i, v]) => (globalThis as FakePad).__pad?.axis(i ?? 0, v ?? 0), [axis, value]);
}

/**
 * Theme primary colours (packages/shared/src/theme/; Playwright cannot import @keke/shared), lower case.
 * The in-round layers (HUD, in-game menu, spectator banner) take their accent from the room's map (P1 review F2).
 */
export const THEME_PRIMARY = { kespro: '#ff6a13', prisma: '#00a651' } as const;

type StyleWindow = {
  document: { querySelector(selector: string): unknown };
  getComputedStyle(el: unknown): { getPropertyValue(name: string): string };
};

/** The computed `--keke-accent` of the in-round HUD and in-game menu, lower case. */
export const roundAccents = (page: Page) =>
  page.evaluate(() => {
    const w = globalThis as unknown as StyleWindow;
    return ['#keke-hud', '#keke-game-menu'].map((selector) => {
      const el = w.document.querySelector(selector);
      return el ? w.getComputedStyle(el).getPropertyValue('--keke-accent').trim().toLowerCase() : null;
    });
  });
