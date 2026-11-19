import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test';
import { resolve } from 'node:path';

import { installAuthRoutes } from './fixtures/auth-routes';

// #854: the instance owner talks to the Executor inside the app. aiur's thread (aiur-team/aiur#8034) is mocked behind
// the app's own `/api/v1/me/executor/thread/*` until it ships.
const blobs = 'g_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e70';
const cellar = 'g_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e71';
const media = resolve(import.meta.dirname, '../../../packages/gm-cli/qa/review-e2e');
const attachment = (id: string, kind: string, mime: string) => ({
  id,
  kind,
  mime,
  url: `/api/v1/me/executor/thread/attachments/${id}`,
});

test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });

test('asks the Executor from a game, reads the reply with media, and sees each game’s status', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await installAuthRoutes(page, { signedIn: true });
  const journal: unknown[] = [
    { id: 'pos_1', pos: 1, role: 'executor', text: 'Live: Endless at Normal speed.', attachments: [], delivery: null },
  ];
  const sent: Array<Record<string, unknown>> = [];
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const files: Record<string, [string, string]> = {
      a1: ['still.png', 'image/png'],
      a2: ['clip.mp4', 'video/mp4'],
      a3: ['sound.mp3', 'audio/mpeg'],
    };
    const file = /\/attachments\/(a\d)$/u.exec(url.pathname)?.[1];
    if (file) return route.fulfill({ path: resolve(media, files[file]![0]), contentType: files[file]![1] });
    if (url.pathname === '/api/v1/me/executor/thread')
      return json(route, { conversation_id: 'conv_1', executor: { attached: true, live: true }, can_send: true });
    if (url.pathname === '/api/v1/me/executor/thread/messages' && method === 'POST') {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      sent.push(body);
      // The Executor answers in the thread: the next read lists the ask, delivered, and its reply with media.
      journal.push(
        {
          id: 'pos_2',
          pos: 2,
          request_id: 9,
          role: 'operator',
          text: body.text,
          attachments: [],
          delivery: 'delivered',
        },
        {
          id: 'pos_3',
          pos: 3,
          role: 'executor',
          text: 'Versus CPU now ends on a results screen, and Nim has a new voice.',
          attachments: [
            attachment('a1', 'image', 'image/png'),
            attachment('a2', 'video', 'video/mp4'),
            attachment('a3', 'audio', 'audio/mpeg'),
          ],
          delivery: null,
        },
      );
      return json(
        route,
        {
          message: {
            id: 'req_9',
            request_id: 9,
            role: 'operator',
            text: body.text,
            attachments: [],
            delivery: 'queued',
          },
        },
        202,
      );
    }
    if (url.pathname === '/api/v1/me/executor/thread/messages') {
      const after = Number(url.searchParams.get('after') ?? 0);
      const messages = journal.filter((message) => (message as { pos: number }).pos > after);
      return json(route, {
        messages,
        next_after: Math.max(after, ...messages.map((m) => (m as { pos: number }).pos)),
        queued: [],
      });
    }
    if (url.pathname === '/api/v1/me/commands')
      return json(route, {
        commands: [
          {
            game_id: blobs,
            game_title: 'Blobs',
            job_id: null,
            ticket: '645',
            title: 'Which menu?',
            summary: 'Which menu?',
            command_id: 'd_menu',
            decision_id: 'd_menu',
            version: 1,
            question: 'Which menu?',
            options: [
              {
                id: 'a',
                label: 'A',
                media: { url: '/api/v1/me/executor/thread/attachments/a1', kind: 'image', width: 100, height: 100 },
              },
              {
                id: 'b',
                label: 'B',
                media: { url: '/api/v1/me/executor/thread/attachments/a1', kind: 'image', width: 100, height: 100 },
              },
            ],
            blocking: false,
            opened_at: '2026-11-18T05:00:00.000Z',
          },
        ],
        sessions: [],
      });
    if (url.pathname === '/api/v1/me/core-commands') return json(route, { commands: [], targets: [] });
    if (url.pathname === '/api/v1/notifications/stream')
      return route.fulfill({ contentType: 'text/event-stream', body: 'retry: 60000\n\n' });
    if (url.pathname === '/api/v1/games')
      return json(route, {
        games: [
          {
            id: blobs,
            familyId: 'family-1',
            ownerId: 'u1',
            title: 'Blobs',
            repo: null,
            live: true,
            createdAt: '2026-11-03T17:00:00.000Z',
          },
          {
            id: cellar,
            familyId: 'family-1',
            ownerId: 'u1',
            title: 'Goblin Cellar',
            repo: null,
            live: true,
            createdAt: '2026-11-03T17:00:00.000Z',
          },
        ],
      });
    if (url.pathname === '/api/v1/jobs') return json(route, { jobs: [] });
    if (url.pathname.endsWith('/workers'))
      return json(route, { workers: [], daemonUnavailable: false, trackerStale: false, cursor: 0, completed: [] });
    if (url.pathname.endsWith('/review-rounds')) return json(route, { rounds: [] });
    if (url.pathname.endsWith('/previews')) return json(route, { previews: [] });
    if (/^\/api\/v1\/games\/[^/]+\/commands$/u.test(url.pathname)) return json(route, { commands: [] });
    if (url.pathname === '/api/v1/me') return json(route, { platformRole: 'none' });
    return json(route, { error: 'not_mocked', path: url.pathname }, 404);
  });

  await page.goto('/all');
  await openMenu(page);
  await page.getByRole('button', { name: 'Ask' }).click();
  const thread = page.getByRole('dialog', { name: 'Executor' });
  await expect(thread.getByText('Live: Endless at Normal speed.')).toBeVisible();
  // Review: the Command waiting on the creator sits in the thread.
  await expect(thread.getByRole('button', { name: 'B' })).toBeVisible();
  await thread.getByRole('textbox').fill('Make Endless the big button, and put Mossbeard in front');
  await capture(page, testInfo, 'ask');
  await thread.getByRole('button', { name: 'Send' }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({ context: { screen: '/all' } });

  await expect(thread.getByText('Versus CPU now ends on a results screen', { exact: false })).toBeVisible();
  await expect(thread.getByText('Make Endless the big button, and put Mossbeard in front')).toHaveCount(1);
  await expect
    .poll(() =>
      thread
        .locator('img')
        .first()
        .evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  await expect.poll(() => thread.locator('audio').evaluate((audio) => audio.duration)).toBeGreaterThan(1);
  const overflow = await thread.evaluate((node) => node.scrollWidth - node.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  expect((await thread.locator('audio').boundingBox())!.height).toBeGreaterThan(20);
  await capture(page, testInfo, 'answer');

  await thread.getByRole('button', { name: 'B' }).click();
  await expect(page.getByRole('dialog', { name: 'Which menu?' })).toBeVisible();
  await capture(page, testInfo, 'review');
  await page.keyboard.press('Escape');

  await openMenu(page);
  await page.getByRole('button', { name: 'Status' }).click();
  const status = page.getByRole('list', { name: 'Build progress' });
  await expect(status.getByRole('group', { name: 'Blobs builds' })).toContainText('Which menu?Waiting on you');
  await expect(
    status.getByRole('group', { name: 'Goblin Cellar builds' }).getByRole('link', { name: 'Live' }),
  ).toBeVisible();
  const sheet = (await page.locator('.studio-menu-sheet').boundingBox())!;
  expect(sheet.x).toBeGreaterThanOrEqual(0);
  expect(sheet.x + sheet.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await capture(page, testInfo, 'status');
});

// On the library the menu opens from the sound control (long press, or Shift+F10).
async function openMenu(page: Page) {
  await page.locator('.studio-library-volume button').press('Shift+F10');
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await page.waitForTimeout(300);
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}
