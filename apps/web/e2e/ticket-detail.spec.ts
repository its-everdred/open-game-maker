import { readFileSync } from 'node:fs';

import { expect, test, type Page, type Route } from '@playwright/test';

import { installAuthRoutes } from './fixtures/auth-routes';
import { openClosedTicket, openRunningTicket, openTicketBuilds } from '../../../packages/gm-cli/src/qa-review-checks';
import { openChat } from '../../../packages/gm-cli/src/qa-voice-e2e';

// Kevin opens the hammer, taps a running ticket and a closed one, and sees each one's summary, status, media and
// timeline on his phone (#873). The API's ticket detail is mocked in the shape services/api answers.
const gameId = 'g_87300000-0000-4000-8000-000000000001';
const MP4 = readFileSync(new URL('./fixtures/tiny.mp4', import.meta.url));
const STILL = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270" viewBox="0 0 480 270">
  <rect width="480" height="270" fill="#3c3836"/><ellipse cx="240" cy="190" rx="150" ry="46" fill="#689d6a"/>
</svg>`;
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 820, height: 1180 },
  { width: 1180, height: 820 },
];

const detail = (ticket: string, running: boolean) => ({
  ticket,
  title: running ? 'Forest backdrop' : 'Blob trailer',
  status: running ? 'working' : 'done',
  phase: running ? 'work' : null,
  running,
  activity: running ? 'Capturing stills' : null,
  summary: running
    ? 'Painting the forest behind the blobs; the first stills are in.'
    : 'The trailer loops now and shipped after your second look.',
  issueUrl: `https://github.com/owner/blobs/issues/${ticket}`,
  pr: running ? null : { number: 66, url: 'https://github.com/owner/blobs/pull/66', state: 'merged', ci: 'passed' },
  mediaPending: 0,
  media: [
    { id: 's', kind: 'image', url: 'https://api.example.test/blobs/sha256/still', caption: 'Forest still' },
    { id: 'c', kind: 'video', url: 'https://api.example.test/blobs/sha256/clip', caption: 'Opening cut' },
    { id: 'a', kind: 'audio', url: 'https://api.example.test/blobs/sha256/sound', caption: null },
  ],
  timeline: [
    { at: '2026-11-17T09:00:00Z', kind: 'round_started', label: 'Round 1 started', quote: null },
    { at: '2026-11-17T10:00:00Z', kind: 'creator_verdict', label: 'Needs changes', quote: 'make it loop' },
    ...(running ? [] : [{ at: '2026-11-17T12:00:00Z', kind: 'pr_merged', label: null, quote: null }]),
  ],
});

test.use({ serviceWorkers: 'block' });

test('opens a build conversation through the voice check path', async ({ page, baseURL }, testInfo) => {
  testInfo.setTimeout(180_000);
  await installAuthRoutes(page, { signedIn: true });
  await installApi(page);
  await openChat(page, baseURL!, 'Forest backdrop');
  await expect(page.getByRole('dialog', { name: 'Forest backdrop' }).locator('.job-conversation-close')).toBeVisible();
  await expect(page.locator('.ticket-detail-dialog')).toHaveCount(0);
});

test('opens a running and a closed ticket’s detail from the hammer', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'the test sets each acceptance viewport itself');
  testInfo.setTimeout(240_000);
  await installAuthRoutes(page, { signedIn: true });
  await installApi(page);
  await page.goto('/all');
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await openTicketBuilds(page);
    const close = page.getByRole('button', { name: 'Close builds' });
    await expect(close).toBeInViewport();
    await openRunningTicket(page, 'Forest backdrop');
    let dialog = page.getByRole('dialog', { name: 'Forest backdrop' });
    await expect(dialog.getByText('Painting the forest behind the blobs; the first stills are in.')).toBeVisible();
    await expect(dialog.getByText('Capturing stills')).toBeVisible();
    await expectMedia(dialog);
    await fits(page);
    await dialog.getByRole('button', { name: 'Close' }).click();
    await openClosedTicket(page, 'Blob trailer');
    dialog = page.getByRole('dialog', { name: 'Blob trailer' });
    await expect(dialog.getByText('#66 Merged')).toBeVisible();
    await expect(dialog.getByText('make it loop')).toBeVisible();
    await expectMedia(dialog);
    await fits(page);
    await dialog.getByRole('button', { name: 'Close' }).click();
    await close.click();
    await expect(page.getByRole('region', { name: 'Builds' })).toBeHidden();
  }
});

async function expectMedia(dialog: ReturnType<Page['getByRole']>) {
  const still = dialog.getByRole('img', { name: 'Forest still' });
  await expect.poll(() => still.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBe(480);
  await expect(dialog.locator('video')).toHaveAttribute('src', 'https://api.example.test/blobs/sha256/clip');
  await expect(dialog.locator('audio')).toHaveAttribute('src', 'https://api.example.test/blobs/sha256/sound');
}

async function fits(page: Page) {
  const body = page.locator('.ticket-detail-body');
  expect(await body.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0);
}

async function installApi(page: Page) {
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/notifications/stream')
      return route.fulfill({ contentType: 'text/event-stream', body: 'retry: 60000\n\n' });
    if (path === '/api/v1/me') return json(route, { platformRole: 'none' });
    if (path === '/api/v1/games')
      return json(route, {
        games: [{ id: gameId, familyId: 'f_1', ownerId: 'u1', title: 'Blobs', repo: null, createdAt: '2026-11-01' }],
      });
    if (path === `/api/v1/games/${gameId}/workers`)
      return json(route, { workers: [{ ticket: '12', title: 'Forest backdrop', percent: 40, etaSeconds: null }] });
    if (path === `/api/v1/games/${gameId}/tickets/completed`)
      return json(route, {
        tickets: [
          {
            ticket: '11',
            title: 'Blob trailer',
            outcome: 'Completed',
            closedAt: '2026-11-17T12:00:00Z',
            url: 'https://github.com/owner/blobs/issues/11',
            jobId: null,
          },
        ],
      });
    if (path === `/api/v1/games/${gameId}/tickets/12/detail`) return json(route, detail('12', true));
    if (path === `/api/v1/games/${gameId}/tickets/11/detail`) return json(route, detail('11', false));
    if (/\/(commands|previews|review-rounds)$/.test(path))
      return json(route, { commands: [], previews: [], rounds: [] });
    if (path === '/api/v1/jobs')
      return json(route, {
        jobs: [
          {
            id: 'j_12',
            gameId,
            creatorId: 'u1',
            aiurIssueNumber: 12,
            state: 'filed',
            plan: { title: 'Forest backdrop', summary: '', scope: { included: [], excluded: [] }, tickets: [] },
            updatedAt: '2026-11-17T12:00:00Z',
          },
        ],
      });
    if (path.startsWith('/api/v1/jobs')) return json(route, { messages: [] });
    return json(route, { error: 'not_mocked', path }, 404);
  });
  await page.route('**/api.example.test/blobs/sha256/*', (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    if (name === 'still') return route.fulfill({ contentType: 'image/svg+xml', body: STILL });
    if (name === 'clip') return route.fulfill({ contentType: 'video/mp4', body: MP4 });
    return route.fulfill({ contentType: 'audio/mpeg', body: Buffer.alloc(0) });
  });
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}
