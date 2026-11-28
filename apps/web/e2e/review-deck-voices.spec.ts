import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test';

import type { GameCommand } from '@ogm/contracts';

import { installAuthRoutes } from './fixtures/auth-routes';

// The Blobs character voices deck Kevin judged on his iPhone (#631): eight cards, each a character's portrait with its
// voice. He heard nothing, had to press Send, and the card did not fit his screen. Each card must play its voice, the
// last vote must answer the Command on its own through the game's route, and the whole card must fit every phone.
const gameId = 'g_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e01';
const DECISION = 'dec_blobs_voices';
const NAMES = ['Pip', 'Mo', 'Bun', 'Dot', 'Lu', 'Gus', 'Fig', 'Zee'];

const answerBodies: Array<Record<string, unknown>> = [];

// A short tone, so the audio element has a real sample to load and play.
function toneWav(seconds: number, hz: number): Buffer {
  const rate = 8000;
  const samples = Math.floor(rate * seconds);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1)
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 6000), i * 2);
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

// A portrait per character, taller than wide like the Blobs character art, drawn as an SVG.
function portrait(index: number): string {
  const hue = (index * 45) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">
  <rect width="600" height="800" fill="hsl(${hue} 30% 22%)"/>
  <ellipse cx="300" cy="470" rx="210" ry="190" fill="hsl(${hue} 50% 55%)"/>
  <circle cx="235" cy="430" r="30" fill="#282828"/>
  <circle cx="365" cy="430" r="30" fill="#282828"/>
  <path d="M230 530 Q300 580 370 530" stroke="#282828" stroke-width="16" fill="none" stroke-linecap="round"/>
  <text x="300" y="150" font-family="sans-serif" font-size="72" font-weight="700" fill="#ebdbb2" text-anchor="middle">${NAMES[index]}</text>
</svg>`;
}

function voicesCommand(): GameCommand {
  return {
    job_id: null,
    ticket: '53',
    title: 'Blobs character voices',
    command_id: DECISION,
    decision_id: DECISION,
    version: 1,
    question: 'Which voice fits each Blob?',
    options: NAMES.map((name, index) => ({
      id: name.toLowerCase(),
      label: `${name}'s voice`,
      media: { url: `https://api.example.test/blobs/sha256/${index}.svg`, width: 600, height: 800, kind: 'image' },
      audio: { url: `https://api.example.test/blobs/sha256/${index}.wav`, width: 640, height: 360, duration_ms: 1500 },
    })),
    blocking: true,
    pick: 'many',
    opened_at: '2026-11-08T07:00:00.000Z',
    review_number: 1,
  };
}

test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });

test.beforeEach(() => {
  answerBodies.length = 0;
});

test('plays each Blob’s voice and answers once all eight have a vote', async ({ page }, testInfo) => {
  testInfo.setTimeout(120_000);
  await openDeck(page);

  const deck = page.getByRole('region', { name: 'Review Blobs character voices' });
  const audio = deck.locator('audio');
  await expect(deck.getByAltText("Pip's voice")).toBeVisible();
  await capture(page, testInfo, 'voices-card-1');

  // The first card plays on a tap; every later card's voice starts inside the vote that brought it in.
  await deck.locator('.review-deck-card').click({ position: { x: 30, y: 60 } });
  for (const [index, name] of NAMES.entries()) {
    await expect(deck.getByAltText(`${name}'s voice`)).toBeVisible();
    await expect(audio).toHaveAttribute('src', `https://api.example.test/blobs/sha256/${index}.wav`);
    await expect.poll(() => audio.evaluate((element) => !(element as HTMLAudioElement).paused)).toBe(true);
    if (index === 3) await capture(page, testInfo, 'voices-card-4');
    if (index % 3 === 1) {
      await page.getByRole('button', { name: 'Dislike', exact: true }).click();
      await page
        .getByRole('dialog', { name: /^Why did you dislike/ })
        .getByRole('button', { name: 'Skip' })
        .click();
    } else {
      await page.getByRole('button', { name: 'Like', exact: true }).click();
    }
  }

  // The eighth vote answered the Command through the game's own route; aiur took it (200).
  await expect(page.getByRole('heading', { name: 'Saved' })).toBeVisible();
  expect(answerBodies).toEqual([
    {
      option_id: 'pip',
      version: 1,
      review: {
        likes: ['pip', 'bun', 'dot', 'gus', 'fig'],
        dislikes: [{ option_id: 'mo' }, { option_id: 'lu' }, { option_id: 'zee' }],
      },
    },
  ]);
  await capture(page, testInfo, 'voices-sent');
});

// The #629 phone matrix, each in portrait and landscape, plus a mid Android and an iPad.
const SIZES: Array<[string, number, number]> = [
  ['iphone-se', 375, 667],
  ['iphone-15', 393, 852],
  ['iphone-15-pro-max', 430, 932],
  ['android-mid', 412, 915],
  ['ipad', 820, 1180],
].flatMap(([name, width, height]) => [
  [`${name}-portrait`, width, height] as [string, number, number],
  [`${name}-landscape`, height, width] as [string, number, number],
]);

test('fits the whole card on every phone, portrait and landscape, with nothing to scroll', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'the matrix sets its own sizes; one project covers it');
  testInfo.setTimeout(180_000);
  await openDeck(page);
  const deck = page.getByRole('region', { name: 'Review Blobs character voices' });
  await expect(deck.getByAltText("Pip's voice")).toBeVisible();

  for (const [name, width, height] of SIZES) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(100);
    const view = { width, height };
    const inside = async (selector: string) => {
      const box = (await page.locator(selector).first().boundingBox())!;
      expect(box, `${selector} at ${name}`).not.toBeNull();
      expect(box.x, `${selector} left at ${name}`).toBeGreaterThanOrEqual(0);
      expect(box.y, `${selector} top at ${name}`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `${selector} right at ${name}`).toBeLessThanOrEqual(view.width + 0.5);
      expect(box.y + box.height, `${selector} bottom at ${name}`).toBeLessThanOrEqual(view.height + 0.5);
      return box;
    };
    const card = await inside('.review-deck-card');
    await inside('.review-deck-label');
    for (const control of ['Undo the last swipe', 'Dislike', 'Like']) {
      const box = (await page.getByRole('button', { name: control, exact: true }).boundingBox())!;
      expect(box.y + box.height, `${control} at ${name}`).toBeLessThanOrEqual(height + 0.5);
      expect(box.x + box.width, `${control} at ${name}`).toBeLessThanOrEqual(width + 0.5);
    }
    // The card takes the portrait's own shape, so the image is never cropped, and it is big enough to judge.
    expect(Math.abs(card.width / card.height - 600 / 800), `card shape at ${name}`).toBeLessThan(0.02);
    expect(card.height, `card height at ${name}`).toBeGreaterThan(Math.min(height * 0.4, 400));
    // Nothing to scroll.
    const scrolls = await page
      .locator('.review-screen')
      .evaluate((element) => element.scrollHeight - element.clientHeight);
    expect(scrolls, `scroll at ${name}`).toBeLessThanOrEqual(0);
    await capture(page, testInfo, `fit-${name}`);
  }
});

async function openDeck(page: Page) {
  await installAuthRoutes(page, { signedIn: true });
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
    if (path === `/api/v1/games/${gameId}/commands`) return json(route, { commands: [voicesCommand()] });
    if (path === `/api/v1/games/${gameId}/review-drafts`) return json(route, { drafts: [] });
    if (path.startsWith(`/api/v1/games/${gameId}/review-drafts/`)) return route.fulfill({ status: 204 });
    if (path === `/api/v1/games/${gameId}/commands/${DECISION}/answer`) {
      answerBodies.push(JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>);
      return json(route, { status: 'answered', decision_id: DECISION, option_id: 'pip' });
    }
    if (path === '/api/v1/jobs' || path === '/api/v1/jobs/active') return json(route, { jobs: [] });
    return json(route, { error: 'not_mocked', path }, 404);
  });
  await page.route('**/api.example.test/blobs/sha256/*', (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop()!;
    const index = Number(name.split('.')[0]);
    if (name.endsWith('.svg')) return route.fulfill({ contentType: 'image/svg+xml', body: portrait(index) });
    return route.fulfill({ contentType: 'audio/wav', body: toneWav(1.5, 220 + index * 40) });
  });
  await page.goto('/blobs/review/1');
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
