import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { installAuthRoutes } from './fixtures/auth-routes';
import { mockGamesRoutes } from './fixtures/games-routes';

test.use({ serviceWorkers: 'block' });

const sizes = [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 820, height: 1180 },
  { width: 1180, height: 820 },
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
    await route.fulfill({ contentType: 'video/mp4', body: readFileSync(new URL('./fixtures/tiny.mp4', import.meta.url)) });
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
    await testInfo.attach(`loading-${size.width}x${size.height}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    // Each control must be the topmost element at its centre and at points just inside its edges.
    const covered = () =>
      page.evaluate(() => {
        const controls = [
          ...document.querySelectorAll<HTMLElement>(
            '.games-play, .games-edit, .games-close, .studio-library-volume button, .studio-menu-button:not([hidden])',
          ),
        ];
        const failures: string[] = [];
        for (const control of controls) {
          const box = control.getBoundingClientRect();
          if (!box.width || !box.height) continue;
          const inset = Math.min(box.width, box.height) / 4;
          const points = [
            [box.x + box.width / 2, box.y + box.height / 2],
            [box.x + inset, box.y + box.height / 2],
            [box.right - inset, box.y + box.height / 2],
            [box.x + box.width / 2, box.y + inset],
            [box.x + box.width / 2, box.bottom - inset],
          ];
          for (const [x, y] of points) {
            if (x! < 0 || y! < 0 || x! > innerWidth || y! > innerHeight) continue;
            const top = document.elementFromPoint(x!, y!);
            if (top && !control.contains(top))
              failures.push(`${control.getAttribute('aria-label') ?? control.className} covered by ${top.className}`);
          }
        }
        return failures;
      });
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

test('round icon buttons share one size with a centred glyph', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'each case sets its own viewport');
  test.setTimeout(120_000);
  for (const size of sizes) {
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
      expect({ ...button, size }).toMatchObject({ width: first!.width, height: first!.height, dx: 0, dy: 0 });
    }
  }
});
