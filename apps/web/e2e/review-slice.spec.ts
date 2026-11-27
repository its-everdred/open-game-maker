import { expect, test, type Frame, type Page, type Route, type TestInfo } from '@playwright/test';

import { installAuthRoutes } from './fixtures/auth-routes';
import { isGameLaunch } from './support/game-launch';

// #1281: a review card plays the reviewed slice in place. Kevin taps the card on his phone and is in the moment under
// review (here, wave 3) in under 5 s, without the title, menus or another page. The slice is the build named on the
// round, started in its scenario on the app's own origin.
const gameId = 'g_fall-1281-8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e90';

test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });

test('a review card plays its slice inline, straight into the scenario', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'the slice is judged on the 390x844 phone');
  testInfo.setTimeout(120_000);
  const designs: string[] = [];
  await installAuthRoutes(page, { signedIn: true });
  await installApi(page, designs);
  await page.goto('/fall/review');

  const card = page.getByRole('region', { name: 'Review for ticket publish' });
  const slice = card.frameLocator('iframe.review-slice');
  const play = slice.getByRole('button', { name: 'Play' });
  await expect(play).toBeEnabled({ timeout: 20_000 });
  await expect(card.locator('iframe.review-slice')).toHaveAttribute(
    'src',
    `/g/${gameId}/play?build=b_wave&scenario=endless%2Fwave-3`,
  );
  /* Nothing loads from the games host until the tap. */
  expect(page.frames().some((frame) => frame.url().includes(`/g/${gameId}/b_wave/`))).toBe(false);
  await capture(page, testInfo, 'review-slice-card');

  const tapped = Date.now();
  await play.tap();
  const game = await gameFrame(page);
  await expect
    .poll(() => game.evaluate(() => window.__fixture.messages.includes('design.apply')), { timeout: 20_000 })
    .toBe(true);
  const elapsed = Date.now() - tapped;
  expect(elapsed, 'tap to a running slice').toBeLessThan(5_000);
  expect(await game.evaluate(() => window.__fixture.params)).toMatchObject({ scenario: 'endless/wave-3' });
  /* The reviewed build, not the branch head. */
  expect(designs).toContain(`/api/v1/games/${gameId}/builds/b_wave/design`);
  expect(designs).not.toContain(`/api/v1/games/${gameId}/branches/main/design`);
  await page.waitForTimeout(1_000);
  await capture(page, testInfo, 'review-slice-playing');
  await testInfo.attach('tap-to-slice-ms', { body: String(elapsed), contentType: 'text/plain' });
});

declare global {
  interface Window {
    __fixture: { params: Record<string, string>; messages: string[] };
  }
}

async function gameFrame(page: Page): Promise<Frame> {
  let found: Frame | undefined;
  await expect
    .poll(
      () => {
        found = page.frames().find((frame) => frame.url().includes(`/g/${gameId}/b_wave/`));
        return found === undefined ? false : found.evaluate(() => window.__fixture !== undefined).catch(() => false);
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  return found!;
}

async function installApi(page: Page, designs: string[]) {
  await page.route('**/api/v1/**', async (route) => {
    if (isGameLaunch(route.request().url())) return route.fallback();
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/notifications/stream') {
      return route.fulfill({ contentType: 'text/event-stream', body: 'retry: 60000\n\n' });
    }
    if (path === '/api/v1/me') return json(route, { platformRole: 'none' });
    if (path === '/api/v1/games/resolve/fall') {
      return json(route, {
        game: {
          id: gameId,
          familyId: 'f_1',
          ownerId: 'u_1',
          title: 'Block Fall',
          slug: 'fall',
          repo: null,
          createdAt: '2026-11-07T17:00:00.000Z',
        },
      });
    }
    if (path === `/api/v1/games/${gameId}/review-rounds`) {
      return json(route, {
        rounds: [
          {
            id: 'round-wave-3',
            ticket: 'publish',
            track: 'prototype-publish',
            category: 'gameplay',
            question: 'Is wave 3 fair?',
            works: ['Endless waves'],
            limitations: [],
            decisionIds: [],
            sourceTickets: ['1281'],
            clipStatus: null,
            playUrl: `https://app.example.test/g/${gameId}?mode=edit&build=b_wave&scenario=endless%2Fwave-3`,
            sliceUrl: `https://app.example.test/g/${gameId}/play?build=b_wave&scenario=endless%2Fwave-3`,
            media: [],
            postedAt: '2026-11-23T00:00:00.000Z',
          },
        ],
      });
    }
    if (path.endsWith('/design')) {
      designs.push(path);
      return json(route, { rev: 1, buildId: 'b_wave', doc: { schemaVersion: 1, globals: {}, entities: {} } });
    }
    if (path === `/api/v1/games/${gameId}/commands`) return json(route, { commands: [] });
    if (path === `/api/v1/games/${gameId}/previews`) return json(route, { previews: [] });
    if (path === `/api/v1/games/${gameId}/review-drafts`) return json(route, { drafts: [] });
    if (path === '/api/v1/jobs' || path === '/api/v1/jobs/active') return json(route, { jobs: [] });
    return json(route, { error: 'not_mocked', path }, 404);
  });
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}
