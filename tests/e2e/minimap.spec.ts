import { expect, type Page } from '@playwright/test';
import type { KekeHook, KekeMinimapMarker } from '../../packages/client/src/game/hookTypes';
import { createRoom, test, toPlay, waitControlling } from './helpers';

// M3-8: the minimap sits in the bottom-right corner and shows our van, our target, loose items and us.
type WithHook = { __KEKE__?: KekeHook };

const markers = (page: Page): Promise<KekeMinimapMarker[]> =>
  page.evaluate(() => {
    const hook = (globalThis as WithHook).__KEKE__;
    if (!hook) throw new Error('window.__KEKE__ is missing (load the page with ?debug=1)');
    return hook.minimap();
  });

const kinds = async (page: Page): Promise<string[]> => (await markers(page)).map((m) => m.kind).sort();

async function expectBottomRight(page: Page): Promise<void> {
  const minimap = page.getByRole('img', { name: /^Minimap/ });
  await expect(minimap).toBeVisible();
  const box = await minimap.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (!box || !viewport) return;
  expect(box.width).toBeLessThanOrEqual(204);
  expect(viewport.width - (box.x + box.width)).toBeLessThan(40);
  expect(viewport.height - (box.y + box.height)).toBeLessThan(40);
}

test('offline walk: the minimap shows our van and follows us', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));
  await page.goto('/?debug=1&scene=game');
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'game', { timeout: 15_000 });
  await expectBottomRight(page);
  await expect.poll(() => kinds(page)).toEqual(['self', 'van']);

  const start = (await markers(page)).find((m) => m.kind === 'self');
  await page.evaluate(() => (globalThis as WithHook).__KEKE__?.teleport(600, 400));
  await expect
    .poll(async () => (await markers(page)).find((m) => m.kind === 'self'))
    .toMatchObject({ x: 600, y: 400, mine: true });
  expect(start?.x).not.toBe(600);
  expect(pageErrors).toEqual([]);
});

test('a solo round: the minimap shows our van, our target and us', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));
  await toPlay(page, 'Mappy', '?debug=1');
  await createRoom(page);
  await page.getByRole('button', { name: 'Ready', exact: true }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'game', { timeout: 10_000 });
  await waitControlling(page);

  await expectBottomRight(page);
  // Forklifts (M5-7) drive their routes too; the rest is ours.
  await expect
    .poll(async () => (await kinds(page)).filter((k) => k !== 'forklift'), { timeout: 5_000 })
    .toEqual(['self', 'target', 'van']);
  expect((await kinds(page)).filter((k) => k === 'forklift').length).toBeGreaterThan(0);
  const all = await markers(page);
  const van = all.find((m) => m.kind === 'van');
  expect(van).toMatchObject({ id: 'van:0', mine: true });
  const target = all.find((m) => m.kind === 'target');
  expect(target?.id).toMatch(/^item:\d+$/);
  expect(pageErrors).toEqual([]);
});
