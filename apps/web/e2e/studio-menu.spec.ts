import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test';
import { readFile } from 'node:fs/promises';

import { installAuthRoutes } from './fixtures/auth-routes';
import { installNewRoutes } from './fixtures/new-routes';
import { installGameApi } from './support/mock-game-api';

const gameId = 'g_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e6f';
const runningJob = {
  id: 'j_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e6f',
  gameId,
  branchId: 'main',
  familyId: 'family-1',
  creatorId: 'u1',
  kind: 'feature',
  complexity: 2,
  state: 'running',
  pausedReason: null,
  start: 'now',
  startAt: null,
  slot: 'edit',
  plan: {
    title: 'Add the moon gate',
    summary: 'Add a moon gate.',
    scope: { included: ['gate'], excluded: [] },
    tickets: [],
  },
  reservation: { amountMicroUsd: 1_000_000, sizeClass: 'small', confidence: 'high' },
  hardCapMicroUsd: 1_000_000,
  usageMicroUsd: 420_000,
  aiurRepo: 'its-everdred/open-games',
  aiurIssueNumber: 211,
  aiurSpendCapMicroUsd: null,
  idempotencyKey: null,
  createdAt: '2026-11-03T18:00:00.000Z',
  updatedAt: new Date().toISOString(),
  terminalAt: null,
  stage: 'building',
  stageText: 'Building the moon gate',
  progressPercent: 42,
  openRequestCount: 2,
};

// Blobs is a registered game: its decisions come from its own aiur instance and no build job owns them (#596).
const blobsId = 'g_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e70';
const decision = (n: number, topic: string, question: string, labels: [string, string], blocking = false) => ({
  game_id: blobsId,
  game_title: 'Blobs',
  job_id: null,
  ticket: '570',
  title: topic,
  summary: topic,
  command_id: `d_blobs_${n}`,
  decision_id: `d_blobs_${n}`,
  version: 1,
  question,
  options: labels.map((label, index) => ({ id: `o${index + 1}`, label })),
  blocking,
  opened_at: `2026-11-08T0${n}:00:00.000Z`,
  review_number: n,
});
const blobsDecisions = () => [
  decision(1, 'Blob colours', 'Which colours should the blobs be?', ['Bright', 'Pastel'], true),
  decision(2, 'Jump feel', 'How should a jump feel?', ['Floaty', 'Snappy']),
  decision(3, 'Level length', 'How long should a level be?', ['One minute', 'Three minutes']),
];
const energyView = {
  level: 'limited',
  preference: 'balanced',
  windows: [
    { window: 'day', usedPercent: 40, resetsAt: '2026-11-09T08:00:00.000Z' },
    { window: 'week', usedPercent: 80, resetsAt: '2026-11-09T08:00:00.000Z' },
    { window: 'month', usedPercent: null, resetsAt: '2026-12-01T08:00:00.000Z' },
  ],
  services: [
    { service: 'voice', usedPercent: null },
    { service: 'images', usedPercent: null },
  ],
};

test.use({ serviceWorkers: 'block' });

test('updates the worker tracker without a reload', async ({ page }, testInfo) => {
  testInfo.setTimeout(90_000);
  await installAuthRoutes(page, { signedIn: true });
  await stubBrandArt(page);
  await installGamesMenuApi(page);
  let percent = 40;
  await page.route('**/api/v1/games/*/workers', (route) =>
    route.fulfill({ json: { workers: [{ ticket: '211', title: 'Moon gate', percent, etaSeconds: 10 }] } }),
  );
  await page.goto('/all');
  await expect(page.locator('.worker-tracker-button .menu-circle-ring circle:nth-child(2)')).toHaveCSS(
    'stroke',
    'rgb(184, 187, 38)',
  );
  await page.getByRole('button', { name: '1 build running' }).click();
  await expect(page.getByText('40%', { exact: true })).toBeVisible();
  percent = 80;
  await expect(page.getByText('80%', { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /Show each build/ }).click();
  await expect(page.getByText('Moon gate', { exact: true })).toBeVisible();
  await capturePhone(page, testInfo, 'worker-builds-expanded');
});

test('opens the same volume and report menu on the title', async ({ page }, testInfo) => {
  testInfo.setTimeout(90_000);
  await installAuthRoutes(page);
  await stubBrandArt(page);
  await stubTown(page);
  await page.goto('/');

  await capturePhone(page, testInfo, 'title-menu-closed');
  await page.getByRole('button', { name: 'Menu' }).click();

  await expect(page.getByRole('button', { name: /^(Mute|Unmute)$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Report a problem' })).toBeVisible();
  await expect(page.locator('.bug-fab')).toHaveCount(0);
  await capturePhone(page, testInfo, 'title-menu-open');
});

test('shows the active build ring and contextual build in the games menu', async ({ page }, testInfo) => {
  testInfo.setTimeout(90_000);
  await installAuthRoutes(page, { signedIn: true });
  await stubBrandArt(page);
  await installGamesMenuApi(page, blobsDecisions().slice(1));
  await page.goto('/all');

  const trigger = page.getByRole('button', { name: 'Menu' });
  await expect(trigger).toHaveAttribute('data-building', 'true');
  await expect(page.locator('.studio-menu-control [role="status"]')).toHaveText('Building Moon Vault');
  await expect(page.locator('.studio-menu-badge')).toHaveText('2');
  await capturePhone(page, testInfo, 'games-menu-building');

  await trigger.click();
  await capturePhone(page, testInfo, 'games-menu-open');
  await page.getByRole('button', { name: 'Jobs: 42%' }).click();
  await expect(page.getByRole('group', { name: 'Moon Vault builds' })).toBeVisible();
  const jobBar = page.getByRole('button', { name: /Add the moon gate.*Active.*Building the moon gate.*42%/ });
  await expect(jobBar).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pause Add the moon gate' })).toBeVisible();
  await expect(page.locator('.bug-fab')).toHaveCount(0);
  await capturePhone(page, testInfo, 'games-menu-builds');

  // A job bar opens that ticket's conversation over the screen instead of leaving it (#478).
  await jobBar.click();
  await expect(page).toHaveURL(/\/all/);
  await expect(page.getByRole('dialog', { name: 'Add the moon gate' })).toBeVisible();
  await capturePhone(page, testInfo, 'games-menu-conversation');
});

// Kevin (2026-11-08): sign in, see how many decisions are open on the top-right button, and click through each one.
test('counts the open decisions and walks through each one from the menu', async ({ page }, testInfo) => {
  testInfo.setTimeout(90_000);
  await installAuthRoutes(page, { signedIn: true });
  await stubBrandArt(page);
  const answered = await installGamesMenuApi(page, blobsDecisions());
  await page.goto('/all');

  const trigger = page.getByRole('button', { name: 'Menu' });
  await expect(page.locator('.studio-menu-badge')).toHaveText('3');
  await expect(trigger).toHaveAttribute('data-blocking', 'true');
  await capturePhone(page, testInfo, 'decisions-badge');

  await trigger.click();
  await page.getByRole('button', { name: 'Decisions: 3' }).click();
  const topics = page.getByRole('list', { name: 'Decisions' }).locator('strong');
  await expect(topics).toHaveText(['Blob colours', 'Jump feel', 'Level length']);
  await capturePhone(page, testInfo, 'decisions-menu');

  await page.getByRole('button', { name: 'Blob colours, Blobs' }).click();
  await expect(page.getByRole('dialog', { name: 'Blob colours' })).toBeVisible();
  await capturePhone(page, testInfo, 'decisions-deck-1');
  await page.getByRole('button', { name: 'Pastel' }).click();
  await page.getByRole('button', { name: 'Next decision' }).click();

  await expect(page.getByRole('dialog', { name: 'Jump feel' })).toBeVisible();
  await page.getByRole('button', { name: 'Snappy' }).click();
  await capturePhone(page, testInfo, 'decisions-deck-next');
  await page.getByRole('button', { name: 'Next decision' }).click();

  await expect(page.getByRole('dialog', { name: 'Level length' })).toBeVisible();
  await page.getByRole('button', { name: 'One minute' }).click();
  await expect(page.getByRole('dialog', { name: 'Level length' })).toHaveCount(0);
  await expect(page.locator('.studio-menu-badge')).toHaveCount(0);
  expect(answered).toEqual([
    { decision: 'd_blobs_1', option: 'o2' },
    { decision: 'd_blobs_2', option: 'o2' },
    { decision: 'd_blobs_3', option: 'o1' },
  ]);
  await capturePhone(page, testInfo, 'decisions-done');
});

test('rings Energy in the menu and opens its windows, then its settings', async ({ page }, testInfo) => {
  testInfo.setTimeout(90_000);
  await installAuthRoutes(page, { signedIn: true });
  await stubBrandArt(page);
  await installGamesMenuApi(page);
  await page.goto('/all');

  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: 'Energy: Limited' }).click();
  const detail = page.getByRole('link', { name: 'Energy settings' });
  await expect(detail).toContainText('20% left');
  await capturePhone(page, testInfo, 'games-menu-energy');

  await detail.click();
  await expect(page).toHaveURL(/\/settings\/energy$/);
  await expect(page.getByRole('heading', { name: 'Energy: Limited' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Balanced' })).toBeChecked();
  await capturePhone(page, testInfo, 'settings-energy');
});

// Kevin (2026-11-08): the circles open in one row beside the menu button, at its height, in portrait and landscape.
for (const [orientation, viewport] of [
  ['portrait', { width: 390, height: 844 }],
  ['landscape', { width: 844, height: 390 }],
] as const) {
  test(`lays the circles out in a row beside the menu button in ${orientation}`, async ({
    page,
    isMobile,
  }, testInfo) => {
    testInfo.setTimeout(90_000);
    test.skip(!isMobile, 'phone layout acceptance path');
    await page.setViewportSize(viewport);
    await installAuthRoutes(page, { signedIn: true });
    await stubBrandArt(page);
    await installGamesMenuApi(page, blobsDecisions().slice(1));
    await page.goto('/all');

    const trigger = page.getByRole('button', { name: 'Menu' });
    await expect(trigger).toHaveAttribute('data-building', 'true');
    await capturePhone(page, testInfo, `${orientation}-closed`);

    await trigger.click();
    const circles = page.getByRole('group', { name: 'Menu' }).locator('.menu-circle');
    await expect(circles.first()).toHaveAttribute('aria-label', 'Decisions: 2');
    await expect(circles.nth(1)).toHaveAttribute('aria-label', 'Jobs: 42%');
    await page.waitForTimeout(500);
    const menuBox = (await trigger.boundingBox())!;
    const first = (await circles.first().boundingBox())!;
    expect(Math.abs(first.y - menuBox.y)).toBeLessThan(1);
    expect(first.height).toBeCloseTo(menuBox.height, 0);
    expect(first.x + first.width).toBeLessThan(menuBox.x);
    await capturePhone(page, testInfo, `${orientation}-open`);

    await page.getByRole('button', { name: 'Jobs: 42%' }).click();
    await expect(page.getByRole('group', { name: 'Moon Vault builds' })).toBeVisible();
    await capturePhone(page, testInfo, `${orientation}-building`);
  });
}

for (const mode of ['play', 'edit'] as const) {
  test(`opens game actions in ${mode} context`, async ({ page }) => {
    await installAuthRoutes(page, { signedIn: true });
    await installGameApi(page);
    await page.goto(`/g/game?mode=${mode}`);
    await page.getByRole('button', { name: 'Menu' }).click();
    await expect(page.getByRole('link', { name: 'Versions' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Publish' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Rollback' })).toBeVisible();
  });
}

test('keeps the phone menu row clear of style media', async ({ page, isMobile }, testInfo) => {
  testInfo.setTimeout(90_000);
  test.skip(!isMobile, 'phone layout acceptance path');
  await installAuthRoutes(page, { signedIn: true });
  await installNewRoutes(page);
  await page.route('**/api/v1/me', (route) => json(route, { platformRole: 'none' }));
  await page.goto('/new?test&step=family');
  await page.waitForFunction(() => window.__ogmHost?.get('new') !== undefined);
  await page.getByRole('button', { name: 'Isometric' }).dispatchEvent('click');

  const menu = page.getByRole('button', { name: 'Menu' });
  const media = page.locator('.new-style-track');
  await expect(media).toHaveCount(2);
  const [menuBox, mediaTop] = await Promise.all([
    menu.evaluate((element) => element.getBoundingClientRect().toJSON()),
    media.evaluateAll((elements) => Math.min(...elements.map((element) => element.getBoundingClientRect().top))),
  ]);

  expect(menuBox.bottom).toBeLessThanOrEqual(mediaTop);
  await capturePhone(page, testInfo, 'new-style-menu-row');
});

async function installGamesMenuApi(page: Page, decisions: ReturnType<typeof blobsDecisions> = []) {
  const open = [...decisions];
  const answered: Array<{ decision: string; option: string }> = [];
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/v1/me/commands') return json(route, { commands: open });
    const answer = /^\/api\/v1\/games\/[^/]+\/commands\/([^/]+)\/answer$/.exec(url.pathname);
    if (answer && route.request().method() === 'POST') {
      const { option_id: option } = route.request().postDataJSON() as { option_id: string };
      answered.push({ decision: answer[1]!, option });
      open.splice(
        open.findIndex((candidate) => candidate.decision_id === answer[1]),
        1,
      );
      return json(route, { status: 'answered', decision_id: answer[1], option_id: option });
    }
    if (url.pathname === '/api/v1/notifications/stream') {
      return route.fulfill({ contentType: 'text/event-stream', body: 'retry: 60000\n\n' });
    }
    if (url.pathname === '/api/v1/games') {
      return json(route, {
        games: [
          {
            id: gameId,
            familyId: 'family-1',
            ownerId: 'u1',
            title: 'Moon Vault',
            repo: null,
            createdAt: '2026-11-03T17:00:00.000Z',
          },
        ],
      });
    }
    if (url.pathname === '/api/v1/jobs' && url.searchParams.has('gameId')) return json(route, { jobs: [runningJob] });
    if (url.pathname === '/api/v1/jobs' && url.searchParams.get('state') === 'active') {
      return json(route, { jobs: [runningJob] });
    }
    if (url.pathname.endsWith('/branches')) {
      return json(route, { branches: [{ id: 'main', name: 'main', latestBuildId: 'build-1' }] });
    }
    if (/^\/api\/v1\/games\/[^/]+\/commands$/.test(url.pathname)) return json(route, { commands: [] });
    if (/^\/api\/v1\/games\/[^/]+\/workers$/.test(url.pathname)) return json(route, { workers: [] });
    if (url.pathname.endsWith('/chat/messages')) return json(route, { messages: [], last_seq: 0 });
    if (url.pathname.endsWith('/chat')) return route.fulfill({ contentType: 'text/event-stream', body: ': open\n\n' });
    if (url.pathname.endsWith('/commands/budget')) return json(route, { used: 0, max: 3 });
    if (url.pathname === '/api/v1/me') return json(route, { platformRole: 'none' });
    if (url.pathname === '/api/v1/energy') return json(route, energyView);
    return json(route, { error: 'not_mocked', path: url.pathname }, 404);
  });
  return answered;
}

async function stubTown(page: Page) {
  await page.route('**/town/index.html*', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><body style="margin:0;background:#504945"></body>',
    }),
  );
  await page.route('**/town/models/bake/poster-*', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="390" height="844"><rect width="100%" height="100%" fill="#504945"/></svg>',
    }),
  );
}

async function stubBrandArt(page: Page) {
  const logo = await readFile(new URL('../../site/public/hero/logo.webp', import.meta.url));
  await page.route(/\/art\/logo\.webp$/, (route) => route.fulfill({ contentType: 'image/webp', body: logo }));
}

async function capturePhone(page: Page, testInfo: TestInfo, name: string) {
  if (testInfo.project.name !== 'phone') return;
  await page.waitForTimeout(200);
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}
