import { expect, test } from '@playwright/test';
import { installAuthRoutes } from './fixtures/auth-routes';
import { mockGamesRoutes } from './fixtures/games-routes';

test.setTimeout(90_000);

test('keeps the cover moving through selection and browser Back', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    const original = Element.prototype.animate;
    Element.prototype.animate = function (...args: Parameters<Element['animate']>) {
      if (this.classList.contains('game-cover-host')) {
        const state = window as Window & { coverGlides?: number };
        state.coverGlides = (state.coverGlides ?? 0) + 1;
      }
      const animation = original.apply(this, args);
      if (this.classList.contains('game-cover-host') || this.hasAttribute('data-game-id')) {
        animation.pause();
        animation.currentTime = 0;
      }
      return animation;
    };
  });
  await installAuthRoutes(page, { signedIn: true });
  await mockGamesRoutes(page);
  await page.route('**/api/v1/jobs?gameId=*', (route) => route.fulfill({ json: { jobs: [] } }));
  await page.route('**/api/v1/me/commands', (route) => route.fulfill({ json: { commands: [] } }));
  await page.goto('/all?test', { waitUntil: 'domcontentloaded' });
  const tile = page.locator('[data-game-id="g_2"] .game-tile');
  await expect(tile).toBeVisible();
  await tile.hover();
  const cover = page.locator('[data-game-id="g_2"] .game-cover-host');
  const rect = () =>
    cover.evaluate((element) => {
      const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
  const before = await rect();
  await tile.click();
  await expect(page).toHaveURL(/spotlight=g_2/);
  await expect(page.getByRole('button', { name: 'Close game' })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as Window & { coverGlides?: number }).coverGlides ?? 0))
    .toBeGreaterThan(0);
  const opening = await rect();
  for (const key of ['x', 'y', 'width', 'height'] as const)
    expect(Math.abs(opening[key] - before[key])).toBeLessThan(3);
  await page.goBack();
  await expect(tile).toBeVisible();
  const closing = await rect();
  for (const key of ['x', 'y', 'width', 'height'] as const)
    expect(Math.abs(closing[key] - opening[key])).toBeLessThan(3);
});

test('hides the old tile when reduced motion is enabled', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installAuthRoutes(page, { signedIn: true });
  await mockGamesRoutes(page);
  await page.route('**/api/v1/jobs?gameId=*', (route) => route.fulfill({ json: { jobs: [] } }));
  await page.route('**/api/v1/me/commands', (route) => route.fulfill({ json: { commands: [] } }));
  await page.goto('/all?test', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-game-id="g_2"] .game-tile').click();
  await expect(page).toHaveURL(/spotlight=g_2/);
  await expect(page.getByRole('button', { name: 'Close game' })).toBeVisible();
  await expect(page.locator('[data-game-id="g_2"]')).toHaveClass(/is-selected/);
  await expect(page.locator('[data-game-id="g_2"] .game-cell-tile')).toHaveCSS('opacity', '0');
});
