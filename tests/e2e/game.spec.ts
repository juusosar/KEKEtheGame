import { expect, test, type Page } from '@playwright/test';
import type { KekeHook } from '../../packages/client/src/game/hookTypes';

// M1 smoke: the Game scene loads with ?debug=1 (&scene=game skips the menus), exposes window.__KEKE__,
// and a keypress moves the player.
// The root tsconfig has no DOM lib, so page code reads the hook through globalThis.
type Snapshot = { x: number; y: number; zone: string | null };
type WithHook = { __KEKE__?: KekeHook };

const player = (page: Page): Promise<Snapshot> =>
  page.evaluate(() => {
    const hook = (globalThis as WithHook).__KEKE__;
    if (!hook) throw new Error('window.__KEKE__ is missing');
    const p = hook.player();
    return { x: p.x, y: p.y, zone: p.zone };
  });

test('game scene: the player walks on a keypress and the debug hook reports it', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  await page.goto('/?debug=1&scene=game');
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'game', { timeout: 15_000 });
  await page.waitForFunction(() => (globalThis as WithHook).__KEKE__ !== undefined);
  await expect(page.locator('#keke-debug')).toBeVisible();

  const start = await player(page);
  expect(start.zone).toBe('loading_dock');

  // Hold D (walk right / east) long enough for several frames.
  await page.locator('canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.down('KeyD');
  await expect.poll(async () => (await player(page)).x, { timeout: 5_000 }).toBeGreaterThan(start.x + 10);
  await page.keyboard.up('KeyD');

  const after = await player(page);
  expect(after.y).toBeCloseTo(start.y, 5);

  // Walls stop the player: teleporting into one is refused.
  const intoWall = await page.evaluate(() => (globalThis as WithHook).__KEKE__?.teleport(1, 1));
  expect(intoWall).toBe(false);
  const toNaN = await page.evaluate(() => (globalThis as WithHook).__KEKE__?.teleport(NaN, NaN));
  expect(toNaN).toBe(false);

  expect(pageErrors).toEqual([]);
});
