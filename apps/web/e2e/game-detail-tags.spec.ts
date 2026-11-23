import { expect, test, type Page } from '@playwright/test';
import { installAuthRoutes } from './fixtures/auth-routes';
import { mockGamesRoutes } from './fixtures/games-routes';

test.use({ serviceWorkers: 'block' });

// Kevin, 2026-11-23, on RestoreBound's detail page: "never more than 1 row of icons. make icons unique. there should
// always be room for other thumbnails below". The tag and genre lists are the published games' manifests.
const games = [
  {
    id: 'g_restorebound',
    slug: 'restorebound',
    title: 'RestoreBound',
    tagline:
      'An Earthbound-inspired turn-based RPG opening: Lygon kidnaps your brother and sister, so you go get them back.',
    tags: ['Pixel art', 'Turn-based', 'Story', 'Single player'],
    choices: { genre: ['RPG', 'Adventure'] },
    stats: { plays: 1 },
  },
  { id: 'g_dusk', slug: 'dusk-helm', title: 'Dusk Helm', choices: { genre: ['rpg', 'roguelike', 'adventure'] } },
  {
    id: 'g_blobs',
    slug: 'blobs',
    title: 'Blobs VS Blocks',
    tagline: 'Match blobs, clear blocks, and build big combos solo or against friends.',
    tags: ['Versus', 'Cozy', 'Solo', 'Multiplayer'],
  },
].map((game, index) => ({
  ownerId: 'u_1',
  familyId: `f_${index}`,
  repo: null,
  coverUrl: 'https://example.test/cover.png',
  publishedReleaseId: null,
  createdAt: '2026-11-01T05:00:00Z',
  updatedAt: `2026-11-0${3 - index}T05:00:00Z`,
  ...game,
}));

async function openDetail(page: Page, id: string) {
  await installAuthRoutes(page, { signedIn: true });
  await mockGamesRoutes(page);
  await page.route('**/api/v1/games', (route) => route.fulfill({ json: { games } }));
  await page.route('**/api/v1/jobs?gameId=*', (route) => route.fulfill({ json: { jobs: [] } }));
  await page.route('**/api/v1/me/commands*', (route) => route.fulfill({ json: { commands: [] } }));
  await page.route('**/api/v1/me/core-commands*', (route) => route.fulfill({ json: { commands: [], targets: [] } }));
  await page.route('**/api/v1/budget/status', (route) => route.fulfill({ json: { unitLabel: 'coins' } }));
  await page.route('**/api/v1/notifications?*', (route) => route.fulfill({ json: { notifications: [] } }));
  await page.goto(`/all?test&spotlight=${id}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('list', { name: 'Tags' })).toBeVisible({ timeout: 90_000 });
}

/** The tags a player can see: inside the list's clipped box, with their icon markup and top edge. */
function shownTags(page: Page) {
  return page.getByRole('list', { name: 'Tags' }).evaluate((list) => {
    const box = list.getBoundingClientRect();
    return [...list.children].flatMap((item) => {
      const rect = item.getBoundingClientRect();
      if (rect.top >= box.bottom - 1 || rect.height === 0) return [];
      return [
        {
          label: item.textContent,
          top: Math.round(rect.top),
          clipped: rect.bottom > box.bottom + 1,
          icon: item.querySelector('.icon')!.innerHTML,
        },
      ];
    });
  });
}

for (const size of [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
]) {
  for (const game of games) {
    test(`${game.title} shows one row of distinct tag icons at ${size.width}x${size.height}`, async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop', 'each case sets its own viewport');
      test.setTimeout(120_000);
      await page.setViewportSize(size);
      await openDetail(page, game.id);
      const tags = await shownTags(page);
      expect(tags.length).toBeGreaterThan(0);
      expect(new Set(tags.map(({ top }) => top)).size, JSON.stringify(tags)).toBe(1);
      expect(tags.filter(({ clipped }) => clipped)).toEqual([]);
      expect(new Set(tags.map(({ icon }) => icon)).size, JSON.stringify(tags.map(({ label }) => label))).toBe(
        tags.length,
      );
    });
  }
}

test('RestoreBound leads with its genres and leaves other game thumbnails on a 390x844 phone', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'each case sets its own viewport');
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await openDetail(page, 'g_restorebound');
  expect((await shownTags(page)).map(({ label }) => label).slice(0, 3)).toEqual(['Single player', 'RPG', 'Adventure']);
  // Other games' thumbnails start in the first screen, below Play and Edit.
  const edit = await page.getByRole('button', { name: 'Edit RestoreBound' }).boundingBox();
  const shown = await page.evaluate(() =>
    [...document.querySelectorAll('[role="gridcell"]:not(.is-selected) .game-tile')].map((tile) => {
      const box = tile.getBoundingClientRect();
      return Math.max(0, Math.min(box.bottom, innerHeight) - Math.max(box.top, 0));
    }),
  );
  expect(edit!.y + edit!.height).toBeLessThan(844);
  expect(Math.max(...shown)).toBeGreaterThanOrEqual(96);
});
