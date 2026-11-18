import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { installAuthRoutes } from './fixtures/auth-routes';
import { mockGamesRoutes } from './fixtures/games-routes';

test.use({ serviceWorkers: 'block' });
test.setTimeout(120_000);

const sizes = [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 820, height: 1180 },
  { width: 1180, height: 820 },
  { width: 1024, height: 768 },
];

const fixture = JSON.parse(readFileSync(new URL('./fixtures/games.json', import.meta.url), 'utf8')) as {
  games: Array<{ id: string }>;
};

/** Holds the trailer response so the detail stays in its loading state until `release` runs. */
async function openWhileLoading(page: Page) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await installAuthRoutes(page, { signedIn: true });
  await mockGamesRoutes(page);
  await page.route('**/api/v1/jobs?gameId=*', (route) => route.fulfill({ json: { jobs: [] } }));
  await page.route('**/api/v1/me/commands*', (route) => route.fulfill({ json: { commands: [] } }));
  await page.route('**/api/v1/me/core-commands*', (route) => route.fulfill({ json: { commands: [], targets: [] } }));
  await page.route('**/api/v1/budget/status', (route) => route.fulfill({ json: { unitLabel: 'coins' } }));
  await page.route('**/api/v1/notifications?*', (route) => route.fulfill({ json: { notifications: [] } }));
  await page.route('**/api/v1/games', (route) =>
    route.fulfill({
      json: {
        games: fixture.games.map((game) =>
          game.id === 'g_1' ? { ...game, trailerUrl: '/fixture-trailer.mp4' } : game,
        ),
      },
    }),
  );
  await page.route('**/fixture-trailer.mp4', async (route) => {
    await held;
    await route.fulfill({
      contentType: 'video/mp4',
      body: readFileSync(new URL('./fixtures/tiny.mp4', import.meta.url)),
    });
  });
  return release;
}

for (const size of sizes) {
  test(`nothing covers the detail controls while loading at ${size.width}x${size.height}`, async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'each case sets its own viewport');
    test.setTimeout(120_000);
    await page.setViewportSize(size);
    const release = await openWhileLoading(page);
    await page.goto('/all?test&spotlight=g_1', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Play Midnight Crumbs' })).toBeVisible({ timeout: 90_000 });
    await expect(
      page.getByRole('region', { name: 'Midnight Crumbs spotlight' }).getByText('Building 40%'),
    ).toBeVisible();
    // Scroll each control into view before checking its centre and inset edges.
    const covered = async () => {
      const controls = page.locator(
        '.games-play, .games-edit, .games-close, .studio-library-volume button, .studio-menu-button:not([hidden])',
      );
      const failures: string[] = [];
      for (let index = 0; index < (await controls.count()); index++) {
        const control = controls.nth(index);
        if (!(await control.isVisible())) continue;
        await control.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
        failures.push(
          ...(await control.evaluate((element) => {
            const box = element.getBoundingClientRect();
            const inset = Math.min(box.width, box.height) / 4;
            const points = [
              [box.x + box.width / 2, box.y + box.height / 2],
              [box.x + inset, box.y + box.height / 2],
              [box.right - inset, box.y + box.height / 2],
              [box.x + box.width / 2, box.y + inset],
              [box.x + box.width / 2, box.bottom - inset],
            ];
            return points.flatMap(([x, y]) => {
              const top = document.elementFromPoint(x!, y!);
              return top && element.contains(top)
                ? []
                : [`${element.getAttribute('aria-label')} covered by ${top?.tagName}.${top?.className}`];
            });
          })),
        );
      }
      return failures;
    };
    expect(await covered()).toEqual([]);
    release();
    await expect
      .poll(() => page.locator('.game-trailer-layer video').evaluate((video: HTMLVideoElement) => video.readyState), {
        timeout: 15_000,
      })
      .toBeGreaterThan(1);
    expect(await covered()).toEqual([]);
  });
}

for (const size of sizes) {
  test(`round icon buttons share one size with a centred glyph at ${size.width}x${size.height}`, async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'each case sets its own viewport');
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.mouse.move(0, 0);
    await page.setViewportSize(size);
    const release = await openWhileLoading(page);
    release();
    await page.goto('/all?test&spotlight=g_1', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Close game' })).toBeVisible({ timeout: 90_000 });
    const buttons = await page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          '.games-close, .studio-library-volume .menu-circle, .studio-menu-button:not([hidden])',
        ),
      ].map((button) => {
        const box = button.getBoundingClientRect();
        const glyph = button.querySelector('.icon')!;
        const inner = glyph.getBoundingClientRect();
        return {
          name: button.getAttribute('aria-label'),
          width: Math.round(box.width),
          height: Math.round(box.height),
          dx: Math.round(inner.x + inner.width / 2 - (box.x + box.width / 2)),
          dy: Math.round(inner.y + inner.height / 2 - (box.y + box.height / 2)),
        };
      }),
    );
    expect(buttons.length, JSON.stringify(size)).toBeGreaterThanOrEqual(2);
    const [first] = buttons;
    for (const button of buttons) {
      expect({ name: button.name, size, width: button.width, height: button.height }).toMatchObject({
        width: first!.width,
        height: first!.height,
      });
      expect(Math.abs(button.dx)).toBeLessThanOrEqual(1);
      expect(Math.abs(button.dy)).toBeLessThanOrEqual(1);
    }
  });
}

for (const size of [
  { width: 844, height: 390 },
  { width: 1180, height: 820 },
  { width: 1024, height: 768 },
  { width: 1366, height: 1024 },
]) {
  test(`RestoreBound detail fits its landscape column at ${size.width}x${size.height}`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'each case sets its own viewport');
    test.setTimeout(120_000);
    await page.setViewportSize(size);
    const release = await openWhileLoading(page);
    release();
    await page.goto('/all?test&spotlight=showcase%3Arestorebound', { waitUntil: 'domcontentloaded' });
    const detail = page.getByRole('region', { name: 'RestoreBound spotlight' });
    await expect(detail).toBeVisible();
    const geometry = await detail.evaluate((element) => {
      const copy = element.querySelector('.games-spotlight-copy')!.getBoundingClientRect();
      const heading = element.querySelector('h1')!.getBoundingClientRect();
      const close = element.querySelector('.games-close')!.getBoundingClientRect();
      const stats = [...element.querySelectorAll('.games-detail-stats dt, .games-detail-stats dd')].map((item) =>
        item.getBoundingClientRect(),
      );
      // A one-word title must never split mid-word; it shrinks to its column instead.
      const titleRange = document.createRange();
      titleRange.selectNodeContents(element.querySelector('h1')!);
      return {
        titleLines: new Set([...titleRange.getClientRects()].map((rect) => Math.round(rect.top))).size,
        titleOverlapsClose:
          heading.left < close.right &&
          heading.right > close.left &&
          heading.top < close.bottom &&
          heading.bottom > close.top,
        clippedStats: stats.some((item) => item.left < copy.left - 1 || item.right > copy.right + 1),
      };
    });
    expect(geometry).toEqual({ titleLines: 1, titleOverlapsClose: false, clippedStats: false });
    for (const name of ['Play RestoreBound', 'Edit RestoreBound']) {
      const button = page.getByRole('button', { name });
      await button.scrollIntoViewIfNeeded();
      await expect(button).toBeInViewport({ ratio: 0.99 });
      expect(
        await button.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
        }),
      ).toBe(true);
    }
  });
}
