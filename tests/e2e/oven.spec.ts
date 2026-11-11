import { expect, type Page } from '@playwright/test';
import type { KekeHook } from '../../packages/client/src/game/hookTypes';
import { createRoom, game, noNpcs, teleportNear, test, toPlay, waitControlling } from './helpers';

// P2-2: the bakery oven on the second store map burns whoever stands on its hot floor. The HUD warns while
// we are on it, the oven sizzles, the feed says it burnt us, and HP goes down. Needs KEKE_DEBUG=1 (teleport).

type WithHook = { __KEKE__?: KekeHook };

/** maps/prisma.tmj `oven` zone: tiles x 4-5, y 16-21 of 32 px. */
const OVEN = { x: 5 * 32, y: 19 * 32 };
/** Bakery floor a few tiles east of the hot floor. */
const BAKERY = { x: 10 * 32, y: 19 * 32 };
/** config.json maxHp (Playwright cannot import @keke/shared). */
const MAX_HP = 100;

const sizzles = (page: Page) => page.evaluate(() => (globalThis as WithHook).__KEKE__?.sfx()['sizzle'] ?? 0);

/** The oven's ambient crackle level now (0 out of earshot). */
const crackle = (page: Page) =>
  page.evaluate(
    () => (globalThis as WithHook).__KEKE__?.ambient().find((a) => a.sound === 'ovenCrackle')?.volume ?? 0,
  );

test('standing on the oven floor burns: HP drops, the HUD warns, the oven sizzles', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));
  await toPlay(page, 'Baker', '?debug=1');
  await createRoom(page, { map: 'prisma' });
  await page.getByRole('button', { name: 'Ready', exact: true }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'game', { timeout: 10_000 });
  await expect(page.locator('body')).toHaveAttribute('data-map', 'prisma');
  await waitControlling(page);
  await noNpcs(page);

  const heat = page.locator('#keke-hud-heat');
  await expect(heat).toBeHidden();
  expect((await game(page)).net?.hp).toBe(MAX_HP);

  await teleportNear(page, OVEN, 8);
  await expect(heat).toBeVisible();
  await expect(heat).toHaveText(/too hot/i);
  await expect
    .poll(async () => (await game(page)).net?.hp ?? MAX_HP, { timeout: 5_000 })
    .toBeLessThan(MAX_HP);
  await expect.poll(() => sizzles(page), { timeout: 5_000 }).toBeGreaterThan(0);
  await expect.poll(() => crackle(page)).toBeGreaterThan(0.3);
  await expect(
    page.locator('#keke-hud-feed li[data-kind="hit"]').filter({ hasText: /burnt you/ }),
  ).toHaveCount(1);
  // The oven is no offence.
  expect(await page.evaluate(() => (globalThis as WithHook).__KEKE__?.wantedIcons() ?? [])).toEqual([]);

  await teleportNear(page, BAKERY, 8);
  await expect(heat).toBeHidden();
  // Out in the parking lot the crackle is silent.
  await teleportNear(page, { x: 1600, y: 1648 }, 32);
  await expect.poll(() => crackle(page)).toBe(0);
  await teleportNear(page, BAKERY, 8);
  const outside = (await game(page)).net?.hp ?? 0;
  await page.waitForTimeout(1_200);
  expect((await game(page)).net?.hp, 'no burns off the hot floor').toBe(outside);
  expect(pageErrors).toEqual([]);
});
