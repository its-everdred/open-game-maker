import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { installAuthRoutes } from './fixtures/auth-routes';
import { mockGamesRoutes } from './fixtures/games-routes';

test.use({ reducedMotion: 'reduce', serviceWorkers: 'block' });

test('plays the published trailer on selection and removes it on close', async ({ page }) => {
  test.setTimeout(180_000);
  await installAuthRoutes(page, { signedIn: true });
  await mockGamesRoutes(page);
  await page.route('**/api/v1/jobs?gameId=*', (route) => route.fulfill({ json: { jobs: [] } }));
  await page.route('**/api/v1/me/commands*', (route) => route.fulfill({ json: { commands: [] } }));
  await page.route('**/api/v1/me/core-commands*', (route) => route.fulfill({ json: { commands: [], targets: [] } }));
  await page.route('**/api/v1/budget/status', (route) => route.fulfill({ json: { unitLabel: 'coins' } }));
  await page.route('**/api/v1/notifications?*', (route) => route.fulfill({ json: { notifications: [] } }));
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/games.json', import.meta.url), 'utf8')) as {
    games: Array<{ id: string }>;
  };
  await page.route('**/api/v1/games', (route) =>
    route.fulfill({
      json: {
        games: fixture.games.map((game) =>
          game.id === 'g_1' ? { ...game, trailerUrl: '/fixture-trailer.mp4' } : game,
        ),
      },
    }),
  );
  await page.route('**/fixture-trailer.mp4', (route) =>
    route.fulfill({
      contentType: 'video/mp4',
      body: readFileSync(new URL('./fixtures/tiny.mp4', import.meta.url)),
    }),
  );
  await page.goto('/all?test&spotlight=g_1', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-game-id="g_1"].is-selected')).toBeVisible({ timeout: 90000 });
  const video = page.locator('.game-trailer-layer video');
  await expect(video).toBeVisible({ timeout: 30000 });
  await expect
    .poll(
      () =>
        video.evaluate((element: HTMLVideoElement) => ({
          paused: element.paused,
          error: element.error?.message ?? null,
          ready: element.readyState,
        })),
      { timeout: 15000, message: 'trailer should play' },
    )
    .toMatchObject({ paused: false, error: null });
  await expect(video).toHaveAttribute('loop');
  await expect(video).toHaveCSS('object-fit', 'cover');
  await page.getByRole('button', { name: 'Close game' }).click();
  await expect(video).toHaveCount(0);
});
