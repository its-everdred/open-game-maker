import { expect, test } from '@playwright/test';

import { installAuthRoutes } from './fixtures/auth-routes';
import { mockGamesRoutes } from './fixtures/games-routes';

type GamesTestApi = { selected(): string | null; tiles(): string[] };
type GamesWindow = Window & { __ogmHost?: { get(name: string): object | undefined } };

test.beforeEach(async ({ page }) => {
  await installAuthRoutes(page, { signedIn: true });
  await mockGamesRoutes(page);
});

test('switches from the selected game to the grid only when the thumbnail row overflows', async ({
  page,
}, testInfo) => {
  const visit = async (count: number) => {
    await page.goto(`/all?test&games=${count}`);
    await expect(page.getByRole('button', { name: 'New game' })).toBeVisible();
  };

  await visit(1);
  const grid = page.locator('.games-grid');
  const columns = () =>
    grid.evaluate((element) => {
      const template = getComputedStyle(element).gridTemplateColumns;
      return template.split(/\s+/).filter(Boolean).length;
    });
  // The grid can re-render after first paint; a detached node reports no columns.
  await expect.poll(columns).toBeGreaterThan(0);
  const capacity = await columns();
  await expect(page.locator('.games-spotlight')).toBeVisible();
  await expect(page.locator('.game-tile')).toHaveCount(1);
  await testInfo.attach(`${testInfo.project.name}-one-game`, {
    body: await page.screenshot(),
    contentType: 'image/png',
  });

  await visit(0);
  await expect(page.getByText('No games yet. Start with a new idea.')).toBeVisible();
  await expect(page.locator('.games-spotlight')).toHaveCount(0);
  await testInfo.attach(`${testInfo.project.name}-zero-games`, {
    body: await page.screenshot(),
    contentType: 'image/png',
  });

  await visit(capacity);
  await expect(page.locator('.games-spotlight')).toBeVisible();
  await expect(page.locator('.game-tile')).toHaveCount(capacity);

  await visit(capacity + 1);
  await expect(page.locator('.games-spotlight')).toHaveCount(0);
  await expect(page.locator('.game-tile')).toHaveCount(capacity + 1);
  await testInfo.attach(`${testInfo.project.name}-full-grid`, {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

test('browses three real game tiles with the keyboard', async ({ page }) => {
  await page.goto('/all?test');

  const tiles = page.locator('.game-tile');
  await expect(tiles).toHaveCount(3);
  await expect(tiles.getByText('Building 40%')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => ((window as GamesWindow).__ogmHost?.get('games') as GamesTestApi | undefined)?.tiles()),
    )
    .toEqual(['g_1', 'g_2', 'g_3']);

  await tiles.first().focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect
    .poll(() =>
      page.evaluate(() => ((window as GamesWindow).__ogmHost?.get('games') as GamesTestApi | undefined)?.selected()),
    )
    .toBe('g_2');

  await page.keyboard.press('Escape');
  await expect.poll(() => page.url()).not.toContain('spotlight');
  // Closing the select view remounts the screen; the library used to re-select
  // the first game once that navigation landed, so assert the dismissed grid.
  await page.waitForTimeout(200);
  expect(page.url()).not.toContain('spotlight');
  await expect(page.locator('.games-spotlight')).toHaveCount(0);
  await expect(tiles).toHaveCount(3);
});

test('keeps spotlight actions and the fixed New game control touch sized on a phone', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'phone layout assertion');
  await page.goto('/all?test&spotlight=g_2');

  const play = page.getByRole('button', { name: 'Play Goblin Cellar' });
  const edit = page.getByRole('button', { name: 'Edit Goblin Cellar' });
  const create = page.getByRole('button', { name: 'New game' });
  await expect(play).toBeEnabled();

  for (const target of [play, edit, create]) {
    const box = (await target.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(64);
  }

  const plus = create.locator('.plus');
  const icon = plus.locator('svg');
  await expect(icon).toHaveAttribute('viewBox', '0 0 16 16');
  const [buttonStyle, plusStyle] = await Promise.all([
    create.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        borderColor: style.borderTopColor,
        boxShadow: style.boxShadow,
        color: style.color,
        gap: style.columnGap,
      };
    }),
    plus.evaluate((element) => {
      const style = getComputedStyle(element);
      return { backgroundColor: style.backgroundColor, color: style.color };
    }),
  ]);
  expect(buttonStyle).toEqual({
    backgroundColor: 'rgb(152, 151, 26)',
    backgroundImage: 'none',
    borderColor: 'rgba(0, 0, 0, 0)',
    boxShadow: 'none',
    color: 'rgb(29, 32, 33)',
    gap: '8px',
  });
  expect(plusStyle).toEqual({ backgroundColor: 'rgba(0, 0, 0, 0)', color: buttonStyle.color });

  const label = create.getByText('New game', { exact: true });
  const [iconBox, labelBox] = await Promise.all([icon.boundingBox(), label.boundingBox()]);
  expect(Math.abs(iconBox!.y + iconBox!.height / 2 - (labelBox!.y + labelBox!.height / 2))).toBeLessThanOrEqual(1);

  const spotlight = (await page.locator('.games-spotlight').boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(spotlight.height).toBeLessThanOrEqual(viewport.height);
});
