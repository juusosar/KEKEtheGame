import { expect, type Page } from '@playwright/test';
import type { KekeHook, KekeNetSnapshot } from '../../packages/client/src/game/hookTypes';
import { aimMouse, createRoom, joinRoom, players, toPlay, waitControlling } from './helpers';

// Shared steps for the weapon specs (M4 review F5): two players in a running round, met on the loading
// dock (no store workers or forklift lanes there, and far from the guards), each with a weapon from the
// debug give-weapon. Assert on server state through the hook and on latched values, never on 0.18 s
// animations (M4 review F1).

type WithHook = { __KEKE__?: KekeHook };

/** Open floor on the loading dock, between van bays 4 and 5 (maps/kespro.tmj columns 0 to 14 are open). */
export const ARENA = { x: 80, y: 1104 } as const;
/** maps/kespro.tmj tile size. */
export const TILE = 32;
export const MAX_HP = 100;

export interface Duel {
  host: Page;
  guest: Page;
  hostId: string;
  guestId: string;
}

/** Host and guest (separate contexts) in one running round, both controlling. */
export async function startDuel(
  newPlayer: (pageErrors: Error[]) => Promise<Page>,
  pageErrors: Error[],
  names: [string, string] = ['Lyoja', 'Kohde'],
): Promise<Duel> {
  const host = await newPlayer(pageErrors);
  const guest = await newPlayer(pageErrors);
  await toPlay(host, names[0], '?debug=1');
  const code = await createRoom(host);
  await toPlay(guest, names[1], '?debug=1');
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
  return { host, guest, hostId: (await net(host)).sessionId, guestId: (await net(guest)).sessionId };
}

/** The local player's room and combat state (fails offline). */
export const net = (page: Page): Promise<KekeNetSnapshot> =>
  page.evaluate(() => {
    const n = (globalThis as WithHook).__KEKE__?.net();
    if (!n) throw new Error('window.__KEKE__.net() is null (offline, or no ?debug=1)');
    return n;
  });

/** Teleports to `at` (or the first free spot on a small ring around it) and waits until we stand there. */
export async function teleportTo(
  page: Page,
  at: { x: number; y: number },
): Promise<{ x: number; y: number }> {
  const spot = await page.evaluate(({ x, y }) => {
    const k = (globalThis as WithHook).__KEKE__;
    if (!k) throw new Error('window.__KEKE__ is missing');
    const offsets: [number, number][] = [[0, 0]];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      offsets.push([Math.cos(a) * 4, Math.sin(a) * 4]);
    }
    for (const [dx, dy] of offsets) if (k.teleport(x + dx, y + dy)) return { x: x + dx, y: y + dy };
    return null;
  }, at);
  expect(spot, `a free spot at ${at.x}, ${at.y}`).not.toBeNull();
  await expect
    .poll(async () => {
      const p = await page.evaluate(() => (globalThis as WithHook).__KEKE__?.player());
      return p ? Math.hypot(p.x - (spot?.x ?? 0), p.y - (spot?.y ?? 0)) : Infinity;
    })
    .toBeLessThan(2);
  return spot as { x: number; y: number };
}

/** Gives the local player `weapon` (debug message) and waits until the server state says so. */
export async function giveWeapon(page: Page, weapon: string): Promise<void> {
  const sent = await page.evaluate(
    (id) => (globalThis as WithHook).__KEKE__?.giveWeapon(id) ?? false,
    weapon,
  );
  expect(sent, `giveWeapon(${weapon}) sent`).toBe(true);
  await expect.poll(async () => (await net(page)).weapon, { timeout: 5_000 }).toBe(weapon);
}

/** One Attack click (left mouse) held for `holdMs`: long enough for a page at a few fps to sample it. */
export async function click(page: Page, holdMs = 150): Promise<void> {
  await page.mouse.down();
  await page.waitForTimeout(holdMs);
  await page.mouse.up();
}

/** Combat broadcasts of `type` this page has received (the hook keeps the last 50). */
export const eventsOf = (page: Page, type: string): Promise<unknown[]> =>
  page.evaluate(
    (t) =>
      ((globalThis as WithHook).__KEKE__?.combatEvents() ?? [])
        .filter((e) => e.type === t)
        .map((e) => e.payload),
    type,
  );

/** Where the local player is (predicted position). */
export const position = (page: Page): Promise<{ x: number; y: number }> =>
  page.evaluate(() => {
    const p = (globalThis as WithHook).__KEKE__?.player();
    if (!p) throw new Error('window.__KEKE__ is missing');
    return { x: p.x, y: p.y };
  });

/**
 * Aims the mouse from `from` toward `to` once the camera has stopped moving (it lerps after a teleport,
 * and an aim taken while it moves points a few degrees off: enough for an egg to miss at 3 tiles), then
 * waits a little so a slow page samples the new aim before the click.
 */
export async function aimAt(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  const screen = () =>
    page.evaluate(({ x, y }) => {
      const k = (globalThis as WithHook).__KEKE__;
      if (!k) throw new Error('window.__KEKE__ is missing');
      return k.screenPoint(x, y);
    }, from);
  let last = await screen();
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(150);
    const now = await screen();
    const still = Math.hypot(now.x - last.x, now.y - last.y) < 0.5;
    last = now;
    if (still) break;
  }
  await aimMouse(page, from, to);
  await page.waitForTimeout(300);
}
