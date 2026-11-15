import { expect, test } from '@playwright/test';
import { installAuthRoutes } from './fixtures/auth-routes';
import { mockGamesRoutes } from './fixtures/games-routes';

test.setTimeout(90_000);

test('shows the selected cover as ambient art and stops its motion when requested', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installAuthRoutes(page, { signedIn: true });
  await mockGamesRoutes(page);
  await page.route('**/api/v1/games', (route) =>
    route.fulfill({
      json: {
        games: [
          {
            id: 'g_1',
            title: 'Midnight Crumbs',
            ownerId: 'u_1',
            familyId: 'f_1',
            repo: null,
            coverUrl: 'https://example.test/cover.png',
            createdAt: '2026-11-01T05:00:00Z',
          },
        ],
      },
    }),
  );
  await page.goto('/all?test', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-game-id="g_1"] .game-tile').evaluate((element: HTMLElement) => element.click());
  const ambient = page.locator('[data-game-id="g_1"] .showcase-ambient');
  await expect(ambient).toBeVisible();
  await expect(ambient.locator('img')).toHaveAttribute('src', 'https://example.test/cover.png');
  await expect(ambient).toHaveCSS('filter', 'blur(70px) saturate(1.7)');
  await expect(ambient).toHaveCSS('animation-name', 'none');
  await expect(ambient).toHaveCSS('transition-property', 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const continuous = await ambient.evaluate((element) => {
    const cell = element.closest('.is-selected')!;
    const before = Number(getComputedStyle(element).opacity);
    cell.classList.remove('is-selected');
    const closing = Number(getComputedStyle(element).opacity);
    const transition = element
      .getAnimations()
      .find((animation) => animation instanceof CSSTransition && animation.transitionProperty === 'opacity');
    cell.classList.add('is-selected');
    const reopening = Number(getComputedStyle(element).opacity);
    return Boolean(transition && Math.abs(before - closing) < 0.01 && Math.abs(closing - reopening) < 0.01);
  });
  expect(continuous).toBe(true);
  await page.getByRole('button', { name: 'Close game' }).evaluate((element: HTMLElement) => element.click());
  await expect(page.locator('[data-game-id="g_1"] .game-cell-exiting')).toHaveCount(1);
  await page.locator('[data-game-id="g_1"] .game-tile').evaluate((element: HTMLElement) => element.click());
  await expect(ambient).toHaveCSS('animation-name', 'ambient-drift');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Close game' }).click();
  await expect(ambient).toHaveCount(0);
});

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
  const expanded = await page.locator('[data-game-id="g_2"]').boundingBox();
  expect(expanded).not.toBeNull();
  for (const key of ['x', 'y', 'width', 'height'] as const)
    expect(Math.abs(opening[key] - before[key])).toBeLessThan(3);
  await page.goBack();
  await expect(tile).toBeVisible();
  const closing = await rect();
  const exiting = await page.locator('[data-game-id="g_2"] .game-cell-exiting').boundingBox();
  expect(exiting).not.toBeNull();
  expect(Math.abs(exiting!.width - expanded!.width)).toBeLessThan(3);
  expect(Math.abs(exiting!.height - expanded!.height)).toBeLessThan(3);
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

test('hides the outgoing tile immediately during phone expansion', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    const original = Element.prototype.animate;
    Element.prototype.animate = function (...args: Parameters<Element['animate']>) {
      const animation = original.apply(this, args);
      if (this.hasAttribute('data-game-id') && this.classList.contains('is-selected')) {
        animation.pause();
        animation.currentTime = 0;
        Element.prototype.animate = original;
      }
      return animation;
    };
  });
  await installAuthRoutes(page, { signedIn: true });
  await mockGamesRoutes(page);
  await page.goto('/all?test', { waitUntil: 'domcontentloaded' });
  const tile = page.locator('[data-game-id="g_2"] .game-tile');
  await expect(tile).toBeVisible();
  const closed = await tile.boundingBox();
  await tile.evaluate((element: HTMLElement) => element.click());
  const outgoing = page.locator('[data-game-id="g_2"] .game-cell-tile');
  await expect(outgoing).toHaveCSS('animation-name', 'none');
  await expect(outgoing).toHaveCSS('opacity', '0');
  const cell = page.locator('[data-game-id="g_2"]');
  await expect(cell).toHaveClass(/is-selected/);
  const opening = await cell.boundingBox();
  expect(opening!.height).toBeGreaterThan(closed!.height * 2);
  await cell.evaluate((element) => element.getAnimations().forEach((animation) => animation.cancel()));
  const heading = page.getByRole('heading', { name: 'Goblin Cellar' });
  await expect(heading).toBeVisible();
  const settled = await cell.boundingBox();
  const title = await heading.boundingBox();
  await page.goto('/all?test&spotlight=g_2', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Goblin Cellar' })).toBeVisible();
  const direct = await page.locator('[data-game-id="g_2"]').boundingBox();
  const directTitle = await page.getByRole('heading', { name: 'Goblin Cellar' }).boundingBox();
  expect(settled).not.toBeNull();
  expect(direct).not.toBeNull();
  expect(title).not.toBeNull();
  expect(directTitle).not.toBeNull();
  expect(Math.abs(settled!.height - direct!.height)).toBeLessThan(2);
  expect(Math.abs(title!.height - directTitle!.height)).toBeLessThan(2);
});
