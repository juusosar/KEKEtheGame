import { expect, type Page } from '@playwright/test';
import type { KekeHook } from '../../packages/client/src/game/hookTypes';
import { createRoom, game, joinRoom, players, row, test, toPlay, waitControlling } from './helpers';

// M6-4: the Teams option in the client (§4.3). Two players end up on opposite teams; each body is
// outlined in its team colour on both screens (hats and body colours stay individual), and the minimap
// paints each team's shared van in the team colour. The lobby shows the team as a ring round the swatch.

type WithHook = { __KEKE__?: KekeHook };

/** Shared TEAM_COLORS (team 1 red, team 2 blue); Playwright specs cannot import @keke/shared. */
const TEAM_COLORS = ['#E53935', '#3FA9F5'];
const teamColor = (team: number): string => TEAM_COLORS[team - 1] ?? '';

const vanMarkers = (page: Page) =>
  page.evaluate(() =>
    ((globalThis as WithHook).__KEKE__?.minimap() ?? [])
      .filter((m) => m.kind === 'van')
      .map((m) => ({ id: m.id, color: m.color ?? '' })),
  );

test('Teams: team colour outlines on bodies and vans, a ring in the lobby', async ({ newPlayer }) => {
  test.setTimeout(60_000);
  const pageErrors: Error[] = [];
  const host = await newPlayer(pageErrors);
  const guest = await newPlayer(pageErrors);

  await toPlay(host, 'Punainen', '?debug=1');
  const code = await createRoom(host);
  await toPlay(guest, 'Sininen', '?debug=1');
  await joinRoom(guest, code);
  for (const page of [host, guest]) await expect(players(page)).toHaveCount(2);

  await host.getByRole('button', { name: 'Teams', exact: true }).click();
  // Auto-balance: one player on each team.
  for (const page of [host, guest]) {
    await expect(row(page, 'Punainen')).toHaveAttribute('data-team', /^[12]$/);
    await expect(row(page, 'Sininen')).toHaveAttribute('data-team', /^[12]$/);
  }
  const hostTeam = Number(await row(host, 'Punainen').getAttribute('data-team'));
  const guestTeam = Number(await row(host, 'Sininen').getAttribute('data-team'));
  expect(new Set([hostTeam, guestTeam])).toEqual(new Set([1, 2]));
  // The swatch keeps the player's colour and gets a ring in the team colour.
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(teamColor(hostTeam).slice(i, i + 2), 16));
  await expect(row(guest, 'Punainen').locator('.swatch-dot')).toHaveCSS(
    'box-shadow',
    new RegExp(`rgb\\(${r}, ${g}, ${b}\\)`),
  );

  for (const page of [host, guest]) await page.getByRole('button', { name: 'Ready', exact: true }).click();
  await host.getByRole('button', { name: 'Start' }).click();
  await Promise.all(
    [host, guest].map(async (page) => {
      await expect(page.locator('body')).toHaveAttribute('data-scene', 'game', { timeout: 10_000 });
      await page.waitForFunction(() => (globalThis as WithHook).__KEKE__ !== undefined);
      await waitControlling(page);
    }),
  );

  const teamOf = { Punainen: hostTeam, Sininen: guestTeam } as const;
  const forBoth = async (page: Page, me: keyof typeof teamOf, other: keyof typeof teamOf) => {
    await expect
      .poll(async () => {
        const s = await game(page);
        const remote = s.remotes.find((p) => p.nickname === other);
        return [s.net?.team, s.net?.outline, remote?.team, remote?.outline];
      })
      .toEqual([teamOf[me], teamColor(teamOf[me]), teamOf[other], teamColor(teamOf[other])]);
    // Each team's van is painted in its team colour on the minimap. On the first map (kespro) the team
    // vans are slots 5 and 6 (0-based 4 and 5), either side of the middle dock gate.
    await expect
      .poll(async () => (await vanMarkers(page)).sort((x, y) => x.id.localeCompare(y.id)))
      .toEqual([
        { id: 'van:4', color: TEAM_COLORS[0] },
        { id: 'van:5', color: TEAM_COLORS[1] },
      ]);
  };
  await Promise.all([forBoth(host, 'Punainen', 'Sininen'), forBoth(guest, 'Sininen', 'Punainen')]);

  // Playtest 1 problem 7: the mini scoreboard's swatches are the team colours, not the player colours.
  const [hr, hg, hb] = [1, 3, 5].map((i) => parseInt(teamColor(hostTeam).slice(i, i + 2), 16));
  const hostRow = guest.locator('#keke-hud-scores li[data-player-id]').filter({ hasText: 'Punainen' });
  await expect(hostRow).toHaveAttribute('data-team', String(hostTeam));
  await expect(hostRow.locator('.swatch')).toHaveCSS('background-color', `rgb(${hr}, ${hg}, ${hb})`);

  expect(pageErrors).toEqual([]);
});
