import { expect, type Page } from '@playwright/test';
import { installFakePad, tapPad, test } from './helpers';

// The How to play screen off the title menu: five illustrated pages (sprites, key caps, a gamepad
// diagram), paged with the tabs, the arrow keys or a gamepad, and back to the title.

const PAGES = ['goal', 'controls', 'fight', 'staff', 'store2'];
const openPage = (page: Page) => page.locator('#keke-howto-page');

async function toHowTo(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'title', { timeout: 15_000 });
  await page.getByRole('button', { name: 'How to play' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'howto');
}

test('How to play opens from the title, pages through every tab and goes back', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));
  await toHowTo(page);

  const dialog = page.getByRole('dialog', { name: 'How to play' });
  await expect(dialog).toHaveAttribute('data-variant', 'page');
  const tabs = page.getByRole('tablist', { name: 'How to play pages' }).getByRole('tab');
  await expect(tabs).toHaveCount(PAGES.length);
  await expect(openPage(page)).toHaveAttribute('data-page', 'goal');
  // Drawn with the game's own sprites: they load from the atlases.
  await expect(openPage(page).locator('.keke-sprite[data-loaded="true"]').first()).toBeVisible();
  await expect(page.locator('#keke-howto-prev')).toBeDisabled();

  // The controls page lists every action on both devices, with the real bindings.
  await tabs.filter({ hasText: 'Controls' }).click();
  await expect(openPage(page)).toHaveAttribute('data-page', 'controls');
  await expect(openPage(page).locator('.howto-keys [data-action="interact"] kbd')).toHaveText('E');
  await expect(openPage(page).locator('.howto-pad-list li')).toHaveCount(8);
  await expect(openPage(page).locator('.howto-pad-list [data-action="interact"] kbd')).toHaveText('A');

  // Arrow keys page; Next walks to the end, where it reads Done.
  await page.keyboard.press('ArrowLeft');
  await expect(openPage(page)).toHaveAttribute('data-page', 'goal');
  for (const id of PAGES.slice(1)) {
    await page.locator('#keke-howto-next').click();
    await expect(openPage(page)).toHaveAttribute('data-page', id);
    await expect(tabs.and(page.locator(`[data-page="${id}"]`))).toHaveAttribute('aria-selected', 'true');
  }
  await expect(page.locator('#keke-howto-next')).toHaveText('Done');

  // Esc goes back to the title, with How to play focused.
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'title');
  await expect(page.getByRole('button', { name: 'How to play' })).toBeFocused();
  expect(pageErrors).toEqual([]);
});

test('How to play works with a gamepad alone', async ({ page }) => {
  await installFakePad(page);
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'title', { timeout: 15_000 });
  // D-pad down moves from Play to How to play; A opens it.
  await tapPad(page, 13);
  await expect(page.getByRole('button', { name: 'How to play' })).toBeFocused();
  await tapPad(page, 0);
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'howto');
  await expect(openPage(page)).toHaveAttribute('data-page', 'goal');

  await tapPad(page, 5); // RB
  await expect(openPage(page)).toHaveAttribute('data-page', 'controls');
  await tapPad(page, 15); // D-pad right
  await expect(openPage(page)).toHaveAttribute('data-page', 'fight');
  await tapPad(page, 4); // LB
  await expect(openPage(page)).toHaveAttribute('data-page', 'controls');
  await tapPad(page, 0); // A goes on
  await expect(openPage(page)).toHaveAttribute('data-page', 'fight');
  await tapPad(page, 1); // B closes
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'title');
});
