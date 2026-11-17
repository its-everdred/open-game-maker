/** `gm qa playtest`: plays every mode of a local game build in the real app shell and reports what broke. */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Frame, type Page } from 'playwright';
import type { DesignDoc } from '@ogm/contracts/browser';
import { captureFile } from '../../../apps/web/e2e/support/shell-capture-files';
import { serveStatic } from '../src/server';
import { GPU_ARGS, SOFTWARE_ARGS } from '../src/browser';
import { hasFfmpeg } from '../src/capture';
import { encodeMp4 } from '../src/qa/media';
import {
  addOnce,
  botMoves,
  judgeSample,
  PLAYTEST_RESULT,
  PLAYTEST_SIZES,
  type BotKey,
  type PlaytestRun,
} from '../src/qa/playtest';

import { gameFrame, openShell } from './open-shell';
import { inspectPlayArea } from './play-area-dom';
import { inspectPlaytest } from './playtest-dom';
import { captureStill, ScreenshotTimeout } from './still';

type Plan = {
  game: { dist: string } | { url: string };
  modes: { id: string; taps: string[] }[];
  seconds: number;
  seed: number;
  keys: BotKey[];
  /** False for a game whose manifest sets `playArea: false`: it has no board to count or overlap. */
  board: boolean;
  software: boolean;
  /** Test fixtures only: one size and short waits. */
  fast?: boolean;
};

const MOVE_MS = 250;
const LOAD_MS = 180_000;

const [out, planJson] = process.argv.slice(2);
if (!out || !planJson) throw new Error('missing playtest arguments');
const plan = JSON.parse(planJson) as Plan;
/** A build file as JSON: read from the local build, or fetched from the hosted one. */
async function buildJson(name: string): Promise<unknown> {
  if ('url' in plan.game) {
    const response = await fetch(new URL(name, plan.game.url));
    if (!response.ok) throw new Error(`hosted build ${name}: HTTP ${response.status}`);
    return response.json();
  }
  const file = captureFile(plan.game.dist, name);
  return file ? JSON.parse(readFileSync(file, 'utf8')) : null;
}
const design = (await buildJson('design/design.json')) as DesignDoc;
if (!design) throw new Error('game build is missing design/design.json');
const manifest = ((await buildJson('manifest.json').catch(() => null)) ?? {}) as { title?: unknown };
const title = typeof manifest.title === 'string' ? manifest.title : 'Local game';
const web = fileURLToPath(new URL('./web/', import.meta.url));
const screenshotTimeout = plan.software ? 30_000 : 10_000;
const ffmpeg = hasFfmpeg();
const server = await serveStatic(web);
const runs: PlaytestRun[] = [];

/** The board rect in page pixels, or the whole game frame when the game declares none. */
async function boardBox(page: Page, frame: Frame) {
  const box = await (await frame.frameElement()).boundingBox();
  if (!box) throw new Error('game frame is hidden');
  const board = await frame.evaluate(() => {
    const rect = document.querySelector('[data-gm-play-area]')?.getBoundingClientRect();
    return rect && rect.width > 0 ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height } : null;
  });
  const scale = box.width / (await frame.evaluate(() => innerWidth));
  return board
    ? {
        x: box.x + board.x * scale,
        y: box.y + board.y * scale,
        width: board.width * scale,
        height: board.height * scale,
      }
    : box;
}

const firstLine = (error: unknown) => (error instanceof Error ? error.message : String(error)).split('\n')[0]!;

async function sample(frame: Frame) {
  let playArea: string | undefined;
  if (plan.board)
    try {
      await frame.evaluate(inspectPlayArea, null);
    } catch (error) {
      playArea = firstLine(error).replace(/^.*?Error: /, '');
    }
  return judgeSample({ ...(await frame.evaluate(inspectPlaytest)), ...(playArea ? { playArea } : {}) }, plan);
}

async function playOne(mode: Plan['modes'][number], width: number, height: number, record: boolean) {
  const size = `${width}x${height}`;
  const dir = resolve(out, mode.id);
  const videoDir = resolve(dir, '.video');
  const run: PlaytestRun = { mode: mode.id, viewport: size, failures: [], unchecked: [] };
  runs.push(run);
  const browser = await chromium.launch({
    headless: true,
    args: plan.software ? [...SOFTWARE_ARGS, '--disable-gpu-compositing'] : GPU_ARGS,
  });
  let video: string | undefined;
  try {
    const shell = await openShell(browser, {
      game: plan.game,
      server,
      web,
      design,
      title,
      width,
      height,
      deviceScaleFactor: 1,
      gameConsole: true,
      ...(record ? { videoDir } : {}),
    });
    const { context, page, errors } = shell;
    const recording = page.video();
    try {
      await page.waitForTimeout(plan.fast ? 500 : 3_000);
      const game = page.frameLocator('.game-frame iframe');
      // The shell's loading layer covers the game, and takes taps, until the game reports its first frame.
      await page
        .waitForFunction(() => document.querySelector('.game-loading-layer:not(.is-done)') === null, null, {
          timeout: LOAD_MS,
        })
        .catch(() => {
          throw new Error(`the game was still loading after ${LOAD_MS / 1000} s`);
        });
      for (const text of mode.taps) {
        await game.getByText(text, { exact: true }).first().tap({ timeout: 45_000 });
        await page.waitForTimeout(plan.fast ? 300 : 1_200);
      }
      await page.waitForTimeout(plan.fast ? 300 : 2_000);
      const frame = gameFrame(page);
      if (!frame) throw new Error('game frame missing');
      await page.locator('.game-frame iframe').focus();
      const moves = botMoves(plan.keys, plan.seed, Math.max(1, Math.round((plan.seconds * 1000) / MOVE_MS)));
      for (const [index, move] of moves.entries()) {
        if (move.kind === 'key') await page.keyboard.press(move.key, { delay: 40 });
        else {
          const box = await boardBox(page, frame);
          await page.touchscreen.tap(box.x + move.x * box.width, box.y + move.y * box.height);
        }
        await page.waitForTimeout(MOVE_MS);
        if (index % 4 === 3 || index === moves.length - 1) {
          const found = await sample(frame);
          addOnce(run.failures, found.failures);
          addOnce(run.unchecked, found.unchecked);
        }
      }
      run.still = `${mode.id}/${size}.png`;
      await captureStill(page, resolve(out, run.still), `${mode.id} at ${size}`, screenshotTimeout);
    } catch (error) {
      if (!run.still) {
        run.still = `${mode.id}/${size}-failed.png`;
        await captureStill(page, resolve(out, run.still), `${mode.id} failure at ${size}`, screenshotTimeout).catch(
          (failure: unknown) => {
            delete run.still;
            run.unchecked.push(`failure still: ${firstLine(failure)}`);
          },
        );
      }
      throw error;
    } finally {
      addOnce(run.failures, errors);
      await context.close();
      video = await recording?.path();
    }
  } catch (error) {
    if (error instanceof ScreenshotTimeout) throw error;
    run.failures.push(`could not play: ${firstLine(error)}`);
  } finally {
    await browser.close();
  }
  if (record) {
    if (!video) run.unchecked.push('clip: no recording');
    else if (!ffmpeg) run.unchecked.push('clip: ffmpeg missing');
    else
      try {
        encodeMp4(video, resolve(out, `${mode.id}/clip.mp4`), 0);
        run.clip = `${mode.id}/clip.mp4`;
      } catch (error) {
        run.unchecked.push(`clip: ${firstLine(error)}`);
      }
    rmSync(videoDir, { recursive: true, force: true });
  }
}

try {
  mkdirSync(out, { recursive: true });
  const sizes = plan.fast ? PLAYTEST_SIZES.slice(0, 1) : PLAYTEST_SIZES;
  for (const mode of plan.modes) {
    mkdirSync(resolve(out, mode.id), { recursive: true });
    for (const [index, [width, height]] of sizes.entries()) {
      console.error(`playtest: ${mode.id} at ${width}x${height}`);
      await playOne(mode, width, height, index === 0);
    }
  }
  writeFileSync(resolve(out, PLAYTEST_RESULT), JSON.stringify(runs, null, 2));
} catch (error) {
  if (!(error instanceof ScreenshotTimeout)) throw error;
  console.error(error.message);
  process.exitCode = 42;
} finally {
  await server.close();
}
