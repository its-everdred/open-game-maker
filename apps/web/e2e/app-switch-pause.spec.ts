import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';

import { installAuthRoutes } from './fixtures/auth-routes';
import { installGameApi } from './support/mock-game-api';
import { bridgeOrigin, bridgeState, gameFrame, setHidden } from './support/visibility';

type SdkState = { tick: number; paused: boolean; counter: number };

test.use({ serviceWorkers: 'block' });
// Each test loads the shell and an SDK game, and two of them reload both.
test.describe.configure({ timeout: 180_000 });

let bundle: Buffer;

test.beforeAll(async () => {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('./fixtures/solo-sdk-game.ts', import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    define: { __GM_BUILD__: '"test"' },
    write: false,
  });
  bundle = Buffer.from(result.outputFiles[0]!.contents);
});

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'the shell lifecycle is the same at every size');
  await installAuthRoutes(page, { signedIn: true });
  await installGameApi(page);
  await page.route(`${bridgeOrigin}/g/game/**/index.html*`, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html><body><script type="module" src="./solo-sdk-game.js"></script></body></html>',
    }),
  );
  await page.route(`${bridgeOrigin}/g/game/**/solo-sdk-game.js`, (route) =>
    route.fulfill({ contentType: 'text/javascript', body: bundle }),
  );
});

test('a pause made before switching apps is still there, with the game untouched, on return', async ({ page }) => {
  await openPlaying(page);
  await page.getByRole('button', { name: 'Menu' }).click({ force: true });
  const paused = page.getByRole('dialog', { name: 'Paused' });
  await expect(paused).toBeVisible();
  await expect.poll(async () => (await sdkState(page))?.paused).toBe(true);
  const before = (await sdkState(page))!;

  await setHidden(page, true);
  await setHidden(page, false);
  // Long enough for a resumed game to run dozens of steps.
  await page.waitForTimeout(1_000);

  await expect(paused).toBeVisible();
  expect(await sdkState(page)).toEqual(before);

  // The next switch away ends with the tab evicted: the reload keeps that same pause and game.
  await setHidden(page, true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(() => bridgeState(page), { timeout: 60_000 }).toBe('ready');
  await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();
  await expect.poll(async () => (await sdkState(page))?.counter).toBe(before.counter);
  expect((await sdkState(page))?.paused).toBe(true);
});

test('switching apps mid-game pauses it, and only Resume starts it again', async ({ page }) => {
  await openPlaying(page);
  await setHidden(page, true);
  await expect.poll(async () => (await sdkState(page))?.paused).toBe(true);
  const left = (await sdkState(page))!;
  await setHidden(page, false);
  await page.waitForTimeout(1_000);

  await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();
  expect(await sdkState(page)).toEqual(left);

  await page.getByRole('dialog', { name: 'Paused' }).getByRole('button', { name: 'Resume' }).click();
  await expect.poll(async () => (await sdkState(page))?.counter ?? 0).toBeGreaterThan(left.counter);
});

test('a tab reloaded in the background comes back paused where the player left it', async ({ page }) => {
  await openPlaying(page);
  await setHidden(page, true);
  await expect.poll(async () => (await sdkState(page))?.paused).toBe(true);
  const left = (await sdkState(page))!;
  // The SDK's save from the pause reaches the shell before the tab goes.
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('ogm.away.game'))).toContain('"counter"');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(() => bridgeState(page), { timeout: 60_000 }).toBe('ready');
  await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();
  await expect.poll(async () => (await sdkState(page))?.counter).toBe(left.counter);
  expect((await sdkState(page))?.paused).toBe(true);
  await page.waitForTimeout(1_000);
  expect((await sdkState(page))?.counter).toBe(left.counter);

  await page.getByRole('dialog', { name: 'Paused' }).getByRole('button', { name: 'Resume' }).click();
  await expect.poll(async () => (await sdkState(page))?.counter ?? 0).toBeGreaterThan(left.counter);
  // Resuming ends the away state: the next load starts fresh.
  expect(await page.evaluate(() => sessionStorage.getItem('ogm.away.game'))).toBeNull();
});

async function openPlaying(page: Page): Promise<void> {
  await page.goto('/g/game?test');
  await expect.poll(() => bridgeState(page), { timeout: 60_000 }).toBe('ready');
  await expect.poll(async () => (await sdkState(page))?.counter ?? 0, { timeout: 15_000 }).toBeGreaterThan(10);
}

async function sdkState(page: Page): Promise<SdkState | undefined> {
  const frame = gameFrame(page);
  if (!frame || frame.isDetached()) return undefined;
  try {
    return await frame.evaluate(() => {
      const runtime = (
        window as Window & {
          __pauseFixture?: {
            clock: { tick: number; paused: boolean };
            instance: { serialize(): { data: { counter: number } } };
          };
        }
      ).__pauseFixture;
      return runtime
        ? { tick: runtime.clock.tick, paused: runtime.clock.paused, counter: runtime.instance.serialize().data.counter }
        : undefined;
    });
  } catch {
    return undefined;
  }
}
