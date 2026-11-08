import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { assetManifestSchema, type Tier, type ViewId } from '@ogm/contracts';
import type { Browser } from 'playwright';

import { measureBudgets, manifestBytes, type Measured, type TierBudgetOverrides } from './budgets.js';
import { launch, openGame, type AppFrame, type OpenedGame } from './browser.js';
import {
  FfmpegMissingError,
  record,
  relativeTo,
  SOFTWARE_MAX_FRAMES,
  SOFTWARE_MAX_RECORD_S,
  stills,
  timeline,
  timelineTimes,
  type RecordOptions,
} from './capture.js';
import { ConsoleCollector } from './console.js';
import { playtesting, type ActivityContext } from './events.js';
import { replayInputs, type InputScript } from './inputs.js';
import {
  ALWAYS_UNCHECKED,
  GM_VERIFY_VERSION,
  unknownBudgets,
  verdictFor,
  viewportsOf,
  writeReport,
  type VerifyReport,
  type ViewportSet,
} from './report.js';
import { acquireSlot, type SemaphoreOptions } from './semaphore.js';

export const RUN_TIMEOUT_MS = 10 * 60_000;

export type RunVerifyOptions = ActivityContext & {
  url: string;
  outDir: string;
  viewport: ViewportSet;
  /** Capture inside the signed-in app shell, the local build standing in for the hosted one. */
  app?: Omit<AppFrame, 'localUrl'>;
  tier: Tier;
  rig?: ViewId;
  frames?: number[];
  timeline?: { from: number; to: number; step: number };
  record?: RecordOptions;
  inputs?: InputScript;
  budgets?: TierBudgetOverrides;
  software: boolean;
  runId?: string;
  /** ffmpeg binary (tests point it at a missing one). */
  ffmpeg?: string;
  slots?: SemaphoreOptions;
  timeoutMs?: number;
  readyTimeoutMs?: number;
  warn?: (line: string) => void;
};

export type RunVerifyResult = { report: VerifyReport; reportPath: string; ffmpegMissing: boolean };

export function newRunId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function downloadBytes(game: OpenedGame, url: string, tier: Tier): Promise<number | undefined> {
  const manifestUrl = new URL('assets/manifest.json', url).href;
  let raw: unknown;
  try {
    const response = await game.page.request.get(manifestUrl, { failOnStatusCode: false });
    raw = response.ok() ? await response.json() : null;
  } catch {
    raw = null;
  }
  const parsed = assetManifestSchema.safeParse(raw);
  return parsed.success ? manifestBytes(parsed.data, tier) : undefined;
}

/**
 * One verify run: opens the game per viewport, writes stills under `<out>/<viewport>/`, the timeline and clip once
 * (on the phone when the set has it, else the last), replays `--inputs`, measures budgets and probes, and always writes
 * `<out>/report.json` — with `verdict: "error"` and `error` when anything failed. Holds one host capture slot.
 */
export async function runVerify(options: RunVerifyOptions): Promise<RunVerifyResult> {
  const startedAt = new Date().toISOString();
  const runId = options.runId ?? newRunId();
  const outDir = options.outDir;
  const warn = options.warn ?? (() => {});
  const collector = new ConsoleCollector();
  const unchecked = new Set<string>(ALWAYS_UNCHECKED);
  const frames: VerifyReport['frames'] = [];
  const measured: Measured = {};
  let renderer = 'unknown';
  let software = options.software;
  let timelinePath: string | undefined;
  let clipPath: string | undefined;
  let probes: VerifyReport['probes'] = {};
  let textState: unknown;
  let error: string | undefined;
  let ffmpegMissing = false;
  let browser: Browser | undefined;
  let timedOut = false;

  playtesting(options, 'start');
  let slot: Awaited<ReturnType<typeof acquireSlot>> | undefined;
  let timer: NodeJS.Timeout | undefined;
  try {
    slot = await acquireSlot(options.slots);
    timer = setTimeout(() => {
      timedOut = true;
      void browser?.close();
    }, options.timeoutMs ?? RUN_TIMEOUT_MS);
    browser = await launch(options.software);
    const viewports = viewportsOf(options.viewport);
    const primary = viewports.includes('phone') ? 'phone' : viewports.at(-1);
    for (const viewport of viewports) {
      const last = viewport === primary;
      const game = await openGame(browser, options.url, {
        viewport,
        tier: options.tier,
        rig: options.rig,
        console: collector,
        readyTimeoutMs: options.readyTimeoutMs,
        ...(options.app ? { app: { ...options.app, localUrl: options.url } } : {}),
      });
      try {
        renderer = game.renderer;
        software = game.software;
        if (!game.hooks.exact) unchecked.add('exact frame times');
        const dir = join(outDir, viewport);
        let times = options.frames ?? [];
        let recordOptions = options.record;
        if (software) {
          if (times.length > SOFTWARE_MAX_FRAMES) {
            warn(`software renderer ${renderer}: capping --frames at ${SOFTWARE_MAX_FRAMES}`);
            times = times.slice(0, SOFTWARE_MAX_FRAMES);
          }
          if (recordOptions && recordOptions.seconds > SOFTWARE_MAX_RECORD_S) {
            warn(`software renderer ${renderer}: capping --record at ${SOFTWARE_MAX_RECORD_S} s`);
            recordOptions = { ...recordOptions, seconds: SOFTWARE_MAX_RECORD_S };
          }
        }
        for (const [i, path] of (await stills(game.hooks, times, dir)).entries())
          frames.push({ t: times[i], path: relativeTo(outDir, path), viewport });
        if (last && options.timeline) {
          let tl = timelineTimes(options.timeline);
          if (software && tl.length > SOFTWARE_MAX_FRAMES) {
            warn(`software renderer ${renderer}: capping the timeline at ${SOFTWARE_MAX_FRAMES} frames`);
            tl = tl.slice(0, SOFTWARE_MAX_FRAMES);
          }
          const path = join(dir, 'timeline.png');
          await timeline(game.hooks, tl, path, options.ffmpeg);
          timelinePath = relativeTo(outDir, path);
        }
        if (last && recordOptions) {
          const path = join(dir, 'run.mp4');
          await record(game.hooks, recordOptions, path, options.ffmpeg);
          clipPath = relativeTo(outDir, path);
        }
        const info = await game.hooks.info();
        if (info) {
          measured.drawCalls = Math.max(measured.drawCalls ?? 0, info.calls ?? 0);
          measured.triangles = Math.max(measured.triangles ?? 0, info.triangles ?? 0);
          if (info.textureBytes !== undefined)
            measured.textureBytes = Math.max(measured.textureBytes ?? 0, info.textureBytes);
        }
        if (last) {
          measured.downloadBytes = await downloadBytes(game, options.url, options.tier);
          if (options.inputs) await replayInputs(game.hooks, options.inputs);
          textState = await game.hooks.text();
          probes = await game.hooks.probes();
        }
      } finally {
        await game.close();
      }
    }
  } catch (caught) {
    if (caught instanceof FfmpegMissingError) ffmpegMissing = true;
    error = timedOut
      ? `timed out after ${options.timeoutMs ?? RUN_TIMEOUT_MS} ms`
      : caught instanceof Error
        ? caught.message
        : String(caught);
  } finally {
    if (timer) clearTimeout(timer);
    await browser?.close().catch(() => {});
    slot?.release();
  }

  const budgets = error ? unknownBudgets() : measureBudgets(options.tier, measured, options.budgets);
  if (budgets.downloadBytes[2] === 'unknown') unchecked.add('download size');
  if (budgets.drawCalls[2] === 'unknown') unchecked.add('draw calls');
  if (budgets.textureBytes[2] === 'unknown') unchecked.add('texture memory');
  const consoleEntries = collector.list();
  const report: VerifyReport = {
    runId,
    ...(options.jobId ? { jobId: options.jobId } : {}),
    ...(options.aiurIssue !== undefined ? { aiurIssue: options.aiurIssue } : {}),
    renderer,
    software,
    viewport: options.viewport,
    frame: options.app ? 'app' : 'bare',
    tier: options.tier,
    ...(options.rig ? { rig: options.rig } : {}),
    frames,
    ...(timelinePath ? { timeline: timelinePath } : {}),
    ...(clipPath ? { clip: clipPath } : {}),
    console: consoleEntries,
    budgets,
    probes,
    clients: 1,
    seats: [],
    unchecked: [...unchecked],
    verdict: error ? 'error' : verdictFor({ budgets, console: consoleEntries }),
    ...(error ? { error } : {}),
    startedAt,
    endedAt: new Date().toISOString(),
    gmVerifyVersion: GM_VERIFY_VERSION,
  };
  const reportPath = writeReport(outDir, report);
  if (textState !== null && textState !== undefined)
    writeFileSync(join(outDir, 'state.json'), `${JSON.stringify(textState, null, 2)}\n`);
  playtesting(options, 'end');
  return { report, reportPath, ffmpegMissing };
}
