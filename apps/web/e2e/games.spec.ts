import { expect, test } from '@playwright/test';

import { installAuthRoutes } from './fixtures/auth-routes';
import { mockGamesRoutes } from './fixtures/games-routes';

test.setTimeout(90_000);
test.use({ reducedMotion: 'reduce' });

type GamesTestApi = { selected(): string | null; tiles(): string[] };
type GamesWindow = Window & { __ogmHost?: { get(name: string): object | undefined } };

test.beforeEach(async ({ page }) => {
  await installAuthRoutes(page, { signedIn: true });
  await mockGamesRoutes(page);
  await page.route('**/api/v1/jobs?gameId=*', (route) => route.fulfill({ json: { jobs: [] } }));
  await page.route('**/api/v1/me/commands', (route) => route.fulfill({ json: { commands: [] } }));
  await page.route('**/api/v1/budget/status', (route) => route.fulfill({ json: { unitLabel: 'coins' } }));
});

for (const count of [0, 1]) {
  test(`keeps the prototype games in the grid with ${count} real games`, async ({ page }, testInfo) => {
    await page.goto(`/all?test&games=${count}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'New game' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^RestoreBound:/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Goblin Cellar:/ })).toBeVisible();
    await expect(page.locator('.games-spotlight')).toHaveCount(0);
    await testInfo.attach(`${testInfo.project.name}-${count}-games`, {
      body: await capture(page),
      contentType: 'image/png',
    });
  });
}

async function capture(page: import('@playwright/test').Page): Promise<Buffer> {
  const session = await page.context().newCDPSession(page);
  try {
    const { data } = await session.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    return Buffer.from(data, 'base64');
  } finally {
    await session.detach();
  }
}

test('browses three real game tiles with the keyboard', async ({ page }) => {
  await page.goto('/all?test');

  const tiles = page.locator('.game-tile');
  await expect(tiles).toHaveCount(15);
  await expect(tiles.getByText('Building 40%')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => ((window as GamesWindow).__ogmHost?.get('games') as GamesTestApi | undefined)?.tiles()),
    )
    .toContain('g_2');
  const ids = await page.evaluate(() => ((window as GamesWindow).__ogmHost?.get('games') as GamesTestApi).tiles());

  await tiles.first().focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect
    .poll(() =>
      page.evaluate(() => ((window as GamesWindow).__ogmHost?.get('games') as GamesTestApi | undefined)?.selected()),
    )
    .toBe(ids[1]);

  await page.keyboard.press('Escape');
  await expect.poll(() => page.url()).not.toContain('spotlight');
  // Closing the select view remounts the screen; the library used to re-select
  // the first game once that navigation landed, so assert the dismissed grid.
  await page.waitForTimeout(200);
  expect(page.url()).not.toContain('spotlight');
  await expect(page.locator('.games-spotlight')).toHaveCount(0);
  await expect(tiles).toHaveCount(15);
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
    backgroundColor: 'rgb(255, 191, 50)',
    backgroundImage: 'linear-gradient(rgba(255, 255, 255, 0.18), rgba(0, 0, 0, 0) 55%)',
    borderColor: 'rgba(0, 0, 0, 0)',
    boxShadow: 'none',
    color: 'rgb(29, 27, 22)',
    gap: 'normal',
  });
  expect(plusStyle).toEqual({ backgroundColor: 'rgba(0, 0, 0, 0)', color: buttonStyle.color });

  await expect(create.getByText('New game', { exact: true })).toHaveCount(0);

  const spotlight = (await page.locator('.games-spotlight').boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(spotlight.height).toBeLessThanOrEqual(viewport.height);
});
