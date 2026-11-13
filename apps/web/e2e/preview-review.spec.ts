import { expect, test } from '@playwright/test';

import { installAuthRoutes } from './fixtures/auth-routes';

const gameId = 'g_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e01';
const first = 'preview-11111111-1111-4111-8111-111111111111';
const second = 'preview-22222222-2222-4222-8222-222222222222';
const access = (id: string) => id.replace('preview-', 'pv-');

test('plays a preview, sends a verdict and shows a newer push', async ({ page }, testInfo) => {
  let buildId: string | null = first;
  let answer: unknown;
  let choice: unknown;
  let commandOpen = true;
  await installAuthRoutes(page, { signedIn: true });
  await page.route('**/p/**', (route) => route.continue({ url: route.request().url().replace('/p/', '/g/') }));
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const json = (body: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/v1/notifications/stream')
      return route.fulfill({ contentType: 'text/event-stream', body: 'retry: 60000\n\n' });
    if (path === '/api/v1/me') return json({ platformRole: 'none' });
    if (path === '/api/v1/games/resolve/blobs')
      return json({
        game: {
          id: gameId,
          title: 'Blobs',
          slug: 'blobs',
          familyId: 'f_1',
          ownerId: 'u_1',
          repo: null,
          createdAt: '2026-11-07T17:00:00.000Z',
        },
      });
    if (path === `/api/v1/games/${gameId}/commands`)
      return json({
        commands: commandOpen
          ? [
              {
                job_id: null,
                ticket: '43',
                title: 'Pick a look',
                command_id: 'c1',
                decision_id: 'd1',
                version: 1,
                question: 'Which look?',
                options: [
                  { id: 'red', label: 'Red' },
                  { id: 'blue', label: 'Blue' },
                ],
                blocking: false,
                opened_at: '2026-11-13T00:00:00.000Z',
                review_number: 1,
              },
            ]
          : [],
      });
    if (path === `/api/v1/games/${gameId}/review-drafts`) return json({ drafts: [] });
    if (path === `/api/v1/games/${gameId}/previews`)
      return json({
        previews: buildId
          ? [{ ticket: '42', buildId, accessId: access(buildId), createdAt: '2026-11-13T00:00:00.000Z' }]
          : [],
      });
    if (path.endsWith('/previews/42/design'))
      return json({ rev: 0, doc: { schemaVersion: 1, globals: {}, entities: {} } });
    if (path.endsWith('/previews/42/answer')) {
      answer = route.request().postDataJSON();
      buildId = null;
      return json({ status: 'answered' });
    }
    if (path.endsWith('/commands/d1/answer')) {
      choice = route.request().postDataJSON();
      commandOpen = false;
      return json({ status: 'answered' });
    }
    return json({});
  });
  await page.goto('/blobs/review');
  const card = page.getByRole('region', { name: 'Preview for ticket 42' });
  await expect(card).toBeVisible();
  await expect(card.locator('iframe')).toBeVisible();
  await expect(page.frameLocator('iframe').getByText('Bridge fixture')).toBeVisible();
  const still = testInfo.outputPath('preview-review.png');
  await page.screenshot({ path: still });
  await testInfo.attach('preview-review', { path: still, contentType: 'image/png' });
  await card.getByLabel('Note (optional)').fill('The jump feels good');
  await card.getByRole('button', { name: 'Looks right' }).click();
  await expect(card).toHaveCount(0);
  expect(answer).toEqual({ buildId: first, verdict: 'looks right', note: 'The jump feels good' });
  buildId = second;
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card.locator('iframe')).toHaveAttribute('src', new RegExp(access(second)));
  await page.getByRole('button', { name: 'Choose B: Blue' }).click();
  await expect.poll(() => choice).toEqual({ option_id: 'blue', version: 1 });
  await expect(page.getByRole('button', { name: 'Choose B: Blue' })).toHaveCount(0);
});
