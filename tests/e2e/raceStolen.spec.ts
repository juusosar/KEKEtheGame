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

// M6 review F4: the "Done when" stolen-box win through the UI. The host packs the order box and drops it
// (Q) at their van; the guest picks it up, which snatches it (quota meter 'stolen', a 'box' feed line for
// both), and runs it to the office; both results panels say a stolen box was delivered.
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
    return { tile: keke.map.tileSize, items: keke.items(), vans: keke.vans() };
  });

/** Taps a key long enough for at least one input frame to carry it. */
async function tap(page: Page, key: string): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(150);
  await page.keyboard.up(key);
}

test('a Quota + Race round won by delivering a stolen order box', async ({ newPlayer, request }) => {
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
  const forBoth = (check: (page: Page) => Promise<void>) => Promise.all([host, guest].map(check));
  await forBoth(async (page) => {
    await expect(page.locator('body')).toHaveAttribute('data-scene', 'game', { timeout: 10_000 });
    await waitControlling(page);
  });
  await noNpcs(host);

  const hostId = (await game(host)).net?.sessionId ?? '';
  const guestId = (await game(guest)).net?.sessionId ?? '';
  expect(hostId).not.toBe('');
  expect(guestId).not.toBe('');

  // Host: one short of the quota, then bank the target at the van, which packs the box into their hands.
  expect(
    await host.evaluate((n) => (globalThis as WithHook).__KEKE__?.vanPoints(n) ?? false, RACE_QUOTA - 1),
  ).toBe(true);
  await expect(host.getByRole('meter', { name: 'Order quota' })).toHaveAttribute(
    'data-points',
    String(RACE_QUOTA - 1),
  );
  const targetId = (await game(host)).net?.target ?? 0;
  expect(targetId).toBeGreaterThan(0);
  const before = await hook(host);
  const target = before.items.find((i) => i.id === targetId);
  if (!target) throw new Error(`target ${targetId} is not drawn`);
  await expect(async () => {
    await teleportNear(host, { x: target.serverX, y: target.serverY }, before.tile * 0.6);
    await tap(host, 'KeyE');
    await expect.poll(async () => (await game(host)).net?.carrying, { timeout: 3_000 }).toBe(targetId);
  }).toPass({ timeout: 30_000 });
  const vanSlot = (await game(host)).net?.van;
  const van = before.vans.find((v) => v.van === vanSlot);
  if (!van) throw new Error(`van ${vanSlot} is not drawn`);
  await teleportNear(host, { x: van.x, y: van.y }, before.tile);
  await expect
    .poll(async () => (await hook(host)).items.find((i) => i.itemId === 'order_box')?.carrier ?? '')
    .toBe(hostId);
  const boxId = (await hook(host)).items.find((i) => i.itemId === 'order_box')?.id ?? 0;

  // Host drops it (Q): the box lies at the van.
  await expect(async () => {
    await tap(host, 'KeyQ');
    await expect
      .poll(async () => (await hook(host)).items.find((i) => i.id === boxId)?.state, { timeout: 3_000 })
      .toBe('loose');
  }).toPass({ timeout: 20_000 });

  // Guest grabs it: retried, since the drop scatter decides where it lies and pickup range is a tile.
  await expect(async () => {
    const box = (await hook(guest)).items.find((i) => i.id === boxId);
    if (!box) throw new Error(`box ${boxId} is not drawn on the guest`);
    await teleportNear(guest, { x: box.serverX, y: box.serverY }, before.tile * 0.6);
    await tap(guest, 'KeyE');
    await expect.poll(async () => (await game(guest)).net?.carrying, { timeout: 3_000 }).toBe(boxId);
  }).toPass({ timeout: 30_000 });

  // Feed lines fade after 6 s: check both pages at once, right after the snatch.
  await forBoth(async (page) => {
    await expect(page.locator('#keke-hud-feed li[data-kind="box"]')).toContainText('Vieras snatched');
  });
  // The thief's quota meter says it is a stolen box to run; the packer's van controls nothing now.
  await expect(guest.getByRole('meter', { name: 'Order quota' })).toHaveAttribute('data-state', 'stolen');

  // Guest runs it into the office: a stolen-box win.
  const asked = await guest.evaluate(
    ({ x, y }) => (globalThis as WithHook).__KEKE__?.teleport(x, y) ?? false,
    OFFICE,
  );
  expect(asked).toBe(true);
  await forBoth(async (page) => {
    const results = page.getByRole('dialog', { name: /Round 1 results/ });
    await expect(results).toBeVisible({ timeout: 10_000 });
    const banner = results.locator('.results-race');
    await expect(banner).toHaveAttribute('data-outcome', 'stolen');
    await expect(banner).toHaveAttribute('data-winner', guestId);
    await expect(banner).toHaveText('Vieras delivered a stolen order box');
    await expect(results.locator(`tr[data-player-id="${guestId}"]`)).toHaveAttribute('data-place', '1');
    await expect(results.locator(`tr[data-player-id="${hostId}"]`)).toHaveAttribute('data-place', '2');
  });

  expect(pageErrors).toEqual([]);
});
