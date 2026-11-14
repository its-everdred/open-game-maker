import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { launch, VIEWPORTS } from './browser.js';
import { acquireSlot } from './semaphore.js';
import type { GateResult } from './gates/index.js';

/** Measure the screenshot itself, including DOM and canvas pixels. */
async function uniformFraction(page: Page, png: Buffer): Promise<number> {
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const img = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('cannot decode boot screenshot');
    context.drawImage(img, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const buckets = new Map<number, number>();
    for (let i = 0; i < data.length; i += 4) {
      const key = (data[i]! >> 4) * 256 + (data[i + 1]! >> 4) * 16 + (data[i + 2]! >> 4);
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    const dominant = [...buckets.entries()].reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0];
    const center = [((dominant >> 8) & 15) * 16 + 8, ((dominant >> 4) & 15) * 16 + 8, (dominant & 15) * 16 + 8];
    let close = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (center.every((value, channel) => Math.abs(data[i + channel]! - value) <= 16)) close++;
    }
    return close / (canvas.width * canvas.height);
  }, png.toString('base64'));
}

async function closeBounded(close: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      close.catch(() => {}),
      new Promise<void>((done) => {
        timer = setTimeout(done, 2_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export type BootViewport = 'phone' | 'tablet-landscape';

export async function runBoot(options: {
  url: string;
  outDir: string;
  viewports: readonly BootViewport[];
  software: boolean;
  runtimeDir?: string;
  signal?: AbortSignal;
}): Promise<GateResult> {
  const { url, outDir, viewports, signal } = options;
  const started = Date.now();
  let browser: Awaited<ReturnType<typeof launch>> | undefined;
  let slot: Awaited<ReturnType<typeof acquireSlot>> | undefined;
  const checks: GateResult['checks'] = [];
  try {
    slot = await acquireSlot({ runtimeDir: options.runtimeDir, signal });
    const launchSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(20_000)]);
    const launching = launch(options.software, true);
    const cancelled = new Promise<never>((_, reject) => {
      const abort = () => reject(new Error('browser launch timed out or was cancelled'));
      if (launchSignal.aborted) abort();
      else launchSignal.addEventListener('abort', abort, { once: true });
    });
    void launching.then(
      (late) => {
        if (launchSignal.aborted) void late.close().catch(() => {});
      },
      () => {},
    );
    browser = await Promise.race([launching, cancelled]);
    const stopBrowser = () => {
      slot?.release();
      void browser?.close().catch(() => {});
    };
    signal?.addEventListener('abort', stopBrowser, { once: true });
    if (signal?.aborted) stopBrowser();
    for (const viewport of viewports) {
      if (signal?.aborted) throw new Error('boot check deadline exceeded');
      const context = await browser.newContext({ ...VIEWPORTS[viewport], deviceScaleFactor: 1 });
      try {
        const page = await context.newPage();
        await page.addInitScript(() => {
          window.addEventListener('gm-frame-ready', () => {
            (window as unknown as { __gmBootReady?: boolean }).__gmBootReady = true;
          });
        });
        const deadline = Date.now() + 20_000;
        await page.goto(url, {
          waitUntil: 'commit',
          timeout: 20_000,
        });
        let readyError: unknown;
        try {
          await page.waitForFunction(
            () => {
              const w = window as unknown as { __gm?: { ready?: boolean }; __ready?: boolean; __gmBootReady?: boolean };
              return w.__gm?.ready === true || w.__ready === true || w.__gmBootReady === true;
            },
            null,
            { timeout: Math.max(1, deadline - Date.now()) },
          );
        } catch (error) {
          readyError = error;
        }
        const dir = outDir;
        mkdirSync(dir, { recursive: true });
        const png = await page.screenshot();
        writeFileSync(join(dir, `${viewport}.png`), png);
        if (readyError) throw readyError;
        // Decode outside the game's realm so its scripts cannot forge pixel data.
        const analysisPage = await context.newPage();
        let fraction: number;
        try {
          fraction = await uniformFraction(analysisPage, png);
        } finally {
          await closeBounded(analysisPage.close());
        }
        checks.push({
          id: 'boot',
          ok: fraction <= 0.98,
          detail: fraction > 0.98 ? `${viewport}: near-uniform frame (${(fraction * 100).toFixed(1)}%)` : undefined,
        });
      } catch (error) {
        checks.push({
          id: 'boot',
          ok: false,
          detail: `${viewport}: ${error instanceof Error ? error.message : String(error)}`,
        });
      } finally {
        await closeBounded(context.close());
      }
    }
  } catch (error) {
    checks.push({ id: 'boot', ok: false, detail: error instanceof Error ? error.message : String(error) });
  } finally {
    try {
      if (browser) await closeBounded(browser.close());
    } finally {
      slot?.release();
    }
  }
  return {
    gate: 'L1',
    ok: checks.length === viewports.length && checks.every((check) => check.ok),
    durationMs: Date.now() - started,
    checks,
  };
}
