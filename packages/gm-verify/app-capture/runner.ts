/** Portable capture of the real app, using the same mocked APIs as its browser tests. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import type { DesignDoc } from '@ogm/contracts/browser';
import { captureFile } from '../../../apps/web/e2e/support/shell-capture-files';
import { serveStatic } from '../src/server';
import { GPU_ARGS, SOFTWARE_ARGS } from '../src/browser';
import { encodeMp4 } from '../src/qa/media';

import { gameFrame, openShell } from './open-shell';
import { captureStill, ScreenshotTimeout } from './still';
import { inspectPlayArea } from './play-area-dom';
import { fixedAspectMinimumFill, matchesPlayAreaAspect, measurePlayArea } from '../src/play-area';
import { measureImageDistortion, type ImageDistortion } from './image-distortion';
import { frameCovered, frameTransform } from './frame-geometry';
import { trackShadowRoots } from './capture-instrumentation';

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
// Only the browser fixture invokes the runner directly with this final argument; the CLI never does.
const fast = testFastArg === '--test-fast' || testFastArg === '--test-all-fast';
const settleMs = fast ? 1_000 : 14_000;
const screenshotTimeout = softwareArg === '1' ? 30_000 : 10_000;
const limits = limitsJson
  ? (JSON.parse(limitsJson) as { minFill?: number; maxOffset?: number; skip?: boolean })
  : undefined;
const measurements: (
  | { viewport: string; screen: string; fill: number; offset: number; ok: boolean }
  | { viewport: string; screen: string; ok: false; error: string; inactive?: boolean }
  | { viewport: string; screen: string; ok: true; skipped: true; reason: string }
)[] = [];
const distortions: ImageDistortion[] = [];
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
      const { context, page, errors } = await openShell(browser, {
        game: { dist },
        server,
        web,
        design,
        title,
        width,
        height,
        deviceScaleFactor: fast ? 1 : 2,
        initScript: trackShadowRoots,
        ...(videoArg === '1' ? { videoDir: out } : {}),
      });
      try {
        if (softwareArg !== '1') await captureStill(page, undefined, `first frame at ${size}`, 5_000);
        await page.waitForTimeout(settleMs);
        const check = () => {
          if (errors.length) throw new Error(errors.join('\n'));
        };
        check();
        const measureImages = async (screen: string, still?: string) => {
          for (let attempt = 0; attempt < 3; attempt++) {
            const frames = page.frames();
            const frame = gameFrame(page);
            if (!frame) throw new Error(`game frame missing at ${size}`);
            await Promise.all(
              frames.map((item) =>
                item.evaluate(() => (window as unknown as { __gmCapturePause?: () => void }).__gmCapturePause?.()),
              ),
            );
            try {
              const versions = await Promise.all(
                frames.map((item) =>
                  item.evaluate(
                    () => (window as unknown as { __gmCaptureVersion?: () => number }).__gmCaptureVersion?.() ?? -1,
                  ),
                ),
              );
              const findings: ImageDistortion[] = [];
              for (const capturedFrame of frames) {
                if (capturedFrame !== page.mainFrame()) {
                  const owner = await capturedFrame.frameElement();
                  const bounds = await owner.boundingBox();
                  if (
                    !(await owner.isVisible()) ||
                    !bounds ||
                    bounds.x + bounds.width <= 0 ||
                    bounds.y + bounds.height <= 0 ||
                    bounds.x >= width ||
                    bounds.y >= height
                  )
                    continue;
                  if (await frameCovered(capturedFrame)) continue;
                }
                findings.push(
                  ...(await measureImageDistortion(
                    capturedFrame,
                    size,
                    screen,
                    capturedFrame === frame,
                    await frameTransform(capturedFrame),
                  )),
                );
              }
              if (still)
                await captureStill(
                  page,
                  resolve(out, `${still}-${size}.png`),
                  `${still} at ${size}`,
                  screenshotTimeout,
                );
              const after = page.frames();
              const stable =
                frames.length === after.length &&
                frames.every((item, index) => item === after[index]) &&
                (
                  await Promise.all(
                    frames.map((item) =>
                      item.evaluate(
                        () => (window as unknown as { __gmCaptureVersion?: () => number }).__gmCaptureVersion?.() ?? -1,
                      ),
                    ),
                  )
                ).every((value, index) => value >= 0 && value === versions[index]);
              if (stable) {
                distortions.push(...findings);
                return;
              }
            } finally {
              await Promise.allSettled(
                frames.map((item) =>
                  item.evaluate(() => (window as unknown as { __gmCaptureResume?: () => void }).__gmCaptureResume?.()),
                ),
              );
            }
          }
          distortions.push({
            element: 'document',
            file: '',
            natural: 0,
            drawn: 0,
            viewport: size,
            screen,
            error: 'screen changed during image measurement',
          });
        };
        const measure = async (screen: string) => {
          if (!limits?.skip) {
            try {
              const frame = gameFrame(page);
              if (!frame) throw new Error(`game frame missing at ${size}`);
              const geometry = await frame.evaluate(inspectPlayArea, null);
              if (geometry.inactive !== undefined) {
                measurements.push({ viewport: size, screen, ok: false, error: geometry.inactive, inactive: true });
                return;
              }
              const frameBox = await (await frame.frameElement()).boundingBox();
              if (!frameBox) throw new Error('game frame is hidden');
              const scaleX = frameBox.width / geometry.viewport.width;
              const scaleY = frameBox.height / geometry.viewport.height;
              const board = geometry.board;
              if (
                frameBox.x + board.left * scaleX < 0 ||
                frameBox.y + board.top * scaleY < 0 ||
                frameBox.x + (board.left + board.width) * scaleX > width ||
                frameBox.y + (board.top + board.height) * scaleY > height
              )
                throw new Error('play area is clipped by shell viewport');
              const hostGeometry = await page.evaluate(inspectPlayArea, {
                left: frameBox.x + board.left * scaleX,
                top: frameBox.y + board.top * scaleY,
                width: board.width * scaleX,
                height: board.height * scaleY,
              });
              if (hostGeometry.inactive !== undefined) throw new Error(`game frame ${hostGeometry.inactive}`);
              if (geometry.aspect !== undefined && (!Number.isFinite(geometry.aspect) || geometry.aspect <= 0))
                throw new Error(`invalid play-area aspect at ${size}`);
              const minFill =
                limits?.minFill ??
                (geometry.aspect === undefined ? 0.9 : fixedAspectMinimumFill(geometry, geometry.aspect));
              const measurement = measurePlayArea(geometry, { minFill, maxOffset: limits?.maxOffset ?? 0.05 });
              measurements.push({
                viewport: size,
                screen,
                ...measurement,
                ok:
                  measurement.ok &&
                  (geometry.aspect === undefined || matchesPlayAreaAspect(geometry.board, geometry.aspect)),
              });
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              measurements.push({
                viewport: size,
                screen,
                ok: false,
                error: message,
              });
            }
          }
        };
        await measureImages('play', 'play');
        await measure('play');
        console.error(`shell capture: play still captured at ${size}`);
        const game = page.frameLocator('.game-frame iframe');
        for (const text of taps) {
          const target = game.getByText(text, { exact: true }).first();
          await target.waitFor({ state: 'visible', timeout: 45_000 });
          await measureImages(`before ${text}`);
          await target.tap({ timeout: 45_000 });
          await page.waitForTimeout(1_200);
          await measureImages(`after ${text}`);
        }
        if (taps.length) {
          await page.waitForTimeout(fast ? 500 : 9_000);
          check();
          await measureImages('ingame', 'ingame');
          await measure('ingame');
        }
        const menu = page.getByRole('button', { name: 'Menu', exact: true }).first();
        await menu.tap();
        await page.waitForTimeout(1_500);
        check();
        await measureImages('menu', 'menu');
        await measure('menu');
        if (editArg === '1') {
          await page.getByRole('button', { name: 'Edit', exact: true }).tap();
          await page.locator('.edit-workspace').waitFor({ timeout: 30_000 });
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
          await measureImages('edit', 'edit');
          await measure('edit');
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
  // A title or results screen may have no active board. Keep the missing-board failure
  // when no screen in that viewport ever showed one.
  for (let i = 0; i < measurements.length; i++) {
    const item = measurements[i]!;
    if (
      'error' in item &&
      item.inactive &&
      item.screen !== (taps.length ? 'ingame' : 'play') &&
      measurements.some(
        (other) => other.viewport === item.viewport && other !== item && (!('error' in other) || !other.inactive),
      )
    ) {
      measurements[i] = {
        viewport: item.viewport,
        screen: item.screen,
        ok: true,
        skipped: true,
        reason: 'no active board',
      };
    }
  }
  writeFileSync(resolve(out, 'play-area.json'), JSON.stringify(measurements));
  writeFileSync(resolve(out, 'image-distortion.json'), JSON.stringify(distortions));
} catch (error) {
  if (!(error instanceof ScreenshotTimeout)) throw error;
  console.error(error.message);
  process.exitCode = 42;
} finally {
  await server.close();
}
