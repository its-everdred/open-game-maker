import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { homedir, setPriority } from 'node:os';
import { join, relative, resolve } from 'node:path';

import type { Tier, ViewId } from '@ogm/contracts';
import type { InputScript, VerifyReport } from '@ogm/gm-verify';
import { isLoopbackUrl } from '@ogm/gm-verify/server';

import { EXIT, UsageError, type GmCommand, type GmContext } from '../../command.js';
import { printJson } from '../../context.js';
import { captureOutputPaths, prepareVerifiedSource, recordRunProvenance } from '../../look/run-provenance.js';
import { gameDir } from '../../outbox.js';
import { readEnvFile } from '../publish/index.js';

const VIEWPORTS = [
  'touch',
  'all',
  'desktop',
  'phone',
  'phone-landscape',
  'tablet',
  'tablet-landscape',
  'both',
] as const;
const FRAMES = ['host', 'app', 'bare'] as const;
const SIGNIN_HINT = 'on the host: ops/bin/ogm-qa-signin (or gm run without --frame app)';
const TIERS = ['mobile', 'desktop', 'low'] as const;
const RIGS = ['iso', 'topdown', 'side', 'follow', 'fps', 'orbit', 'fixed'] as const;
const FFMPEG_HINT = 'sudo apt install ffmpeg';

function oneOf<T extends string>(name: string, value: unknown, choices: readonly T[]): T {
  if (typeof value === 'string' && choices.includes(value as T)) return value as T;
  throw new UsageError(`--${name} must be ${choices.join(', ')}`, `gm run --${name} ${choices[0]}`);
}

export function parseFrames(value: unknown): number[] | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0)
    throw new UsageError('--frames needs comma-separated seconds', 'gm run --frames 0,2,5');
  const parts = value.split(',');
  const frames = parts.map(Number);
  if (
    frames.length > 120 ||
    parts.some((part) => part.trim() === '') ||
    frames.some((frame) => !Number.isFinite(frame) || frame < 0)
  )
    throw new UsageError('--frames needs up to 120 non-negative seconds', 'gm run --frames 0,2,5');
  return frames;
}

export function parseTimeline(value: unknown): { from: number; to: number; step: number } | undefined {
  if (value === undefined) return undefined;
  const raw = typeof value === 'string' ? value.split(':') : [];
  const parts = raw.map(Number);
  if (
    parts.length !== 3 ||
    raw.some((part) => part.trim() === '') ||
    parts.some((part) => !Number.isFinite(part)) ||
    parts[0] < 0 ||
    parts[1] < parts[0] ||
    parts[2] <= 0 ||
    Math.floor((parts[1] - parts[0]) / parts[2]) + 1 > 120
  )
    throw new UsageError('--timeline needs from:to:step (up to 120 frames)', 'gm run --timeline 0:10:0.5');
  return { from: parts[0], to: parts[1], step: parts[2] };
}

export function parseRecord(
  value: unknown,
  fpsValue: unknown,
  native: boolean,
): { seconds: number; fps?: number; native?: boolean } | undefined {
  if (value === undefined) {
    if (fpsValue !== undefined) throw new UsageError('--record-fps requires --record', 'gm run --record 4s');
    if (native) throw new UsageError('--record-native requires --record', 'gm run --record 4s');
    return undefined;
  }
  const match = typeof value === 'string' ? /^(\d+(?:\.\d+)?)s?$/.exec(value) : null;
  const seconds = match ? Number(match[1]) : Number.NaN;
  if (!(seconds > 0 && seconds <= 60))
    throw new UsageError('--record needs a duration from 0 to 60 seconds', 'gm run --record 10s');
  if (
    fpsValue !== undefined &&
    (typeof fpsValue !== 'number' || !Number.isInteger(fpsValue) || fpsValue < 1 || fpsValue > 60)
  )
    throw new UsageError('--record-fps must be an integer from 1 to 60', 'gm run --record 4s --record-fps 60');
  return { seconds, ...(fpsValue === undefined ? {} : { fps: fpsValue }), ...(native ? { native: true } : {}) };
}

function loadInputs(
  ctx: GmContext,
  value: unknown,
  readInputScript: (path: string) => InputScript,
): InputScript | undefined {
  if (value === undefined) return undefined;
  try {
    return readInputScript(resolve(ctx.cwd, value as string));
  } catch (error) {
    const cause = error instanceof Error ? error.message.split('\n')[0] : String(error);
    throw new UsageError(`--inputs could not be read: ${cause}`, 'gm run --inputs script.json');
  }
}

/** A string field of the game's gm.manifest.json, when there is one. */
function manifestField(ctx: GmContext, field: 'id' | 'title'): string | undefined {
  try {
    const value = (
      JSON.parse(readFileSync(join(gameDir(ctx.cwd), 'gm.manifest.json'), 'utf8')) as Record<string, unknown>
    )[field];
    return typeof value === 'string' && value !== '' ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The signed-in app shell to capture in: `--app`, else `/play/<manifest id>` on OGM_APP_ORIGIN (the environment, then
 * the host's api.env), with the QA account's storage state (`--storage`, OGM_QA_STORAGE, ~/.config/ogm/qa/storage.json).
 */
export function appFrame(ctx: GmContext, flags: Record<string, unknown>): { url: string; storageState: string } {
  const home = ctx.home ?? homedir();
  let url = typeof flags.app === 'string' ? flags.app : undefined;
  if (url === undefined) {
    const envDir = ctx.env?.OGM_ENV_DIR || join(home, '.config', 'ogm', 'env');
    const origin = ctx.env?.OGM_APP_ORIGIN || readEnvFile(join(envDir, 'api.env')).OGM_APP_ORIGIN;
    if (!origin)
      throw new UsageError('no app origin to capture the app shell from', 'gm run --app https://<app>/play/<slug>');
    const id = manifestField(ctx, 'id');
    if (id === undefined)
      throw new UsageError(
        'no gm.manifest.json id to open /play/<slug> with',
        'gm run --app https://<app>/play/<slug>',
      );
    url = `${origin.replace(/\/+$/, '')}/play/${encodeURIComponent(id)}`;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UsageError(`--app ${url} is not a URL`, 'gm run --app https://<app>/play/<slug>');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
    throw new UsageError('--app must be an http(s) URL', 'gm run --app https://<app>/play/<slug>');
  const storage = resolve(
    ctx.cwd,
    typeof flags.storage === 'string'
      ? flags.storage
      : ctx.env?.OGM_QA_STORAGE || join(home, '.config', 'ogm', 'qa', 'storage.json'),
  );
  if (!existsSync(storage)) throw new UsageError(`no signed-in storage state at ${storage}`, SIGNIN_HINT);
  return { url: parsed.href, storageState: storage };
}

export function loadBudgetOverrides<T>(
  ctx: GmContext,
  value: unknown,
  read: (path: string) => T,
  commandName: 'run' | 'perf',
): T | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    return read(resolve(ctx.cwd, value));
  } catch (error) {
    const cause = error instanceof Error ? error.message.split('\n')[0] : String(error);
    throw new UsageError(`--budgets could not be read: ${cause}`, `gm ${commandName} --budgets budgets.json`);
  }
}

export function niceCapture(): void {
  try {
    setPriority(10);
  } catch {
    // Best effort: an unprivileged runner can always lower, but capture correctness does not depend on niceness.
  }
}

export function finish(ctx: GmContext, report: VerifyReport, reportPath: string, ffmpegMissing = false): number {
  if (ffmpegMissing || report.error?.includes('ffmpeg not found on PATH'))
    throw new UsageError(report.error ?? 'ffmpeg is unavailable', FFMPEG_HINT);
  const shownPath = relative(ctx.cwd, reportPath) || reportPath;
  if (ctx.json) printJson(ctx, { reportPath: shownPath, ...report });
  else ctx.out(`${shownPath}  ${report.verdict}  ${report.renderer}`);
  if (report.verdict === 'error') {
    if (!ctx.json && report.error) ctx.err(report.error);
    return EXIT.failed;
  }
  return report.verdict === 'pass' ? EXIT.ok : EXIT.failed;
}

export const command: GmCommand = {
  name: 'run',
  summary: 'capture deterministic stills, a timeline, a clip and report.json',
  usage: '[--frame app|bare] [--app play-url] [--url loopback] [--viewport touch|all|<one>] [capture flags]',
  example: 'run --frames 0,2,5 --record 10s --out shots/',
  flags: {
    headless: { type: 'boolean', default: true, help: 'run Chromium without a display server' },
    'verify-source': { type: 'boolean', help: 'build the committed game before a capture for visual scope' },
    url: { type: 'string', help: 'loopback game URL; otherwise serve ./dist' },
    frame: {
      type: 'string',
      default: 'host',
      help: 'host: the game in the host frame (top bar, Pause, touch overlay); app: the signed-in app; bare: the game alone',
    },
    app: { type: 'string', help: 'app play URL (default OGM_APP_ORIGIN/play/<gm.manifest.json id>)' },
    storage: { type: 'string', help: 'signed-in storage state (default ~/.config/ogm/qa/storage.json)' },
    viewport: {
      type: 'string',
      default: 'touch',
      help: 'touch (390x844, 844x390, 820x1180, 1180x820 with touch), all (those and desktop), or one of them',
    },
    tier: { type: 'string', default: 'mobile', help: 'mobile, desktop or low asset tier' },
    inputs: { type: 'string', help: 'logical input script JSON' },
    frames: { type: 'string', help: 'comma-separated capture times in seconds' },
    timeline: { type: 'string', help: 'from:to:step seconds tiled into one PNG' },
    record: { type: 'string', help: 'H.264 clip duration, for example 10s' },
    'record-fps': { type: 'number', help: 'clip frame rate from 1 to 60 (default 30)' },
    'record-native': {
      type: 'boolean',
      default: false,
      help: 'record the game canvas at its pixel size (default 960 px page clip)',
    },
    rig: { type: 'string', help: 'camera rig id' },
    out: { type: 'string', default: 'shots', help: 'direct-run output directory' },
    budgets: { type: 'string', help: 'calibration budget overrides JSON' },
  },
  async run(ctx, args, flags) {
    if (args.length > 0) throw new UsageError(`unexpected argument ${args[0]}`, 'gm help run');
    const viewport = oneOf('viewport', flags.viewport, VIEWPORTS);
    const tier = oneOf('tier', flags.tier, TIERS) as Tier;
    const rig = flags.rig === undefined ? undefined : (oneOf('rig', flags.rig, RIGS) as ViewId);
    const frames = parseFrames(flags.frames);
    const timeline = parseTimeline(flags.timeline);
    const record = parseRecord(flags.record, flags['record-fps'], flags['record-native'] === true);
    const url = typeof flags.url === 'string' ? flags.url : undefined;
    const frame = oneOf('frame', flags.frame, FRAMES);

    if (url && !isLoopbackUrl(url))
      throw new UsageError('--url is loopback only', 'gm run --url http://127.0.0.1:8000/');
    let source: string | undefined;
    if (flags['verify-source']) {
      if (url || frame === 'app')
        throw new UsageError(
          'source verification requires the local game build',
          'omit --url and use --frame host or bare',
        );
      const out = resolve(ctx.cwd, flags.out as string);
      const game = gameDir(ctx.cwd);
      const outputPath = relative(game, out).split('\\').join('/');
      if (
        !outputPath ||
        outputPath === '..' ||
        outputPath.startsWith('../') ||
        /^(?:src|public|assets|design|node_modules|dist)(?:\/|$)/i.test(outputPath)
      )
        throw new UsageError('source-verified output must be outside build input directories', 'use --out shots');
      let outputPart = game;
      for (const part of outputPath.split('/')) {
        outputPart = join(outputPart, part);
        let isLink = false;
        try {
          isLink = lstatSync(outputPart).isSymbolicLink();
        } catch {
          /* A new output directory has no entry yet. */
        }
        if (isLink) throw new UsageError('source-verified output cannot traverse a symlink', 'use --out shots');
      }
      source = prepareVerifiedSource(
        ctx.cwd,
        () => execFileSync('pnpm', ['run', 'build'], { cwd: ctx.cwd, stdio: 'ignore' }),
        captureOutputPaths(ctx.cwd, out),
      );
    }
    const verify = await import('@ogm/gm-verify');
    const inputs = loadInputs(ctx, flags.inputs, verify.readInputScript);
    const budgets = loadBudgetOverrides(ctx, flags.budgets, verify.readBudgetOverrides, 'run');

    if (ctx.config.verifyQueue) {
      if (url) throw new UsageError('queue mode serves ./dist and does not accept --url', 'omit --url');
      if (frame === 'app') throw new UsageError('queue mode cannot sign in to the app', 'gm run --frame host');
      const runId = verify.newRunId();
      const dir = verify.submitRequest(ctx.cwd, {
        v: 1,
        runId,
        ...(ctx.config.jobId ? { jobId: ctx.config.jobId } : {}),
        ...(ctx.config.aiurIssue !== undefined ? { aiurIssue: ctx.config.aiurIssue } : {}),
        ...(ctx.config.aiurRunId ? { aiurRunId: ctx.config.aiurRunId } : {}),
        serveDir: 'dist',
        args: {
          viewport,
          frame,
          tier,
          ...(rig ? { rig } : {}),
          ...(frames ? { frames } : {}),
          ...(timeline ? { timeline } : {}),
          ...(record ? { record } : {}),
          ...(inputs ? { inputs } : {}),
          ...(budgets ? { budgets } : {}),
        },
      });
      try {
        const report = await verify.waitForReport(dir);
        const reportPath = resolve(dir, 'report.json');
        recordRunProvenance(
          ctx.cwd,
          reportPath,
          report.frames,
          source,
          [report.timeline, report.clip].filter((path): path is string => path !== undefined),
        );
        return finish(ctx, report, reportPath);
      } catch (error) {
        ctx.err(error instanceof Error ? error.message : String(error));
        return EXIT.failed;
      }
    }

    const app = frame === 'app' ? appFrame(ctx, flags) : undefined;
    niceCapture();
    let server: Awaited<ReturnType<typeof verify.serveStatic>> | undefined;
    let target = url;
    if (!target) {
      try {
        server = await verify.serveStatic(resolve(ctx.cwd, 'dist'));
        target = server.url;
      } catch {
        throw new UsageError('no built game in ./dist', 'build the game or pass --url http://127.0.0.1:PORT/');
      }
    }
    try {
      const result = await verify.runVerify({
        url: target,
        outDir: resolve(ctx.cwd, flags.out as string),
        viewport,
        frame,
        ...(app ? { app } : {}),
        title: manifestField(ctx, 'title') ?? '',
        tier,
        ...(rig ? { rig } : {}),
        ...(frames ? { frames } : {}),
        ...(timeline ? { timeline } : {}),
        ...(record ? { record } : {}),
        ...(inputs ? { inputs } : {}),
        ...(budgets ? { budgets } : {}),
        software: ctx.config.verifySoftwareGl,
        eventsFile: ctx.config.eventsFile,
        jobId: ctx.config.jobId,
        aiurIssue: ctx.config.aiurIssue,
        aiurRunId: ctx.config.aiurRunId,
        source: 'gm run',
        slots: { runtimeDir: ctx.config.runtimeDir },
        warn: ctx.err,
      });
      recordRunProvenance(
        ctx.cwd,
        result.reportPath,
        result.report.frames,
        source,
        [result.report.timeline, result.report.clip].filter((path): path is string => path !== undefined),
      );
      return finish(ctx, result.report, result.reportPath, result.ffmpegMissing);
    } finally {
      await server?.close();
    }
  },
};
