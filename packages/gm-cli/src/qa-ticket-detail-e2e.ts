import {
  mediaFailures,
  openClosedTicket,
  openRunningTicket,
  openTicketBuilds,
  settleMedia,
} from './qa-review-checks.js';

type Browser = Awaited<ReturnType<(typeof import('@ogm/gm-verify'))['launch']>>;
type Page = Awaited<ReturnType<Awaited<ReturnType<Browser['newContext']>>['newPage']>>;
type Locator = ReturnType<Page['locator']>;

// The hammer panel's ticket detail on the QA game (#873): Kevin opens the hammer, taps a running ticket and a closed one
// and sees each one's summary and media. The QA API seeds both tickets (`/internal/qa/ticket-fixtures`) with the same
// picture, clip and sound as the review round; everything after the seed is the deployed app's real path.

export const RUNNING_TITLE = 'QA running ticket';
export const CLOSED_TITLE = 'QA closed ticket';

/** The detail's summary line; the verdict quote also starts "QA: ", so text alone matches two elements (#875). */
export const summary = (dialog: Locator) => dialog.locator('.ticket-detail-summary');

/** What one ticket's detail must show; the empty list means it passed. */
export async function detailFailures(dialog: Locator, where: string): Promise<string[]> {
  const failures: string[] = [];
  if (!(await summary(dialog).count())) failures.push(`${where}: no summary`);
  if ((await dialog.locator('img, video, audio').count()) !== 3)
    failures.push(`${where}: not a picture, clip and sound`);
  if (!(await dialog.locator('blockquote').count())) failures.push(`${where}: no verdict quote`);
  const body = dialog.locator('.ticket-detail-body');
  if ((await body.count()) && (await body.evaluate((element) => element.scrollWidth > element.clientWidth)))
    failures.push(`${where}: scrolls sideways`);
  return [...failures, ...(await mediaFailures(dialog, where))];
}

/**
 * Opens the running ticket from the panel's list and the closed one from Completed, checking and capturing each.
 * Throws with every failure found.
 */
export async function ticketDetailSteps(page: Page, origin: string, still: (label: string) => Promise<void>) {
  const timeout = { timeout: 20_000 };
  await page.goto(`${origin}/all`, { waitUntil: 'load', timeout: 60_000 });
  await openTicketBuilds(page);
  const failures: string[] = [];
  for (const [title, label] of [
    [RUNNING_TITLE, 'ticket-running'],
    [CLOSED_TITLE, 'ticket-closed'],
  ] as const) {
    if (title === CLOSED_TITLE) {
      await openClosedTicket(page, title);
    } else {
      await openRunningTicket(page, title);
    }
    const dialog = page.getByRole('dialog', { name: title });
    await summary(dialog).waitFor(timeout);
    await settleMedia(dialog);
    await still(label);
    failures.push(...(await detailFailures(dialog, `the ${label.replace('ticket-', '')} ticket`)));
    await dialog.getByRole('button', { name: 'Close' }).click(timeout);
  }
  if (failures.length) throw new Error(failures.join('; '));
}
