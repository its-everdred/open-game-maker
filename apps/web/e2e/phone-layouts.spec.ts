import { expect, test, type Locator } from '@playwright/test';

import { installAuthRoutes } from './fixtures/auth-routes';
import { mockGamesRoutes } from './fixtures/games-routes';

// #629: Kevin's phones. The title scene must reach the bottom of the screen, and a game's spotlight in landscape must
// show its first decision on arrival with New game clear of the cover and the list.
const landscapes = {
  'iPhone SE': { width: 667, height: 375 },
  'iPhone 15': { width: 852, height: 393 },
  '844 phone': { width: 844, height: 390 },
  'iPhone 15 Pro Max': { width: 932, height: 430 },
  'mid Android': { width: 915, height: 412 },
  iPad: { width: 1180, height: 820 },
};

const media = (id: string) => ({
  url: `https://media.example.test/${id}.mp4`,
  poster: `https://media.example.test/${id}.jpg`,
  width: 640,
  height: 360,
  duration_ms: 4000,
});
// Three review decks, like Blobs' journeys: enough rows to outgrow a phone held sideways.
const commands = ['character voices', 'keys and HUD', 'level two'].map((title, index) => ({
  job_id: null,
  ticket: String(600 + index),
  title: `Blobs ${title}`,
  command_id: `m_${index}`,
  decision_id: `d_${index}`,
  version: 1,
  question: `Which ${title}?`,
  options: ['a', 'b'].map((id) => ({ id, label: id.toUpperCase(), media: media(id) })),
  recommend: 'a',
  blocking: false,
  opened_at: '2026-11-08T10:00:00.000Z',
}));

test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });
test.setTimeout(180_000);

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'each case sets its own viewport');
  await installAuthRoutes(page, { signedIn: true });
});

test('the title scene reaches the bottom of the screen even when the title box is shorter', async ({ page }) => {
  await page.route('**/town/index.html*', (route) => route.fulfill({ contentType: 'text/html', body: '<body>' }));
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto('/');
  const start = page.getByRole('button', { name: 'Start', exact: true });
  await expect(start).toBeVisible({ timeout: 15_000 });
  // iOS Safari sizes 100svh above its toolbar, which floats over (or hides from) the bottom of the screen; stand in
  // for that gap with a title box shorter than the window.
  await page.addStyleTag({ content: '.title-screen { min-height: 80vh !important; height: 80vh; }' });

  const town = (await page.locator('.title-town').boundingBox())!;
  expect(town.y).toBe(0);
  expect(town.y + town.height).toBeGreaterThanOrEqual(852);
  await expect(start).toBeInViewport();
  // Chromium has no collapsing toolbar, so 100svh and 100lvh measure alike here: pin the unit that reaches under it.
  const height = await page.evaluate(() =>
    [...document.styleSheets]
      .filter((sheet) => !sheet.href || sheet.href.startsWith(location.origin))
      .flatMap((sheet) => [...sheet.cssRules])
      .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && rule.selectorText === '.title-town')
      .map((rule) => rule.style.getPropertyValue('height'))
      .find(Boolean),
  );
  expect(height).toBe('100lvh');
});

for (const [device, viewport] of Object.entries(landscapes)) {
  test(`${device} landscape keeps the game detail and decisions accessible`, async ({ page }, testInfo) => {
    await mockGamesRoutes(page);
    await page.route('**/api/v1/jobs?gameId=*', (route) => route.fulfill({ json: { jobs: [] } }));
    await page.route('**/api/v1/budget/status', (route) => route.fulfill({ json: { unitLabel: 'coins' } }));
    await page.route('**/api/v1/games/*/commands', (route) => route.fulfill({ json: { commands } }));
    await page.route('**/api/v1/me/commands', (route) =>
      route.fulfill({
        json: { commands: commands.map((command) => ({ ...command, game_id: 'g_2', game_title: 'Goblin Cellar' })) },
      }),
    );
    await page.setViewportSize(viewport);
    await page.goto('/all?spotlight=g_2', { waitUntil: 'domcontentloaded' });

    const spotlight = page.locator('.games-spotlight');
    const cover = spotlight.locator('.games-spotlight-media');
    const close = page.getByRole('button', { name: 'Close game' });
    // Exercise the same fixed notice element as the review feed while the detail is open.
    await page.evaluate(() => {
      const notice = document.createElement('button');
      notice.className = 'worker-tracker-toast worker-tracker-game-toast';
      notice.textContent = 'New review ready';
      document.body.append(notice);
    });
    const notice = page.getByRole('button', { name: 'New review ready' });
    await expect(spotlight.getByRole('heading', { name: 'Goblin Cellar' })).toBeInViewport({
      ratio: 1,
      timeout: 60_000,
    });
    await expect(page.getByRole('button', { name: 'New game' })).toHaveCount(0);
    await expectApart(close, cover);
    await expectApart(close, notice);
    await expectApart(close, page.locator('.studio-library-volume button'));
    expect(
      await close.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
      }),
    ).toBe(true);
    expect((await spotlight.boundingBox())!.height).toBeLessThanOrEqual(viewport.height * 0.71);
    await expect(page.locator('[data-game-id]:not(.is-selected) .game-tile').first()).toBeInViewport();
    const session = await page.context().newCDPSession(page);
    try {
      const { data } = await session.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      await testInfo.attach(`${device}-landscape`, { body: Buffer.from(data, 'base64'), contentType: 'image/png' });
    } finally {
      await session.detach();
    }
    await close.click();
    await expect(spotlight).toHaveCount(0);
    await notice.evaluate((element) => element.remove());
    await page.goto('/all?spotlight=g_2', { waitUntil: 'domcontentloaded' });

    // the rest of the list and Play stay reachable
    const play = spotlight.getByRole('button', { name: 'Play Goblin Cellar' });
    await play.scrollIntoViewIfNeeded();
    await expect(play).toBeInViewport();
    await page.locator('.studio-library-volume button').press('Shift+F10');
    await page.getByRole('button', { name: 'Decisions: 3' }).click();
    await expect(page.getByRole('button', { name: 'Blobs character voices, Goblin Cellar' })).toBeVisible();

    await page.keyboard.press('Escape');
    await close.click();
    await expect(spotlight).toHaveCount(0);
  });
}

async function expectApart(a: Locator, b: Locator) {
  const [x, y] = [(await a.boundingBox())!, (await b.boundingBox())!];
  const overlaps = x.x < y.x + y.width && y.x < x.x + x.width && x.y < y.y + y.height && y.y < x.y + x.height;
  expect(overlaps, `${JSON.stringify(x)} overlaps ${JSON.stringify(y)}`).toBe(false);
}
