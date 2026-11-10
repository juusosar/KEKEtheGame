import { expect } from '@playwright/test';
import type { KekeHook } from '../../packages/client/src/game/hookTypes';
import { requireDebugServer, test } from './helpers';
import { ARENA, aimAt, MAX_HP, TILE, giveWeapon, net, position, startDuel, teleportTo } from './duel';

// M4 review F5: spray weapons in a real round. The host holds Attack with the ketchup bottle at the guest
// two tiles away (damage per tick and the slow), then with the fire extinguisher (push and vision cloud).

type WithHook = { __KEKE__?: KekeHook };

/** weapons.json (Playwright specs cannot import @keke/shared). */
const KETCHUP = { id: 'ketchup_bottle', damagePerTick: 3, slow: 0.6, seconds: 3 };
const EXTINGUISHER = { id: 'fire_extinguisher' };
const SPRAY_MS = 600;

test('ketchup and fire extinguisher: held sprays damage, slow, push and cloud', async ({
  newPlayer,
  request,
}) => {
  await requireDebugServer(request);
  test.setTimeout(120_000);
  const pageErrors: Error[] = [];
  const { host, guest } = await startDuel(newPlayer, pageErrors);
  const hostAt = await teleportTo(host, ARENA);
  const target = { x: ARENA.x + 2 * TILE, y: ARENA.y };
  const weapon = host.getByRole('region', { name: 'Weapon' });

  // Ketchup: the slow lasts 1.5 s after the last tick, so watch for it while spraying.
  await giveWeapon(host, KETCHUP.id);
  await expect(weapon).toHaveAttribute('data-uses', String(KETCHUP.seconds));
  const guestAt = await teleportTo(guest, target);
  await aimAt(host, hostAt, guestAt);
  await Promise.all([
    (async () => {
      await host.mouse.down();
      await host.waitForTimeout(SPRAY_MS);
      await host.mouse.up();
    })(),
    expect
      .poll(async () => (await net(guest)).slowMultiplier, { timeout: 5_000, intervals: [50] })
      .toBeCloseTo(KETCHUP.slow, 3), // synced as a float32
  ]);
  await expect.poll(async () => (await net(guest)).hp, { timeout: 5_000 }).toBeLessThan(MAX_HP);
  const hp = (await net(guest)).hp;
  expect((MAX_HP - hp) % KETCHUP.damagePerTick, `damage ${MAX_HP - hp} is whole ticks`).toBe(0);
  // Spray uses are seconds: the HUD counts them down.
  await expect.poll(async () => Number(await weapon.getAttribute('data-uses'))).toBeLessThan(KETCHUP.seconds);
  await expect(weapon.locator('.hud-uses')).toHaveText(/s$/);

  // Extinguisher: no damage, pushes the guest away, leaves a vision cloud.
  await giveWeapon(host, EXTINGUISHER.id);
  const pushedFrom = await teleportTo(guest, target);
  await aimAt(host, hostAt, pushedFrom);
  await Promise.all([
    (async () => {
      await host.mouse.down();
      await host.waitForTimeout(SPRAY_MS);
      await host.mouse.up();
    })(),
    expect
      .poll(() => host.evaluate(() => (globalThis as WithHook).__KEKE__?.sprayClouds().length ?? 0), {
        timeout: 5_000,
        intervals: [50],
      })
      .toBeGreaterThan(0),
  ]);
  await expect
    .poll(async () => (await position(guest)).x, { timeout: 5_000 })
    .toBeGreaterThan(pushedFrom.x + 40);
  expect((await net(guest)).hp, 'the extinguisher does no damage').toBe(hp);
  expect(pageErrors).toEqual([]);
});
