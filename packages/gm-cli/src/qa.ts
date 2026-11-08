import { resolve } from 'node:path';

import type { Journey } from '@ogm/gm-verify';
import { z } from 'zod';

import { UsageError, type FlagSpec, type GmContext } from './command.js';
import { readLedger } from './ledger/index.js';
import { gameDir, workspaceRoot } from './outbox.js';
import { niceCapture } from './commands/run/index.js';

type Browser = Awaited<ReturnType<(typeof import('@ogm/gm-verify'))['launch']>>;

/** Where every `gm qa` command reads and writes one run, so `gm qa look` finds what open, drive and room left. */
export const QA_OUT = 'shots/qa';

export const outFlag: FlagSpec = {
  out: { type: 'string', default: QA_OUT, help: 'run directory (shared by every gm qa command)' },
};
export const urlFlag: FlagSpec = {
  url: { type: 'string', help: 'the build to test, e.g. https://<games-host>:10000/g/<game>/<build>/' },
};

/** The build URL: http or https, nothing else (a `file:` or `javascript:` URL is not a hosted build). */
export function buildUrl(flags: Record<string, unknown>, command: string): string {
  const value = flags.url;
  if (typeof value !== 'string' || value === '')
    throw new UsageError('--url is required', `gm qa ${command} --url https://<games-host>:10000/g/<game>/<build>/`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UsageError(
      `--url ${value} is not a URL`,
      `gm qa ${command} --url https://<games-host>:10000/g/<game>/<build>/`,
    );
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new UsageError(
      '--url must be http or https',
      `gm qa ${command} --url https://<games-host>:10000/g/<game>/<build>/`,
    );
  return url.href;
}

export function outDir(ctx: GmContext, flags: Record<string, unknown>): string {
  return resolve(ctx.cwd, typeof flags.out === 'string' ? flags.out : QA_OUT);
}

export async function readJourneyFlag(
  ctx: GmContext,
  flags: Record<string, unknown>,
  command: string,
): Promise<Journey> {
  if (typeof flags.journey !== 'string')
    throw new UsageError('--journey is required', `gm qa ${command} --journey games/<name>/qa/journeys/<j>.json`);
  const { readJourney } = await import('@ogm/gm-verify');
  const path = resolve(ctx.cwd, flags.journey);
  try {
    return readJourney(path);
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? z.prettifyError(error).replace(/\s*\n\s*/g, ' ')
        : String(error instanceof Error ? error.message : error);
    throw new UsageError(`cannot read journey ${flags.journey}: ${message}`, 'gm help qa drive');
  }
}

/** One capture slot and one browser for the command, both released however it ends. */
export async function withBrowser<T>(ctx: GmContext, run: (browser: Browser) => Promise<T>): Promise<T> {
  const verify = await import('@ogm/gm-verify');
  niceCapture();
  const slot = await verify.acquireSlot({ runtimeDir: ctx.config.runtimeDir });
  let browser: Browser | undefined;
  try {
    browser = await verify.launch(ctx.config.verifySoftwareGl);
    return await run(browser);
  } finally {
    await browser?.close();
    slot.release();
  }
}

/** The creator's rules from the game's feedback ledger; none when the command runs outside a game workspace. */
export function ledgerRules(ctx: GmContext): string[] {
  let dir: string;
  try {
    dir = gameDir(ctx.cwd, workspaceRoot(ctx.cwd));
  } catch {
    return [];
  }
  return readLedger(dir).entries.map((entry) => entry.rule);
}
