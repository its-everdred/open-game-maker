import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { mediaFailures, optionFailures, settleMedia, swipeDeckFailures } from './qa-review-checks.js';

type Browser = Awaited<ReturnType<(typeof import('@ogm/gm-verify'))['launch']>>;
type Page = Awaited<ReturnType<Awaited<ReturnType<Browser['newContext']>>['newPage']>>;

/** The four sizes the review deck is approved at: phone and tablet, portrait and landscape. */
export const REVIEW_VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 820, height: 1180 },
  { width: 1180, height: 820 },
] as const;

export type ReviewE2eConfig = {
  /** The app the creator opens, e.g. the deployed origin. */
  origin: string;
  /** The API the host reaches directly for the internal QA routes. */
  api: string;
  internalToken: string;
  cookie: { name: string; value: string };
  out: string;
  /** Test-only: hides the round's note box, the regression the run must catch. */
  injectRegression: boolean;
  /** Test-only: the review picture's URL answers 404, a broken media URL the run must catch. */
  breakMedia: boolean;
  /** One id per run, so a viewport's fixtures never meet another's. */
  stamp: string;
};

export type ViewportResult = { viewport: string; ok: boolean; failure?: string; stills: string[] };

export const NOTE = 'QA note';
export const PICK_NOTE = 'QA pick';
const MEDIA_DIR = new URL('../qa/review-e2e/', import.meta.url);

// A regression a deploy could ship: the round's note box is gone, so "Needs changes" can no longer carry a note.
const REGRESSION_CSS = '[aria-label="Note (optional)"], label:has(> textarea) { display: none !important; }';

class StepFailed extends Error {}

async function internal(config: ReviewE2eConfig, path: string, init: RequestInit = {}) {
  const response = await fetch(`${config.api}/internal/qa${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-ogm-internal': config.internalToken, ...init.headers },
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new StepFailed(`${init.method ?? 'GET'} ${path} answered ${response.status}`);
  return body;
}

export type Report = {
  round: { verdict: string | null; notes: string | null; dispatch: string | null };
  received: { kind: string; option?: string; response?: string; reason?: string }[];
};

// The verdicts reached aiur: the round's rework carries the note, and the Command's answer picks B with its note.
export function reached(report: Report): string | null {
  if (report.round.verdict !== 'needs_work' || report.round.notes !== NOTE) return 'the round verdict was not stored';
  const rework = report.received.find((item) => item.kind === 'rework');
  if (!rework?.reason?.includes(NOTE)) return 'the round verdict did not reach aiur';
  const answer = report.received.find((item) => item.kind === 'answer');
  if (!answer) return 'the Command answer did not reach aiur';
  const picked = answer.option === 'b' || (answer.response ?? '').includes('"b"');
  if (!picked || !(answer.response ?? '').includes(PICK_NOTE)) return 'the Command answer is not B with its note';
  return null;
}

async function poll<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs: number): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > until) return value;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

async function swipe(page: Page, right: boolean): Promise<void> {
  const media = page.getByRole('dialog', { name: 'Needs Review' }).locator('.review-deck-playable').first();
  await media.scrollIntoViewIfNeeded();
  const box = await media.boundingBox();
  if (!box) throw new StepFailed('the review card has no media to swipe');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + (right ? 110 : -110), box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
}

async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof StepFailed) throw error;
    throw new StepFailed(`${name}: ${(error as Error).message.split('\n')[0]}`);
  }
}

async function runViewport(
  browser: Browser,
  config: ReviewE2eConfig,
  viewport: { width: number; height: number },
): Promise<ViewportResult> {
  const name = `${viewport.width}x${viewport.height}`;
  const run = `${config.stamp}-${name}`;
  const stills: string[] = [];
  const media = (file: string) => readFileSync(new URL(file, MEDIA_DIR)).toString('base64');
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  try {
    const seeded = await internal(config, '/review-fixtures', {
      method: 'POST',
      body: JSON.stringify({
        run,
        media: { still: media('still.png'), clip: media('clip.mp4'), audio: media('sound.mp3') },
      }),
    });
    if (config.breakMedia) {
      const picture = readFileSync(new URL('still.png', MEDIA_DIR));
      await context.route('**/*', async (route) => {
        if (route.request().resourceType() !== 'image') return route.fallback();
        const response = await route.fetch();
        if ((await response.body()).equals(picture)) return route.fulfill({ status: 404, body: '' });
        return route.fulfill({ response });
      });
    }
    await context.addCookies([{ ...config.cookie, url: config.origin }]);
    if (config.injectRegression)
      await context.addInitScript((css) => {
        document.addEventListener('DOMContentLoaded', () => {
          const style = document.createElement('style');
          style.textContent = css;
          document.head.append(style);
        });
      }, REGRESSION_CSS);
    const page = await context.newPage();
    const still = async (label: string) => {
      const file = join(config.out, `${name}-${stills.length + 1}-${label}.png`);
      await page.screenshot({ path: file });
      stills.push(file);
    };
    const dialog = page.getByRole('dialog', { name: 'Needs Review' });
    const timeout = { timeout: 20_000 };

    await step('open the review deck', async () => {
      await page.goto(`${config.origin}/all`, { waitUntil: 'load', timeout: 60_000 });
      await page.locator('.worker-tracker-button').click(timeout);
      await dialog.getByText('QA review round').waitFor(timeout);
      await dialog.locator('video').first().waitFor(timeout);
      await dialog
        .locator('audio')
        .first()
        .waitFor({ state: 'attached', ...timeout });
    });
    await step('show the round', async () => {
      await settleMedia(dialog);
      await still('round');
      const failures = [...(await mediaFailures(dialog, 'the round')), ...(await swipeDeckFailures(page, dialog))];
      if (failures.length) throw new StepFailed(failures.join('; '));
    });
    await step('swipe the round right and undo', async () => {
      await swipe(page, true);
      await page.getByRole('button', { name: 'Undo' }).click(timeout);
    });
    await step('swipe the round left with a note', async () => {
      await swipe(page, false);
      await page.getByLabel('Note (optional)').fill(NOTE, timeout);
      await page.getByRole('button', { name: 'Send changes' }).click(timeout);
      await dialog.getByRole('status').filter({ hasText: 'sent to agent' }).waitFor({ timeout: 90_000 });
    });
    await still('round-sent');
    await step('pick B on the Command with a note', async () => {
      await dialog.getByRole('button', { name: 'Next' }).click(timeout);
      await dialog.getByText('QA: which one?').waitFor(timeout);
      await settleMedia(dialog);
      await still('command');
      const failures = [
        ...(await mediaFailures(dialog, 'the Command')),
        ...(typeof seeded.options === 'number'
          ? await optionFailures(dialog, seeded.options)
          : ['the fixture seed did not say how many options the Command carries']),
      ];
      if (failures.length) throw new StepFailed(failures.join('; '));
      await dialog.getByLabel('Note (optional)').fill(PICK_NOTE, timeout);
      await dialog.getByRole('button', { name: /^Pick B/ }).click(timeout);
    });
    const report = await poll(
      async () => (await internal(config, `/review-fixtures/${run}`)) as Report,
      (value) => reached(value) === null,
      30_000,
    );
    await still('command-sent');
    const alert = dialog.getByRole('alert');
    const failure = (await alert.count()) ? `the deck showed: ${await alert.first().innerText()}` : reached(report);
    return failure === null ? { viewport: name, ok: true, stills } : { viewport: name, ok: false, failure, stills };
  } catch (error) {
    return { viewport: name, ok: false, failure: (error as Error).message, stills };
  } finally {
    await context.close();
    await internal(config, `/review-fixtures/${run}`, { method: 'DELETE' }).catch(() => undefined);
  }
}

/** Completes a review round and a three-option Command on the QA game at each review size; one result per size. */
export async function reviewE2e(browser: Browser, config: ReviewE2eConfig): Promise<ViewportResult[]> {
  mkdirSync(config.out, { recursive: true });
  // A run that died midway leaves its cards; they would sit ahead of this run's in the deck.
  await internal(config, '/review-fixtures', { method: 'DELETE' });
  const results: ViewportResult[] = [];
  for (const viewport of REVIEW_VIEWPORTS) results.push(await runViewport(browser, config, viewport));
  return results;
}
