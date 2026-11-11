import { expect, type Page } from '@playwright/test';
import type { KekeHook, KekeNpcSpriteSnapshot } from '../../packages/client/src/game/hookTypes';
import type { NpcView } from '../../packages/client/src/net/npcView';
import { aimMouse, createRoom, requireDebugServer, test, toPlay, waitControlling } from './helpers';

// P2-3 / P2-4: customer crowds on the second store map. They are drawn in several looks, stay off the
// minimap, and punching one makes it and its group run (synced mode 'panic'), with the yellow fright mark
// and a gasp. Needs the e2e server's KEKE_DEBUG=1 (teleport, holdNpc).
type WithHook = { __KEKE__?: KekeHook };

/** Runs `fn` against the page's debug hook. `fn` must not close over anything (it is sent as source). */
const hook = <T>(page: Page, fn: (k: KekeHook) => T): Promise<T> =>
  page.evaluate(
    ([src]) => {
      const k = (globalThis as WithHook).__KEKE__;
      if (!k) throw new Error('window.__KEKE__ is missing (load the page with ?debug=1)');
      return (new Function(`return ${src}`)() as (k: KekeHook) => T)(k);
    },
    [fn.toString()] as const,
  );

const customers = async (page: Page): Promise<NpcView[]> =>
  (await hook(page, (k): NpcView[] => k.npcs())).filter((n) => n.behaviour === 'customer');
const sprites = async (page: Page): Promise<KekeNpcSpriteSnapshot[]> =>
  (await hook(page, (k): KekeNpcSpriteSnapshot[] => k.npcSprites())).filter((s) => s.type === 'customer');

test('customers crowd the second map and run when a punch lands among them', async ({ page, request }) => {
  test.setTimeout(120_000);
  await requireDebugServer(request);
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));
  await toPlay(page, 'Shopper', '?debug=1');
  await createRoom(page, { map: 'prisma' });
  await page.getByRole('button', { name: 'Ready', exact: true }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'game', { timeout: 10_000 });
  await waitControlling(page);

  // 6 + 1 player customers, drawn from the customer sheet and its look variants, not on the minimap.
  await expect.poll(async () => (await customers(page)).length).toBe(7);
  await expect
    .poll(async () => {
      const drawn = await sprites(page);
      return drawn.length === 7 && drawn.every((s) => s.visible && /^customer(_\d+)?$/.test(s.sheet));
    })
    .toBe(true);
  expect(new Set((await sprites(page)).map((s) => s.sheet)).size).toBeGreaterThan(1);
  expect((await hook(page, (k) => k.minimap())).some((m) => m.id.includes('customer'))).toBe(false);

  // Walk up to a customer held still (debug holdNpc) and punch it: a few tries cover a swing aimed from
  // a view one tick old. Under load a stocker or guard can walk into the swing (it hit stocker_2 once), so
  // every other worker is held where it stands and the customer farthest from them is the target.
  let victim = '';
  for (let attempt = 0; victim === ''; attempt++) {
    expect(attempt, 'punches needed to hit a held customer').toBeLessThan(5);
    const workers = (await hook(page, (k): NpcView[] => k.npcs())).filter(
      (n) => n.behaviour !== 'customer' && n.alive,
    );
    await page.evaluate(
      (ids) => ids.forEach((id) => (globalThis as WithHook).__KEKE__?.holdNpc(id, 30)),
      workers.map((n) => n.id),
    );
    const clearance = (c: NpcView): number =>
      Math.min(Infinity, ...workers.map((w) => Math.hypot(w.x - c.x, w.y - c.y)));
    const target = (await customers(page))
      .filter((n) => n.alive)
      .sort((a, b) => clearance(b) - clearance(a))[0];
    if (!target) throw new Error('no customer up');
    await page.evaluate((id) => (globalThis as WithHook).__KEKE__?.holdNpc(id, 20), target.id);
    await expect
      .poll(async () => (await customers(page)).find((n) => n.id === target.id)?.moving ?? true)
      .toBe(false);
    const held = (await customers(page)).find((n) => n.id === target.id) ?? target;
    const spot = await page.evaluate(
      ({ x, y }) => {
        const k = (globalThis as WithHook).__KEKE__;
        if (!k) throw new Error('window.__KEKE__ is missing');
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const at = { x: x + Math.cos(a) * 24, y: y + Math.sin(a) * 24 };
          if (k.teleport(at.x, at.y)) return at;
        }
        return null;
      },
      { x: held.x, y: held.y },
    );
    if (spot === null) throw new Error(`no free spot next to ${held.id}`);
    await page.waitForTimeout(150);
    const pos = await hook(page, (k) => k.player());
    await aimMouse(page, pos, held);
    await page.waitForTimeout(60);
    await page.mouse.down();
    await page.waitForTimeout(60);
    await page.mouse.up();
    for (let wait = 0; wait < 10 && victim === ''; wait++) {
      const hit = (await hook(page, (k) => k.combatEvents())).find(
        (e) => e.type === 'npcHit' && /^customer_/.test((e.payload as { npc: string }).npc),
      );
      if (hit) victim = (hit.payload as { npc: string }).npc;
      else await page.waitForTimeout(150);
    }
  }
  expect(victim).toMatch(/^customer_/);

  // The punched customer and its group run: synced panic, moving, the fright mark, and one gasp.
  await expect
    .poll(async () => (await customers(page)).filter((n) => n.mode === 'panic').length)
    .toBeGreaterThanOrEqual(2);
  const panicking = (await customers(page)).filter((n) => n.mode === 'panic');
  const before = new Map(panicking.map((n) => [n.id, { x: n.x, y: n.y }]));
  await expect
    .poll(async () =>
      (await customers(page)).some((n) => {
        const from = before.get(n.id);
        return from !== undefined && Math.hypot(n.x - from.x, n.y - from.y) > 24;
      }),
    )
    .toBe(true);
  await expect.poll(async () => (await sprites(page)).some((s) => s.alarmed)).toBe(true);
  await expect.poll(async () => (await hook(page, (k) => k.sfx())).customerGasp ?? 0).toBeGreaterThan(0);
  // Hitting a customer is NPC damage: we are Wanted.
  await expect(page.getByRole('status', { name: 'Wanted' })).toBeVisible();
  expect(pageErrors).toEqual([]);
});
