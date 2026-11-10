import { expect, type Page } from '@playwright/test';
import type { KekeHook } from '../../packages/client/src/game/hookTypes';
import {
  createRoom,
  game,
  joinRoom,
  players,
  requireDebugServer,
  row,
  teleportNear,
  test,
  toPlay,
  waitControlling,
} from './helpers';

// M6-4: Quota + Race with Teams on (§4.3), three players (2 v 1). One teammate fills the shared van and
// packs the team's order box, drops it, and the other teammate picks it up and delivers it. Teammates
// share the quota bar; picking up your own side's box is silent in the feed; the whole team wins and
// both teammates' results banners count the delivery as theirs.
// Three pages: runs in the 'heavy' project (playwright.config.ts). Needs KEKE_DEBUG=1 on the e2e server.

type WithHook = { __KEKE__?: KekeHook };

/** config.json raceQuota (Playwright cannot import @keke/shared). */
const RACE_QUOTA = 6;
/** Centre of the kespro office trigger, walkable (see race.spec.ts). */
const OFFICE = { x: 3696, y: 1280 };

const hook = (page: Page) =>
  page.evaluate(() => {
    const keke = (globalThis as WithHook).__KEKE__;
    if (!keke) throw new Error('window.__KEKE__ is missing (load the page with ?debug=1)');
    return { tile: keke.map.tileSize, items: keke.items(), vans: keke.vans() };
  });

const boxCarrier = async (page: Page): Promise<string> =>
  (await hook(page)).items.find((i) => i.itemId === 'order_box')?.carrier ?? '';

test('Teams race: a teammate delivers the box the other one packed, and the team wins', async ({
  newPlayer,
  request,
}) => {
  await requireDebugServer(request);
  test.setTimeout(120_000);
  const pageErrors: Error[] = [];
  const names = ['Ykkonen', 'Kakkonen', 'Kolmonen'];
  const pages = [await newPlayer(pageErrors), await newPlayer(pageErrors), await newPlayer(pageErrors)];
  const [host] = pages;
  if (!host) throw new Error('no host page');

  await toPlay(host, names[0] ?? '', '?debug=1&fps=30');
  const code = await createRoom(host);
  for (let i = 1; i < pages.length; i++) {
    const page = pages[i];
    if (!page) continue;
    await toPlay(page, names[i] ?? '', '?debug=1&fps=30');
    await joinRoom(page, code);
  }
  for (const page of pages) await expect(players(page)).toHaveCount(3);
  await host.getByRole('button', { name: 'Quota + Race' }).click();
  await host.getByRole('button', { name: 'Teams', exact: true }).click();
  for (const name of names) await expect(row(host, name)).toHaveAttribute('data-team', /^[12]$/);
  const teams = await Promise.all(
    names.map(async (n) => Number(await row(host, n).getAttribute('data-team'))),
  );
  // 2 v 1: the two on the bigger team are the packer and the deliverer.
  const big = teams.filter((t) => t === 1).length === 2 ? 1 : 2;
  const mates = pages.filter((_, i) => teams[i] === big);
  const loner = pages.find((_, i) => teams[i] !== big);
  const [packer, runner] = mates;
  if (!packer || !runner || !loner) throw new Error(`teams are not 2 v 1: ${teams.join(', ')}`);

  for (const page of pages) await page.getByRole('button', { name: 'Ready', exact: true }).click();
  await host.getByRole('button', { name: 'Start' }).click();
  await Promise.all(
    pages.map(async (page) => {
      await expect(page.locator('body')).toHaveAttribute('data-scene', 'game', { timeout: 10_000 });
      await page.waitForFunction(() => (globalThis as WithHook).__KEKE__ !== undefined);
      await waitControlling(page);
    }),
  );
  const packerId = (await game(packer)).net?.sessionId ?? '';
  const runnerId = (await game(runner)).net?.sessionId ?? '';
  const lonerId = (await game(loner)).net?.sessionId ?? '';
  expect((await game(runner)).net?.van).toBe((await game(packer)).net?.van);

  // The packer fills the shared van to one short; the runner's quota bar shows the same progress.
  expect(
    await packer.evaluate((n) => (globalThis as WithHook).__KEKE__?.vanPoints(n) ?? false, RACE_QUOTA - 1),
  ).toBe(true);
  for (const page of [packer, runner]) {
    await expect(page.getByRole('meter', { name: 'Order quota' })).toHaveAttribute(
      'data-points',
      String(RACE_QUOTA - 1),
    );
  }

  // The packer banks their target: the box is packed into their hands.
  const targetId = (await game(packer)).net?.target ?? 0;
  const before = await hook(packer);
  const target = before.items.find((i) => i.id === targetId);
  if (!target) throw new Error(`target ${targetId} is not drawn`);
  await expect(async () => {
    await teleportNear(packer, { x: target.serverX, y: target.serverY }, before.tile * 0.6);
    await packer.keyboard.down('KeyE');
    await packer.waitForTimeout(150);
    await packer.keyboard.up('KeyE');
    await expect.poll(async () => (await game(packer)).net?.carrying, { timeout: 3_000 }).toBe(targetId);
  }).toPass({ timeout: 30_000 });
  const vanSlot = (await game(packer)).net?.van;
  const van = before.vans.find((v) => v.van === vanSlot);
  if (!van) throw new Error(`van ${vanSlot} is not drawn`);
  await teleportNear(packer, { x: van.x, y: van.y }, before.tile);
  await expect.poll(() => boxCarrier(packer)).toBe(packerId);

  // Drop it (Q) and let the teammate pick it up next to the van.
  await expect(async () => {
    await packer.keyboard.down('KeyQ');
    await packer.waitForTimeout(150);
    await packer.keyboard.up('KeyQ');
    await expect.poll(() => boxCarrier(packer), { timeout: 3_000 }).toBe('');
  }).toPass({ timeout: 15_000 });
  const box = (await hook(runner)).items.find((i) => i.itemId === 'order_box');
  if (!box) throw new Error('the dropped box is not drawn');
  await expect(async () => {
    await teleportNear(runner, { x: box.serverX, y: box.serverY }, before.tile * 0.6);
    await runner.keyboard.down('KeyE');
    await runner.waitForTimeout(150);
    await runner.keyboard.up('KeyE');
    await expect.poll(() => boxCarrier(runner), { timeout: 3_000 }).toBe(runnerId);
  }).toPass({ timeout: 30_000 });
  await expect(runner.locator('#keke-hud-arrow')).toHaveAttribute('data-kind', 'office');
  // A teammate picking up the team's own box is not a snatch.
  for (const page of pages) await expect(page.locator('#keke-hud-feed li[data-kind="box"]')).toHaveCount(0);

  expect(
    await runner.evaluate(({ x, y }) => (globalThis as WithHook).__KEKE__?.teleport(x, y) ?? false, OFFICE),
  ).toBe(true);

  await Promise.all(
    pages.map(async (page) => {
      const results = page.getByRole('dialog', { name: /Round 1 results/ });
      await expect(results).toBeVisible({ timeout: 15_000 });
      const banner = results.locator('.results-race');
      await expect(banner).toHaveAttribute('data-outcome', 'delivered');
      await expect(banner).toHaveAttribute('data-winner', runnerId);
      // The delivery counts as "ours" for both teammates, not for the other team.
      if (page === loner) await expect(banner).not.toHaveClass(/\bme\b/);
      else await expect(banner).toHaveClass(/\bme\b/);
      for (const id of [packerId, runnerId]) {
        await expect(results.locator(`.results-players tr[data-player-id="${id}"]`)).toHaveAttribute(
          'data-place',
          '1',
        );
      }
      await expect(results.locator(`.results-players tr[data-player-id="${lonerId}"]`)).toHaveAttribute(
        'data-place',
        '2',
      );
      await expect(results.locator(`.results-teams tr[data-team="${big}"]`)).toHaveAttribute(
        'data-place',
        '1',
      );
    }),
  );

  expect(pageErrors).toEqual([]);
});
