import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import type { Browser } from 'playwright';

import { launch, openGame, type OpenedGame } from '../browser.js';
import { playtesting, type ActivityContext } from '../events.js';
import { toFrame, type InputScript } from '../inputs.js';
import {
  replay as replayBrowser,
  replayPromiseKey,
  type ReplayBundle,
  type ReplayOptions,
  type ReplayResult,
} from '../replay.js';
import { ALWAYS_UNCHECKED, GM_VERIFY_VERSION, unknownBudgets, writeReport, type VerifyReport } from '../report.js';
import { acquireSlot, type SemaphoreOptions } from '../semaphore.js';
import { isLoopbackUrl, serveStatic } from '../server.js';
import type { GateCheck, GateResult } from './index.js';
import { pngStddev } from './png-variance.js';
import { captureHud } from './hud-capture.js';
import { runPromiseProcess, type SpawnOptions, type SpawnResult } from './promise-process.js';
import { L1Watchdog, writeStallDiagnostic } from './l1-watchdog.js';

const STEP_MS = 1000 / 60;
const DEFAULT_TICKS = 3_600;
const DEFAULT_STDDEV = 8;
const READY_TIMEOUT_MS = 60_000;

export type RunL1Options = ActivityContext & {
  url?: string;
  serveDir?: string;
  outDir?: string;
  inputs?: InputScript;
  ticks?: number;
  software?: boolean;
  slots?: SemaphoreOptions;
  readyTimeoutMs?: number;
  minStddev?: number;
  /** Overall deadline in milliseconds. */
  deadlineMs?: number;
  progress?: (line: string) => void;
  onTimeout?: (reason: string) => void;
  /** Test seam for the no-progress timeout; defaults to 90 seconds. */
  stallTimeoutMs?: number;
};

function slash(path: string): string {
  return path.split(sep).join('/');
}

function promiseFiles(root: string): string[] {
  const dir = join(root, 'promises');
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  const walk = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile() && entry.name.endsWith('.spec.ts')) files.push(child);
    }
  };
  walk(dir);
  return files.sort();
}

type PromiseRunnerOptions = {
  replay?: (bundle: ReplayBundle, options: ReplayOptions) => Promise<ReplayResult>;
  spawn?: (command: string, args: string[], options: SpawnOptions) => SpawnResult | Promise<SpawnResult>;
  software?: boolean;
  wallClockMs?: number;
  deadlineAt?: number;
  signal?: AbortSignal;
};

type PromiseReplay = {
  seed: number;
  keyframe: { tick: number; state: unknown };
  actions: { tick: number; action: string; phase: 'down' | 'up' }[];
  expectedError?: string;
};

function replayFile(spec: string): string {
  return `${spec.slice(0, -'.spec.ts'.length)}.replay.json`;
}

export async function runPromiseSpecs(root: string, options: PromiseRunnerOptions = {}): Promise<GateCheck> {
  let files: string[];
  try {
    files = promiseFiles(root);
  } catch {
    return { id: 'promises', ok: false, detail: 'unavailable: promises directory' };
  }
  if (files.length === 0) return { id: 'promises', ok: true, detail: 'no promise specs' };
  const relativeFiles = files.map((file) => slash(relative(root, file)));
  const privateDir = mkdtempSync(join(tmpdir(), 'gm-promise-results-'));
  const results: Record<string, Pick<ReplayResult, 'class' | 'errorsSeen'>> = {};
  try {
    for (const file of files) {
      if (options.signal?.aborted) throw new Error('promise specs cancelled');
      const jsonPath = replayFile(file);
      if (!existsSync(jsonPath)) continue;
      let promise: PromiseReplay;
      try {
        promise = JSON.parse(readFileSync(jsonPath, 'utf8')) as PromiseReplay;
      } catch (error) {
        return {
          id: 'promises',
          ok: false,
          detail: `invalid replay JSON: ${error instanceof Error ? error.message : String(error)}`,
          file: slash(relative(root, jsonPath)),
        };
      }
      let result: ReplayResult;
      try {
        result = await (options.replay ?? replayBrowser)(
          { ...promise, errors: promise.expectedError ? [{ message: promise.expectedError }] : [], probes: {} },
          {
            serveDir: join(root, 'dist'),
            outDir: join(privateDir, replayPromiseKey(promise)),
            software: options.software,
            wallClockMs: options.wallClockMs,
          },
        );
      } catch (error) {
        return {
          id: 'promises',
          ok: false,
          detail: `replay failed: ${error instanceof Error ? error.message : String(error)}`,
          file: slash(relative(root, jsonPath)),
        };
      }
      results[replayPromiseKey(promise)] = { class: result.class, errorsSeen: result.errorsSeen };
    }

    if (options.signal?.aborted) throw new Error('promise specs cancelled');
    const setupPath = join(privateDir, 'setup.mjs');
    const configPath = join(privateDir, 'vitest.config.mjs');
    writeFileSync(setupPath, `globalThis.__GM_PROMISE_RESULTS__ = ${JSON.stringify(results)};\n`);
    writeFileSync(
      configPath,
      `export default { test: { root: ${JSON.stringify(root)}, setupFiles: [${JSON.stringify(setupPath)}], fileParallelism: false } };\n`,
    );
    const result = await (options.spawn ?? runPromiseProcess)(
      'pnpm',
      ['exec', 'vitest', 'run', '--config', configPath, ...relativeFiles],
      {
        cwd: root,
        encoding: 'utf8',
        signal: options.signal,
        timeout: Math.max(1, Math.min(5 * 60_000, options.deadlineAt ? options.deadlineAt - Date.now() : 5 * 60_000)),
      },
    );
    if (result.error)
      return {
        id: 'promises',
        ok: false,
        detail: `unavailable: ${result.error.message}`,
        file: relativeFiles[0],
      };
    if (result.status === 0) return { id: 'promises', ok: true, detail: `${files.length} promise spec(s)` };
    const detail = `${result.stdout}\n${result.stderr}`
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => /(?:FAIL|Error|failed)/i.test(line));
    return {
      id: 'promises',
      ok: false,
      detail: detail || `promise specs exited ${result.status ?? 1}`,
      file: relativeFiles[0],
    };
  } finally {
    rmSync(privateDir, { recursive: true, force: true });
  }
}

async function openWithRetry(
  browser: Browser,
  url: string,
  readyTimeoutMs: number | undefined,
): Promise<{ game: OpenedGame; retryError?: string }> {
  try {
    return {
      game: await openGame(browser, url, { viewport: 'phone', tier: 'mobile', readyTimeoutMs }),
    };
  } catch (error) {
    return {
      game: await openGame(browser, url, { viewport: 'phone', tier: 'mobile', readyTimeoutMs }),
      retryError: error instanceof Error ? error.message : String(error),
    };
  }
}

async function advance(
  game: OpenedGame,
  ticks: number,
  inputs: InputScript | undefined,
  watchdog: L1Watchdog,
  outDir: string,
): Promise<GateCheck> {
  const targetMs = ticks * STEP_MS;
  let elapsed = 0;
  let lastFrameAt = 0;
  const rememberFrame = async () => {
    try {
      await watchdog.wait(game.page.screenshot({ path: join(outDir, 'last-frame.png'), timeout: 1_000 }));
    } catch (error) {
      if (watchdog.controller.signal.aborted) throw error;
    }
    lastFrameAt = Date.now();
  };
  const advanceTo = async (target: number) => {
    while (elapsed < target) {
      const next = Math.min(target, elapsed + 60 * STEP_MS);
      await watchdog.wait(game.hooks.advanceTime(next - elapsed));
      elapsed = next;
      const state = await watchdog.wait(game.hooks.text());
      if (state) watchdog.progressed(state.tick);
      if (Date.now() - lastFrameAt >= 10_000) await rememberFrame();
    }
  };
  try {
    await rememberFrame();
    watchdog.startTicks();
    for (const step of [...(inputs ?? [])].sort((a, b) => a.t - b.t)) {
      const at = step.t * 1000;
      if (at > targetMs) return { id: 'ticks', ok: false, detail: `input at ${step.t}s exceeds ${ticks} ticks` };
      if (at > elapsed) await advanceTo(at);
      await watchdog.wait(game.hooks.inject(toFrame(step)));
    }
    if (targetMs > elapsed) await advanceTo(targetMs);
    const text = await watchdog.wait(game.hooks.text());
    if (!text) return { id: 'ticks', ok: false, detail: 'unavailable: __gm.renderGameToText' };
    if (text.tick !== ticks) return { id: 'ticks', ok: false, detail: `expected tick ${ticks}, got ${text.tick}` };
    return { id: 'ticks', ok: true, detail: `tick ${text.tick}` };
  } catch (error) {
    if (watchdog.controller.signal.aborted) throw error;
    return { id: 'ticks', ok: false, detail: error instanceof Error ? error.message : String(error) };
  } finally {
    watchdog.endTicks();
  }
}

async function roundTrip(game: OpenedGame): Promise<GateCheck> {
  const before = await game.hooks.text();
  if (!before) return { id: 'round-trip', ok: false, detail: 'unavailable: __gm.renderGameToText' };
  try {
    const restored = await game.page.evaluate((state) => {
      const gm = (window as unknown as { __gm?: { restore?: (save: unknown) => void } }).__gm;
      if (typeof gm?.restore !== 'function') return false;
      const saveSchemaVersion =
        typeof state === 'object' && state !== null && typeof Reflect.get(state, 'saveSchemaVersion') === 'number'
          ? (Reflect.get(state, 'saveSchemaVersion') as number)
          : 1;
      gm.restore({ saveSchemaVersion, data: state });
      return true;
    }, before.state);
    if (!restored) return { id: 'round-trip', ok: false, detail: 'unavailable: __gm.restore' };
    const after = await game.hooks.text();
    if (!after) return { id: 'round-trip', ok: false, detail: 'unavailable: __gm.renderGameToText' };
    return isDeepStrictEqual(after.state, before.state)
      ? { id: 'round-trip', ok: true }
      : { id: 'round-trip', ok: false, detail: 'renderGameToText state changed after restore' };
  } catch (error) {
    return { id: 'round-trip', ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

async function hudStill(game: OpenedGame, path: string, ticks: number, minStddev: number): Promise<GateCheck> {
  try {
    await game.hooks.renderAt(ticks * STEP_MS);
    const screenshot = await captureHud(game.page, path);
    const stddev = pngStddev(screenshot);
    const detail = `pixel stddev ${stddev.toFixed(2)} (minimum ${minStddev})`;
    return { id: 'hud-still', ok: stddev > minStddev, detail };
  } catch (error) {
    return { id: 'hud-still', ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

export async function runL1(root: string, options: RunL1Options = {}): Promise<GateResult> {
  const started = performance.now();
  const startedAt = new Date().toISOString();
  const ticks = options.ticks ?? DEFAULT_TICKS;
  if (!Number.isSafeInteger(ticks) || ticks < 1) {
    return {
      gate: 'L1',
      ok: false,
      durationMs: Math.round(performance.now() - started),
      checks: [{ id: 'ticks', ok: false, detail: 'ticks must be a positive whole number' }],
    };
  }
  const outDir = resolve(root, options.outDir ?? join('shots', 'test'));
  const checks: GateCheck[] = [];
  let server: Awaited<ReturnType<typeof serveStatic>> | undefined;
  let slot: Awaited<ReturnType<typeof acquireSlot>> | undefined;
  let browser: Browser | undefined;
  let game: OpenedGame | undefined;
  let reportPath: string | undefined;
  let hardError: string | undefined;

  mkdirSync(outDir, { recursive: true });
  playtesting({ ...options, source: options.source ?? 'gm test' }, 'start');
  const watchdog = new L1Watchdog(
    ticks,
    options.deadlineMs ?? Math.min(1_200_000, 120_000 + (ticks / 30) * 1_000),
    options.progress,
    options.onTimeout,
    options.stallTimeoutMs,
  );
  try {
    let url = options.url;
    if (url && !isLoopbackUrl(url)) throw new Error('unavailable: URL is not loopback');
    if (!url) {
      server = await watchdog.wait(serveStatic(resolve(root, options.serveDir ?? 'dist')), (late) => {
        void late.close();
      });
      url = server.url;
    }
    watchdog.setStage('waiting for slot');
    slot = await watchdog.wait(acquireSlot({ ...options.slots, signal: watchdog.controller.signal }), (late) =>
      late.release(),
    );
    watchdog.setStage('slot acquired');
    options.progress?.(`tick 0/${ticks} (slot acquired)`);
    browser = await watchdog.wait(launch(options.software ?? false, true), (late) => {
      void late.close();
    });
    const opened = await watchdog.wait(
      openWithRetry(browser, url, options.readyTimeoutMs ?? READY_TIMEOUT_MS),
      (late) => {
        void late.game.close();
      },
    );
    game = opened.game;
    const bootErrors = game.console.list().filter((entry) => entry.level === 'error');
    checks.push(
      bootErrors.length === 0
        ? {
            id: 'boot',
            ok: true,
            ...(opened.retryError ? { detail: `passed after one retry: ${opened.retryError}` } : {}),
          }
        : { id: 'boot', ok: false, detail: `console error: ${bootErrors[0]!.text}` },
    );
    checks.push(await advance(game, ticks, options.inputs, watchdog, outDir));
    watchdog.setStage('round trip');
    checks.push(await watchdog.wait(roundTrip(game)));
    watchdog.setStage('HUD screenshot');
    checks.push(
      await watchdog.wait(hudStill(game, join(outDir, 'hud.png'), ticks, options.minStddev ?? DEFAULT_STDDEV)),
    );
    const smokeError = game.console.list().find((entry) => entry.level === 'error');
    if (smokeError && bootErrors.length === 0) {
      const ticksCheck = checks.find((check) => check.id === 'ticks');
      if (ticksCheck) {
        ticksCheck.ok = false;
        ticksCheck.detail = `console error: ${smokeError.text}`;
      }
    }
  } catch (error) {
    hardError = error instanceof Error ? error.message : String(error);
    if (hardError.startsWith('stalled at tick')) await writeStallDiagnostic(outDir, game, hardError).catch(() => {});
    checks.push({ id: 'boot', ok: false, detail: hardError });
    for (const id of ['ticks', 'round-trip', 'hud-still'] as const)
      checks.push({ id, ok: false, detail: 'unavailable: boot failed' });
  } finally {
    if (hardError) slot?.release();
    let probes: Record<string, number | string | boolean> = {};
    if (game && !hardError) {
      try {
        probes = await watchdog.wait(game.hooks.probes());
      } catch (error) {
        if (watchdog.controller.signal.aborted) {
          hardError = error instanceof Error ? error.message : String(error);
          checks.push({ id: 'boot', ok: false, detail: hardError });
          await writeStallDiagnostic(outDir, game, hardError).catch(() => {});
        }
      }
    }
    const consoleEntries = game?.console.list() ?? [];
    const renderer = game?.renderer ?? 'unknown';
    const usedSoftware = game?.software ?? options.software ?? false;
    // Normal cleanup may use the remaining deadline; failed runs release promptly.
    const cleanup = Promise.allSettled([game?.close(), browser?.close(), server?.close()]);
    if (hardError) {
      await Promise.race([cleanup, new Promise<void>((resolve) => setTimeout(resolve, 1_000))]);
    } else {
      watchdog.setStage('browser cleanup');
      try {
        await watchdog.wait(cleanup);
      } catch (error) {
        hardError = error instanceof Error ? error.message : String(error);
        checks.push({ id: 'boot', ok: false, detail: hardError });
        await writeStallDiagnostic(outDir, game, hardError).catch(() => {});
      }
    }
    slot?.release();

    if (!hardError) {
      watchdog.setStage('promise specs');
      try {
        checks.push(
          await watchdog.wait(
            runPromiseSpecs(root, {
              software: options.software,
              wallClockMs: Math.max(1, watchdog.endAt - Date.now()),
              deadlineAt: watchdog.endAt,
              signal: watchdog.controller.signal,
            }),
          ),
        );
      } catch (error) {
        hardError = error instanceof Error ? error.message : String(error);
        checks.push({ id: 'promises', ok: false, detail: hardError });
        await writeStallDiagnostic(outDir, game, hardError).catch(() => {});
      }
    }
    watchdog.close();
    if (browser) {
      const ok = checks.every((check) => check.ok);
      const report: VerifyReport = {
        runId: `test-${Date.now().toString(36)}`,
        ...(options.jobId ? { jobId: options.jobId } : {}),
        ...(options.aiurIssue !== undefined ? { aiurIssue: options.aiurIssue } : {}),
        renderer,
        software: usedSoftware,
        viewport: 'phone',
        tier: 'mobile',
        frames: existsSync(join(outDir, 'hud.png')) ? [{ t: ticks / 60, path: 'hud.png', viewport: 'phone' }] : [],
        console: consoleEntries,
        budgets: unknownBudgets(),
        probes,
        clients: 1,
        seats: [],
        unchecked: [...ALWAYS_UNCHECKED, 'text contrast'],
        verdict: hardError ? 'error' : ok ? 'pass' : 'fail',
        ...(hardError ? { error: hardError } : {}),
        startedAt,
        endedAt: new Date().toISOString(),
        gmVerifyVersion: GM_VERIFY_VERSION,
      };
      reportPath = writeReport(outDir, report);
    }
    playtesting({ ...options, source: options.source ?? 'gm test' }, 'end');
  }

  return {
    gate: 'L1',
    ok: checks.every((check) => check.ok),
    durationMs: Math.round(performance.now() - started),
    checks,
    ...(reportPath ? { report: reportPath } : {}),
  };
}
