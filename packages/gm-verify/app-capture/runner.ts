/** Portable capture of the real app, using the same mocked APIs as its browser tests. */
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import type { DesignDoc } from '@ogm/contracts/browser';
import { installAuthRoutes } from '../../../apps/web/e2e/fixtures/auth-routes';
import { buildId, installGameApi } from '../../../apps/web/e2e/support/mock-game-api';
import { captureFile, captureUrlFile } from '../../../apps/web/e2e/support/shell-capture-files';
import { gameHeaders } from '../../../services/games-host/src/headers';
import { serveStatic } from '../src/server';
import { GPU_ARGS, SOFTWARE_ARGS } from '../src/browser';
import { encodeMp4 } from '../src/qa/media';

const [dist, out, tapsJson, editArg, videoArg, softwareArg, testFastArg] = process.argv.slice(2);
if (!dist || !out || !tapsJson) throw new Error('missing capture arguments');
const taps = JSON.parse(tapsJson) as string[];
const design = JSON.parse(readFileSync(resolve(dist, 'design/design.json'), 'utf8')) as DesignDoc;
const manifestFile = captureFile(dist, 'manifest.json');
const manifest = manifestFile ? (JSON.parse(readFileSync(manifestFile, 'utf8')) as { title?: unknown }) : {};
const title = typeof manifest.title === 'string' ? manifest.title : 'Local game';
const web = fileURLToPath(new URL('./web/', import.meta.url));
const server = await serveStatic(web);
const browser = await chromium
  .launch({ headless: true, args: softwareArg === '1' ? SOFTWARE_ARGS : GPU_ARGS })
  .catch(async (error: unknown) => {
    await server.close();
    throw error;
  });
const build = buildId;
// Only the browser fixture invokes the runner directly with this final argument; the CLI never does.
const settleMs = testFastArg === '--test-fast' ? 1_000 : 14_000;
try {
  mkdirSync(out, { recursive: true });
  const viewports = [
    [390, 844],
    [844, 390],
    [820, 1180],
    [1180, 820],
  ] as const;
  for (const [width, height] of testFastArg === '--test-fast' ? viewports.slice(0, 1) : viewports) {
    const size = `${width}x${height}`;
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: testFastArg === '--test-fast' ? 1 : 2,
      isMobile: true,
      hasTouch: true,
      serviceWorkers: 'block',
      ...(videoArg === '1' ? { recordVideo: { dir: out, size: { width, height } } } : {}),
    });
    try {
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await installAuthRoutes(page, { signedIn: true });
      await installGameApi(page, design, title);
      // The real web build expects this games origin; intercept it without opening a listener.
      await page.route('http://127.0.0.1:10000/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        const suffix = path.includes(`/${build}/`) ? path.split(`/${build}/`)[1]! : path.slice(1);
        const file = captureUrlFile(dist, suffix || 'index.html');
        if (!file) {
          errors.push(`game resource missing: ${path}`);
          return route.abort();
        }
        await route.fulfill({ path: file, headers: gameHeaders(new URL(server.url).origin) });
      });
      await page.route(`${server.url}g/game**`, (route) =>
        route.fulfill({ path: resolve(web, 'index.html'), contentType: 'text/html' }),
      );
      const entry = page.waitForResponse((response) => response.url().includes(`/${build}/index.html`), {
        timeout: 30_000,
      });
      await page.goto(new URL('g/game?test=1', server.url).href);
      const response = await entry;
      if (!response.ok()) throw new Error(`game entry failed: ${response.status()}`);
      await page.locator('.game-frame iframe').waitFor({ state: 'visible', timeout: 30_000 });
      const state = await page.waitForFunction(
        () => {
          const host = (window as unknown as { __ogmHost?: { game?: { bridgeState?: string } } }).__ogmHost;
          const status = host?.game?.bridgeState;
          return status === 'ready' || status === 'error' ? status : false;
        },
        null,
        { timeout: 30_000 },
      );
      if ((await state.jsonValue()) !== 'ready') throw new Error('game bridge did not become ready');
      await page.waitForTimeout(settleMs);
      const check = () => {
        if (errors.length) throw new Error(errors.join('\n'));
      };
      check();
      await page.screenshot({ path: resolve(out, `play-${size}.png`), timeout: 120_000 });
      const game = page.frameLocator('.game-frame iframe');
      for (const text of taps) {
        await game.getByText(text, { exact: true }).first().tap({ timeout: 45_000 });
        await page.waitForTimeout(1_200);
      }
      if (taps.length) {
        await page.waitForTimeout(testFastArg === '--test-fast' ? 500 : 9_000);
        check();
        await page.screenshot({ path: resolve(out, `ingame-${size}.png`), timeout: 120_000 });
      }
      const menu = page.getByRole('button', { name: 'Menu', exact: true }).first();
      await menu.tap();
      await page.waitForTimeout(1_500);
      check();
      await page.screenshot({ path: resolve(out, `menu-${size}.png`), timeout: 120_000 });
      if (editArg === '1') {
        await page.getByRole('button', { name: 'Edit', exact: true }).tap();
        await page.getByLabel('Editor canvas').waitFor({ timeout: 30_000 });
        await page.waitForFunction(
          () => {
            const host = (window as unknown as { __ogmHost?: { game?: { bridgeState?: string; mode?: string } } })
              .__ogmHost;
            return host?.game?.mode === 'edit' && host.game.bridgeState === 'ready';
          },
          null,
          { timeout: 30_000 },
        );
        await page.waitForTimeout(1_500);
        check();
        await page.screenshot({ path: resolve(out, `edit-${size}.png`), timeout: 120_000 });
      }
      const video = page.video();
      await context.close();
      if (videoArg === '1' && video) encodeMp4(await video.path(), resolve(out, `motion-${size}.mp4`), 0);
    } finally {
      await context.close();
    }
  }
} finally {
  try {
    await browser.close();
  } finally {
    await server.close();
  }
}
