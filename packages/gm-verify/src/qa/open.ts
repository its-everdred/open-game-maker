import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Browser, Page } from 'playwright';

import { VIEWPORTS, isSoftware, rendererString } from '../browser.js';
import { ConsoleCollector } from '../console.js';
import type { ConsoleEntry, ViewportName } from '../report.js';
import { frame, isBlank, pixelStats } from './pixels.js';

export const OPEN_TIMEOUT_MS = 30_000;
const POLL_MS = 250;

export type OpenViewport = {
  viewport: ViewportName;
  renderer: string;
  software: boolean;
  /** The page set `window.__gm.ready` (or `__ready`); otherwise interactive means the first non-blank frame. */
  readyHook: boolean;
  /** From navigation start to ready or the first non-blank frame; null when neither came before the timeout. */
  ttiMs: number | null;
  blank: boolean;
  still: string;
  console: ConsoleEntry[];
  failures: string[];
};

export type QaOpenResult = { url: string; verdict: 'pass' | 'fail'; viewports: OpenViewport[] };

/** Collects page errors and console errors/warnings from a page into a collector. */
export function watchConsole(page: Page, collector: ConsoleCollector): void {
  page.on('pageerror', (error) => collector.add('error', error.message));
  page.on('console', (message) => {
    const type = message.type();
    if (type === 'error') collector.add('error', message.text());
    else if (type === 'warning') collector.add('warning', message.text());
  });
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function hasConsoleError(entries: readonly ConsoleEntry[]): boolean {
  return entries.some((e) => e.level === 'error');
}

/** Opens the build; returns why it failed (a navigation error, or the server's non-2xx answer such as a 502), else null. */
export async function gotoBuild(
  page: Page,
  url: string,
  options: { waitUntil?: 'commit' | 'domcontentloaded'; timeout?: number } = {},
): Promise<string | null> {
  try {
    const response = await page.goto(url, {
      waitUntil: options.waitUntil ?? 'domcontentloaded',
      timeout: options.timeout,
    });
    return response && !response.ok() ? `HTTP ${response.status()} from ${url}` : null;
  } catch (error) {
    return errorText(error);
  }
}

async function readyFlag(page: Page): Promise<boolean> {
  return page
    .evaluate(() => {
      const w = window as unknown as { __gm?: { ready?: boolean }; __ready?: boolean };
      return w.__gm?.ready === true || w.__ready === true;
    })
    .catch(() => false);
}

async function openOne(
  browser: Browser,
  url: string,
  viewport: ViewportName,
  outDir: string,
  timeoutMs: number,
): Promise<OpenViewport> {
  const context = await browser.newContext(VIEWPORTS[viewport]);
  const collector = new ConsoleCollector();
  try {
    const page = await context.newPage();
    watchConsole(page, collector);
    const started = Date.now();
    const failures: string[] = [];
    const opened = await gotoBuild(page, url, { waitUntil: 'commit', timeout: timeoutMs });
    if (opened) failures.push(opened);
    let ttiMs: number | null = null;
    let readyHook = false;
    /* Checks once more after the deadline, so a slow boot reads as slow (with its time), not as never interactive. */
    for (;;) {
      readyHook = await readyFlag(page);
      if (readyHook || !isBlank(await pixelStats(page, await frame(page)))) {
        ttiMs = Date.now() - started;
        break;
      }
      if (Date.now() - started >= timeoutMs) break;
      await page.waitForTimeout(POLL_MS);
    }
    /* A frame or two after ready, so the still shows what a player sees rather than the first paint. */
    await page.waitForTimeout(500);
    const still = `open-${viewport}.png`;
    const png = await page.screenshot({ path: join(outDir, still) });
    const blank = isBlank(await pixelStats(page, png));
    const renderer = await rendererString(page);
    const entries = collector.list();
    if (ttiMs === null) failures.push(`not interactive after ${timeoutMs}ms`);
    else if (ttiMs > timeoutMs) failures.push(`interactive after ${ttiMs}ms, over the ${timeoutMs}ms limit`);
    if (blank) failures.push('blank frame');
    if (renderer === 'no WebGL') failures.push('no WebGL');
    for (const entry of entries.filter((e) => e.level === 'error')) failures.push(`console error: ${entry.text}`);
    return {
      viewport,
      renderer,
      software: isSoftware(renderer) || renderer === 'no WebGL',
      readyHook,
      ttiMs,
      blank,
      still,
      console: entries,
      failures,
    };
  } finally {
    await context.close();
  }
}

/** Boots the build as a player would on each viewport (no test query, no hooks needed) and writes `qa-open.json`. */
export async function qaOpen(
  browser: Browser,
  url: string,
  options: { outDir: string; viewports?: ViewportName[]; timeoutMs?: number },
): Promise<QaOpenResult> {
  mkdirSync(options.outDir, { recursive: true });
  rmSync(join(options.outDir, 'qa-open.json'), { force: true });
  const viewports: OpenViewport[] = [];
  for (const viewport of options.viewports ?? (['phone', 'desktop'] as const)) {
    viewports.push(await openOne(browser, url, viewport, options.outDir, options.timeoutMs ?? OPEN_TIMEOUT_MS));
  }
  const result: QaOpenResult = {
    url,
    verdict: viewports.every((v) => v.failures.length === 0) ? 'pass' : 'fail',
    viewports,
  };
  writeFileSync(join(options.outDir, 'qa-open.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
