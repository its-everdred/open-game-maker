import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { compareGlassScreen } from '../../../packages/gm-cli/src/design-parity/compare';
import { verifyGlassReference } from '../../../packages/gm-cli/src/design-parity/reference';
import { installAuthRoutes } from './fixtures/auth-routes';
import { mockGamesRoutes } from './fixtures/games-routes';
import { installNewRoutes } from './fixtures/new-routes';
import { buildId, installGameApi } from './support/mock-game-api';
import { captureBuildSuffix, captureUrlFile } from './support/shell-capture-files';
import { gameHeaders } from '@ogm/contracts';
import type { DesignDoc } from '@ogm/contracts/browser';

// The command selects these tests explicitly; normal browser tests do not claim design parity.
// eslint-disable-next-line no-restricted-properties
const selected = process.env.OGM_GLASS_PARITY_SCREEN;
// eslint-disable-next-line no-restricted-properties
const gameDist = process.env.OGM_GLASS_GAME_DIST;
// eslint-disable-next-line no-restricted-properties
const bridgePort = process.env.OGM_WEB_BRIDGE_PORT ?? '43176';
if (
  selected &&
  !['all', 'Home', 'Editor', 'Settings', 'SignIn', 'NewGame', 'GameSheet', 'Admin', 'Activity'].includes(selected)
) {
  throw new Error(`Unknown glass parity screen: ${selected}`);
}
const root = resolve(process.cwd(), '../..');
const baseline = resolve(root, 'tests/design-baselines/ogm-glass');
const runId = randomUUID();
test.use({ trace: 'off' });
test.setTimeout(300_000);
const screens = [
  { screen: 'SignIn', name: 'SignIn-780x1688', width: 390, height: 844, scale: 2, route: '/signin?test' },
  { screen: 'NewGame', name: 'NewGame-780x1688', width: 390, height: 844, scale: 2, route: '/new?test&step=genre' },
  { screen: 'GameSheet', name: 'GameSheet-780x1688', width: 390, height: 844, scale: 2, route: '/all?test' },
  { screen: 'Admin', name: 'Admin-780x1688', width: 390, height: 844, scale: 2, route: '/admin/members?test' },
  { screen: 'Activity', name: 'Activity-780x1688', width: 390, height: 844, scale: 2, route: '/all?test' },
  { screen: 'Home', name: 'Home-780x1688', width: 390, height: 844, scale: 2, route: '/all?test' },
  { screen: 'Home', name: 'HomeLandscape-844x390', width: 844, height: 390, scale: 1, route: '/all?test' },
  { screen: 'Home', name: 'HomeDesktop-1440x900', width: 1440, height: 900, scale: 1, route: '/all?test' },
  { screen: 'Editor', name: 'Editor-780x1688', width: 390, height: 844, scale: 2, route: '/g/game?mode=edit&test' },
  {
    screen: 'Editor',
    name: 'EditorLandscape-844x390',
    width: 844,
    height: 390,
    scale: 1,
    route: '/g/game?mode=edit&test',
  },
  {
    screen: 'Editor',
    name: 'EditorDesktop-1440x900',
    width: 1440,
    height: 900,
    scale: 1,
    route: '/g/game?mode=edit&test',
  },
  { screen: 'Settings', name: 'Settings-780x1688', width: 390, height: 844, scale: 2, route: '/settings?test' },
] as const;

for (const target of screens) {
  test(`@glass-parity ${target.name}`, async ({ browser }, testInfo) => {
    test.skip(!selected || (selected !== 'all' && selected !== target.screen), 'Selected by gm design parity');
    test.skip(testInfo.project.name !== 'desktop', 'Each reference specifies its own viewport');
    const context = await browser.newContext({
      viewport: { width: target.width, height: target.height },
      deviceScaleFactor: target.scale,
      isMobile: target.width < 1000,
      hasTouch: target.width < 1000,
      serviceWorkers: 'block',
      reducedMotion: 'reduce',
    });
    try {
      const page = await context.newPage();
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      let actualGameId: string | undefined;
      await page.route('**/api/v1/**', (route) => route.fulfill({ status: 404, json: { error: 'unmocked' } }));
      await installAuthRoutes(page, { signedIn: target.screen !== 'SignIn' });
      if (target.screen === 'Editor') {
        if (!gameDist) throw new Error('Editor parity requires a real game build via --dist');
        const dist = await realpath(gameDist);
        if (dist.split(/[\\/]/).includes('fixtures')) throw new Error('Editor parity cannot use a test fixture game');
        const design = JSON.parse(await readFile(resolve(dist, 'design/design.json'), 'utf8')) as DesignDoc;
        const manifest = JSON.parse(await readFile(resolve(dist, 'manifest.json'), 'utf8')) as {
          id?: string;
          title?: string;
        };
        actualGameId = manifest.id;
        await installGameApi(page, design, manifest.title ?? 'Game');
        await page.route(`http://127.0.0.1:${bridgePort}/**`, async (route) => {
          const path = new URL(route.request().url()).pathname;
          const suffix = captureBuildSuffix(path, buildId);
          if (suffix === null) return route.fallback();
          const file = captureUrlFile(dist, suffix);
          if (!file) throw new Error(`Missing game build file: ${path}`);
          return route.fulfill({
            path: file,
            headers: gameHeaders(new URL(page.url()).origin),
          });
        });
      } else {
        await mockGamesRoutes(page);
        if (target.screen === 'NewGame') await installNewRoutes(page);
        if (target.screen === 'Admin') {
          await page.route('**/api/v1/me', (route) =>
            route.fulfill({
              json: {
                user: { id: 'u1', email: 'kevin@example.test' },
                family: { id: 'f1', name: 'Family', role: 'owner', capability: 'creator' },
                platformRole: 'admin',
              },
            }),
          );
          await page.route('**/api/v1/admin/members', (route) =>
            route.fulfill({
              json: {
                members: [
                  {
                    userId: 'u1',
                    name: 'Kevin',
                    email: 'kevin@example.test',
                    role: 'owner',
                    capability: 'creator',
                    joinedAt: '2026-10-01T00:00:00Z',
                  },
                  {
                    userId: 'u2',
                    name: 'Kim',
                    email: 'kim@example.test',
                    role: 'member',
                    capability: 'creator',
                    joinedAt: '2026-10-01T00:00:00Z',
                  },
                  {
                    userId: 'u3',
                    name: 'Player',
                    email: 'player@example.test',
                    role: 'member',
                    capability: 'player',
                    joinedAt: '2026-10-01T00:00:00Z',
                  },
                ],
              },
            }),
          );
          await page.route('**/api/v1/admin/invites', (route) =>
            route.fulfill({
              json: {
                invitations: [
                  {
                    id: 'invite-1',
                    kind: 'member',
                    email: '[tester one email]',
                    capability: 'player',
                    createdAt: new Date().toISOString(),
                    expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
                    acceptedAt: null,
                    revokedAt: null,
                  },
                  {
                    id: 'invite-2',
                    kind: 'member',
                    email: '[tester two email]',
                    capability: 'creator',
                    createdAt: new Date().toISOString(),
                    expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
                    acceptedAt: null,
                    revokedAt: null,
                  },
                ],
              },
            }),
          );
        }
        await page.route('**/api/v1/jobs?gameId=*', (route) => route.fulfill({ json: { jobs: [] } }));
        await page.route('**/api/v1/me/commands*', (route) => route.fulfill({ json: { commands: [], sessions: [] } }));
        await page.route('**/api/v1/me/core-commands*', (route) =>
          route.fulfill({ json: { commands: [], targets: [] } }),
        );
        await page.route('**/api/v1/notifications?*', (route) => route.fulfill({ json: { notifications: [] } }));
        await page.route('**/api/v1/budget/status', (route) => route.fulfill({ json: { unitLabel: 'coins' } }));
        if (target.screen === 'Home' || target.screen === 'GameSheet' || target.screen === 'Activity') {
          if (target.screen === 'Activity') {
            await page.route('**/api/v1/games/*/review-rounds*', (route) => route.fulfill({ json: { rounds: [] } }));
            await page.route('**/api/v1/games/*/previews', (route) => route.fulfill({ json: { previews: [] } }));
            await page.route('**/api/v1/games/*/commands', (route) => route.fulfill({ json: { commands: [] } }));
            await page.route('**/api/v1/games/*/tickets/completed', (route) =>
              route.fulfill({
                json: {
                  tickets: new URL(route.request().url()).pathname.includes('/dusk/')
                    ? [
                        {
                          ticket: '8',
                          title: 'Roadside camp',
                          outcome: 'done',
                          closedAt: new Date().toISOString(),
                          url: 'https://example.test/tickets/8',
                        },
                        {
                          ticket: '9',
                          title: '[second completed ticket]',
                          outcome: 'done',
                          closedAt: new Date().toISOString(),
                          url: 'https://example.test/tickets/9',
                        },
                      ]
                    : [],
                },
              }),
            );
            await page.route('**/api/v1/games/*/workers', (route) =>
              route.fulfill({
                json: {
                  workers: new URL(route.request().url()).pathname.includes('/dusk/')
                    ? [
                        {
                          ticket: '1',
                          title: 'Dusk and torch',
                          percent: 80,
                          etaSeconds: null,
                          state: 'human-review',
                          last: 'Warmer torch or cooler dusk?',
                        },
                        {
                          ticket: '2',
                          title: 'Forest road',
                          percent: 55,
                          etaSeconds: null,
                          state: 'in-progress',
                          last: 'Placing tree clusters',
                        },
                        {
                          ticket: '3',
                          title: 'Warmer torches',
                          percent: 30,
                          etaSeconds: null,
                          state: 'in-progress',
                          last: 'Your chat · rendering two looks',
                        },
                      ]
                    : [],
                },
              }),
            );
          }
          await page.route('**/api/v1/jobs?state=active', (route) =>
            route.fulfill({
              json: {
                jobs:
                  target.screen !== 'Home'
                    ? []
                    : [
                        {
                          id: 'job-1',
                          gameId: 'blobs',
                          kind: 'edit',
                          state: 'running',
                          title: 'Forest road',
                          progressPercent: 55,
                        },
                        {
                          id: 'job-2',
                          gameId: 'blobs',
                          kind: 'edit',
                          state: 'running',
                          title: 'Forest road',
                          progressPercent: 55,
                        },
                        {
                          id: 'job-3',
                          gameId: 'blobs',
                          kind: 'edit',
                          state: 'running',
                          title: 'Forest road',
                          progressPercent: 55,
                        },
                      ],
              },
            }),
          );
          for (const name of ['blobs', 'dusk'] as const) {
            await page.route(`https://example.test/glass/${name}.png`, (route) =>
              route.fulfill({ path: resolve(process.cwd(), `e2e/fixtures/glass/${name}-thumbnail.png`) }),
            );
          }
          await page.route('https://example.test/glass/goblin.webp', (route) =>
            route.fulfill({ path: resolve(process.cwd(), 'public/proto/art/goblin-play.webp') }),
          );
          await page.route('**/api/v1/games', (route) =>
            route.fulfill({
              json: {
                games: [
                  {
                    id: 'blobs',
                    coverUrl: 'https://example.test/glass/blobs.png',
                    title: 'Blobs VS Blocks',
                    tags: ['Puzzle', 'Versus', 'Bots', 'Online'],
                    stats: { version: '14' },
                    ownerId: 'u1',
                    familyId: 'f1',
                    visibility: 'listed',
                    createdAt: '2026-11-01T00:00:00Z',
                  },
                  {
                    id: 'dusk',
                    coverUrl: 'https://example.test/glass/dusk.png',
                    title: 'Dusk Helm',
                    ownerId: 'u1',
                    familyId: 'f1',
                    visibility: 'listed',
                    createdAt: '2026-10-01T00:00:00Z',
                  },
                  {
                    id: 'goblin',
                    coverUrl: 'https://example.test/glass/goblin.webp',
                    title: 'Goblin Cellar',
                    ownerId: 'u1',
                    familyId: 'f1',
                    visibility: 'private',
                    createdAt: '2026-09-01T00:00:00Z',
                  },
                ],
              },
            }),
          );
        }
      }
      await page.goto(target.route, { waitUntil: 'domcontentloaded' });
      const selector =
        target.screen === 'Activity'
          ? '.worker-tracker-button'
          : target.screen === 'Admin'
            ? '.admin-table'
            : target.screen === 'GameSheet'
              ? '[data-game-id="blobs"] .game-tile'
              : target.screen === 'NewGame'
                ? '.new-game-head'
                : target.screen === 'SignIn'
                  ? '.signin-screen'
                  : target.screen === 'Editor'
                    ? '.edit-workspace'
                    : target.screen === 'Home'
                      ? '[data-game-id]'
                      : '.settings-screen';
      await expect(page.locator(selector).first()).toBeVisible({ timeout: 30_000 });
      if (target.screen === 'Activity') {
        await page.locator(selector).first().click();
        await expect(page.locator('.worker-tracker-panel')).toBeVisible();
        await expect(page.locator('.worker-tracker-panel').getByText('Forest road')).toBeVisible();
        await expect(page.locator('.worker-tracker-panel')).not.toContainText('Could not load all reviews');
      }
      if (target.screen === 'GameSheet') {
        await page.locator(selector).first().click();
        await expect(page.locator('.games-spotlight')).toBeVisible();
      }
      if (target.screen === 'NewGame') {
        for (const name of ['Adventure', 'RPG']) {
          const option = page.getByRole('button', { name });
          await option.click();
          await expect(option).toHaveAttribute('aria-pressed', 'true');
        }
      }
      if (target.screen === 'Editor') {
        await expect(page.locator('.game-frame iframe')).toBeVisible();
        await page.waitForFunction(
          () => {
            const host = (window as unknown as { __ogmHost?: { game?: { bridgeState?: string } } }).__ogmHost;
            return host?.game?.bridgeState === 'ready';
          },
          null,
          { timeout: 30_000 },
        );
        if (actualGameId === 'blobs') {
          const game = page.frameLocator('.game-frame iframe');
          await expect(game.locator('html')).toHaveAttribute('data-boot-stage', 'ready', {
            timeout: 180_000,
          });
          for (const [screen, text, next] of [
            ['title', 'Play', 'menu'],
            ['menu', 'Endless', 'pieces'],
            ['pieces', 'Blobs', 'select'],
            ['select', 'Play', 'solo'],
          ] as const) {
            const flow = game.locator('#blobs-flow');
            await expect(flow).toHaveAttribute('data-screen', screen, { timeout: 30_000 });
            const button =
              screen === 'select' ? flow.locator('.blobs-menu__play') : flow.getByText(text, { exact: true }).first();
            await expect(button).toBeVisible({ timeout: 30_000 });
            // Activate the game's own control while the editor owns pointer input.
            await button.evaluate((element: HTMLElement) => element.click());
            expect(pageErrors, 'Game errors during capture setup').toEqual([]);
            await expect(flow).toHaveAttribute('data-screen', next, { timeout: 30_000 });
          }
        }
      }
      await page.evaluate(async () => {
        const ready = Promise.all([
          document.fonts.ready,
          ...Array.from(document.images)
            .filter((image) => image.currentSrc && image.getClientRects().length > 0)
            .map((image) => image.decode()),
        ]);
        let timer: ReturnType<typeof setTimeout>;
        try {
          await Promise.race([
            ready,
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error('Visible images or fonts did not finish loading')), 30_000);
            }),
          ]);
        } finally {
          clearTimeout(timer!);
        }
      });
      console.log(`Capturing ${target.name}`);
      const actual = await page.screenshot({ timeout: 120_000 });
      const reference = await readFile(resolve(baseline, `${target.name}.png`));
      const manifest: unknown = JSON.parse(await readFile(resolve(baseline, 'manifest.json'), 'utf8'));
      verifyGlassReference(reference, manifest, `${target.name}.png`);
      const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
      const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim() !== '';
      const out = resolve(root, 'assets-local/review/design-parity', dirty ? `${sha}-dirty` : sha, runId, target.name);
      console.log(`Comparing ${target.name}`);
      const result = await compareGlassScreen(reference, actual, out, resolve(baseline, 'masks.json'), target.name);
      for (const [name, contentType] of [
        ['side-by-side.png', 'image/png'],
        ['heatmap.png', 'image/png'],
        ['score.json', 'application/json'],
        ['checklist.md', 'text/markdown'],
      ] as const) {
        await testInfo.attach(name, { path: resolve(out, name), contentType });
      }
      console.log(`Glass parity evidence: ${out}`);
      expect(result.pass, `${target.name}: SSIM ${result.ssim}, ΔE > 3 ${result.deltaEOver3Percent}%`).toBe(true);
    } finally {
      await context.close().catch(() => undefined);
    }
  });
}
