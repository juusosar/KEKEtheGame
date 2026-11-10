import { expect } from '@playwright/test';
import { requireDebugServer, test } from './helpers';
import {
  ARENA,
  aimAt,
  MAX_HP,
  TILE,
  click,
  eventsOf,
  giveWeapon,
  net,
  position,
  startDuel,
  teleportTo,
} from './duel';

// M4 review F5: thrown weapons in a real round. The host throws an egg, then a shaken soda bottle, at the
// guest three tiles away on the loading dock. Damage, uses and the knockback come from the server state.

/** weapons.json (Playwright specs cannot import @keke/shared). */
const EGG = { id: 'egg_carton', damage: 8, uses: 6 };
const SODA = { id: 'soda_bottle', damage: 6, uses: 2 };

test('egg carton and shaken soda: thrown at a player, damage, uses and the burst shove', async ({
  newPlayer,
  request,
}) => {
  await requireDebugServer(request);
  test.setTimeout(120_000);
  const pageErrors: Error[] = [];
  const { host, guest } = await startDuel(newPlayer, pageErrors);
  const hostAt = await teleportTo(host, ARENA);
  const target = { x: ARENA.x + 3 * TILE, y: ARENA.y };

  // Egg: one flight, 8 damage, 6 → 5 eggs in the HUD.
  await giveWeapon(host, EGG.id);
  const weapon = host.getByRole('region', { name: 'Weapon' });
  await expect(weapon).toHaveAttribute('data-uses', String(EGG.uses));
  const guestAt = await teleportTo(guest, target);
  await aimAt(host, hostAt, guestAt);
  await click(host);
  await expect.poll(async () => (await net(guest)).hp, { timeout: 5_000 }).toBe(MAX_HP - EGG.damage);
  await expect(weapon).toHaveAttribute('data-uses', String(EGG.uses - 1));
  const throws = (await eventsOf(host, 'attack')) as { mode: string; weapon: string }[];
  expect(throws).toContainEqual(expect.objectContaining({ mode: 'thrown', weapon: EGG.id }));

  // Soda: 6 damage and the fizz burst shoves the guest away along the throw.
  await host.waitForTimeout(400); // egg cooldown
  await giveWeapon(host, SODA.id);
  await expect(weapon).toHaveAttribute('data-uses', String(SODA.uses));
  const sodaAt = await teleportTo(guest, target);
  await aimAt(host, hostAt, sodaAt);
  await click(host);
  const hpBefore = MAX_HP - EGG.damage;
  await expect.poll(async () => (await net(guest)).hp, { timeout: 5_000 }).toBe(hpBefore - SODA.damage);
  await expect.poll(async () => (await position(guest)).x, { timeout: 5_000 }).toBeGreaterThan(sodaAt.x + 24);
  await expect(weapon).toHaveAttribute('data-uses', String(SODA.uses - 1));
  expect(pageErrors).toEqual([]);
});
