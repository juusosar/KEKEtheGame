import { expect, test } from '@playwright/test';
import type { KekeHook } from '../../packages/client/src/game/hookTypes';

// M7-2 (§12): the sound settings control is on every screen, its changes survive a reload, and the Game
// scene loops its map's music track. Audio output itself is not checked: the specs read state only.
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
