import { expect, type Page } from '@playwright/test';
import type { KekeHook } from '../../packages/client/src/game/hookTypes';
import {
  createRoom,
  joinRoom,
  noNpcs,
  players,
  requireDebugServer,
  test,
  toPlay,
  waitControlling,
} from './helpers';

// P2-5: pushable shopping carts in the second store's corral. The host walks into a cart and pushes it out
// of the corral; the server moves it and both players see it move; it rattles. Needs KEKE_DEBUG=1 (teleport).

type WithHook = { __KEKE__?: KekeHook };

/** config.json cartSizePx / 2 and playerHitboxSize / 2 (specs cannot import @keke/shared). */
const CART_HALF = 12;
const PLAYER_HALF = 10;

const carts = (page: Page) => page.evaluate(() => (globalThis as WithHook).__KEKE__?.carts() ?? []);
const drawn = (page: Page) => page.evaluate(() => (globalThis as WithHook).__KEKE__?.cartsDrawn() ?? []);

test('a player pushes a cart out of the corral and both players see it move', async ({
  newPlayer,
  request,
}) => {
  await requireDebugServer(request);
  test.setTimeout(90_000);
  const pageErrors: Error[] = [];
  const host = await newPlayer(pageErrors);
  const guest = await newPlayer(pageErrors);
  await toPlay(host, 'Pusher', '?debug=1');
  const code = await createRoom(host, { map: 'prisma' });
  await toPlay(guest, 'Watcher', '?debug=1');
  await joinRoom(guest, code);
  for (const page of [host, guest]) await expect(players(page)).toHaveCount(2);
  for (const page of [host, guest]) await page.getByRole('button', { name: 'Ready', exact: true }).click();
  await host.getByRole('button', { name: 'Start' }).click();
  for (const page of [host, guest]) {
    await expect(page.locator('body')).toHaveAttribute('data-scene', 'game', { timeout: 10_000 });
    await expect(page.locator('body')).toHaveAttribute('data-map', 'prisma');
  }
  await Promise.all([host, guest].map((page) => waitControlling(page)));
  await noNpcs(host);

  // Eight carts in the corral, synced and drawn on both clients.
  for (const page of [host, guest]) {
    await expect.poll(async () => (await carts(page)).length).toBe(8);
    await expect.poll(async () => (await drawn(page)).length).toBe(8);
  }
  const cart = (await carts(host)).find((c) => c.id === 1);
  if (!cart) throw new Error('no cart 1');
  expect(cart.dir).toBe('left');

  // Stand flush against its east side and walk west: it rolls out of the open side of the corral.
  const spot = { x: cart.x + CART_HALF + PLAYER_HALF + 0.5, y: cart.y };
  const moved = await host.evaluate(
    ({ x, y }) => (globalThis as WithHook).__KEKE__?.teleport(x, y) ?? false,
    spot,
  );
  expect(moved).toBe(true);
  await expect
    .poll(async () => {
      const p = await host.evaluate(() => (globalThis as WithHook).__KEKE__?.player());
      return p ? Math.hypot(p.x - spot.x, p.y - spot.y) : Infinity;
    })
    .toBeLessThan(2);
  await host.keyboard.down('KeyA');
  await host.waitForTimeout(1200);
  await host.keyboard.up('KeyA');

  for (const page of [host, guest]) {
    await expect
      .poll(async () => (await carts(page)).find((c) => c.id === 1)?.x ?? cart.x)
      .toBeLessThan(cart.x - 64);
    await expect
      .poll(async () => (await drawn(page)).find((c) => c.id === 1)?.x ?? cart.x)
      .toBeLessThan(cart.x - 64);
  }
  // Only the pushed cart moved; the pusher is behind it, not through it.
  const after = await carts(host);
  const pushed = after.find((c) => c.id === 1);
  const me = await host.evaluate(() => (globalThis as WithHook).__KEKE__?.player());
  expect(pushed && me && me.x > pushed.x).toBe(true);
  expect(after.find((c) => c.id === 2)).toMatchObject({ x: (await carts(guest)).find((c) => c.id === 2)?.x });
  // It rattled.
  const sfx = await host.evaluate(() => (globalThis as WithHook).__KEKE__?.sfx() ?? {});
  expect(sfx['cartRattle'] ?? 0).toBeGreaterThan(0);
  expect(pageErrors).toEqual([]);
});
