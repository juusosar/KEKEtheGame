import { expect, type Page } from '@playwright/test';
import type { KekeHook } from '../../packages/client/src/game/hookTypes';
import {
  aimMouse,
  createRoom,
  game,
  joinRoom,
  players,
  requireDebugServer,
  test,
  toPlay,
  waitControlling,
} from './helpers';

// M4-7: the combat HUD and visuals in a real round. The host punches the guest down from full HP: the
// host's held fist swings at once, damage numbers float, the guest's HUD HP bar drops, the KO overlay
// counts down to the respawn, and both feeds announce the KO. Needs the e2e server's KEKE_DEBUG=1.

type WithHook = { __KEKE__?: KekeHook };

/** weapons.json / config.json (Playwright specs cannot import @keke/shared). */
const FIST_DAMAGE = 5;
const FIST_COOLDOWN_MS = 400;
const MAX_HP = 100;

const held = (page: Page) =>
  page.evaluate(() => {
    const k = (globalThis as WithHook).__KEKE__;
    return k ? k.held() : [];
  });
const fx = (page: Page) =>
  page.evaluate(() => {
    const k = (globalThis as WithHook).__KEKE__;
    return k ? k.fx() : [];
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
  const hostId = (await game(host)).net?.sessionId ?? '';
  // Meet in the store at the host's target, so the camera is centred on the host.
  const { tile, items } = await me(host);
  const targetId = (await game(host)).net?.target ?? 0;
  const target = items.find((i) => i.id === targetId);
  if (!target) throw new Error(`target ${targetId} is not drawn`);
  const at = await teleportNear(host, { x: target.serverX, y: target.serverY }, tile * 1.5);
  await host.waitForTimeout(500); // camera catches up

  let hp = MAX_HP;
  for (let swing = 0; hp > 0; swing++) {
    expect(swing, 'swings needed to KO').toBeLessThan(40);
    // Fists shove: put the guest back next to us (about 22 px to the right) before every punch.
    const guestAt = await teleportNear(guest, { x: at.x + 22, y: at.y }, 4);
    await aimMouse(host, at, guestAt);
    await host.waitForTimeout(60);
    await host.mouse.down();
    if (swing === 0) {
      // The held fist swings on the press, before the server answers.
      await expect.poll(async () => (await held(host)).find((h) => h.id === hostId)?.swinging).toBe(true);
    }
    await host.waitForTimeout(60);
    await host.mouse.up();
    await expect.poll(async () => (await game(guest)).net?.hp, { timeout: 5_000 }).toBeLessThan(hp);
    hp = (await game(guest)).net?.hp ?? 0;
    if (swing === 0) {
      expect(hp).toBe(MAX_HP - FIST_DAMAGE);
      await expect(guest.getByRole('meter', { name: 'Health' })).toHaveAttribute('data-hp', String(hp));
      await expect(guest.getByRole('meter', { name: 'Health' })).toHaveAttribute('aria-valuenow', String(hp));
      // The host sees the damage number over the guest, and the feed tells both sides.
      expect(await fx(host)).toContainEqual(
        expect.objectContaining({ kind: 'number', target: guestId, text: '-5' }),
      );
      await expect(host.locator('#keke-hud-feed li[data-kind="hit"]')).toContainText('You hit Kohde');
      await expect(guest.locator('#keke-hud-feed li[data-kind="hit"]')).toContainText('Lyoja hit you');
    }
    await host.waitForTimeout(FIST_COOLDOWN_MS - 100);
  }

  // KO: overlay with a countdown on the guest, KO lines in both feeds, stars on the body.
  const ko = guest.locator('#keke-hud-ko');
  await expect(ko).toBeVisible();
  await expect(ko).toHaveAttribute('data-respawn-in', /^[0-3]$/);
  await expect(ko).toContainText('Lyoja got you with Fists');
  await expect(guest.locator('#keke-hud-feed li[data-kind="ko"]')).toContainText('Lyoja knocked you out');
  await expect(host.locator('#keke-hud-feed li[data-kind="ko"]')).toContainText('You knocked out Kohde');
  expect((await held(guest)).find((h) => h.id === guestId)?.visible, 'a KO body holds nothing').toBe(false);

  // Respawn: the overlay goes and the bar is full again.
  await expect(ko).toBeHidden({ timeout: 8_000 });
  await expect(guest.getByRole('meter', { name: 'Health' })).toHaveAttribute('data-hp', String(MAX_HP));
  await expect(guest.getByRole('region', { name: 'Weapon' })).toHaveAttribute('data-weapon', 'fists');
  expect(pageErrors).toEqual([]);
});
