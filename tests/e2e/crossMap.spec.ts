import { expect, type Page } from '@playwright/test';
import type { KekeHook } from '../../packages/client/src/game/hookTypes';
import { createRoom, joinRoom, players, requireDebugServer, test, toPlay, waitControlling } from './helpers';

// P3-3: two sessions on both maps (one round each), Timed then Race. On the second map both clients
// have the second store's twists (gate sprites, pushable carts synced and drawn, customers in the state
// and drawn, the bottle hum and oven crackle loops); on the first map nothing of them is left after the
// switch back (no stale sprites, loops or carts); in the second session the carts are back at their
// spawns although one was pushed in the first. NPCs stay on: customers are part of what is checked, and
// nothing here scripts a walk past them. Needs KEKE_DEBUG=1 (end phase, teleport).

type WithHook = { __KEKE__?: KekeHook };

/** config.json cartSizePx / 2 and playerHitboxSize / 2 (specs cannot import @keke/shared). */
const CART_HALF = 12;
const PLAYER_HALF = 10;

interface Twists {
  map: string;
  gates: number;
  carts: { id: number; x: number; y: number }[];
  cartsDrawn: number;
  customers: number;
  customerSprites: number;
  ambient: string[];
}

const twists = (page: Page): Promise<Twists> =>
  page.evaluate(() => {
    const keke = (globalThis as WithHook).__KEKE__;
    if (!keke) throw new Error('window.__KEKE__ is missing (load the page with ?debug=1)');
    return {
      map: keke.map.theme,
      gates: keke.gates().length,
      carts: keke
        .carts()
        .map((c) => ({ id: c.id, x: c.x, y: c.y }))
        .sort((a, b) => a.id - b.id),
      cartsDrawn: keke.cartsDrawn().length,
      customers: keke.npcs().filter((n) => n.type === 'customer').length,
      customerSprites: keke.npcSprites().filter((n) => n.type === 'customer').length,
      ambient: keke
        .ambient()
        .map((a) => a.sound)
        .sort(),
    };
  });

const endPhase = (page: Page) => page.evaluate(() => (globalThis as WithHook).__KEKE__?.endPhase() ?? false);

/** Nothing of the second store on this page: no gates, carts, customers or its ambient loops. */
async function expectFirstStore(page: Page): Promise<void> {
  await expect
    .poll(() => twists(page), { timeout: 10_000 })
    .toEqual({
      map: 'kespro',
      gates: 0,
      carts: [],
      cartsDrawn: 0,
      customers: 0,
      customerSprites: 0,
      ambient: [],
    });
}

/** The second store's twists on this page, synced and drawn, in a room of `playerCount` players. */
async function expectSecondStore(page: Page, playerCount: number): Promise<Twists> {
  await expect
    .poll(
      async () => {
        const t = await twists(page);
        return {
          map: t.map,
          gates: t.gates > 0,
          carts: t.carts.length,
          cartsDrawn: t.cartsDrawn,
          // 6 + players (npcs.json customer count).
          customers: t.customers,
          customerSprites: t.customerSprites,
          ambient: t.ambient,
        };
      },
      { timeout: 10_000 },
    )
    .toEqual({
      map: 'prisma',
      gates: true,
      carts: 8,
      cartsDrawn: 8,
      customers: 6 + playerCount,
      customerSprites: 6 + playerCount,
      ambient: ['bottleHum', 'ovenCrackle'],
    });
  return twists(page);
}

test('the second store’s twists come and go with the map across two Both sessions', async ({
  newPlayer,
  request,
}) => {
  await requireDebugServer(request);
  test.setTimeout(180_000);
  const pageErrors: Error[] = [];
  const host = await newPlayer(pageErrors);
  const guest = await newPlayer(pageErrors);
  const both = [host, guest];
  const forBoth = (check: (page: Page) => Promise<unknown>) => Promise.all(both.map(check));

  await toPlay(host, 'Kiertäjä', '?debug=1');
  const code = await createRoom(host, { map: 'both' });
  await toPlay(guest, 'Seuraaja', '?debug=1');
  await joinRoom(guest, code);
  for (const page of both) await expect(players(page)).toHaveCount(2);

  const startSession = async () => {
    for (const page of both) await page.getByRole('button', { name: 'Ready', exact: true }).click();
    await host.getByRole('button', { name: 'Start' }).click();
    await forBoth(async (page) => {
      await expect(page.locator('body')).toHaveAttribute('data-scene', 'game', { timeout: 10_000 });
      await expect(page.locator('body')).toHaveAttribute('data-map', 'kespro');
    });
    await forBoth(waitControlling);
  };
  /** Round results, then the countdown of round 2 on the second map. */
  const toSecondMap = async () => {
    expect(await endPhase(host)).toBe(true);
    await forBoth((page) => expect(page.locator('body')).toHaveAttribute('data-phase', 'roundResults'));
    expect(await endPhase(host)).toBe(true);
    await forBoth(async (page) => {
      await expect(page.locator('body')).toHaveAttribute('data-map', 'prisma', { timeout: 10_000 });
      await expect(page.locator('body')).toHaveAttribute('data-room', code);
    });
    await forBoth(waitControlling);
  };
  /** Round results, podium, lobby. */
  const toLobby = async () => {
    expect(await endPhase(host)).toBe(true);
    await forBoth((page) => expect(page.locator('body')).toHaveAttribute('data-phase', 'roundResults'));
    expect(await endPhase(host)).toBe(true);
    await forBoth((page) => expect(page.locator('body')).toHaveAttribute('data-phase', 'podium'));
    expect(await endPhase(host)).toBe(true);
    await forBoth((page) =>
      expect(page.locator('body')).toHaveAttribute('data-scene', 'lobby', { timeout: 10_000 }),
    );
  };

  // --- Session 1, Timed: first map, then the second. ---------------------------------------------------
  await startSession();
  await forBoth((page) => expectFirstStore(page));
  await toSecondMap();
  const [spawned] = await Promise.all(both.map((page) => expectSecondStore(page, 2)));
  if (!spawned) throw new Error('no twists');
  // Both clients agree on every cart.
  expect((await twists(guest)).carts).toEqual(spawned.carts);

  // The host pushes cart 1 out of the corral (carts.spec), so the next session can show it came back.
  const cart = spawned.carts.find((c) => c.id === 1);
  if (!cart) throw new Error('no cart 1');
  const spot = { x: cart.x + CART_HALF + PLAYER_HALF + 0.5, y: cart.y };
  expect(
    await host.evaluate(({ x, y }) => (globalThis as WithHook).__KEKE__?.teleport(x, y) ?? false, spot),
  ).toBe(true);
  await expect
    .poll(async () => {
      const p = await host.evaluate(() => (globalThis as WithHook).__KEKE__?.player());
      return p ? Math.hypot(p.x - spot.x, p.y - spot.y) : Infinity;
    })
    .toBeLessThan(2);
  await host.keyboard.down('KeyA');
  await host.waitForTimeout(1200);
  await host.keyboard.up('KeyA');
  await forBoth((page) =>
    expect
      .poll(async () => (await twists(page)).carts.find((c) => c.id === 1)?.x ?? cart.x)
      .toBeLessThan(cart.x - 64),
  );
  await toLobby();

  // --- Session 2, Race: the switch back to the first map leaves nothing of the second. ----------------
  await host.getByRole('button', { name: 'Quota + Race' }).click();
  await expect(guest.getByRole('button', { name: 'Quota + Race' })).toHaveAttribute('aria-pressed', 'true');
  await startSession();
  await forBoth((page) => expectFirstStore(page));
  await toSecondMap();
  await forBoth(async (page) => {
    const again = await expectSecondStore(page, 2);
    // Every cart is back at its spawn, cart 1 too.
    expect(again.carts).toEqual(spawned.carts);
  });
  await toLobby();
  expect(pageErrors).toEqual([]);
});
