import { expect, test, type Page } from '@playwright/test';
import type { KekeHook } from '../../packages/client/src/game/hookTypes';
import { createRoom, requireDebugServer, toPlay, waitControlling } from './helpers';

// M7-2 (§12): the sound settings control is on every screen, its changes survive a reload, the Game
// scene loops its map's music track, and round events play their sounds. Audio output itself is not
// checked: the specs read state and the latched play counts (`__KEKE__.sfx()`) only.
type WithHook = { __KEKE__?: KekeHook };

test('volume and mute settings are saved and come back after a reload', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'title', { timeout: 15_000 });

  const control = page.locator('#keke-audio');
  const toggle = page.getByRole('button', { name: 'Sound settings' });
  const panel = page.getByRole('group', { name: 'Sound' });
  await expect(control).toHaveAttribute('data-muted', 'false');
  await expect(panel).toBeHidden();
  await toggle.click();
  await expect(panel).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  await panel.getByLabel('Music').fill('20');
  await panel.getByLabel('Master volume').fill('35');
  await panel.getByLabel('Mute').check();
  await expect(control).toHaveAttribute('data-muted', 'true');
  const stored = await page.evaluate(() =>
    (globalThis as unknown as { localStorage: { getItem(k: string): string | null } }).localStorage.getItem(
      'keke.audio',
    ),
  );
  expect(JSON.parse(stored ?? 'null')).toEqual({ master: 0.35, music: 0.2, sfx: 0.8, muted: true });

  // Escape closes the panel and leaves the screen as it was.
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();

  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'title', { timeout: 15_000 });
  await expect(control).toHaveAttribute('data-muted', 'true');
  await toggle.click();
  await expect(panel.getByLabel('Music')).toHaveValue('20');
  await expect(panel.getByLabel('Master volume')).toHaveValue('35');
  await expect(panel.getByLabel('Sound effects')).toHaveValue('80');
  await expect(panel.getByLabel('Mute')).toBeChecked();
  expect(pageErrors).toEqual([]);
});

test('the Game scene loops the map music and the sound files are served', async ({ page, request }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));
  await page.goto('/?debug=1&scene=game');
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'game', { timeout: 15_000 });
  await page.waitForFunction(() => (globalThis as WithHook).__KEKE__ !== undefined);
  const track = await page.evaluate(() => (globalThis as WithHook).__KEKE__?.music() ?? null);
  expect(track).toBe('assets/music/kespro_loop.wav');
  // The control is there in the game too.
  await expect(page.getByRole('button', { name: 'Sound settings' })).toBeVisible();

  for (const path of [track, 'assets/audio/hit.wav', 'assets/audio/deposit.wav']) {
    const res = await request.get(`/${path ?? ''}`);
    expect(res.ok(), path ?? '').toBe(true);
    expect((await res.body()).subarray(0, 4).toString('ascii')).toBe('RIFF');
  }
  expect(pageErrors).toEqual([]);
});

const played = (page: Page) =>
  page.evaluate(() => (globalThis as WithHook).__KEKE__?.sfx() ?? ({} as Record<string, number>));

test('a solo round plays the countdown, the go, our swing and the round-end buzzer', async ({
  page,
  request,
}) => {
  await requireDebugServer(request);
  test.setTimeout(60_000);
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));
  // Every server message type is registered on the client (playtest 1 idea 12).
  const unregistered: string[] = [];
  page.on('console', (m) => {
    if (m.text().includes('not registered for type')) unregistered.push(m.text());
  });
  await toPlay(page, 'Kuulija', '?debug=1');
  await createRoom(page);
  await page.getByRole('button', { name: 'Ready', exact: true }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'game', { timeout: 10_000 });
  await waitControlling(page);

  await expect.poll(async () => (await played(page))['countdownGo'] ?? 0).toBe(1);
  const atStart = await played(page);
  expect(atStart['countdown'] ?? 0).toBeGreaterThanOrEqual(1);
  expect(atStart['countdown'] ?? 0).toBeLessThanOrEqual(3);

  // Our own fists swing: the server's attack echo plays the swing at full volume.
  // Held across an input step (1/30 s), as combat.spec.ts does, so the press is sampled.
  await page.mouse.move(200, 200);
  await page.mouse.down();
  await page.waitForTimeout(120);
  await page.mouse.up();
  await expect.poll(async () => (await played(page))['swing'] ?? 0).toBeGreaterThanOrEqual(1);

  expect(await page.evaluate(() => (globalThis as WithHook).__KEKE__?.endPhase() ?? false)).toBe(true);
  await expect(page.locator('body')).toHaveAttribute('data-phase', 'roundResults', { timeout: 10_000 });
  await expect.poll(async () => (await played(page))['roundEnd'] ?? 0).toBe(1);
  expect(pageErrors).toEqual([]);
  expect(unregistered).toEqual([]);
});

test('the bottle machines hum on the second map, louder up close (P2-6)', async ({ page, request }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));
  const hum = async (): Promise<{ sound: string; volume: number }[]> =>
    page.evaluate(() => (globalThis as WithHook).__KEKE__?.ambient() ?? []);

  // The first map has no ambient sounds.
  await page.goto('/?debug=1&scene=game');
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'game', { timeout: 15_000 });
  await page.waitForFunction(() => (globalThis as WithHook).__KEKE__ !== undefined);
  expect(await hum()).toEqual([]);

  await page.goto('/?debug=1&scene=game&map=prisma');
  await expect(page.locator('body')).toHaveAttribute('data-map', 'prisma', { timeout: 15_000 });
  await page.waitForFunction(() => (globalThis as WithHook).__KEKE__ !== undefined);
  // Inside the bottle-return alcove, two tiles in front of the machines (tile 68,40).
  expect(
    await page.evaluate(() => (globalThis as WithHook).__KEKE__?.teleport(68 * 32 + 16, 40 * 32 + 16)),
  ).toBe(true);
  await expect.poll(async () => (await hum())[0]?.volume ?? 0).toBeGreaterThan(0.3);
  expect((await hum())[0]?.sound).toBe('bottleHum');
  // Out in the parking lot it is silent.
  expect(await page.evaluate(() => (globalThis as WithHook).__KEKE__?.teleport(1600, 1648))).toBe(true);
  await expect.poll(async () => (await hum())[0]?.volume ?? 1).toBe(0);
  const served = await request.get('/assets/audio/bottleHum.wav');
  expect(served.ok()).toBe(true);
  expect(pageErrors).toEqual([]);
});
