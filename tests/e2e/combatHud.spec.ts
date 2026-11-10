import { expect, type Page } from '@playwright/test';
import type { KekeHook } from '../../packages/client/src/game/hookTypes';
import {
  aimMouse,
  createRoom,
  E2E_RESPAWN_SECONDS,
  game,
  joinRoom,
  players,
  requireDebugServer,
  test,
  toPlay,
  waitControlling,
  nearButcherCounter,
} from './helpers';

// M4-7: the combat HUD and visuals in a real round. The host punches the guest down from full HP: the
// host's held fist swings at once, damage numbers float, the guest's HUD HP bar drops, the KO overlay
// counts down to the respawn, and both feeds announce the KO. Needs the e2e server's KEKE_DEBUG=1.

type WithHook = { __KEKE__?: KekeHook };

/** weapons.json / config.json (Playwright specs cannot import @keke/shared). */
const FIST_DAMAGE = 5;
const FIST_COOLDOWN_MS = 400;
/** After the first punch the host finishes with the frozen salmon (damage 18), so a page drawing at a
 * few fps still gets to the KO well inside the test timeout (M4 review F1). */
const FINISHER = { id: 'frozen_salmon', name: 'Frozen salmon', cooldownMs: 900 };
const MAX_HP = 100;

const swings = (page: Page) =>
  page.evaluate(() => {
    const k = (globalThis as WithHook).__KEKE__;
    return k ? k.swings().predicted : 0;
  });
const held = (page: Page) =>
  page.evaluate(() => {
    const k = (globalThis as WithHook).__KEKE__;
    return k ? k.held() : [];
  });
const koEvents = (page: Page) =>
  page.evaluate(() => {
    const k = (globalThis as WithHook).__KEKE__;
    return k ? k.combatEvents().filter((e) => e.type === 'ko').length : 0;
  });
const fx = (page: Page) =>
  page.evaluate(() => {
    const k = (globalThis as WithHook).__KEKE__;
    return k ? k.fxStarted() : [];
  });
const me = (page: Page) =>
  page.evaluate(() => {
    const k = (globalThis as WithHook).__KEKE__;
    if (!k) throw new Error('window.__KEKE__ is missing');
    return { player: k.player(), tile: k.map.tileSize, items: k.items() };
  });
/** Teleports to the first free spot on a ring around `at` and waits until we stand there. */
async function teleportNear(page: Page, at: { x: number; y: number }, reach: number) {
  const spot = await page.evaluate(
    ({ x, y, reach }) => {
      const k = (globalThis as WithHook).__KEKE__;
      if (!k) throw new Error('window.__KEKE__ is missing');
      const offsets: [number, number][] = [[0, 0]];
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        offsets.push([Math.cos(a) * reach, Math.sin(a) * reach]);
      }
      for (const [dx, dy] of offsets) if (k.teleport(x + dx, y + dy)) return { x: x + dx, y: y + dy };
      return null;
    },
    { ...at, reach },
  );
  expect(spot, 'a free spot next to the destination').not.toBeNull();
  await expect
    .poll(async () => {
      const p = (await me(page)).player;
      return Math.hypot(p.x - (spot?.x ?? 0), p.y - (spot?.y ?? 0));
    })
    .toBeLessThan(2);
  return spot as { x: number; y: number };
}

test('punching a player down: held swing, HP bar, KO overlay, feed and respawn', async ({
  newPlayer,
  request,
}) => {
  await requireDebugServer(request);
  test.setTimeout(150_000);
  const pageErrors: Error[] = [];
  const host = await newPlayer(pageErrors);
  const guest = await newPlayer(pageErrors);

  await toPlay(host, 'Lyoja', '?debug=1');
  const code = await createRoom(host);
  await toPlay(guest, 'Kohde', '?debug=1');
  await joinRoom(guest, code);
  for (const page of [host, guest]) await expect(players(page)).toHaveCount(2);
  for (const page of [host, guest]) await page.getByRole('button', { name: 'Ready', exact: true }).click();
  await host.getByRole('button', { name: 'Start' }).click();
  await Promise.all(
    [host, guest].map(async (page) => {
      await expect(page.locator('body')).toHaveAttribute('data-scene', 'game', { timeout: 10_000 });
      await waitControlling(page);
    }),
  );

  // Both HUDs: full HP bar and unlimited fists.
  await Promise.all(
    [host, guest].map(async (page) => {
      const hp = page.getByRole('meter', { name: 'Health' });
      await expect(hp).toHaveAttribute('data-hp', String(MAX_HP));
      await expect(hp).toHaveAttribute('data-level', 'ok');
      const weapon = page.getByRole('region', { name: 'Weapon' });
      await expect(weapon).toHaveAttribute('data-weapon', 'fists');
      await expect(weapon).toHaveAttribute('data-uses', 'inf');
      await expect(weapon.locator('.hud-uses')).toHaveText('∞');
      await expect(page.locator('#keke-hud-ko')).toBeHidden();
    }),
  );

  const guestId = (await game(guest)).net?.sessionId ?? '';
  // Meet in the store at the host's target, so the camera is centred on the host.
  const { tile, items } = await me(host);
  const targetId = (await game(host)).net?.target ?? 0;
  // Our target, unless it lies behind the butcher's counter (the butcher would join the fight).
  const target =
    items.find((i) => i.id === targetId && !nearButcherCounter({ x: i.serverX, y: i.serverY })) ??
    items.find((i) => !nearButcherCounter({ x: i.serverX, y: i.serverY }));
  if (!target) throw new Error(`target ${targetId} is not drawn`);
  const at = await teleportNear(host, { x: target.serverX, y: target.serverY }, tile * 1.5);
  await host.waitForTimeout(500); // camera catches up

  let hp = MAX_HP;
  for (let swing = 0; hp > 0; swing++) {
    expect(swing, 'swings needed to KO').toBeLessThan(15);
    // Hits shove: put the guest back next to us (about 22 px to the right) before every swing.
    const guestAt = await teleportNear(guest, { x: at.x + 22, y: at.y }, 4);
    await aimMouse(host, at, guestAt);
    await host.waitForTimeout(60);
    const swungBefore = swing === 0 ? await swings(host) : 0;
    await host.mouse.down();
    if (swing === 0) {
      // The held fist swings on the press, before the server answers. The swing animation lasts 0.18 s,
      // which a page drawing at a few fps can miss entirely, so read the predicted-swing counter instead
      // (M4 review F1).
      await expect.poll(() => swings(host)).toBe(swungBefore + 1);
    }
    await host.waitForTimeout(60);
    await host.mouse.up();
    await expect.poll(async () => (await game(guest)).net?.hp, { timeout: 5_000 }).toBeLessThan(hp);
    hp = (await game(guest)).net?.hp ?? 0;
    if (swing === 0) {
      expect(hp).toBe(MAX_HP - FIST_DAMAGE);
      // Feed lines fade after 6 s, so check everything at once rather than one page after the other.
      const guestHp = guest.getByRole('meter', { name: 'Health' });
      await Promise.all([
        expect(host.locator('#keke-hud-feed li[data-kind="hit"]')).toContainText('You hit Kohde'),
        expect(guest.locator('#keke-hud-feed li[data-kind="hit"]')).toContainText('Lyoja hit you'),
        expect(guestHp).toHaveAttribute('data-hp', String(hp)),
        expect(guestHp).toHaveAttribute('aria-valuenow', String(hp)),
      ]);
      // The host saw the damage number over the guest (read from the started-FX log: the number lives
      // 0.7 s, less than a slow page's round trips).
      expect(await fx(host)).toContainEqual(
        expect.objectContaining({ kind: 'number', target: guestId, text: '-5' }),
      );
      // Finish with a heavier weapon (debug give-weapon); the host's HUD shows it.
      await host.waitForTimeout(FIST_COOLDOWN_MS);
      await host.evaluate((id) => (globalThis as WithHook).__KEKE__?.giveWeapon(id), FINISHER.id);
      await expect(host.getByRole('region', { name: 'Weapon' })).toHaveAttribute('data-weapon', FINISHER.id);
      continue;
    }
    await host.waitForTimeout(FINISHER.cooldownMs - 100);
  }

  // KO: overlay with a countdown on the guest, KO lines in both feeds, stars on the body. The KO lasts
  // E2E_RESPAWN_SECONDS (config.e2e.json), so check both pages at once.
  const ko = guest.locator('#keke-hud-ko');
  await Promise.all([
    (async () => {
      await expect(ko).toBeVisible();
      await expect(ko).toHaveAttribute('data-respawn-in', /^[0-6]$/);
      await expect(ko).toContainText(`Lyoja got you with ${FINISHER.name}`);
    })(),
    expect(guest.locator('#keke-hud-feed li[data-kind="ko"]')).toContainText('Lyoja knocked you out'),
    expect(host.locator('#keke-hud-feed li[data-kind="ko"]')).toContainText('You knocked out Kohde'),
    expect
      .poll(async () => (await held(guest)).find((h) => h.id === guestId)?.visible, {
        message: 'a KO body holds nothing',
      })
      .toBe(false),
  ]);
  // The KO line stays in the feed and the event log after the respawn, so this needs no race.
  expect(await koEvents(guest), 'the guest saw its own KO').toBeGreaterThan(0);

  // Respawn: the overlay goes and the bar is full again.
  await expect(ko).toBeHidden({ timeout: (E2E_RESPAWN_SECONDS + 5) * 1000 });
  await expect(guest.getByRole('meter', { name: 'Health' })).toHaveAttribute('data-hp', String(MAX_HP));
  await expect(guest.getByRole('region', { name: 'Weapon' })).toHaveAttribute('data-weapon', 'fists');
  expect(pageErrors).toEqual([]);
});
