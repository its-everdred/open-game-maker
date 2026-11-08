import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { tierSchema, viewIdSchema } from '@ogm/contracts';
import { z } from 'zod';

import { tierBudgetOverridesSchema } from './budgets.js';
import { FFMPEG_TIMEOUT_MS, MAX_CAPTURE_FRAMES } from './capture.js';
import { inputScriptSchema } from './inputs.js';
import { inside, publish } from './publish.js';
import {
  ALWAYS_UNCHECKED,
  GM_VERIFY_VERSION,
  unknownBudgets,
  verifyReportSchema,
  viewportSetSchema,
  writeReport,
  type VerifyReport,
} from './report.js';
import { RUN_TIMEOUT_MS, type RunVerifyOptions } from './run.js';
import { SLOT_WAIT_MS } from './semaphore.js';
import { serveStatic } from './server.js';

export const QUEUE_DIR = join('.gm', 'verify');
const RUN_ID = /^[A-Za-z0-9_-]{1,64}$/;
const CLAIM_GRACE_MS = 10_000;
const MAX_REQUEST_BYTES = 1_000_000;

const timelineSchema = z
  .strictObject({ from: z.number().min(0), to: z.number().min(0), step: z.number().positive() })
  .superRefine((timeline, context) => {
    const frames = Math.floor((timeline.to - timeline.from) / timeline.step) + 1;
    if (timeline.to < timeline.from || frames < 1 || frames > MAX_CAPTURE_FRAMES)
      context.addIssue({
        code: 'custom',
        message: `timeline must contain 1-${MAX_CAPTURE_FRAMES} frames with to >= from`,
      });
  });

/**
 * What a sandboxed `gm run` writes to `.gm/verify/<runId>/request.json`. Data only: the host never executes or reads
 * anything named here except `serveDir`, which must resolve inside the workspace (no URLs).
 */
export const verifyRequestSchema = z.strictObject({
  v: z.literal(1),
  runId: z.string().regex(RUN_ID),
  jobId: z.string().max(200).optional(),
  aiurIssue: z.number().int().positive().optional(),
  aiurRunId: z.string().min(1).max(200).optional(),
  serveDir: z.string().min(1),
  args: z.strictObject({
    viewport: viewportSetSchema,
    tier: tierSchema,
    rig: viewIdSchema.optional(),
    frames: z.array(z.number().min(0)).max(120).optional(),
    timeline: timelineSchema.optional(),
    record: z
      .strictObject({
        seconds: z.number().positive().max(60),
        fps: z.number().int().min(1).max(60).optional(),
        native: z.boolean().optional(),
      })
      .optional(),
    inputs: inputScriptSchema.max(10_000).optional(),
    budgets: tierBudgetOverridesSchema.optional(),
  }),
});
export type VerifyRequest = z.infer<typeof verifyRequestSchema>;

export function requestDir(workspace: string, runId: string): string {
  return join(workspace, QUEUE_DIR, runId);
}

/** Sandbox side: drop the request; the host runner writes `report.json` (and the shots) into the same directory. */
export function submitRequest(workspace: string, request: VerifyRequest): string {
  const parsed = verifyRequestSchema.parse(request);
  const dir = requestDir(workspace, parsed.runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'request.json.tmp'), `${JSON.stringify(parsed, null, 2)}\n`);
  renameSync(join(dir, 'request.json.tmp'), join(dir, 'request.json'));
  return dir;
}

export async function waitForReport(
  dir: string,
  options: { timeoutMs?: number; pollMs?: number } = {},
): Promise<VerifyReport> {
  /* the host may wait for a slot first, and one synchronous encode can outlast the run timer */
  const timeoutMs = options.timeoutMs ?? SLOT_WAIT_MS + RUN_TIMEOUT_MS + FFMPEG_TIMEOUT_MS + 60_000;
  const deadline = Date.now() + timeoutMs;
  const path = join(dir, 'report.json');
  for (;;) {
    if (existsSync(path)) return verifyReportSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    if (Date.now() >= deadline) throw new Error(`no report from the host runner after ${timeoutMs} ms (${path})`);
    await sleep(options.pollMs ?? 1_000);
  }
}

function errorReport(runId: string, error: string, request?: VerifyRequest): VerifyReport {
  const now = new Date().toISOString();
  return {
    runId,
    ...(request?.jobId ? { jobId: request.jobId } : {}),
    ...(request?.aiurIssue !== undefined ? { aiurIssue: request.aiurIssue } : {}),
    renderer: 'unknown',
    software: false,
    viewport: request?.args.viewport ?? 'phone',
    tier: request?.args.tier ?? 'mobile',
    frames: [],
    console: [],
    budgets: unknownBudgets(),
    probes: {},
    clients: 1,
    seats: [],
    unchecked: [...ALWAYS_UNCHECKED],
    verdict: 'error',
    error,
    startedAt: now,
    endedAt: now,
    gmVerifyVersion: GM_VERIFY_VERSION,
  };
}

export type Runner = (options: RunVerifyOptions) => Promise<{ report: VerifyReport }>;

export type ProcessOptions = {
  runner: Runner;
  software: boolean;
  slots?: RunVerifyOptions['slots'];
  timeoutMs?: number;
  eventsFile?: string;
};

/**
 * Host side, one request: validate, serve `serveDir` on loopback, capture into a host-private directory, then publish
 * the shots and `report.json` beside the request (see `publish`). Every refusal still publishes an error report so the
 * sandboxed caller stops polling; only a request directory that is not a real directory inside the workspace is left
 * unanswered (rejects), because there is nowhere safe to write.
 */
export async function processRequest(workspace: string, dir: string, options: ProcessOptions): Promise<VerifyReport> {
  const root = realpathSync(workspace);
  if (lstatSync(dir).isSymbolicLink() || !inside(root, realpathSync(dir)))
    throw new Error(`refusing ${dir}: not a real directory inside ${root}`);
  const staging = mkdtempSync(join(tmpdir(), 'ogm-verify-'));
  try {
    const report = await capture(root, dir, staging, options);
    publish(staging, dir, root);
    return report;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/** Reads only a regular file of bounded size: a planted FIFO, device or symlink must not hang or exhaust the host. */
function readRequestFile(path: string): string {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_REQUEST_BYTES)
      throw new Error(`request.json must be a regular file under ${MAX_REQUEST_BYTES} bytes`);
    const buffer = Buffer.alloc(stat.size);
    const read = readSync(fd, buffer, 0, stat.size, 0);
    return buffer.subarray(0, read).toString('utf8');
  } finally {
    closeSync(fd);
  }
}

async function capture(root: string, dir: string, staging: string, options: ProcessOptions): Promise<VerifyReport> {
  const runId = basename(dir);
  const fail = (message: string, request?: VerifyRequest): VerifyReport => {
    const report = errorReport(RUN_ID.test(runId) ? runId : 'invalid', message, request);
    writeReport(staging, report);
    return report;
  };
  const planted = readdirSync(dir).filter((name) => !['request.json', 'claim'].includes(name));
  if (planted.length > 0) return fail(`refusing ${dir}: it already holds files other than request.json`);
  let request: VerifyRequest;
  try {
    request = verifyRequestSchema.parse(JSON.parse(readRequestFile(join(dir, 'request.json'))));
  } catch (error) {
    return fail(`invalid request: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
  }
  if (request.runId !== runId) return fail('request runId does not match its directory', request);
  let serveDir: string;
  try {
    serveDir = realpathSync(resolve(root, request.serveDir));
  } catch {
    return fail(`serveDir ${request.serveDir} does not exist`, request);
  }
  if (!inside(root, serveDir) || !statSync(serveDir).isDirectory())
    return fail(`serveDir ${request.serveDir} is not a directory inside the workspace`, request);
  const server = await serveStatic(serveDir);
  try {
    const { report } = await options.runner({
      ...request.args,
      url: server.url,
      outDir: staging,
      runId,
      jobId: request.jobId,
      aiurIssue: request.aiurIssue,
      aiurRunId: request.aiurRunId,
      software: options.software,
      slots: options.slots,
      timeoutMs: options.timeoutMs ?? RUN_TIMEOUT_MS,
      eventsFile: options.eventsFile,
      source: 'gm run',
    });
    return report;
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error), request);
  } finally {
    await server.close();
  }
}

/** Every `<root>/<workspace>/.gm/verify/<runId>/` with a request and neither a report nor a claim. */
export function pendingRequests(root: string): { workspace: string; dir: string }[] {
  const found: { workspace: string; dir: string }[] = [];
  for (const name of readdirSync(root).sort()) {
    const workspace = join(root, name);
    const workspaceStat = lstatSync(workspace);
    if (workspaceStat.isSymbolicLink() || !workspaceStat.isDirectory()) continue;
    const queue = join(workspace, QUEUE_DIR);
    if (!existsSync(queue)) continue;
    const queueStat = lstatSync(queue);
    if (queueStat.isSymbolicLink() || !queueStat.isDirectory()) continue;
    for (const runId of readdirSync(queue).sort()) {
      const dir = join(queue, runId);
      const dirStat = lstatSync(dir);
      if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) continue;
      reapDeadClaim(dir);
      if (
        existsSync(join(dir, 'request.json')) &&
        !existsSync(join(dir, 'report.json')) &&
        !existsSync(join(dir, 'claim'))
      )
        found.push({ workspace, dir });
    }
  }
  return found;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function reapDeadClaim(dir: string): void {
  const path = join(dir, 'claim');
  let claimStat: ReturnType<typeof lstatSync>;
  try {
    claimStat = lstatSync(path);
  } catch {
    return;
  }
  if (claimStat.isSymbolicLink()) {
    rmSync(path, { force: true });
    return;
  }
  let pid = Number.NaN;
  try {
    pid = Number(readFileSync(join(path, 'pid'), 'utf8').trim());
  } catch {
    if (Date.now() - claimStat.mtimeMs < CLAIM_GRACE_MS) return;
  }
  if (Number.isSafeInteger(pid) && pid > 0 && pidAlive(pid)) return;
  rmSync(path, { recursive: true, force: true });
}

function claim(workspace: string, dir: string): boolean {
  const path = join(dir, 'claim');
  let created = false;
  try {
    const root = realpathSync(workspace);
    const dirStat = lstatSync(dir);
    if (dirStat.isSymbolicLink() || !dirStat.isDirectory() || !inside(root, realpathSync(dir))) return false;
    mkdirSync(path);
    created = true;
    writeFileSync(join(path, 'pid'), `${process.pid}\n`, { flag: 'wx' });
    return true;
  } catch {
    if (created && existsSync(path)) {
      try {
        const root = realpathSync(workspace);
        if (inside(root, realpathSync(path))) rmSync(path, { recursive: true, force: true });
      } catch {
        // A competing runner owns the claim, or the sandbox changed the request while it was being claimed.
      }
    }
    return false;
  }
}

/**
 * `gm verify serve`: polls `root` every `pollMs` and processes each new request (the semaphore keeps the host at two
 * captures). With `once`, processes what is pending and returns the reports.
 */
export async function serveQueue(
  root: string,
  options: ProcessOptions & { once?: boolean; pollMs?: number; signal?: AbortSignal; log?: (line: string) => void },
): Promise<VerifyReport[]> {
  const done: VerifyReport[] = [];
  const inflight = new Set<Promise<void>>();
  for (;;) {
    for (const { workspace, dir } of pendingRequests(root)) {
      if (!claim(workspace, dir)) continue;
      options.log?.(`run ${dir}`);
      const job = processRequest(workspace, dir, options).then(
        (report) => {
          done.push(report);
          options.log?.(`${report.verdict} ${dir}`);
        },
        (error: unknown) => {
          /* keep the claim: an unanswerable request is logged once, not retried every poll */
          options.log?.(error instanceof Error ? error.message : String(error));
        },
      );
      inflight.add(job);
      void job.finally(() => inflight.delete(job));
    }
    if (options.once || options.signal?.aborted) break;
    await sleep(options.pollMs ?? 2_000, undefined, { signal: options.signal }).catch(() => {});
    if (options.signal?.aborted) break;
  }
  await Promise.all(inflight);
  return done;
}
