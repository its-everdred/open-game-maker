import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Browser } from 'playwright';

import { VIEWPORTS } from '../browser.js';
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
  options: { outDir: string; viewport?: ViewportName; ffmpegBinary?: string },
): Promise<DriveResult> {
  const viewport = options.viewport ?? journey.viewport ?? 'desktop';
  const dir = join(options.outDir, journey.name);
  const videoDir = join(dir, '.video');
  mkdirSync(videoDir, { recursive: true });
  rmSync(join(dir, DRIVE_RESULT), { force: true });
  const size = recordSize(VIEWPORTS[viewport].viewport);
  const recordingStartedAt = Date.now();
  const context = await browser.newContext({ ...VIEWPORTS[viewport], recordVideo: { dir: videoDir, size } });
  const collector = new ConsoleCollector();
  let steps: StepResult[] = [];
  let webm: string | undefined;
  let firstInputAt: number | undefined;
  try {
    const page = await context.newPage();
    watchConsole(page, collector);
    const player = new Player(page, dir, { label: viewport, touch: VIEWPORTS[viewport].hasTouch === true });
    /* Not `load`: a hosted build is still loading its assets, and the journey's first expect waits for that.
       Not `commit`: an unpainted page cannot be screenshotted, and the first input step takes a frame. */
    const opened = await gotoBuild(page, url);
    if (opened) steps = [{ index: 0, step: `open ${url}`, ok: false, ms: 0, error: opened }];
    else {
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
  writeFileSync(join(dir, DRIVE_RESULT), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
