import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { installAuthRoutes } from './fixtures/auth-routes';
import { buildId, installGameApi } from './support/mock-game-api';
import { captureUrlFile } from './support/shell-capture-files';
import { bridgeOrigin, bridgeState, gameFrame, setHidden } from './support/visibility';

/* Blobs, the real game, lives in the open-games repo: point OGM_BLOBS_DIST at a draft build of it
   (`vite build --mode draft`) to run the switch-apps checks against it. */
// eslint-disable-next-line no-restricted-properties
const dist = process.env.OGM_BLOBS_DIST;

type GameText = { tick: number; state: unknown };

test.use({ serviceWorkers: 'block' });
test.describe.configure({ timeout: 240_000 });

test('Blobs stays paused through a switch away and an evicted reload', async ({ page }, testInfo) => {
  test.skip(!dist, 'OGM_BLOBS_DIST is not set');
  test.skip(testInfo.project.name !== 'desktop', 'one size covers the shell lifecycle');
  const design = JSON.parse(readFileSync(resolve(dist!, 'design/design.json'), 'utf8')) as unknown;
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(`${error.message}\n${error.stack ?? ''}`));
  await installAuthRoutes(page, { signedIn: true });
  await installGameApi(page);
  await page.route('**/api/v1/games/game/branches/main/design', (route) =>
    route.fulfill({ json: { rev: 4, buildId, doc: design } }),
  );
  await page.route(`${bridgeOrigin}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    const suffix = path.includes(`/${buildId}/`) ? path.split(`/${buildId}/`)[1]! : path.slice(1);
    const file = captureUrlFile(dist!, suffix || 'index.html');
    if (file) await route.fulfill({ path: file });
    else await route.abort();
  });

  await page.goto('/g/game?test');
  await expect.poll(() => bridgeState(page), { timeout: 60_000 }).toBe('ready');
  const game = page.frameLocator('.game-frame iframe');
  for (const text of ['Play', 'Endless', 'Blobs', 'Play']) {
    await game.getByText(text, { exact: true }).first().click({ timeout: 30_000, force: true });
    await page.waitForTimeout(1_200);
    expect(pageErrors).toEqual([]);
  }
  const playing = await gameText(page);
  await expect.poll(async () => (await gameText(page))?.tick ?? 0, { timeout: 30_000 }).toBeGreaterThan(playing!.tick);
  await page.screenshot({ path: testInfo.outputPath('blobs-playing.png') });

  await setHidden(page, true);
  const paused = page.getByRole('dialog', { name: 'Paused' });
  await expect(paused).toBeVisible();
  const left = await settledText(page);
  await setHidden(page, false);
  await page.waitForTimeout(2_000);
  await expect(paused).toBeVisible();
  expect(await gameText(page)).toEqual(left);
  await page.screenshot({ path: testInfo.outputPath('blobs-returned.png') });

  await setHidden(page, true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(() => bridgeState(page), { timeout: 60_000 }).toBe('ready');
  await expect(paused).toBeVisible();
  // Blobs comes back paused and frozen. Its own save does not yet carry the screen it was on, so it returns to its
  // title rather than the run (open-games#683); the run itself is checked against the SDK fixture.
  const reloaded = await settledText(page);
  await page.waitForTimeout(2_000);
  expect(await gameText(page)).toEqual(reloaded);
  await page.screenshot({ path: testInfo.outputPath('blobs-reloaded.png') });

  await paused.getByRole('button', { name: 'Resume' }).click();
  const resumed = (await gameText(page))!;
  await expect.poll(async () => (await gameText(page))?.tick ?? 0, { timeout: 30_000 }).toBeGreaterThan(resumed.tick);
  expect(pageErrors).toEqual([]);
});

async function gameText(page: Page): Promise<GameText | undefined> {
  const frame = gameFrame(page);
  if (!frame || frame.isDetached()) return undefined;
  try {
    return await frame.evaluate(() => {
      const text = (window as Window & { render_game_to_text?: () => string | GameText }).render_game_to_text?.();
      const value = typeof text === 'string' ? (JSON.parse(text) as GameText) : text;
      return value ? { tick: value.tick, state: value.state } : undefined;
    });
  } catch {
    return undefined;
  }
}

/** The game's text once two reads a beat apart agree: the pause has reached the game. */
async function settledText(page: Page): Promise<GameText> {
  let previous = await gameText(page);
  for (;;) {
    await page.waitForTimeout(500);
    const next = await gameText(page);
    if (next && JSON.stringify(next) === JSON.stringify(previous)) return next;
    previous = next;
  }
}
