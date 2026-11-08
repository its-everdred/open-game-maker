import { readFileSync } from 'node:fs';

import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test';

import type { GameCommand } from '@ogm/contracts';

import { installAuthRoutes } from './fixtures/auth-routes';

// A registered game's Command has no job (#577); its option media comes from the game's own aiur instance, signed by
// the API like a job's. The Blobs staging Command showed text only (#611). Its clip has no poster aiur can serve, so the
// card's named kind is what makes it a clip and not an audio sample.
const gameId = 'g_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e01';
const MP4 = readFileSync(new URL('./fixtures/tiny.mp4', import.meta.url));

const STILL = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320" viewBox="0 0 480 320">
  <rect width="480" height="320" fill="#3c3836"/>
  <ellipse cx="240" cy="230" rx="150" ry="46" fill="#689d6a"/>
  <circle cx="200" cy="210" r="12" fill="#282828"/>
  <circle cx="280" cy="210" r="12" fill="#282828"/>
</svg>`;

function silentWav(seconds: number): Buffer {
  const rate = 8000;
  const data = Buffer.alloc(Math.floor(rate * seconds) * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const command: GameCommand = {
  job_id: null,
  ticket: '12',
  title: 'Blobs staging',
  checkpoint_id: 'dec_blobs',
  decision_id: 'dec_blobs',
  version: 1,
  question: 'How should the blobs rest?',
  options: [
    {
      id: 'flat',
      label: 'Lie flat on a table',
      media: { url: 'https://api.example.test/blobs/sha256/flat', width: 480, height: 320, kind: 'image' },
    },
    {
      id: 'roll',
      label: 'Roll across the floor',
      media: {
        url: 'https://api.example.test/blobs/sha256/roll',
        width: 64,
        height: 48,
        duration_ms: 1000,
        kind: 'video',
      },
    },
    {
      id: 'hum',
      label: 'Hum while resting',
      media: {
        url: 'https://api.example.test/blobs/sha256/hum',
        width: 640,
        height: 360,
        duration_ms: 2000,
        kind: 'audio',
      },
    },
  ],
  blocking: true,
  opened_at: '2026-11-07T17:40:00.000Z',
  review_number: 1,
};

test.use({ serviceWorkers: 'block' });

test('shows a jobless Command’s still, clip and sample on their cards', async ({ page }, testInfo) => {
  testInfo.setTimeout(60_000);
  await installAuthRoutes(page, { signedIn: true });
  await installApi(page);
  await page.goto('/blobs/review/1');

  const deck = page.getByRole('region', { name: 'Review Blobs staging' });
  await expect(deck).toBeVisible();
  const still = deck.locator('.review-deck-card img.review-deck-media');
  await expect(still).toHaveAttribute('src', 'https://api.example.test/blobs/sha256/flat');
  await expect.poll(() => still.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBe(480);
  await capture(page, testInfo, 'jobless-still');

  await page.getByRole('button', { name: 'Like', exact: true }).click();
  const clip = deck.locator('.review-deck-card video.review-deck-media');
  await expect(clip).toHaveAttribute('src', 'https://api.example.test/blobs/sha256/roll');
  // The deck's one audio element has nothing to play for a clip.
  await expect(deck.locator('audio')).not.toHaveAttribute('src');
  await capture(page, testInfo, 'jobless-clip');

  await page.getByRole('button', { name: 'Like', exact: true }).click();
  await expect(deck.locator('audio')).toHaveAttribute('src', 'https://api.example.test/blobs/sha256/hum');
  await expect(page.locator('.review-deck-length').first()).toHaveText('0:02');
  await capture(page, testInfo, 'jobless-sample');
});

async function installApi(page: Page) {
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/notifications/stream') {
      return route.fulfill({ contentType: 'text/event-stream', body: 'retry: 60000\n\n' });
    }
    if (path === '/api/v1/me') return json(route, { platformRole: 'none' });
    if (path === '/api/v1/games/resolve/blobs') {
      return json(route, {
        game: {
          id: gameId,
          familyId: 'f_1',
          ownerId: 'u_1',
          title: 'Blobs',
          slug: 'blobs',
          repo: null,
          createdAt: '2026-11-07T17:00:00.000Z',
        },
      });
    }
    if (path === `/api/v1/games/${gameId}/commands`) return json(route, { commands: [command] });
    if (path === '/api/v1/jobs' || path === '/api/v1/jobs/active') return json(route, { jobs: [] });
    return json(route, { error: 'not_mocked', path }, 404);
  });
  await page.route('**/api.example.test/blobs/sha256/*', (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    if (name === 'flat') return route.fulfill({ contentType: 'image/svg+xml', body: STILL });
    if (name === 'roll') return route.fulfill({ contentType: 'video/mp4', body: MP4 });
    return route.fulfill({ contentType: 'audio/wav', body: silentWav(2) });
  });
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await page.waitForTimeout(150);
  const path = testInfo.outputPath(`${name}-${testInfo.project.name}.png`);
  await page.screenshot({ path });
  await testInfo.attach(`${name}-${testInfo.project.name}`, { path, contentType: 'image/png' });
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}
