import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import type {
  KekeHook,
  KekeNetSnapshot,
  KekePlayerSnapshot,
  KekeRemoteSnapshot,
} from '../../packages/client/src/game/hookTypes';

// Shared steps for the menu, lobby and multiplayer specs: Title → Profile → Play, create or join a room,
// ready up and start, then read the game through the `?debug=1` hook `window.__KEKE__`.

/** Opens the game (optionally with a query such as `?debug=1`) and walks Title → Profile → Play. */
export async function toPlay(page: Page, nickname: string, query = ''): Promise<void> {
  await page.goto(`/${query}`);
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'title', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Play' }).click();
  await page.getByLabel('Nickname').fill(nickname);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'play');
}

/** From Play: creates a room, waits for the lobby and returns the room code. */
export async function createRoom(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Create room' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'lobby', { timeout: 10_000 });
  await expect(page.locator('body')).toHaveAttribute('data-room', /^[A-Z]{4}$/);
  return (await page.locator('body').getAttribute('data-room')) ?? '';
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
  expect((await game(page)).net?.pendingInputs ?? Infinity).toBeLessThan(10);
}
