import { expect, type Page } from '@playwright/test';
import type { KekeHook } from '../../packages/client/src/game/hookTypes';
import {
  createRoom,
  game,
  installFakePad,
  noNpcs,
  requireDebugServer,
  setPadAxis,
  teleportNear,
  test,
  toPlay,
  waitControlling,
} from './helpers';

// M7 review F6: on-screen button prompts that follow the last-used device (§13.3). The round intro
// teaches Move / Scores / Menu; next to an item with empty hands the HUD offers "E Pick up", while
// carrying "Q Drop"; touching the gamepad switches the same prompt to "B Drop". Solo round, so the
// debug teleport (KEKE_DEBUG=1) puts us next to our target.

type WithHook = { __KEKE__?: KekeHook };

const prompt = (page: Page, action: string) => page.locator(`#keke-hud-prompts li[data-action="${action}"]`);

test('button prompts: round intro, pick up, drop, and the gamepad switch', async ({ page, request }) => {
  await requireDebugServer(request);
  test.setTimeout(90_000);
  await installFakePad(page);
  await toPlay(page, 'Opettaja', '?debug=1');
  await createRoom(page);
  await page.getByRole('button', { name: 'Ready', exact: true }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'game', { timeout: 10_000 });

  // Round intro: the basics, in keyboard names.
  const prompts = page.getByRole('list', { name: 'Button prompts' });
  await expect(prompts).toBeVisible();
  await expect(prompts).toHaveAttribute('data-device', 'keyboardMouse');
  await expect(prompt(page, 'move').locator('kbd')).toHaveText('WASD');
  await expect(prompt(page, 'scoreboard').locator('kbd')).toHaveText('Tab');
  await expect(prompt(page, 'menu').locator('kbd')).toHaveText('Esc');

  await page.waitForFunction(() => (globalThis as WithHook).__KEKE__ !== undefined);
  await waitControlling(page);
  await noNpcs(page);
  // Nothing to offer at the van: the round's prompts appear only when they apply.
  await expect(prompt(page, 'move')).toHaveCount(0);

  // Next to our target with empty hands: "E Pick up".
  const targetId = (await game(page)).net?.target ?? 0;
  expect(targetId).toBeGreaterThan(0);
  const { target, tile } = await page.evaluate((id) => {
    const keke = (globalThis as WithHook).__KEKE__;
    if (!keke) throw new Error('window.__KEKE__ is missing');
    return { target: keke.items().find((i) => i.id === id), tile: keke.map.tileSize };
  }, targetId);
  if (!target) throw new Error(`target ${targetId} is not drawn`);
  // Retried like round.spec.ts in case a teleport does not stick.
  await expect(async () => {
    await teleportNear(page, { x: target.serverX, y: target.serverY }, tile * 0.6);
    await expect(prompt(page, 'interact')).toBeVisible({ timeout: 2_000 });
    await expect(prompt(page, 'interact').locator('kbd')).toHaveText('E');
    await expect(prompt(page, 'interact')).toContainText('Pick up');
    await page.keyboard.down('KeyE');
    await page.waitForTimeout(150);
    await page.keyboard.up('KeyE');
    await expect.poll(async () => (await game(page)).net?.carrying, { timeout: 3_000 }).toBe(targetId);
  }).toPass({ timeout: 30_000 });

  // Carrying: "Q Drop" replaces the pickup prompt.
  await expect(prompt(page, 'drop').locator('kbd')).toHaveText('Q');
  await expect(prompt(page, 'interact')).toHaveCount(0);

  // Touch the pad (right stick: aims, does not walk): the same prompt now names the pad button.
  await setPadAxis(page, 2, 0.9);
  await expect(prompts).toHaveAttribute('data-device', 'gamepad');
  await expect(prompt(page, 'drop').locator('kbd')).toHaveText('B');
  await setPadAxis(page, 2, 0);

  // And back to the keyboard on the next key press.
  await page.keyboard.down('ShiftLeft');
  await page.waitForTimeout(100);
  await page.keyboard.up('ShiftLeft');
  await expect(prompt(page, 'drop').locator('kbd')).toHaveText('Q');

  // The menu takes over: no prompts behind it.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Menu' })).toBeVisible();
  await expect(prompts).toBeHidden();
});
