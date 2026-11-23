import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { ReplayResult as ReplayResultValue } from '@ogm/contracts';
import { z } from 'zod';

import { launch, openGame, type OpenedGame } from './browser.js';
import { serveStatic } from './server.js';

const STEP_MS = 1000 / 60;
const SETTLE_MS = 2_000;
const DEFAULT_WALL_CLOCK_MS = 10 * 60_000;

const replayActionSchema = z.strictObject({
  tick: z.number().int().min(0),
  action: z.string().min(1).max(64),
  phase: z.enum(['down', 'up']),
});

const replayKeyframeSchema = z.strictObject({
  tick: z.number().int().min(0),
  state: z.unknown(),
});

const replayBundleSchema = z.looseObject({
  seed: z.number().int(),
  keyframe: replayKeyframeSchema.optional(),
  actions: z.array(replayActionSchema).max(10_000),
  errors: z.array(z.union([z.string().max(16_384), z.looseObject({ message: z.string().max(16_384) })])).max(1_000),
  probes: z.record(z.string().max(128), z.union([z.number(), z.string(), z.boolean()])).default({}),
});

export type ReplayAction = z.infer<typeof replayActionSchema>;
export type ReplayKeyframe = z.infer<typeof replayKeyframeSchema>;
export type ReplayBundle = z.input<typeof replayBundleSchema>;
export type ReplayReason = 'no_actions' | 'no_keyframe' | 'state_mismatch' | 'timeout';
export type ReplayClass = 'reproduces_with_error' | 'reproduces_no_error' | 'not_reproducible';
export type ReplayResult = ReplayResultValue;

export type ReplayOptions = {
  serveDir: string;
  wallClockMs?: number;
  outDir?: string;
  software?: boolean;
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function replayPromiseKey(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function expectedErrors(bundle: z.output<typeof replayBundleSchema>): string[] {
  return bundle.errors.map((error) => (typeof error === 'string' ? error : error.message));
}

function normalizedError(value: string): string {
  return value
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/\b(?:line|column)\s+\d+\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchesExpected(seen: string[], expected: string[]): boolean {
  const normalizedSeen = seen.map(normalizedError);
  return expected.some((value) => {
    const wanted = normalizedError(value);
    return normalizedSeen.some((actual) => actual.includes(wanted) || wanted.includes(actual));
  });
}

function probesMatch(
  actual: Record<string, number | string | boolean>,
  expected: Record<string, number | string | boolean>,
): boolean {
  return Object.entries(expected).every(([key, wanted]) => {
    const seen = actual[key];
    if (typeof wanted !== 'number') return seen === wanted;
    if (typeof seen !== 'number') return false;
    const tolerance = Math.max(Math.abs(wanted) * 0.05, Number.EPSILON);
    return Math.abs(seen - wanted) <= tolerance;
  });
}

function writeReplayScript(bundle: z.output<typeof replayBundleSchema>, directory: string): string {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, 'replay.json');
  const [expectedError] = expectedErrors(bundle);
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        seed: bundle.seed,
        keyframe: bundle.keyframe,
        actions: bundle.actions,
        ...(expectedError ? { expectedError } : {}),
      },
      null,
      2,
    )}\n`,
  );
  return path;
}

async function runActions(game: OpenedGame, bundle: z.output<typeof replayBundleSchema>): Promise<string[]> {
  const errors: string[] = [];
  await game.hooks.setSeed(bundle.seed);
  await game.hooks.restore(bundle.keyframe!.state);
  let tick = bundle.keyframe!.tick;
  for (const action of [...bundle.actions].sort((left, right) => left.tick - right.tick)) {
    if (action.tick > tick) {
      try {
        await game.hooks.advanceTime((action.tick - tick) * STEP_MS);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    tick = Math.max(tick, action.tick);
    try {
      await game.hooks.inject({
        playerIndex: 0,
        tick: action.tick,
        source: 'network',
        actions: { [action.action]: action.phase !== 'up' },
      });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  try {
    await game.hooks.advanceTime(SETTLE_MS);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return errors;
}

async function withDeadline<T>(operation: Promise<T>, wallClockMs: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolveTimeout) => {
    timer = setTimeout(() => resolveTimeout(undefined), wallClockMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Without `outDir` the script lands in a temp dir that is removed before returning, so `scriptPath` no longer exists. */
export async function replay(input: ReplayBundle, options: ReplayOptions): Promise<ReplayResult> {
  const tempDir = options.outDir ? undefined : mkdtempSync(join(tmpdir(), 'gm-replay-'));
  try {
    return await replayIn(input, options, tempDir ?? resolve(options.outDir!));
  } finally {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  }
}

async function replayIn(input: ReplayBundle, options: ReplayOptions, directory: string): Promise<ReplayResult> {
  const startedAt = Date.now();
  const parsed = replayBundleSchema.parse(input);
  const scriptPath = writeReplayScript(parsed, directory);
  const finish = (value: Omit<ReplayResult, 'durationMs'>): ReplayResult => ({
    ...value,
    durationMs: Math.max(0, Date.now() - startedAt),
  });
  if (parsed.actions.length === 0)
    return finish({
      class: 'not_reproducible',
      reason: 'no_actions',
      errorsSeen: [],
      finalState: null,
      finalProbes: {},
      scriptPath,
    });
  if (!parsed.keyframe)
    return finish({
      class: 'not_reproducible',
      reason: 'no_keyframe',
      errorsSeen: [],
      finalState: null,
      finalProbes: {},
      scriptPath,
    });

  const server = await serveStatic(resolve(options.serveDir), { game: true });
  let browser: Awaited<ReturnType<typeof launch>> | undefined;
  let game: OpenedGame | undefined;
  try {
    const target = new URL(server.url);
    target.searchParams.set('seed', String(parsed.seed));
    const operation = (async () => {
      browser = await launch(options.software ?? false);
      game = await openGame(browser, target.href, { viewport: 'phone', tier: 'mobile' });
      const injectedErrors = await runActions(game, parsed);
      const errorsSeen = [
        ...game.console
          .list()
          .filter((entry) => entry.level === 'error')
          .map((entry) => entry.text),
        ...injectedErrors,
      ];
      const [text, finalProbes] = await Promise.all([
        game.hooks.text().catch(() => null),
        game.hooks.probes().catch(() => ({})),
      ]);
      const finalState = text?.state ?? null;
      if (matchesExpected(errorsSeen, expectedErrors(parsed))) {
        return finish({ class: 'reproduces_with_error', errorsSeen, finalState, finalProbes, scriptPath });
      }
      return probesMatch(finalProbes, parsed.probes)
        ? finish({ class: 'not_reproducible', errorsSeen, finalState, finalProbes, scriptPath })
        : finish({
            class: 'reproduces_no_error',
            reason: 'state_mismatch',
            errorsSeen,
            finalState,
            finalProbes,
            scriptPath,
          });
    })();
    operation.catch(() => undefined);
    void operation
      .finally(async () => {
        await game?.close().catch(() => undefined);
        await browser?.close().catch(() => undefined);
      })
      .catch(() => undefined);
    const completed = await withDeadline(operation, options.wallClockMs ?? DEFAULT_WALL_CLOCK_MS);
    return (
      completed ??
      ({
        class: 'not_reproducible',
        reason: 'timeout',
        errorsSeen: [],
        finalState: null,
        finalProbes: {},
        scriptPath,
        durationMs: Math.max(0, Date.now() - startedAt),
      } satisfies ReplayResult)
    );
  } finally {
    await game?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}
