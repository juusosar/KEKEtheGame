import { expect, type Page } from '@playwright/test';
import type { KekeHook } from '../../packages/client/src/game/hookTypes';
import {
  createRoom,
  game,
  joinRoom,
  noNpcs,
  players,
  requireDebugServer,
  teleportNear,
  test,
  toPlay,
  waitControlling,
} from './helpers';

// M6-3: a Quota + Race round won through the UI with two players. The host picks the mode in the lobby,
// fills the van to one short of the quota (debug aid), banks their target, which packs the order box,
// and runs it to the office. Both clients see the quota bar, the box on the carrier, the office arrow,
// the race feed lines and minimap markers, a race scoreboard, and a results banner naming the winner.
// Needs the e2e server's KEKE_DEBUG=1 (teleport and van points are debug-only).

type WithHook = { __KEKE__?: KekeHook };

/** config.json raceQuota (Playwright cannot import @keke/shared). */
const RACE_QUOTA = 6;
/** Centre of the kespro office trigger (maps/kespro.tmj bounds x 3616-3776, y 1056-1504), walkable. */
const OFFICE = { x: 3696, y: 1280 };

const hook = (page: Page) =>
  page.evaluate(() => {
    const keke = (globalThis as WithHook).__KEKE__;
    if (!keke) throw new Error('window.__KEKE__ is missing (load the page with ?debug=1)');
    return {
      tile: keke.map.tileSize,
      items: keke.items(),
      vans: keke.vans(),
      minimap: keke.minimap(),
      raceEvents: keke.raceEvents(),
    };
  });

test('a Quota + Race round: quota bar, packed box, office arrow, delivery and results', async ({
  newPlayer,
  request,
}) => {
  await requireDebugServer(request);
  test.setTimeout(90_000);
  const pageErrors: Error[] = [];
  const host = await newPlayer(pageErrors);
  const guest = await newPlayer(pageErrors);

  await toPlay(host, 'Hostia', '?debug=1');
  const code = await createRoom(host);
  await toPlay(guest, 'Vieras', '?debug=1');
  await joinRoom(guest, code);
  for (const page of [host, guest]) await expect(players(page)).toHaveCount(2);
  await host.getByRole('button', { name: 'Quota + Race' }).click();
  await expect(guest.getByRole('button', { name: 'Quota + Race' })).toHaveAttribute('aria-pressed', 'true');
  for (const page of [host, guest]) await page.getByRole('button', { name: 'Ready', exact: true }).click();
  await host.getByRole('button', { name: 'Start' }).click();
  // Per-page checks run on both pages at once, so a slow page cannot eat the other's phase window.
  const forBoth = (check: (page: Page) => Promise<void>) => Promise.all([host, guest].map(check));

  await forBoth(async (page) => {
    await expect(page.locator('body')).toHaveAttribute('data-scene', 'game', { timeout: 10_000 });
    await expect(page.getByRole('dialog', { name: 'Get ready' }).locator('.intro-mode')).toHaveText(
      'Quota + Race',
    );
  });
  await forBoth(async (page) => {
    await waitControlling(page);
    await expect(page.locator('body')).toHaveAttribute('data-phase', 'playing');
    // The race runs 240 s, so the clock starts above Timed's 180 s.
    expect(Number(await page.locator('#keke-hud-timer').getAttribute('data-seconds'))).toBeGreaterThan(180);
    const quota = page.getByRole('meter', { name: 'Order quota' });
    await expect(quota).toHaveAttribute('data-points', '0');
    await expect(quota).toHaveAttribute('data-quota', String(RACE_QUOTA));
    await expect(quota).toHaveAttribute('data-state', 'collecting');
    // The office is on everyone's minimap in race mode.
    await expect.poll(async () => (await hook(page)).minimap.some((m) => m.kind === 'office')).toBe(true);
  });
  await noNpcs(host);

  const hostId = (await game(host)).net?.sessionId ?? '';
  const guestId = (await game(guest)).net?.sessionId ?? '';
  expect(hostId).not.toBe('');

  // One short of the quota: the next deposit packs the box.
  expect(
    await host.evaluate((n) => (globalThis as WithHook).__KEKE__?.vanPoints(n) ?? false, RACE_QUOTA - 1),
  ).toBe(true);
  const quota = host.getByRole('meter', { name: 'Order quota' });
  await expect(quota).toHaveAttribute('data-points', String(RACE_QUOTA - 1));
  await expect(quota).toHaveText(`Order box ${RACE_QUOTA - 1} / ${RACE_QUOTA}`);

  // Pick up our target (retried: the butcher may knock us off a spot behind the meat counter).
  const targetId = (await game(host)).net?.target ?? 0;
  expect(targetId).toBeGreaterThan(0);
  const before = await hook(host);
  const target = before.items.find((i) => i.id === targetId);
  if (!target) throw new Error(`target ${targetId} is not drawn`);
  await expect(async () => {
    await teleportNear(host, { x: target.serverX, y: target.serverY }, before.tile * 0.6);
    await host.keyboard.down('KeyE');
    await host.waitForTimeout(150);
    await host.keyboard.up('KeyE');
    await expect.poll(async () => (await game(host)).net?.carrying, { timeout: 3_000 }).toBe(targetId);
  }).toPass({ timeout: 30_000 });

  // Bank it at our van: the van reaches the quota, the items are packed and we carry the order box.
  const vanSlot = (await game(host)).net?.van;
  const van = before.vans.find((v) => v.van === vanSlot);
  if (!van) throw new Error(`van ${vanSlot} is not drawn`);
  await teleportNear(host, { x: van.x, y: van.y }, before.tile);
  await expect
    .poll(async () => (await hook(host)).items.find((i) => i.itemId === 'order_box')?.carrier ?? '')
    .toBe(hostId);
  const box = (await hook(host)).items.find((i) => i.itemId === 'order_box');
  expect(box).toMatchObject({ state: 'carried', frame: 'order_box', outline: null, packedVan: vanSlot });
  const points = box?.points ?? 0;
  expect(points).toBeGreaterThanOrEqual(RACE_QUOTA);

  // The feed lines first, on both pages at once: they fade after 6 s, and the checks below can take
  // longer than that on a busy machine.
  await Promise.all([
    expect(host.locator('#keke-hud-feed li[data-kind="packed"]')).toHaveText(
      'Your order box is packed: take it to the office!',
    ),
    expect(guest.locator('#keke-hud-feed li[data-kind="packed"]')).toHaveText(
      `Hostia packed an order box (${points} items)`,
    ),
  ]);

  // Our HUD: the box in the carry slot, the arrow to the office, the quota bar calling for a delivery.
  const carry = host.getByRole('region', { name: 'Carrying' });
  await expect(carry).toHaveAttribute('data-item-id', 'order_box');
  await expect(carry.locator('.hud-name')).toHaveText('Order box');
  await expect(host.locator('#keke-hud-arrow')).toHaveAttribute('data-kind', 'office');
  await expect(host.getByRole('img', { name: 'Arrow to the office' })).toHaveCount(1);
  await expect(quota).toHaveAttribute('data-state', 'deliver');
  await expect(quota).toHaveAttribute('data-points', '0');

  await forBoth(async (page) => {
    // Everyone sees the box above the carrier and the carrier on the minimap.
    await expect
      .poll(async () => (await hook(page)).items.find((i) => i.itemId === 'order_box')?.carrier ?? '')
      .toBe(hostId);
    await expect
      .poll(async () =>
        (await hook(page)).minimap.some((m) => m.kind === 'carrier' && m.id === `carrier:${hostId}`),
      )
      .toBe(true);
    // Race scoreboard: items the van controls (the packed box counts while we hold it).
    const scores = page.getByRole('list', { name: 'Scores' });
    await expect(scores.locator(`li[data-player-id="${hostId}"]`)).toHaveAttribute(
      'data-points',
      String(points),
    );
    await expect(scores.locator(`li[data-player-id="${hostId}"]`)).toHaveAttribute('data-place', '1');
    await expect(scores.locator(`li[data-player-id="${guestId}"]`)).toHaveAttribute('data-place', '2');
  });
  // The guest has no quota bar progress of their own and no office arrow.
  await expect(guest.getByRole('meter', { name: 'Order quota' })).toHaveAttribute('data-points', '0');
  await expect(guest.locator('#keke-hud-arrow')).not.toHaveAttribute('data-kind', 'office');

  // Run it into the office: the delivery ends the round at once.
  const asked = await host.evaluate(
    ({ x, y }) => (globalThis as WithHook).__KEKE__?.teleport(x, y) ?? false,
    OFFICE,
  );
  expect(asked).toBe(true);

  await forBoth(async (page) => {
    const results = page.getByRole('dialog', { name: /Round 1 results/ });
    await expect(results).toBeVisible({ timeout: 10_000 });
    const banner = results.locator('.results-race');
    await expect(banner).toHaveAttribute('data-outcome', 'delivered');
    await expect(banner).toHaveAttribute('data-winner', hostId);
    await expect(banner).toHaveText('Hostia delivered the order box');
    const rows = results.locator('.results-players tbody tr[data-player-id]');
    await expect(rows.first()).toHaveAttribute('data-player-id', hostId);
    await expect(rows.first()).toHaveAttribute('data-place', '1');
    await expect(results.locator(`tr[data-player-id="${guestId}"]`)).toHaveAttribute('data-place', '2');
    // Both clients got the delivery broadcast (the feed is behind the results panel).
    await expect
      .poll(async () =>
        (await hook(page)).raceEvents.some(
          (e) => e.type === 'delivery' && (e.payload as { player?: string }).player === hostId,
        ),
      )
      .toBe(true);
  });
  expect(await host.evaluate(() => (globalThis as WithHook).__KEKE__?.sfx().delivery ?? 0)).toBeGreaterThan(
    0,
  );

  expect(pageErrors).toEqual([]);
});
