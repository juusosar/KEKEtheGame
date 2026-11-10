import { expect, test, type Page } from '@playwright/test';
import type { KekeHook } from '../../packages/client/src/game/hookTypes';
import type { NpcView } from '../../packages/client/src/net/npcView';
import { createRoom, toPlay, waitControlling } from './helpers';

// M5-3: a round's store workers reach the client in the synced state (drawing them is M5-7).
type WithHook = { __KEKE__?: KekeHook };
// npcs.json stocker count min (Playwright cannot import @keke/shared data).
const MIN_STOCKERS = 3;

const npcs = (page: Page) =>
  page.evaluate((): NpcView[] => {
    const hook = (globalThis as WithHook).__KEKE__;
    if (!hook) throw new Error('window.__KEKE__ is missing (load the page with ?debug=1)');
    return hook.npcs();
  });

test('a round has stockers that walk around the store', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));
  await toPlay(page, 'Watcher', '?debug=1');
  await createRoom(page);
  await page.getByRole('button', { name: 'Ready', exact: true }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'game', { timeout: 10_000 });
  await waitControlling(page);

  const first = await npcs(page);
  const stockers = first.filter((n) => n.behaviour === 'stocker');
  expect(stockers.length).toBeGreaterThanOrEqual(MIN_STOCKERS);
  for (const s of stockers) expect(s).toMatchObject({ alive: true, maxHp: s.hp });
  // They wander: at least one has moved a tile within a few seconds.
  await expect
    .poll(
      async () => {
        const now = await npcs(page);
        return Math.max(
          ...stockers.map((s) => {
            const n = now.find((m) => m.id === s.id);
            return n ? Math.hypot(n.x - s.x, n.y - s.y) : 0;
          }),
        );
      },
      { timeout: 10_000 },
    )
    .toBeGreaterThan(32);
  expect(pageErrors).toEqual([]);
});
