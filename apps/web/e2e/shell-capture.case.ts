import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from '@playwright/test';
import { installAuthRoutes } from './fixtures/auth-routes';
import { installGameApi } from './support/mock-game-api';
import { captureFile } from './support/shell-capture-files';

// eslint-disable-next-line no-restricted-properties
const env = process.env;
const dist = resolve(env.GM_SHELL_DIST!);
const out = resolve(env.GM_SHELL_OUT!);
const taps = JSON.parse(env.GM_SHELL_TAPS ?? '[]') as string[];
// The direct browser harness uses a short delay for its synthetic fixtures; gm capture shell forces the real delay.
const settleMs = env.GM_SHELL_TEST_FAST === '1' ? 1_000 : 14_000;
const design = JSON.parse(readFileSync(resolve(dist, 'design/design.json'), 'utf8')) as unknown;
const build = 'b_01BX5ZZKBKACTAV9WEVGEMMVRZ';
mkdirSync(out, { recursive: true });

for (const [width, height] of [
  [390, 844],
  [844, 390],
  [820, 1180],
  [1180, 820],
]) {
  test(`shell ${width}x${height}`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      baseURL,
      viewport: { width, height },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      serviceWorkers: 'block',
    });
    try {
      const page = await context.newPage();
      const failedGameFiles: string[] = [];
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      const checkErrors = () => {
        if (failedGameFiles.length) throw new Error(`game resources failed: ${failedGameFiles.join(', ')}`);
        if (pageErrors.length) throw new Error(`page errors: ${pageErrors.join(', ')}`);
      };
      page.on('console', (message) => {
        if (message.type() === 'error') console.error(message.text());
      });
      await installAuthRoutes(page, { signedIn: true });
      await installGameApi(page);
      await page.route('**/api/v1/games/game/branches/main/design', (route) =>
        route.fulfill({ json: { rev: 4, buildId: build, doc: design } }),
      );
      await page.route('http://127.0.0.1:10000/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        const suffix = path.includes(`/${build}/`) ? path.split(`/${build}/`)[1] : path.slice(1);
        const file = captureFile(dist, suffix || 'index.html');
        if (!file) {
          failedGameFiles.push(path);
          return route.abort();
        }
        try {
          await route.fulfill({ path: file });
        } catch {
          failedGameFiles.push(path);
          await route.abort();
        }
      });
      const entry = page.waitForResponse((response) => response.url().includes(`/${build}/index.html`), {
        timeout: 30_000,
      });
      await page.goto('/g/game');
      const response = await entry;
      if (!response.ok()) throw new Error(`game entry failed: ${response.status()}`);
      await page.locator('.game-frame iframe').waitFor({ state: 'visible', timeout: 30_000 });
      await page.waitForTimeout(settleMs);
      checkErrors();
      await page.screenshot({ path: resolve(out, `play-${width}x${height}.png`) });
      const game = page.frameLocator('.game-frame iframe');
      for (const text of taps) {
        await game.getByText(text, { exact: true }).first().tap({ timeout: 10_000 });
        await page.waitForTimeout(1_200);
      }
      checkErrors();
      if (taps.length) {
        await page.waitForTimeout(9_000);
        checkErrors();
        await page.screenshot({ path: resolve(out, `ingame-${width}x${height}.png`) });
      }
      const menu = page.getByRole('button', { name: 'Menu' });
      if (await menu.count()) {
        await menu.first().tap();
        await page.waitForTimeout(1_500);
        await page.screenshot({ path: resolve(out, `menu-${width}x${height}.png`) });
      }
    } finally {
      await context.close();
    }
  });
}
