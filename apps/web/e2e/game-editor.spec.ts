import { expect, test, type Page } from '@playwright/test';

import { installAuthRoutes } from './fixtures/auth-routes';
import { installGameApi, type GameApiFixture } from './support/mock-game-api';

type GameHook = {
  bridgeState: string;
  headRev: number;
  saved: string;
  mode: string;
  selection: string[];
  dropped: number;
  readOnly: boolean;
};

type FixtureHook = { mode: string; messages: Array<{ t: string; payload: unknown }> };

// eslint-disable-next-line no-restricted-properties
const bridgePort = process.env.OGM_WEB_BRIDGE_PORT ?? '10001';
const bridgeOrigin = `http://127.0.0.1:${bridgePort}`;

test.use({ serviceWorkers: 'block' });

test('runs the cross-origin editor transaction, undo, and mode flow', async ({ page }, testInfo) => {
  test.slow(); // one test walks load, transaction, undo and play; navigation alone took 13 s on a loaded host
  await installAuthRoutes(page, { signedIn: true });
  const api = await installGameApi(page);
  await openReadyEditor(page, api);
  const before = (await gameState(page))!;
  await page.evaluate(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://third-origin.invalid',
        data: JSON.stringify({ v: 1, id: 'hostile', t: 'editor.picked', payload: { targets: [] } }),
      }),
    );
  });
  await expect.poll(() => gameState(page).then((state) => state?.dropped)).toBe(before.dropped + 1);
  expect(await gameState(page)).toMatchObject({ headRev: before.headRev, selection: before.selection });

  await selectSkeleton(page);
  await page.getByLabel('Editor canvas').click({ force: true, position: { x: 180, y: 120 } });
  await expect.poll(() => api.transactions.length).toBe(1);
  expect(api.transactions[0]?.baseRev).toBe(4);
  await expect.poll(() => gameState(page).then((state) => state?.saved)).toBe('saved');

  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect.poll(() => api.transactions.length).toBe(2);
  expect(api.transactions[1]?.label).toContain('Undo');

  if (testInfo.project.name === 'phone') {
    for (const name of ['Play', 'Menu']) {
      const box = await page.getByRole('button', { name, exact: true }).boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
    await expect(page.getByLabel('Editor canvas')).toBeAttached();
    await expect(page.locator('[data-focus-zone="editor-inspector"]')).toBeAttached();
  }

  await page.getByRole('button', { name: /Play/ }).click({ force: true });
  await expect
    .poll(() => playFrameState(page), { timeout: 10_000 })
    .toEqual({
      attached: true,
      bridgeState: 'ready',
      mode: 'play',
    });
});

test('replays one conflict and becomes read-only on lease loss', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'desktop covers protocol recovery; phone covers responsive acceptance');
  await installAuthRoutes(page, { signedIn: true });
  const api = await installGameApi(page);
  api.script('conflict', 'success');
  await openReadyEditor(page, api);

  await selectSkeleton(page);
  const canvas = page.getByLabel('Editor canvas');
  await canvas.click({ force: true, position: { x: 160, y: 100 } });
  await expect.poll(() => api.attempts.length).toBe(2);
  expect(api.attempts.map(({ baseRev }) => baseRev)).toEqual([4, 9]);

  api.script('lease-lost');
  await canvas.click({ force: true, position: { x: 220, y: 140 } });
  await expect.poll(() => api.attempts.length).toBe(3);
  await expect.poll(() => gameState(page).then((state) => state?.readOnly)).toBe(true);
});

async function openReadyEditor(page: Page, api: GameApiFixture): Promise<void> {
  await page.goto('/g/game?mode=edit&test');
  await Promise.all([api.transactionStreamReady, page.getByLabel('Editor canvas').waitFor()]);
}

async function selectSkeleton(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Skeleton' }).click({ force: true });
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(page.getByRole('button', { name: 'place', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Place a skeleton', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
}

function gameState(page: Page): Promise<GameHook | undefined> {
  return page.evaluate(() => (window as Window & { __ogmHost?: { game?: GameHook } }).__ogmHost?.game);
}

async function playFrameState(page: Page): Promise<{ attached: boolean; bridgeState?: string; mode?: string }> {
  const frame = page.frames().find((candidate) => candidate.url().startsWith(`${bridgeOrigin}/g/`));
  if (!frame || frame.isDetached()) return { attached: false };

  try {
    const [game, fixture] = await Promise.all([
      gameState(page),
      frame.evaluate(() => (window as Window & { __fixture: FixtureHook }).__fixture),
    ]);
    if (frame.isDetached()) return { attached: false };
    return { attached: true, bridgeState: game?.bridgeState, mode: fixture.mode };
  } catch {
    return { attached: false };
  }
}
