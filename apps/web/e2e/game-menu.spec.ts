import { expect, test, type Page } from '@playwright/test';

import { installAuthRoutes } from './fixtures/auth-routes';
import { installGameApi } from './support/mock-game-api';

type GameHook = { bridgeState: string };
type FixtureHook = { messages: Array<{ t: string }>; send(type: string, payload: object): void };

// eslint-disable-next-line no-restricted-properties
const bridgePort = process.env.OGM_WEB_BRIDGE_PORT ?? '10001';
const bridgeOrigin = `http://127.0.0.1:${bridgePort}`;

test.use({ serviceWorkers: 'block' });

const viewports = [
  { name: 'portrait', width: 390, height: 844 },
  { name: 'landscape', width: 844, height: 390 },
];

const workers = [
  {
    ticket: '969',
    title: 'Dusk and torch',
    percent: 80,
    etaSeconds: null,
    state: 'in-progress',
    last: 'Warmer torch or cooler dusk?',
  },
  {
    ticket: '41',
    title: 'Forest road',
    percent: 55,
    etaSeconds: null,
    state: 'in-progress',
    last: 'Placing tree clusters from the forests',
  },
  {
    ticket: '22',
    title: 'First half playable',
    percent: 64,
    etaSeconds: null,
    state: 'in-progress',
    last: 'Wiring the boss door',
  },
  { ticket: '16', title: 'UI kit with liquid orbs', percent: null, etaSeconds: null, state: 'human-review' },
];

/** The game's tickets, a review ready with a still, a decision waiting on #969, and Energy readings. */
async function installMenuData(page: Page) {
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.slice('/api/v1'.length);
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/games' && route.request().method() === 'GET')
      return json({ games: [{ id: 'game', title: 'Goblin Cellar', ownerId: 'u1', live: true }] });
    if (path === '/games/game' && route.request().method() === 'GET')
      return json({
        id: 'game',
        familyId: 'family',
        ownerId: 'u1',
        title: 'Goblin Cellar',
        visibility: 'private',
        repoVisibility: 'private',
      });
    if (path === '/games/game/workers') return json({ workers });
    if (path === '/games/game/review-rounds')
      return json({
        rounds: [
          {
            id: 'round-16',
            ticket: '16',
            question: 'Liquid orbs, round 4',
            media: [{ kind: 'still', url: `${url.origin}/proto/art/town.png` }],
          },
        ],
      });
    if (path === '/games/game/previews') return json({ previews: [] });
    if (path.startsWith('/me/commands')) return json({ commands: [], question_sessions: [] });
    if (path === '/energy')
      return json({
        level: 'healthy',
        preference: 'balanced',
        windows: [],
        services: [],
        sources: [
          {
            id: 'claude',
            label: 'Claude',
            usedPercent: 62,
            resetsAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
            basis: 'reported',
            observedAt: null,
            stale: false,
          },
          {
            id: 'codex',
            label: 'Codex',
            usedPercent: 91,
            resetsAt: new Date(Date.now() + 9 * 86_400_000).toISOString(),
            basis: 'reported',
            observedAt: null,
            stale: false,
          },
        ],
      });
    return route.fallback();
  });
}

async function openGame(page: Page, query: string) {
  await page.goto(`/g/game?${query}`);
  await expect.poll(() => gameState(page).then((state) => state?.bridgeState), { timeout: 60_000 }).toBe('ready');
  const frame = page.frames().find((candidate) => candidate.url().startsWith(`${bridgeOrigin}/g/`));
  await frame?.evaluate(() => (window as Window & { __fixture: FixtureHook }).__fixture.send('load.frame', {}));
}

function gameState(page: Page): Promise<GameHook | undefined> {
  return page.evaluate(() => (window as Window & { __ogmHost?: { game?: GameHook } }).__ogmHost?.game);
}

for (const viewport of viewports) {
  test(`edit menu lists reviews, work and Energy in ${viewport.name}`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the test sets each phone viewport itself');
    test.setTimeout(300_000);
    await page.setViewportSize(viewport);
    await installAuthRoutes(page, { signedIn: true });
    await installGameApi(page);
    await installMenuData(page);
    await openGame(page, 'mode=edit&test');

    const menu = page.getByRole('button', { name: 'Menu' });
    await expect(menu.locator('.studio-menu-badge')).toHaveText('1');
    await menu.click();
    const dialog = page.getByRole('dialog', { name: 'Paused' });
    await expect(dialog).toBeVisible();
    const work = dialog.getByRole('region', { name: 'Work' });
    await expect(work.getByRole('button')).toHaveCount(3);
    await expect(work.getByRole('button').first()).toContainText('Dusk and torch');
    await expect(dialog.getByRole('region', { name: 'Review' })).toContainText('Liquid orbs, round 4');
    await expect(dialog.getByRole('region', { name: 'Energy' })).toContainText('Claude');
    await page.waitForTimeout(800);
    await page.screenshot({ path: testInfo.outputPath(`edit-menu-${viewport.name}.png`), timeout: 120_000 });

    await dialog.getByRole('button', { name: 'More' }).click();
    await expect(dialog.getByRole('link', { name: 'Publish' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`edit-more-${viewport.name}.png`), timeout: 120_000 });

    await dialog.getByRole('button', { name: 'Resume' }).click();
    await expect(dialog).toBeHidden();
  });

  test(`play menu offers Resume, sound and File a bug in ${viewport.name}`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the test sets each phone viewport itself');
    test.setTimeout(300_000);
    await page.setViewportSize(viewport);
    await installAuthRoutes(page, { signedIn: true });
    await installGameApi(page);
    await installMenuData(page);
    await openGame(page, 'test');

    const menu = page.getByRole('button', { name: 'Menu' });
    await expect(menu.locator('.studio-menu-badge')).toHaveCount(0);
    await menu.click();
    const dialog = page.getByRole('dialog', { name: 'Paused' });
    for (const name of ['Resume', 'Restart', 'Leave', 'Mute', 'File a bug']) {
      await expect(dialog.getByRole('button', { name, exact: true })).toBeInViewport();
    }
    await expect(dialog.getByRole('slider', { name: 'Volume' })).toBeVisible();
    await expect(dialog).not.toContainText('Work');
    await page.screenshot({ path: testInfo.outputPath(`play-menu-${viewport.name}.png`), timeout: 120_000 });

    await dialog.getByRole('button', { name: 'File a bug' }).click();
    const bug = page.getByRole('dialog', { name: 'File a bug' });
    await expect(bug.getByRole('textbox', { name: 'Describe the issue' })).toBeVisible();
    await expect(bug).toContainText('game.log');
    await bug.getByRole('textbox', { name: 'Describe the issue' }).fill('The goblin froze right after the gate opened');
    await page.screenshot({ path: testInfo.outputPath(`play-bug-${viewport.name}.png`), timeout: 120_000 });
  });
}
