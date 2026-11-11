import { expect } from '@playwright/test';
import {
  createRoom,
  game,
  installFakePad,
  joinRoom,
  noNpcs,
  players,
  tapPad,
  test,
  toPlay,
  waitControlling,
} from './helpers';

// M7 review F5: Esc opens the in-game menu (§13.3 Menu). The round keeps running behind it (multiplayer,
// no pause) but our inputs go idle; it has Resume, the sound settings, the controls table and Leave room
// behind a confirmation. A confirmed leave is a consented leave: the other player sees us gone at once,
// not after the 30 s reconnect window, and we land on the Play screen.

test('in-game menu: Esc opens it, inputs go idle, Leave room returns to Play', async ({ newPlayer }) => {
  test.setTimeout(120_000);
  const pageErrors: Error[] = [];
  const host = await newPlayer(pageErrors);
  const guest = await newPlayer(pageErrors);

  await toPlay(host, 'Lahtija', '?debug=1');
  const code = await createRoom(host);
  await toPlay(guest, 'Jaaja', '?debug=1');
  await joinRoom(guest, code);
  for (const page of [host, guest]) await expect(players(page)).toHaveCount(2);
  for (const page of [host, guest]) await page.getByRole('button', { name: 'Ready', exact: true }).click();
  await host.getByRole('button', { name: 'Start' }).click();
  for (const page of [host, guest]) {
    await expect(page.locator('body')).toHaveAttribute('data-scene', 'game', { timeout: 10_000 });
    await page.waitForFunction(() => (globalThis as { __KEKE__?: unknown }).__KEKE__ !== undefined);
    await waitControlling(page);
  }
  // Walking is checked below: keep store workers from shoving us.
  await noNpcs(host);

  const menu = host.getByRole('dialog', { name: 'Menu' });
  await expect(menu).toBeHidden();
  await host.keyboard.press('Escape');
  await expect(menu).toBeVisible();
  await expect(host.locator('body')).toHaveAttribute('data-menu', 'open');
  await expect(host.getByRole('button', { name: 'Resume' })).toBeFocused();

  // Sound settings and the §13.3 controls table, keyboard column marked as the live device.
  const sound = menu.getByRole('group', { name: 'Sound' });
  await expect(sound.getByLabel('Master volume')).toBeVisible();
  await expect(sound.getByLabel('Mute')).toBeVisible();
  const controls = host.locator('#keke-game-menu-controls');
  await expect(controls).toHaveAttribute('data-device', 'keyboardMouse');
  await expect(controls.locator('tr[data-action="interact"] td.kbm')).toHaveText('E');
  await expect(controls.locator('tr[data-action="interact"] td.pad')).toHaveText('A');
  await expect(controls.locator('tr[data-action="menu"] td.kbm')).toHaveClass(/current/);

  // Inputs go idle while the menu is open: holding D does not walk, but the round clock keeps going.
  const timer = host.getByRole('timer', { name: 'Time left' });
  const before = (await game(host)).player;
  const secondsBefore = Number(await timer.getAttribute('data-seconds'));
  await host.keyboard.down('KeyD');
  await host.waitForTimeout(800);
  await host.keyboard.up('KeyD');
  const after = (await game(host)).player;
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(2);
  await expect
    .poll(async () => Number(await timer.getAttribute('data-seconds')), { timeout: 5_000 })
    .toBeLessThan(secondsBefore);

  // Esc closes it again, and walking works.
  await host.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(host.locator('body')).not.toHaveAttribute('data-menu', 'open');
  const start = (await game(host)).player;
  await host.keyboard.down('KeyD');
  await expect
    .poll(async () => Math.abs((await game(host)).player.x - start.x), { timeout: 5_000 })
    .toBeGreaterThan(8);
  await host.keyboard.up('KeyD');

  // Leave asks first; Stay (or Esc) goes back to the menu.
  await host.keyboard.press('Escape');
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: 'Leave room' }).click();
  const confirm = menu.getByRole('group', { name: 'Leave the room?' });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText(code);
  await confirm.getByRole('button', { name: 'Stay' }).click();
  await expect(confirm).toBeHidden();
  await expect(menu.getByRole('button', { name: 'Resume' })).toBeVisible();

  await menu.getByRole('button', { name: 'Leave room' }).click();
  await confirm.getByRole('button', { name: 'Leave', exact: true }).click();
  await expect(host.locator('body')).toHaveAttribute('data-scene', 'play', { timeout: 10_000 });
  await expect(host.locator('body')).not.toHaveAttribute('data-room', /.+/);
  await expect(host.locator('#keke-game-menu')).toHaveCount(0);
  await expect(host.locator('body')).not.toHaveAttribute('data-menu', 'open');

  // The guest sees us gone well inside the 30 s reconnect window: the leave was consented.
  await expect(guest.locator('#keke-hud-scores li[data-player-id]')).toHaveCount(1, { timeout: 8_000 });
  await expect(guest.locator('#keke-hud-scores')).not.toContainText('Lahtija');

  expect(pageErrors).toEqual([]);
});

test('in-game menu: offline walk mode goes back to the title', async ({ page }) => {
  await page.goto('/?debug=1&scene=game');
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'game', { timeout: 15_000 });
  await page.keyboard.press('Escape');
  const menu = page.getByRole('dialog', { name: 'Menu' });
  await expect(menu).toBeVisible();
  // Keyboard navigation: arrows move focus (Tab is the scoreboard key in game).
  await expect(page.getByRole('button', { name: 'Resume' })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(menu.getByRole('button', { name: 'Back to title' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu.getByRole('group', { name: 'Leave the room?' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu.getByRole('group', { name: 'Leave the room?' })).toBeHidden();
  await menu.getByRole('button', { name: 'Back to title' }).click();
  await menu.getByRole('button', { name: 'Leave', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'title', { timeout: 10_000 });
});

test('in-game menu: gamepad Start opens it, D-pad and A/B drive it', async ({ page }) => {
  await installFakePad(page);
  await page.goto('/?debug=1&scene=game');
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'game', { timeout: 15_000 });
  const tap = (button: number): Promise<void> => tapPad(page, button);
  const START = 9;
  const A = 0;
  const B = 1;
  const UP = 12;
  const RIGHT = 15;

  const menu = page.getByRole('dialog', { name: 'Menu' });
  await tap(START);
  await expect(menu).toBeVisible();
  // The pad was the last device used, so the controls table marks the gamepad column.
  await expect(page.locator('#keke-game-menu-controls')).toHaveAttribute('data-device', 'gamepad');
  await expect(page.locator('#keke-game-menu-controls tr[data-action="drop"] td.pad')).toHaveClass(/current/);

  // Down from Resume reaches the master volume slider; right raises it by 5.
  await expect(page.getByRole('button', { name: 'Resume' })).toBeFocused();
  await tap(13);
  const master = menu.getByRole('group', { name: 'Sound' }).getByLabel('Master volume');
  await expect(master).toBeFocused();
  const level = Number(await master.inputValue());
  await tap(RIGHT);
  await expect(master).toHaveValue(String(Math.min(100, level + 5)));

  // Up twice wraps past Resume to Back to title; A asks, B backs out of the question, B closes.
  await tap(UP);
  await tap(UP);
  await expect(menu.getByRole('button', { name: 'Back to title' })).toBeFocused();
  await tap(A);
  await expect(menu.getByRole('group', { name: 'Leave the room?' })).toBeVisible();
  await tap(B);
  await expect(menu.getByRole('group', { name: 'Leave the room?' })).toBeHidden();
  await tap(B);
  await expect(menu).toBeHidden();
  // Start toggles it open again.
  await tap(START);
  await expect(menu).toBeVisible();
});
