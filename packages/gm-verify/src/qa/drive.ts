import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { redactCapabilities } from './redact.js';
import { join } from 'node:path';

import type { Browser } from 'playwright';

import { GAME_FILE, gameFrame, routeGameToLocal, VIEWPORTS } from '../browser.js';
import { FfmpegMissingError, hasFfmpeg } from '../capture.js';
import { ConsoleCollector } from '../console.js';
import type { ConsoleEntry, ViewportName } from '../report.js';
import type { SoloJourney } from './journey.js';
import { clipStart, encodeGif, encodeMp4, recordSize } from './media.js';
import { errorText, gotoBuild, hasConsoleError, watchConsole } from './open.js';
import { Player, type StepResult } from './player.js';

export type DriveResult = {
  journey: string;
  url: string;
  viewport: ViewportName;
  verdict: 'pass' | 'fail';
  steps: StepResult[];
  /** Steps never run because an earlier one failed. */
  skipped: number;
  console: ConsoleEntry[];
  clip: { mp4: string; gif: string | null } | null;
  /** Why there is no clip or GIF (ffmpeg missing or too slow), so the report can list it as unchecked. */
  unchecked: string[];
};

export const DRIVE_RESULT = 'journey-result.json';

/**
 * Plays a journey against the build in real time with real input, recording the page. Writes stills, `journey.mp4`,
 * `journey.gif` and `journey-result.json` into `<outDir>/<journey name>/`; any failed step fails the journey.
 */
export async function driveJourney(
  browser: Browser,
  url: string,
  journey: SoloJourney,
  options: {
    outDir: string;
    viewport?: ViewportName;
    ffmpegBinary?: string;
    app?: { url: string; storageState: string };
    readyTimeoutMs?: number;
  },
): Promise<DriveResult> {
  const viewport = options.viewport ?? journey.viewport ?? 'desktop';
  const dir = join(options.outDir, journey.name);
  const videoDir = join(dir, '.video');
  mkdirSync(videoDir, { recursive: true });
  rmSync(join(dir, DRIVE_RESULT), { force: true });
  const size = recordSize(VIEWPORTS[viewport].viewport);
  let recordingStartedAt = Date.now();
  const context = await browser.newContext({
    ...VIEWPORTS[viewport],
    ...(options.app ? { storageState: options.app.storageState, serviceWorkers: 'block' as const } : {}),
    recordVideo: { dir: videoDir, size },
  });
  const collector = new ConsoleCollector();
  let steps: StepResult[] = [];
  let webm: string | undefined;
  let firstInputAt: number | undefined;
  try {
    if (options.app) {
      const origin = new URL(options.app.url).origin;
      const me = await context.request.get(new URL('/api/v1/me', origin).href, { maxRedirects: 0 });
      if (!me.ok())
        throw new Error(`QA session is not signed in (/api/v1/me: ${me.status()}); refresh with ops/bin/ogm-qa-signin`);
      const identity = (await me.json().catch(() => null)) as { user?: unknown } | null;
      if (!identity?.user)
        throw new Error(
          'QA session is not signed in (/api/v1/me returned no user); refresh with ops/bin/ogm-qa-signin',
        );
      await routeGameToLocal(context, { ...options.app, localUrl: url });
    }
    recordingStartedAt = Date.now();
    const page = await context.newPage();
    let gameStatus: number | undefined;
    page.on('response', (response) => {
      const requestUrl = new URL(response.url());
      if (options.app && requestUrl.origin !== new URL(options.app.url).origin && GAME_FILE.test(requestUrl.pathname)) {
        if (response.request().isNavigationRequest()) gameStatus = response.status();
      }
    });
    watchConsole(page, collector);
    /* Not `load`: a hosted build is still loading its assets, and the journey's first expect waits for that.
       Not `commit`: an unpainted page cannot be screenshotted, and the first input step takes a frame. */
    const opened = await gotoBuild(page, options.app?.url ?? url);
    if (opened) steps = [{ index: 0, step: `open ${url}`, ok: false, ms: 0, error: opened }];
    else {
      const game = options.app
        ? await gameFrame(page, new URL(options.app.url).origin, options.readyTimeoutMs ?? 30_000)
        : undefined;
      await game?.waitForLoadState('domcontentloaded');
      if (game && (gameStatus === undefined || gameStatus < 200 || gameStatus >= 300))
        throw new Error(`local game frame failed to load (HTTP ${gameStatus ?? 'unknown'})`);
      const player = new Player(page, dir, {
        label: viewport,
        touch: VIEWPORTS[viewport].hasTouch === true,
        target: game,
      });
      if (game) await player.expect({ do: 'expect', pixels: 'nonblank', timeoutMs: options.readyTimeoutMs ?? 30_000 });
      steps = await player.runAll(journey.steps);
      firstInputAt = player.firstInputAt;
    }
    webm = await page.video()?.path();
  } catch (error) {
    /* A crash still leaves a failed result, so the report cannot read an older run's pass for this journey. */
    steps = [...steps, { index: steps.length, step: 'run', ok: false, ms: 0, error: errorText(error) }];
  } finally {
    await context.close();
  }

  const binary = options.ffmpegBinary ?? 'ffmpeg';
  const unchecked: string[] = [];
  let clip: DriveResult['clip'] = null;
  try {
    if (!webm) throw new Error('no recording');
    if (!hasFfmpeg(binary)) throw new FfmpegMissingError(binary);
    encodeMp4(webm, join(dir, 'journey.mp4'), clipStart(recordingStartedAt, firstInputAt), binary);
    clip = { mp4: 'journey.mp4', gif: null };
    encodeGif(join(dir, 'journey.mp4'), join(dir, 'journey.gif'), binary);
    clip.gif = 'journey.gif';
  } catch (error) {
    unchecked.push(`${clip ? 'gif' : 'clip'} (${errorText(error)})`);
  } finally {
    rmSync(videoDir, { recursive: true, force: true });
  }

  const consoleEntries = collector.list();
  const result: DriveResult = {
    journey: journey.name,
    url,
    viewport,
    verdict:
      steps.length === journey.steps.length && steps.every((s) => s.ok) && !hasConsoleError(consoleEntries)
        ? 'pass'
        : 'fail',
    steps,
    skipped: Math.max(0, journey.steps.length - steps.length),
    console: consoleEntries,
    clip,
    unchecked,
  };
  const safe = redactCapabilities(result);
  writeFileSync(join(dir, DRIVE_RESULT), `${JSON.stringify(safe, null, 2)}\n`);
  return safe;
}
