import { readFileSync, writeFileSync } from 'node:fs';

import { expect, test, type Locator, type Page } from '@playwright/test';

import { installAuthRoutes } from './fixtures/auth-routes';
import { mockGamesRoutes } from './fixtures/games-routes';
import { installNewRoutes } from './fixtures/new-routes';
import { installGameApi } from './support/mock-game-api';
import { prototypePaletteNormalizationCss } from './support/prototype-palette';
import { attachComparison, prototypeThresholds } from './support/visual-compare';

// eslint-disable-next-line no-restricted-properties
const referenceOrigin = `http://127.0.0.1:${process.env.OGM_PROTOTYPE_E2E_PORT ?? '43176'}`;
const townStub = readFileSync(new URL('./fixtures/town-stub/index.html', import.meta.url), 'utf8');
const neutralImage = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="788"><rect width="1400" height="788" fill="#6b6570"/></svg>',
);
const neutralPoster = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800"><rect width="1280" height="800" fill="#6b6570"/></svg>',
);
const prototypeGames = [
  {
    id: 'goblin-cellar',
    title: 'Goblin Cellar',
    ownerId: 'u_1',
    familyId: 'f_1',
    repo: null,
    coverUrl: null,
    publishedReleaseId: 'r_1',
    tagline: 'Build a dungeon, fill it with goblins, then fight your way out.',
    choices: { genre: ['rpg', 'battle'], vibe: ['cozy', 'epic'] },
    createdAt: '2026-10-20T00:00:00Z',
    updatedAt: '2026-11-01T03:00:00Z',
  },
  {
    id: 'restorebound',
    title: 'RestoreBound',
    ownerId: 'u_1',
    familyId: 'f_1',
    repo: null,
    coverUrl: null,
    publishedReleaseId: 'r_2',
    tagline: 'A sleepy village, one repair at a time.',
    choices: { genre: ['adventure', 'craft'], vibe: ['cozy', 'calm'] },
    createdAt: '2026-10-20T00:00:00Z',
    updatedAt: '2026-11-01T02:00:00Z',
  },
  {
    id: 'mossy-leap',
    title: 'Mossy Leap',
    ownerId: 'u_1',
    familyId: 'f_1',
    repo: null,
    coverUrl: null,
    publishedReleaseId: 'r_3',
    tagline: 'Hop, bop and collect every coin in the Greenwood.',
    choices: { genre: ['platformer'], vibe: ['cute', 'retro'] },
    createdAt: '2026-10-20T00:00:00Z',
    updatedAt: '2026-11-01T01:00:00Z',
  },
];

const viewports = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;
const scenarios = [
  { name: 'title', threshold: prototypeThresholds.title, prepare: prepareTitle },
  { name: 'games', threshold: prototypeThresholds.games, prepare: prepareGames },
  { name: 'creation-option', threshold: prototypeThresholds['creation-option'], prepare: prepareCreationOption },
  { name: 'creation-talk', threshold: prototypeThresholds['creation-talk'], prepare: prepareCreationTalk },
  { name: 'editor', threshold: prototypeThresholds.editor, prepare: prepareEditor },
] as const;

test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });
test.describe.configure({ mode: 'serial' });

for (const scenario of scenarios) {
  for (const viewport of viewports) {
    test(`${scenario.name} matches the prototype shell at ${viewport.width}x${viewport.height}`, async ({
      browser,
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop', 'the test sets both exact acceptance viewports itself');
      test.setTimeout(60_000);
      const referenceContext = await browser.newContext({
        viewport,
        reducedMotion: 'reduce',
        serviceWorkers: 'block',
      });
      const reference = await referenceContext.newPage();
      const appErrors: string[] = [];
      const failedResponses: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) {
          appErrors.push(message.text());
        }
      });
      page.on('pageerror', (error) => appErrors.push(error.message));
      page.on('response', (response) => {
        const expectedVoiceFallback = response.url().endsWith('/api/v1/voice/token') && response.status() === 503;
        const pathname = new URL(response.url()).pathname;
        const expectedMissingGameResource =
          response.status() === 404 && ['/api/v1/games/game/published', '/api/v1/games/game/saves'].includes(pathname);
        if (response.status() >= 400 && !expectedVoiceFallback && !expectedMissingGameResource) {
          failedResponses.push(`${response.status()} ${response.url()}`);
        }
      });

      try {
        await page.setViewportSize(viewport);
        await page.route('**/api/v1/me/commands', (route) => route.fulfill({ json: { commands: [] } }));
        const masks = await test.step('prepare app and prototype', () => scenario.prepare(page, reference));
        if (scenario.name === 'editor') {
          const appShell = await capture(page, []);
          writeFileSync(testInfo.outputPath(`editor-${viewport.name}-app-shell.png`), appShell);
          await testInfo.attach(`editor-${viewport.name}-app-shell`, {
            body: appShell,
            contentType: 'image/png',
          });
        }
        await test.step('normalize pages', () => Promise.all([normalize(page), normalize(reference)]));
        // Capture through CDP after normalization. Playwright's screenshot helper waits
        // on every web font, including the intentionally unavailable prototype fonts.
        const referenceShot = await test.step('capture prototype', () => capture(reference, masks.reference));
        const appShot = await test.step('capture app', () => capture(page, masks.app));
        const artifactName = `${scenario.name}-${viewport.name}`;
        const score = await attachComparison(testInfo, artifactName, referenceShot, appShot);
        testInfo.annotations.push({
          type: 'visual-score',
          description: `${score.toFixed(4)} <= ${scenario.threshold}`,
        });
        expect(score, `${artifactName} normalized shell distance`).toBeLessThanOrEqual(scenario.threshold);
        expect(appErrors, `${artifactName} app console errors`).toEqual([]);
        expect(failedResponses, `${artifactName} failed responses`).toEqual([]);
      } finally {
        await referenceContext.close();
      }
    });
  }
}
type Masks = { app: ReturnType<Page['locator']>[]; reference: ReturnType<Page['locator']>[] };

async function capture(page: Page, masks: Locator[]): Promise<Buffer> {
  const elements = (await Promise.all(masks.map((mask) => mask.all()))).flat();
  const boxes = (await Promise.all(elements.map((element) => element.boundingBox()))).filter((box) => box !== null);
  await page.evaluate((rectangles) => {
    for (const rectangle of rectangles) {
      const mask = document.createElement('div');
      mask.dataset.visualMask = '';
      Object.assign(mask.style, {
        position: 'fixed',
        left: `${rectangle.x}px`,
        top: `${rectangle.y}px`,
        width: `${rectangle.width}px`,
        height: `${rectangle.height}px`,
        background: '#6b6570',
        zIndex: '2147483647',
        pointerEvents: 'none',
      });
      document.body.append(mask);
    }
  }, boxes);
  const session = await page.context().newCDPSession(page);
  try {
    const { data } = await session.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    });
    return Buffer.from(data, 'base64');
  } finally {
    await session.detach().catch(() => undefined);
    if (!page.isClosed()) {
      await page.locator('[data-visual-mask]').evaluateAll((elements) => {
        for (const element of elements) element.remove();
      });
    }
  }
}

async function prepareTitle(app: Page, reference: Page): Promise<Masks> {
  await Promise.all([
    neutralizeAppAssets(app),
    neutralizeReferenceAssets(reference),
    installAuthRoutes(app, { signedIn: true }),
  ]);
  await app.route('**/town/index.html*', (route) => route.fulfill({ contentType: 'text/html', body: townStub }));
  await app.route('**/api/v1/games', (route) => route.fulfill({ json: { games: [] } }));
  await Promise.all([
    app.goto('/?test', { waitUntil: 'domcontentloaded' }),
    reference.goto(`${referenceOrigin}/studio/index.html#library`, { waitUntil: 'domcontentloaded' }),
  ]);
  await expect(reference.locator('#lib-grid .tile').first()).toBeVisible();
  await showStudioScreen(reference, 's-title');
  await app.locator('.title-town').evaluate((town) => {
    town.replaceChildren();
    (town as HTMLElement).style.background = '#6b6570';
  });
  await Promise.all([
    expect(app.getByRole('button', { name: 'Start', exact: true })).toBeVisible(),
    expect(reference.locator('#t-start')).toBeVisible(),
  ]);
  await reference.locator('#s-title .t-scene').evaluate((scene) => {
    scene.replaceChildren();
    (scene as HTMLElement).style.background = '#6b6570';
  });
  return { app: [], reference: [] };
}

async function prepareGames(app: Page, reference: Page): Promise<Masks> {
  await Promise.all([neutralizeAppAssets(app), neutralizeReferenceAssets(reference)]);
  await installAuthRoutes(app, { signedIn: true });
  await mockGamesRoutes(app);
  await app.route('**/api/v1/games', (route) => route.fulfill({ json: { games: prototypeGames } }));
  await app.route('**/api/v1/games/goblin-cellar/branches', (route) =>
    route.fulfill({
      json: {
        branches: [
          {
            id: 'main',
            gameId: 'goblin-cellar',
            name: 'main',
            gitRef: 'main',
            forkPoint: null,
            headRev: 40,
            latestBuildId: 'b_13',
            status: 'active',
            createdBy: 'u_1',
            createdAt: '2026-10-20T00:00:00Z',
          },
        ],
      },
    }),
  );
  await app.route('**/api/v1/jobs?gameId=*', (route) => route.fulfill({ json: { jobs: [] } }));
  await app.route('**/api/v1/budget/status', (route) => route.fulfill({ json: { unitLabel: 'coins' } }));
  await Promise.all([
    app.goto('/all?test&spotlight=goblin-cellar', { waitUntil: 'domcontentloaded' }),
    reference.goto(`${referenceOrigin}/studio/index.html#library`, { waitUntil: 'domcontentloaded' }),
  ]);
  const prototypeGame = reference.locator('#lib-grid .tile', { hasText: 'Goblin Cellar' });
  await expect(prototypeGame).toBeVisible();
  await prototypeGame.click();
  await reference.locator('#lib-grid .tile').evaluateAll((tiles) => {
    for (const tile of tiles.slice(3)) (tile as HTMLElement).hidden = true;
  });
  await Promise.all([
    expect(app.getByRole('heading', { name: 'Goblin Cellar' })).toBeVisible(),
    expect(reference.locator('.lh-title')).toHaveText('Goblin Cellar'),
  ]);
  return {
    app: [app.locator('.games-spotlight-media'), app.locator('.game-cover-image, .game-cover-placeholder')],
    reference: [reference.locator('#lh-shot'), reference.locator('.tile canvas')],
  };
}

async function prepareCreationOption(app: Page, reference: Page): Promise<Masks> {
  await Promise.all([neutralizeAppAssets(app), neutralizeReferenceAssets(reference)]);
  await installAuthRoutes(app, { signedIn: true });
  await installNewRoutes(app);
  await Promise.all([
    app.goto('/new?test&step=genre', { waitUntil: 'domcontentloaded' }),
    reference.goto(`${referenceOrigin}/studio/index.html#new`, { waitUntil: 'domcontentloaded' }),
  ]);
  const appChoice = app.getByRole('button', { name: 'Adventure' });
  const referenceChoice = reference.getByRole('button', { name: 'Adventure' });
  await appChoice.click();
  await referenceChoice.evaluate((button) => button.setAttribute('aria-pressed', 'true'));
  await Promise.all([
    expect(appChoice).toHaveAttribute('aria-pressed', 'true'),
    expect(referenceChoice).toHaveAttribute('aria-pressed', 'true'),
  ]);
  return { app: [], reference: [] };
}

async function prepareCreationTalk(app: Page, reference: Page): Promise<Masks> {
  await Promise.all([neutralizeAppAssets(app), neutralizeReferenceAssets(reference)]);
  await installAuthRoutes(app, { signedIn: true });
  await installNewRoutes(app);
  await Promise.all([
    app.goto('/new?test&step=talk', { waitUntil: 'domcontentloaded' }),
    reference.goto(`${referenceOrigin}/studio/index.html#new`, { waitUntil: 'domcontentloaded' }),
  ]);
  for (let step = 0; step < 5; step += 1) await reference.locator('#wz-next').click();
  await Promise.all([
    expect(app.getByRole('heading', { name: 'Talk it through' })).toBeVisible(),
    expect(reference.locator('#wz-title')).toHaveText('Talk it through'),
    expect(app.locator('.talk-host .vs')).toBeVisible(),
    expect(reference.locator('.talk-host .vs')).toBeVisible(),
  ]);
  return {
    app: [app.locator('.scope-seis, .scope-orb')],
    reference: [reference.locator('.seis, .orb')],
  };
}

async function prepareEditor(app: Page, reference: Page): Promise<Masks> {
  await Promise.all([neutralizeAppAssets(app), neutralizeReferenceAssets(reference)]);
  await installAuthRoutes(app, { signedIn: true });
  await installGameApi(app);
  await app.route('**/api/v1/me/commands', (route) => route.fulfill({ json: { commands: [] } }));
  await app.route('**/api/v1/me', (route) => route.fulfill({ json: { platformRole: 'none' } }));
  await app.route('**/api/v1/energy', (route) =>
    route.fulfill({
      json: {
        level: 'limited',
        preference: 'balanced',
        windows: [],
        services: [],
      },
    }),
  );
  await app.route('**/api/v1/games/game/branches', (route) => route.fulfill({ json: { branches: [] } }));
  await app.route('**/api/v1/games', (route) => route.fulfill({ json: { games: [] } }));
  await app.route('**/api/v1/budget/status', (route) => route.fulfill({ json: { unitLabel: 'coins' } }));
  await Promise.all([
    app.goto('/g/game?mode=edit&test', { waitUntil: 'domcontentloaded' }),
    reference.goto(`${referenceOrigin}/ui/index.html`, { waitUntil: 'domcontentloaded' }),
  ]);
  await reference.evaluate(() => {
    const home = document.querySelector<HTMLElement>('#home');
    const editor = document.querySelector<HTMLElement>('#editor');
    const loading = document.querySelector<HTMLElement>('#loading');
    const title = document.querySelector<HTMLInputElement>('#title');
    if (home) home.hidden = true;
    if (editor) {
      editor.hidden = false;
      editor.classList.remove('pre');
    }
    if (loading) loading.hidden = true;
    if (title) title.value = 'Goblin Cellar';
    const rail = document.querySelector<HTMLElement>('#rail');
    const trayTitle = document.querySelector<HTMLElement>('#trayTitle');
    const firstCategory = rail?.querySelector<HTMLButtonElement>('button');
    if (rail && firstCategory) {
      rail.replaceChildren(firstCategory);
      firstCategory.classList.add('on');
      const label = firstCategory.querySelector<HTMLElement>('span:last-child');
      if (label) label.textContent = 'Actors';
    }
    if (trayTitle) trayTitle.textContent = 'Actors';
  });
  // The requested editor revision removes the prototype's header and uses a compact side column in landscape.
  if (reference.viewportSize()!.width > reference.viewportSize()!.height) {
    await reference.addStyleTag({
      content: `
      #editor { grid-template-columns: minmax(0, 1fr) minmax(220px, 25%); grid-template-rows: auto 180px minmax(0, 1fr);
        grid-template-areas: 'stage rail' 'stage tray' 'stage .'; }
      #editor::before { background: #fdf1d8; }
      #editor .topbar, #editor #inspector, #tray h2 { display: none; }
      #rail { flex-direction: row; padding-top: 60px; }
      #rail button { flex: 0 0 72px; min-height: 0; font-size: 14px; }
      #rail .thumb { width: 36px; height: 36px; }
    `,
    });
  }
  await Promise.all([
    expect(app.locator('.editor-chrome')).toBeAttached(),
    expect(app.locator('.editor-rail')).toBeVisible(),
    expect(app.locator('.editor-rail button').first()).toBeVisible(),
    expect(reference.locator('#editor')).toBeVisible(),
  ]);
  if (app.viewportSize()!.width < app.viewportSize()!.height) {
    const [stage, rail] = await Promise.all([
      app.locator('.game-stage').boundingBox(),
      app.locator('.editor-rail').boundingBox(),
    ]);
    const previewFraction = stage!.height / app.viewportSize()!.height;
    expect(previewFraction).toBeGreaterThanOrEqual(0.65);
    expect(previewFraction).toBeLessThanOrEqual(0.7);
    expect(rail!.y).toBeGreaterThanOrEqual(stage!.y + stage!.height);
  } else {
    const [stage, rail] = await Promise.all([
      app.locator('.game-stage').boundingBox(),
      app.locator('.editor-rail').boundingBox(),
    ]);
    expect(rail!.x).toBeGreaterThanOrEqual(stage!.x + stage!.width);
    expect(rail!.height / app.viewportSize()!.height).toBeLessThan(0.3);
    const palette = await app.locator('.editor-palette').boundingBox();
    expect(palette!.height).toBeLessThanOrEqual(180);
  }
  await app.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(app.locator('#studio-editor-tools .editor-inspector')).toBeVisible();
  await app.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(app.locator('.editor-rail button').first()).toBeEnabled();
  await app.locator('.editor-rail button').first().click();
  return { app: [app.locator('.game-stage')], reference: [reference.locator('#stage')] };
}

async function neutralizeAppAssets(page: Page): Promise<void> {
  await neutralizeFonts(page);
  await page.route(/\/art\/.*\.(?:png|jpe?g|webp|gif)$/i, (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: neutralImage }),
  );
  await page.route('**/town/models/bake/poster-*', (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: neutralPoster }),
  );
}

async function neutralizeReferenceAssets(page: Page): Promise<void> {
  await neutralizeFonts(page);
  await page.addInitScript(() => {
    const schedule = window.requestAnimationFrame.bind(window);
    const pending = new Set<FrameRequestCallback>();
    window.requestAnimationFrame = (callback: FrameRequestCallback) => {
      if (pending.has(callback)) return 0;
      pending.add(callback);
      return schedule((time) => {
        pending.delete(callback);
        callback(time);
      });
    };
  });
  await page.route(
    (url) => url.origin === referenceOrigin && /^\/ui\/.*\.js$/i.test(url.pathname),
    (route) => route.abort(),
  );
  await page.route(
    (url) => url.origin === referenceOrigin && /^\/(?:studio|ui)\/.*\.(?:png|jpe?g|webp|gif)$/i.test(url.pathname),
    (route) => route.fulfill({ contentType: 'image/svg+xml', body: neutralImage }),
  );
}

async function normalize(page: Page): Promise<void> {
  await page.locator('link[href*="fonts.googleapis.com"], link[href*="fonts.gstatic.com"]').evaluateAll((links) => {
    for (const link of links) link.remove();
  });
  await page.addStyleTag({
    content: `
      ${prototypePaletteNormalizationCss}
      *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
      html, body, button, input, textarea { font-family: Arial, sans-serif !important; }
      #bg canvas, .studio-backdrop canvas { visibility: hidden !important; }
      #bg, .studio-backdrop { background: #0f0e16 !important; }
    `,
  });
}

async function neutralizeFonts(page: Page): Promise<void> {
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ contentType: 'text/css; charset=utf-8', body: '' }),
  );
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort());
}

async function showStudioScreen(page: Page, id: 's-title' | 's-library' | 's-wizard'): Promise<void> {
  await page.evaluate((screenId) => {
    for (const screen of document.querySelectorAll<HTMLElement>('.screen')) screen.hidden = screen.id !== screenId;
    document.body.classList.toggle('on-title', screenId === 's-title');
    document.body.classList.remove('on-play', 'builds-on');
    document.querySelector<HTMLElement>('#tracker')?.classList.add('hidden');
  }, id);
}
