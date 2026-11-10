import { expect, test, type Page } from '@playwright/test';
import type { KekeHook, KekeNpcSpriteSnapshot } from '../../packages/client/src/game/hookTypes';
import type { NpcView } from '../../packages/client/src/net/npcView';
import { aimMouse, createRoom, requireDebugServer, toPlay, waitControlling } from './helpers';

// M5-7: store workers are drawn from their own sheets (forklifts with their warning light and on the
// minimap), and punching one makes us Wanted: the ❗ shows over our head, the HUD Wanted indicator counts
// down, the alarm plays, the feed says so and the worker turns on us. Needs the e2e server's KEKE_DEBUG=1 (teleport).
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

const npcs = (page: Page) => hook(page, (k): NpcView[] => k.npcs());
const sprites = (page: Page) => hook(page, (k): KekeNpcSpriteSnapshot[] => k.npcSprites());
const sessionId = (page: Page) => hook(page, (k) => k.net()?.sessionId ?? '');

test('workers are drawn, and punching one makes us Wanted', async ({ page, request }) => {
  // Stockers stop at shelves only every so often: waiting for one can take a while on a slow machine.
  test.setTimeout(120_000);
  await requireDebugServer(request);
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));
  await toPlay(page, 'Vandal', '?debug=1');
  await createRoom(page);
  await page.getByRole('button', { name: 'Ready', exact: true }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'game', { timeout: 10_000 });
  await waitControlling(page);
  const me = await sessionId(page);

  // Every synced stocker has a sprite from the stocker sheet.
  await expect
    .poll(async () => {
      const drawn = await sprites(page);
      const synced = (await npcs(page)).filter((n) => n.behaviour === 'stocker');
      return (
        synced.length > 0 &&
        synced.every((n) =>
          drawn.some(
            (s) => s.id === n.id && s.visible && s.sheet === 'stocker' && s.anim.startsWith('stocker/'),
          ),
        )
      );
    })
    .toBe(true);
  // Forklifts (M5-5): drawn from the forklift sheet with the warning light, and on the minimap.
  await expect
    .poll(async () => {
      const lifts = (await sprites(page)).filter((s) => s.sheet === 'forklift');
      return lifts.length > 0 && lifts.every((s) => s.light && s.anim.startsWith('forklift/drive_'));
    })
    .toBe(true);
  await expect
    .poll(async () => (await hook(page, (k) => k.minimap())).filter((m) => m.kind === 'forklift').length)
    .toBeGreaterThan(0);
  await expect(page.locator('#keke-hud-wanted')).toBeHidden();
  expect(await hook(page, (k) => k.wantedIcons())).toEqual([]);

  // Walk up to a worker and punch it until a hit lands (they wander, so retry).
  let victim = '';
  for (let attempt = 0; victim === ''; attempt++) {
    expect(attempt, 'punches needed to hit a worker').toBeLessThan(25);
    // Stockers walk at 80 px/s, faster than a scripted punch: wait for one restocking (1-4 s stops).
    let stocker: NpcView | undefined;
    await expect
      .poll(
        async () => {
          // A stocker at a shelf. Not a guard or the butcher: they stun and knock us about.
          stocker = (await npcs(page)).find((n) => n.behaviour === 'stocker' && n.alive && !n.moving);
          return stocker !== undefined;
        },
        { timeout: 30_000 },
      )
      .toBe(true);
    if (!stocker) throw new Error('no worker standing still');
    const spot = await page.evaluate(
      ({ x, y }) => {
        const k = (globalThis as WithHook).__KEKE__;
        if (!k) throw new Error('window.__KEKE__ is missing');
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const at = { x: x + Math.cos(a) * 18, y: y + Math.sin(a) * 18 };
          if (k.teleport(at.x, at.y)) return at;
        }
        return null;
      },
      { x: stocker.x, y: stocker.y },
    );
    if (spot === null) continue;
    await page.waitForTimeout(150);
    const target = stocker;
    const now = (await npcs(page)).find((n) => n.id === target.id);
    const pos = await hook(page, (k) => k.player());
    if (!now) continue;
    await aimMouse(page, pos, now);
    await page.waitForTimeout(60);
    await page.mouse.down();
    await page.waitForTimeout(60);
    await page.mouse.up();
    // Latched: the event log keeps the npcHit even when the page draws slowly.
    for (let wait = 0; wait < 10 && victim === ''; wait++) {
      const hit = (await hook(page, (k) => k.combatEvents())).find((e) => e.type === 'npcHit');
      if (hit) victim = (hit.payload as { npc: string }).npc;
      else await page.waitForTimeout(150);
    }
  }

  // The hit worker got a damage number (latched list of started effects).
  expect(await hook(page, (k) => k.fxStarted())).toContainEqual(
    expect.objectContaining({ kind: 'number', target: victim }),
  );

  // Wanted: icon over us, HUD indicator, alarm, feed line.
  await expect.poll(() => hook(page, (k) => k.wantedIcons())).toContain(me);
  const wanted = page.getByRole('status', { name: 'Wanted' });
  await expect(wanted).toBeVisible();
  await expect(wanted).toHaveAttribute('data-seconds', /^(1\d|20|[1-9])$/);
  await expect(wanted).toContainText('WANTED');
  await expect
    .poll(async () => (await hook(page, (k) => k.sfx()))['wantedAlarm'] ?? 0)
    .toBeGreaterThanOrEqual(1);
  await expect(page.locator('#keke-hud-feed li[data-kind="wanted"]')).toContainText('You are WANTED');

  // The worker we hit (or a guard) is after us: the one we hit shows the anger mark.
  await expect
    .poll(async () => (await sprites(page)).find((s) => s.id === victim)?.hostile, { timeout: 5_000 })
    .toBe(true);
  expect(pageErrors).toEqual([]);
});
