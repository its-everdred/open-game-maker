import { readFileSync } from 'node:fs';

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

test('places the games grid behind the floating controls', async ({ page }, testInfo) => {
  await page.setViewportSize(
    testInfo.project.name === 'phone' ? { width: 390, height: 844 } : { width: 1180, height: 820 },
  );
  await page.goto('/all?test&games=0', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.games-spotlight')).toHaveCount(0);
  await expect
    .poll(async () => {
      const grid = await page.locator('.games-grid').boundingBox();
      const floor = await page.locator('.games-floor').boundingBox();
      return grid && floor ? grid.y - floor.y : null;
    })
    .toBe(0);
});

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
  await expect(tiles).toHaveCount(9);
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
  await expect(tiles).toHaveCount(9);
});

test('keeps spotlight actions and close control touch sized on a phone', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'phone layout assertion');
  await page.goto('/all?test&spotlight=g_2');

  const play = page.getByRole('button', { name: 'Play Goblin Cellar' });
  const edit = page.getByRole('button', { name: 'Edit Goblin Cellar' });
  const create = page.getByRole('button', { name: 'New game' });
  const close = page.getByRole('button', { name: 'Close game' });
  await expect(play).toBeEnabled({ timeout: 30_000 });
  await expect(create).toHaveCount(0);

  for (const target of [play, edit]) {
    const box = (await target.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(64);
  }
  // Close matches the standard round buttons (Kevin, 2026-11-17), so it gets the secondary tap size.
  expect((await close.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  await close.click();
  await expect(create).toBeVisible();

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
});

test('orders the library after playing two games', async ({ page }) => {
  const played = new Map<string, string>();
  let sequence = 0;
  const games = ['g_a', 'g_b'].map((id) => ({
    id,
    title: id,
    familyId: 'family',
    ownerId: 'user',
    repo: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  }));
  await page.route('**/api/v1/games', (route) =>
    route.fulfill({
      json: {
        games: games.map((game) => ({ ...game, lastPlayedAt: played.get(game.id) ?? null })),
      },
    }),
  );
  await page.route(/\/api\/v1\/games\/g_[ab]$/, (route) => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1);
    return route.fulfill({ json: games.find((game) => game.id === id) });
  });
  await page.route(/\/api\/v1\/games\/g_[ab]\/play$/, (route) => {
    const id = new URL(route.request().url()).pathname.split('/').at(-2)!;
    const lastPlayedAt = `2026-11-15T00:00:0${++sequence}.000Z`;
    played.set(id, lastPlayedAt);
    return route.fulfill({ json: { lastPlayedAt } });
  });
  for (const id of ['g_b', 'g_a']) {
    await page.goto(`/g/${id}?mode=play`);
    await expect.poll(() => played.has(id)).toBe(true);
  }
  await page.goto('/all?test');
  await expect
    .poll(() =>
      page
        .locator('[data-game-id]')
        .evaluateAll((nodes) => nodes.slice(0, 2).map((node) => node.getAttribute('data-game-id'))),
    )
    .toEqual(['g_a', 'g_b']);
});

test('keeps tile badges in the bottom band', async ({ page }) => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/games.json', import.meta.url), 'utf8')) as {
    games: Array<Record<string, unknown>>;
    jobs: Array<Record<string, unknown>>;
  };
  fixture.games.push({ ...fixture.games[2], id: 'g_empty', title: 'Empty game' });
  fixture.games.push({ ...fixture.games[2], id: 'g_featured', slug: 'restorebound', title: 'RestoreBound' });
  fixture.jobs.push({ ...fixture.jobs[0], id: 'j_featured', gameId: 'g_featured' });
  await page.route('**/api/v1/jobs?state=active', (route) => route.fulfill({ json: { jobs: fixture.jobs } }));
  fixture.games[0]!.logoUrl = 'https://example.test/cover.png';
  fixture.games[2]!.choices = { genre: ['adventure', 'rpg'], vibe: ['cozy', 'creepy'] };
  await page.setViewportSize({ width: 667, height: 375 });
  await page.route('**/api/v1/games', (route) => route.fulfill({ json: { games: fixture.games } }));
  await page.goto('/all?test');
  await expect(page.locator('.game-new-badge').first()).toBeVisible();
  await expect(page.locator('.game-copy')).toHaveCount(0);
  await expect(page.locator('.game-logo')).toBeVisible();
  await expect(page.locator('[data-game-id="g_featured"] .game-building-chip')).toBeVisible();
  for (const size of [
    { width: 667, height: 375 },
    { width: 1440, height: 900 },
    { width: 1180, height: 820 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    await page.evaluate(() => window.scrollTo(0, 0));
    const firstTile = (await page.locator('[role="gridcell"]').first().boundingBox())!;
    await page.evaluate((distance) => window.scrollTo(0, distance), firstTile.height * 0.18);
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const failures: string[] = [];
            const overlaps = (a: DOMRect, b: DOMRect) =>
              a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
            const fixed = Array.from(document.querySelectorAll('.studio-logo, .studio-menu-button'))
              .map((element) => element.getBoundingClientRect())
              .filter((rect) => rect.width && rect.height);
            for (const control of document.querySelectorAll('.game-new-badge, .game-building-chip')) {
              const cell = control.closest('[role="gridcell"]')!;
              const box = control.getBoundingClientRect();
              const tile = cell.getBoundingClientRect();
              const name = `${cell.getAttribute('data-game-id')} ${control.className}`;
              const threshold = control.matches('.showcase-tile .game-new-badge') ? 0.45 : 0.6;
              if (box.top < tile.top + tile.height * threshold || box.bottom > tile.bottom)
                failures.push(`${name}: outside bottom band`);
              if (fixed.some((rect) => overlaps(rect, box))) failures.push(`${name}: covered by navigation`);
              for (const other of cell.querySelectorAll('.game-new-badge, .game-building-chip')) {
                if (other !== control && overlaps(other.getBoundingClientRect(), box))
                  failures.push(`${name}: overlaps another control`);
              }
              const meta = cell.querySelector('.game-tile-meta')?.getBoundingClientRect();
              const logo = cell.querySelector('.game-logo')?.getBoundingClientRect();
              const job = cell.querySelector('.game-building-chip');
              if (meta && !logo && !job && (meta.top >= box.bottom || meta.bottom <= box.top))
                failures.push(`${name}: not aligned with metadata`);
              for (const item of cell.querySelectorAll(
                '.game-tile-meta strong, .game-tile-meta .game-tag-icons .icon, .showcase-rating',
              )) {
                const rect = item.getBoundingClientRect();
                if (overlaps(rect, box))
                  failures.push(
                    `${name}: overlaps metadata ${JSON.stringify({ box: box.toJSON(), rect: rect.toJSON(), tile: tile.toJSON() })}`,
                  );
                if (rect.left < tile.left || rect.right > tile.right) failures.push(`${name}: metadata clipped`);
                if (rect.top < tile.top + tile.height * 0.18) failures.push(`${name}: metadata in navigation zone`);
              }
              if (logo && overlaps(logo, box))
                failures.push(
                  `${name}: control overlaps logo ${JSON.stringify({ box: box.toJSON(), logo: logo.toJSON(), tile: tile.toJSON() })}`,
                );
              if (logo && meta && overlaps(logo, meta))
                failures.push(
                  `${name}: metadata overlaps logo ${JSON.stringify({ meta: meta.toJSON(), logo: logo.toJSON(), tile: tile.toJSON() })}`,
                );
            }
            return failures;
          }),
        { message: JSON.stringify(size), timeout: 5000 },
      )
      .toEqual([]);
  }
});
