import { expect, type Page } from '@playwright/test';
import type { KekeHook } from '../../packages/client/src/game/hookTypes';
import { requireDebugServer, test } from './helpers';
import { ARENA, TILE, click, giveWeapon, net, startDuel, teleportTo } from './duel';

// M4 review F5: banana peels in a real round. The host drops a peel on the loading dock; the guest
// picks up their target, steps on the peel, slips, drops the item and slides; both feeds say so.

type WithHook = { __KEKE__?: KekeHook };

const traps = (page: Page) => page.evaluate(() => (globalThis as WithHook).__KEKE__?.traps() ?? []);

test('banana peel: dropped, armed, a carrier slips, drops the item and slides', async ({
  newPlayer,
  request,
}) => {
  await requireDebugServer(request);
  test.setTimeout(120_000);
  const pageErrors: Error[] = [];
  const { host, guest, hostId } = await startDuel(newPlayer, pageErrors);
  await teleportTo(host, ARENA);

  await giveWeapon(host, 'banana_peels');
  await click(host);
  await expect.poll(async () => (await traps(host)).length, { timeout: 5_000 }).toBe(1);
  await expect.poll(async () => (await traps(guest))[0]?.armed, { timeout: 5_000 }).toBe(true);
  const peel = (await traps(guest))[0];
  if (!peel) throw new Error('no peel');
  expect(peel.owner).toBe(hostId);
  // Step the host off the peel (owners do not slip, but keep the spot clear).
  await teleportTo(host, { x: ARENA.x, y: ARENA.y - 3 * TILE });

  // The guest picks up their target (teleport to it + E).
  const targetId = (await net(guest)).target;
  const item = (await guest.evaluate(() => (globalThis as WithHook).__KEKE__?.items() ?? [])).find(
    (i) => i.id === targetId,
  );
  if (!item) throw new Error(`target ${targetId} is not drawn`);
  await teleportTo(guest, { x: item.serverX, y: item.serverY });
  // Held for a few frames: a press shorter than one frame of a slow page is never sampled.
  await guest.keyboard.down('KeyE');
  await guest.waitForTimeout(200);
  await guest.keyboard.up('KeyE');
  await expect.poll(async () => (await net(guest)).carrying, { timeout: 5_000 }).toBe(targetId);

  // Onto the peel: the carried item drops (latched), the slide shows on the server, both feeds say "slip".
  // A plain teleport: the slide moves us away at once, so do not wait to stand there.
  const sent = await guest.evaluate(
    ({ x, y }) => (globalThis as WithHook).__KEKE__?.teleport(x, y) ?? false,
    peel,
  );
  expect(sent, 'teleport onto the peel').toBe(true);
  await Promise.all([
    expect.poll(async () => (await net(guest)).sliding, { timeout: 5_000, intervals: [30] }).toBe(true),
    expect.poll(async () => (await net(guest)).carrying, { timeout: 5_000 }).toBe(0),
    expect(guest.locator('#keke-hud-feed li[data-kind="slip"]')).toHaveCount(1),
    expect(host.locator('#keke-hud-feed li[data-kind="slip"]')).toHaveCount(1),
  ]);
  await expect.poll(async () => (await traps(host)).length, { timeout: 5_000 }).toBe(0);
  expect(pageErrors).toEqual([]);
});
