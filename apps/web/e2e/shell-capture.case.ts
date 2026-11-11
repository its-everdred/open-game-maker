import { mkdirSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { test } from '@playwright/test';
import { installAuthRoutes } from './fixtures/auth-routes';
import { installGameApi } from './support/mock-game-api';

// eslint-disable-next-line no-restricted-properties
const env = process.env;
const dist = resolve(env.GM_SHELL_DIST!);
const out = resolve(env.GM_SHELL_OUT!);
const taps = JSON.parse(env.GM_SHELL_TAPS ?? '[]') as string[];
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
        const file = resolve(dist, suffix || 'index.html');
        if (!file.startsWith(`${dist}${sep}`)) return route.abort();
        try {
          await route.fulfill({ path: file });
        } catch {
          await route.abort();
        }
      });
      await page.goto('/g/game');
      await page.locator('.game-frame iframe').waitFor({ state: 'visible', timeout: 30_000 });
      await page.waitForTimeout(14_000);
      await page.screenshot({ path: resolve(out, `play-${width}x${height}.png`) });
      const game = page.frameLocator('.game-frame iframe');
      for (const text of taps) {
        await game.getByText(text, { exact: true }).first().tap({ timeout: 10_000 });
        await page.waitForTimeout(1_200);
      }
      if (taps.length) {
        await page.waitForTimeout(9_000);
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
