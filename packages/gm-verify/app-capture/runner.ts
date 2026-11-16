/** Portable capture of the real app, using the same mocked APIs as its browser tests. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

import { captureStill, ScreenshotTimeout } from './still';
import { fixedAspectMinimumFill, matchesPlayAreaAspect, measurePlayArea } from '../src/play-area';

const [dist, out, tapsJson, editArg, videoArg, softwareArg, testFastArg, limitsJson] = process.argv.slice(2);
if (!dist || !out || !tapsJson) throw new Error('missing capture arguments');
const taps = JSON.parse(tapsJson) as string[];
const design = JSON.parse(readFileSync(resolve(dist, 'design/design.json'), 'utf8')) as DesignDoc;
const manifestFile = captureFile(dist, 'manifest.json');
const manifest = manifestFile ? (JSON.parse(readFileSync(manifestFile, 'utf8')) as { title?: unknown }) : {};
const title = typeof manifest.title === 'string' ? manifest.title : 'Local game';
const web = fileURLToPath(new URL('./web/', import.meta.url));
console.error('shell capture: starting app server');
const server = await serveStatic(web);
const build = buildId;
// Only the browser fixture invokes the runner directly with this final argument; the CLI never does.
const fast = testFastArg === '--test-fast' || testFastArg === '--test-all-fast';
const settleMs = fast ? 1_000 : 14_000;
const screenshotTimeout = softwareArg === '1' ? 30_000 : 10_000;
const limits = limitsJson
  ? (JSON.parse(limitsJson) as { minFill?: number; maxOffset?: number; skip?: boolean })
  : undefined;
const measurements: { viewport: string; fill: number; offset: number; ok: boolean }[] = [];
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
    console.error(`shell capture: opening ${size}`);
    // A new browser per viewport releases WebGL resources between captures.
    const browser = await chromium.launch({
      headless: true,
      args: softwareArg === '1' ? [...SOFTWARE_ARGS, '--disable-gpu-compositing'] : GPU_ARGS,
    });
    try {
      const context = await browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: fast ? 1 : 2,
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
        console.error(`shell capture: waiting for game entry at ${size}`);
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
        console.error(`shell capture: game ready at ${size}`);
        if (softwareArg !== '1') await captureStill(page, undefined, `first frame at ${size}`, 5_000);
        await page.waitForTimeout(settleMs);
        const check = () => {
          if (errors.length) throw new Error(errors.join('\n'));
        };
        check();
        await captureStill(page, resolve(out, `play-${size}.png`), `play at ${size}`, screenshotTimeout);
        console.error(`shell capture: play still captured at ${size}`);
        const game = page.frameLocator('.game-frame iframe');
        for (const text of taps) {
          await game.getByText(text, { exact: true }).first().tap({ timeout: 45_000 });
          await page.waitForTimeout(1_200);
        }
        if (taps.length) {
          await page.waitForTimeout(fast ? 500 : 9_000);
          check();
          await captureStill(page, resolve(out, `ingame-${size}.png`), `ingame at ${size}`, screenshotTimeout);
        }
        if (!limits?.skip) {
          const frame = page.frames().find((item) => item.url().includes(`/${build}/index.html`));
          if (!frame) throw new Error(`game frame missing at ${size}`);
          const geometry = await frame
            .evaluate(() => {
              const board = document.querySelector<HTMLElement>('[data-gm-play-area]');
              if (!board) throw new Error('missing [data-gm-play-area]');
              const rect = board.getBoundingClientRect();
              for (let element: HTMLElement | null = board; element; element = element.parentElement) {
                const style = getComputedStyle(element);
                if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0)
                  throw new Error('play area is hidden');
                if (element !== board) {
                  const bounds = element.getBoundingClientRect();
                  if (
                    (['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowX) &&
                      (rect.left < bounds.left - 1 || rect.right > bounds.right + 1)) ||
                    (['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowY) &&
                      (rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1))
                  )
                    throw new Error('play area is clipped by an ancestor');
                }
              }
              const probe = document.createElement('div');
              probe.style.cssText =
                'position:fixed;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
              document.body.appendChild(probe);
              const style = getComputedStyle(probe);
              const safe = {
                top: parseFloat(style.paddingTop),
                right: parseFloat(style.paddingRight),
                bottom: parseFloat(style.paddingBottom),
                left: parseFloat(style.paddingLeft),
              };
              probe.remove();
              return {
                viewport: { width: innerWidth, height: innerHeight },
                board: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
                safe,
                controls: {
                  top: Number(board.dataset.gmControlTop ?? 0),
                  bottom: Number(board.dataset.gmControlBottom ?? 0),
                },
                aspect:
                  board.dataset.gmPlayAreaAspect === undefined ? undefined : Number(board.dataset.gmPlayAreaAspect),
              };
            })
            .catch((error: unknown) => {
              throw new Error(
                `play-area measurement at ${size}: ${error instanceof Error ? error.message : String(error)}`,
              );
            });
          if (geometry.aspect !== undefined && (!Number.isFinite(geometry.aspect) || geometry.aspect <= 0))
            throw new Error(`invalid play-area aspect at ${size}`);
          const minFill =
            limits?.minFill ??
            (geometry.aspect === undefined ? 0.9 : fixedAspectMinimumFill(geometry, geometry.aspect));
          const measurement = measurePlayArea(geometry, { minFill, maxOffset: limits?.maxOffset ?? 0.05 });
          measurements.push({
            viewport: size,
            ...measurement,
            ok:
              measurement.ok &&
              (geometry.aspect === undefined || matchesPlayAreaAspect(geometry.board, geometry.aspect)),
          });
        }
        const menu = page.getByRole('button', { name: 'Menu', exact: true }).first();
        await menu.tap();
        await page.waitForTimeout(1_500);
        check();
        await captureStill(page, resolve(out, `menu-${size}.png`), `menu at ${size}`, screenshotTimeout);
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
          await captureStill(page, resolve(out, `edit-${size}.png`), `edit at ${size}`, screenshotTimeout);
        }
        const video = page.video();
        await context.close();
        if (videoArg === '1' && video) encodeMp4(await video.path(), resolve(out, `motion-${size}.mp4`), 0);
      } finally {
        await context.close();
      }
    } finally {
      await browser.close();
    }
  }
  writeFileSync(resolve(out, 'play-area.json'), JSON.stringify(measurements));
} catch (error) {
  if (!(error instanceof ScreenshotTimeout)) throw error;
  console.error(error.message);
  process.exitCode = 42;
} finally {
  await server.close();
}
