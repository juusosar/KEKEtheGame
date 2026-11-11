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

// P1-6: rounds on the second store map. The host picks it in the lobby, both clients load its own map,
// tiles and music, and a Timed round (pickup and deposit) and a Race delivery play on it. On this map the
// vans stand in the parking lot and the office is across the road east of it, so the carrier runs across
// the lot. Needs the e2e server's KEKE_DEBUG=1 (teleport, end phase, van points).

type WithHook = { __KEKE__?: KekeHook };

/** maps/prisma.tmj: 100 x 72 tiles of 32 px. */
const MAP_PX = { width: 3200, height: 2304 };
/** config.json raceQuota (Playwright cannot import @keke/shared). */
const RACE_QUOTA = 6;

const hook = (page: Page) =>
  page.evaluate(() => {
    const keke = (globalThis as WithHook).__KEKE__;
    if (!keke) throw new Error('window.__KEKE__ is missing (load the page with ?debug=1)');
    return {
      map: keke.map,
      music: keke.music(),
      items: keke.items(),
      vans: keke.vans(),
      minimap: keke.minimap(),
    };
  });

const endPhase = (page: Page) => page.evaluate(() => (globalThis as WithHook).__KEKE__?.endPhase() ?? false);

const press = async (page: Page, key: string) => {
  await page.keyboard.down(key);
  await page.waitForTimeout(150);
  await page.keyboard.up(key);
};

/** Two players in a room on the second map with `mode` picked, through the countdown with no NPCs. */
async function startOnPrisma(
  newPlayer: (pageErrors: Error[]) => Promise<Page>,
  pageErrors: Error[],
  mode: 'Timed' | 'Quota + Race',
): Promise<{ host: Page; guest: Page; hostId: string }> {
  const host = await newPlayer(pageErrors);
  const guest = await newPlayer(pageErrors);
  await toPlay(host, 'Hostia', '?debug=1');
  const code = await createRoom(host, { map: 'prisma' });
  await toPlay(guest, 'Vieras', '?debug=1');
  await joinRoom(guest, code);
  for (const page of [host, guest]) await expect(players(page)).toHaveCount(2);
  if (mode !== 'Timed') {
    await host.getByRole('button', { name: mode }).click();
    await expect(guest.getByRole('button', { name: mode })).toHaveAttribute('aria-pressed', 'true');
  }
  for (const page of [host, guest]) await page.getByRole('button', { name: 'Ready', exact: true }).click();
  await host.getByRole('button', { name: 'Start' }).click();
  await Promise.all(
    [host, guest].map(async (page) => {
      await expect(page.locator('body')).toHaveAttribute('data-scene', 'game', { timeout: 10_000 });
      await expect(page.locator('body')).toHaveAttribute('data-map', 'prisma');
      await expect(page.getByRole('dialog', { name: 'Get ready' }).locator('.intro-map')).toHaveText(
        /supermarket/,
      );
    }),
  );
  await Promise.all([host, guest].map((page) => waitControlling(page)));
  await noNpcs(host);
  const hostId = (await game(host)).net?.sessionId ?? '';
  expect(hostId).not.toBe('');
  return { host, guest, hostId };
}

/** Teleports next to our target and picks it up (retried: a teleport can land on a busy spot). */
async function pickUpTarget(host: Page): Promise<number> {
  const targetId = (await game(host)).net?.target ?? 0;
  expect(targetId).toBeGreaterThan(0);
  const { items, map } = await hook(host);
  const target = items.find((i) => i.id === targetId);
  if (!target) throw new Error(`target ${targetId} is not drawn`);
  await expect(async () => {
    await teleportNear(host, { x: target.serverX, y: target.serverY }, map.tileSize * 0.6);
    await press(host, 'KeyE');
    await expect.poll(async () => (await game(host)).net?.carrying, { timeout: 3_000 }).toBe(targetId);
  }).toPass({ timeout: 30_000 });
  return targetId;
}

/** Teleports next to our own van in the parking lot. */
async function toOwnVan(host: Page): Promise<void> {
  const { vans, map } = await hook(host);
  const slot = (await game(host)).net?.van;
  const van = vans.find((v) => v.van === slot);
  if (!van) throw new Error(`van ${slot} is not drawn`);
  // Vans are in the lot, south of the store front (y 43 tiles).
  expect(van.y).toBeGreaterThan(44 * map.tileSize);
  await teleportNear(host, { x: van.x, y: van.y }, map.tileSize);
}

test('a Timed round on the second map: its own map, music, pickup, deposit and results', async ({
  newPlayer,
  request,
}) => {
  await requireDebugServer(request);
  test.setTimeout(90_000);
  const pageErrors: Error[] = [];
  const { host, guest, hostId } = await startOnPrisma(newPlayer, pageErrors, 'Timed');

  // Both clients draw this map's own file and play its own loop.
  for (const page of [host, guest]) {
    const { map, music } = await hook(page);
    expect(map).toMatchObject({ theme: 'prisma', widthPx: MAP_PX.width, heightPx: MAP_PX.height });
    expect(music).toBe('assets/music/prisma_loop.wav');
  }

  await pickUpTarget(host);
  await toOwnVan(host);
  await expect.poll(async () => (await game(host)).net?.deposited ?? 0).toBeGreaterThan(0);
  const deposited = (await game(host)).net?.deposited ?? 0;

  await Promise.all(
    [host, guest].map(async (page) => {
      const row = page.getByRole('list', { name: 'Scores' }).locator(`li[data-player-id="${hostId}"]`);
      await expect(row).toHaveAttribute('data-points', String(deposited));
      await expect(row).toHaveAttribute('data-place', '1');
    }),
  );

  expect(await endPhase(host)).toBe(true);
  await Promise.all(
    [host, guest].map(async (page) => {
      const results = page.getByRole('dialog', { name: /Round 1 results/ });
      await expect(results).toBeVisible();
      await expect(results.locator('.results-players tbody tr[data-player-id]').first()).toHaveAttribute(
        'data-player-id',
        hostId,
      );
      await expect(results.locator(`tr[data-player-id="${hostId}"] .items`)).toHaveText(String(deposited));
    }),
  );

  expect(pageErrors).toEqual([]);
});

test('a Race delivery on the second map: box packed at the van in the lot, run across the road', async ({
  newPlayer,
  request,
}) => {
  await requireDebugServer(request);
  test.setTimeout(90_000);
  const pageErrors: Error[] = [];
  const { host, guest, hostId } = await startOnPrisma(newPlayer, pageErrors, 'Quota + Race');

  // The office is on the minimap, east of the parking lot (across the road).
  await expect.poll(async () => (await hook(host)).minimap.some((m) => m.kind === 'office')).toBe(true);
  const { minimap, map } = await hook(host);
  const office = minimap.find((m) => m.kind === 'office');
  if (!office) throw new Error('no office marker');
  expect(office.x).toBeGreaterThan(78 * map.tileSize);

  // One short of the quota, then bank the target: the van packs the box and we carry it.
  expect(
    await host.evaluate((n) => (globalThis as WithHook).__KEKE__?.vanPoints(n) ?? false, RACE_QUOTA - 1),
  ).toBe(true);
  await expect(host.getByRole('meter', { name: 'Order quota' })).toHaveAttribute(
    'data-points',
    String(RACE_QUOTA - 1),
  );
  await pickUpTarget(host);
  await toOwnVan(host);
  await expect
    .poll(async () => (await hook(host)).items.find((i) => i.itemId === 'order_box')?.carrier ?? '')
    .toBe(hostId);
  await expect(host.locator('#keke-hud-arrow')).toHaveAttribute('data-kind', 'office');

  // Into the office: the delivery ends the round at once.
  expect(
    await host.evaluate(({ x, y }) => (globalThis as WithHook).__KEKE__?.teleport(x, y) ?? false, {
      x: office.x,
      y: office.y,
    }),
  ).toBe(true);
  await Promise.all(
    [host, guest].map(async (page) => {
      const results = page.getByRole('dialog', { name: /Round 1 results/ });
      await expect(results).toBeVisible({ timeout: 10_000 });
      const banner = results.locator('.results-race');
      await expect(banner).toHaveAttribute('data-outcome', 'delivered');
      await expect(banner).toHaveAttribute('data-winner', hostId);
    }),
  );

  expect(pageErrors).toEqual([]);
});
