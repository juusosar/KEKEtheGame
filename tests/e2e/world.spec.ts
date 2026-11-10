import { expect, test, type Page } from '@playwright/test';
import type { KekeHook, KekeItemSnapshot, KekeVanSnapshot } from '../../packages/client/src/game/hookTypes';
import { createRoom, game, toPlay, waitControlling } from './helpers';

// M3-6: the Game scene draws the round's items and vans and reports them through `window.__KEKE__`.
type WithHook = { __KEKE__?: KekeHook };
// The default profile colour (DEFAULT_COLOR in @keke/shared; Playwright cannot import its JSON config).
const DEFAULT_COLOR = '#3FA9F5';

const world = (page: Page) =>
  page.evaluate((): { items: KekeItemSnapshot[]; vans: KekeVanSnapshot[] } => {
    const hook = (globalThis as WithHook).__KEKE__;
    if (!hook) throw new Error('window.__KEKE__ is missing (load the page with ?debug=1)');
    return { items: hook.items(), vans: hook.vans() };
  });

test('offline walk draws our van in slot 1 and no items', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));
  await page.goto('/?debug=1&scene=game');
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'game', { timeout: 15_000 });
  await page.waitForFunction(() => (globalThis as WithHook).__KEKE__ !== undefined);

  const { items, vans } = await world(page);
  expect(items).toEqual([]);
  expect(vans).toHaveLength(1);
  expect(vans[0]).toMatchObject({ van: 0, index: 1, frame: 'slot_1', outline: DEFAULT_COLOR });
  expect(pageErrors).toEqual([]);
});

test('a round shows our target outlined in our colour and our numbered van', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));
  await toPlay(page, 'Hauler', '?debug=1');
  await createRoom(page);
  await page.getByRole('button', { name: 'Ready', exact: true }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'game', { timeout: 10_000 });
  await waitControlling(page);

  const net = (await game(page)).net;
  expect(net).not.toBeNull();
  expect(net?.van).toBe(0);
  expect(net?.carrying).toBe(0);
  expect(net?.target).toBeGreaterThan(0);

  const { items, vans } = await world(page);
  const target = items.find((item) => item.id === net?.target);
  expect(target).toMatchObject({
    state: 'target',
    owner: net?.sessionId,
    carrier: '',
    outline: DEFAULT_COLOR,
  });
  expect(target?.name).not.toBe('');
  expect(target?.frame).not.toBe('');
  // Lying items are drawn where the server put them.
  expect(target?.x).toBeCloseTo(target?.serverX ?? NaN, 0);
  expect(target?.y).toBeCloseTo(target?.serverY ?? NaN, 0);

  expect(vans).toEqual([
    expect.objectContaining({ van: 0, index: 1, frame: 'slot_1', points: 0, outline: DEFAULT_COLOR }),
  ]);
  expect(pageErrors).toEqual([]);
});
