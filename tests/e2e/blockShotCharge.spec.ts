import { expect, type Page } from '@playwright/test';
import type { KekeHook } from '../../packages/client/src/game/hookTypes';
import { requireDebugServer, test } from './helpers';
import { ARENA, aimAt, MAX_HP, TILE, click, eventsOf, giveWeapon, net, startDuel, teleportTo } from './duel';

// M4 review F5: the cast-iron pan's block and reflect, the champagne cork shot, and the pallet jack
// dash in a real round on the loading dock.

type WithHook = { __KEKE__?: KekeHook };

/** weapons.json / config.json (Playwright specs cannot import @keke/shared). */
const FIST_DAMAGE = 5;
const EGG_DAMAGE = 8;
const CORK_DAMAGE = 20;
const CHAMPAGNE_USES = 9;
const JACK_DAMAGE = 25;

const swingsOf = (page: Page) =>
  page.evaluate(() => (globalThis as WithHook).__KEKE__?.swings() ?? { predicted: 0, last: null });

test('pan block and reflect, champagne cork then swing, pallet jack dash', async ({ newPlayer, request }) => {
  await requireDebugServer(request);
  test.setTimeout(150_000);
  const pageErrors: Error[] = [];
  const { host, guest, hostId, guestId } = await startDuel(newPlayer, pageErrors);
  const hostAt = await teleportTo(host, ARENA);

  // Pan block: the guest raises the pan (right mouse); the host's fist does 30% damage.
  await giveWeapon(guest, 'cast_iron_pan');
  let guestAt = await teleportTo(guest, { x: ARENA.x + 22, y: ARENA.y });
  await guest.mouse.move(10, 10);
  await guest.mouse.down({ button: 'right' });
  await expect.poll(async () => (await net(guest)).blocking, { timeout: 5_000 }).toBe(true);
  await aimAt(host, hostAt, guestAt);
  await click(host);
  await expect.poll(async () => (await net(guest)).hp, { timeout: 5_000 }).toBeLessThan(MAX_HP);
  const blockedHp = (await net(guest)).hp;
  expect(MAX_HP - blockedHp, 'a blocked punch does 1 or 2 damage').toBeLessThan(FIST_DAMAGE);

  // Reflect: an egg thrown at the raised pan flies back and hits the host.
  await giveWeapon(host, 'egg_carton');
  guestAt = await teleportTo(guest, { x: ARENA.x + 3 * TILE, y: ARENA.y });
  await aimAt(host, hostAt, guestAt);
  await click(host);
  await expect.poll(async () => (await net(host)).hp, { timeout: 5_000 }).toBe(MAX_HP - EGG_DAMAGE);
  expect((await net(guest)).hp, 'the blocker takes nothing').toBe(blockedHp);
  await guest.mouse.up({ button: 'right' });
  await expect.poll(async () => (await net(guest)).blocking, { timeout: 5_000 }).toBe(false);

  // Champagne: one cork from 8 tiles hits for 20, then the bottle swings in melee.
  await giveWeapon(host, 'champagne_bottle');
  const weapon = host.getByRole('region', { name: 'Weapon' });
  await expect(weapon).toHaveAttribute('data-uses', String(CHAMPAGNE_USES));
  guestAt = await teleportTo(guest, { x: ARENA.x + 8 * TILE, y: ARENA.y });
  await aimAt(host, hostAt, guestAt);
  await click(host);
  await expect.poll(async () => (await net(guest)).hp, { timeout: 5_000 }).toBe(blockedHp - CORK_DAMAGE);
  await expect(weapon).toHaveAttribute('data-uses', String(CHAMPAGNE_USES - 1));
  expect((await swingsOf(host)).last?.mode).toBe('shot');
  await host.waitForTimeout(700); // cooldown
  await click(host);
  await expect.poll(async () => (await swingsOf(host)).last?.mode).toBe('melee');

  // Pallet jack: a dash three tiles into the guest: 25 damage and a knockdown.
  await host.waitForTimeout(700);
  await giveWeapon(host, 'pallet_jack');
  const hpBeforeJack = (await net(guest)).hp;
  guestAt = await teleportTo(guest, { x: ARENA.x + 3 * TILE, y: ARENA.y });
  await aimAt(host, hostAt, guestAt);
  await Promise.all([
    click(host),
    expect.poll(async () => (await net(guest)).stunned, { timeout: 5_000, intervals: [30] }).toBe(true),
  ]);
  await expect.poll(async () => (await net(guest)).hp, { timeout: 5_000 }).toBe(hpBeforeJack - JACK_DAMAGE);
  // The dash lasts 0.4 s, so read the attack broadcast rather than the short-lived charging flag.
  const attacks = (await eventsOf(host, 'attack')) as { mode: string; weapon: string }[];
  expect(attacks).toContainEqual(expect.objectContaining({ mode: 'charge', weapon: 'pallet_jack' }));
  await expect.poll(async () => (await net(host)).charging, { timeout: 5_000 }).toBe(false);
  const hits = (await eventsOf(guest, 'hit')) as { target: string; weapon: string | null }[];
  expect(hits).toContainEqual(expect.objectContaining({ target: guestId, weapon: 'pallet_jack' }));
  expect(
    hits.some((h) => h.target === hostId && h.weapon === 'egg_carton'),
    'the reflected egg',
  ).toBe(true);
  expect(pageErrors).toEqual([]);
});
