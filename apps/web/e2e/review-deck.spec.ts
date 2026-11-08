import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test';

import type { GameCommand } from '@ogm/contracts';

import { installAuthRoutes } from './fixtures/auth-routes';

// The review deck's first real decks (A3): the Blobs' six voice samples (Open-Games #53) and the 3x3 image-mock matrix
// (Open-Games games/blobs/review/mock-matrix). Each Command opens as one link on a phone and judges its cards one at a
// time; the answer carries the whole like/dislike map with the creator's reasons.
const gameId = 'g_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e01';

const VOICE_DECK = 'cp_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e72';
const IMAGE_DECK = 'cp_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e75';

const answerBodies: Array<Record<string, unknown>> = [];

// One set-level note the creator adds on the summary, beside the per-card votes and reasons.
const SET_NOTES = 'All six read too young for the Blobs; keep the two warm ones and pitch them down.';

// A 16-bit PCM WAV of the given length, so the audio card has something real to play.
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

// Two seconds: long enough that the autoplay check runs while the sample is still playing on a fast desktop run.
const WAV = silentWav(2);

// A still per card, drawn as an SVG so the image deck needs no binary fixtures.
function cardSvg(index: number): string {
  const hue = (index * 40) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320">
  <rect width="320" height="320" fill="hsl(${hue} 32% 28%)"/>
  <circle cx="160" cy="150" r="86" fill="hsl(${hue} 44% 52%)"/>
  <circle cx="126" cy="132" r="20" fill="#282828"/>
  <circle cx="194" cy="132" r="20" fill="#282828"/>
  <path d="M112 190 Q160 226 208 190" stroke="#282828" stroke-width="12" fill="none" stroke-linecap="round"/>
  <text x="160" y="288" font-family="sans-serif" font-size="40" fill="#ebdbb2" text-anchor="middle">${index + 1}</text>
</svg>`;
}

function voiceCommand(): GameCommand {
  return {
    job_id: 'j_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e6f',
    ticket: '570',
    title: 'Pick the Blobs voices',
    checkpoint_id: VOICE_DECK,
    decision_id: 'd_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e73',
    version: 2,
    question: 'Which voice should the Blobs use?',
    options: Array.from({ length: 6 }, (_, index) => ({
      id: `v${index + 1}`,
      label: `Voice ${index + 1}`,
      media: {
        url: `https://media.example.test/voices/v${index + 1}.wav`,
        width: 320,
        height: 320,
        duration_ms: 2000,
      },
    })),
    recommend: 'v2',
    blocking: true,
    pick: 'one',
    opened_at: '2026-11-07T17:40:00.000Z',
    review_number: 1,
  };
}

function imageCommand(): GameCommand {
  return {
    job_id: 'j_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e74',
    ticket: '570',
    title: 'Pick the Blobs look',
    checkpoint_id: IMAGE_DECK,
    decision_id: 'd_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e76',
    version: 3,
    question: 'Which Blobs look should the mock matrix keep?',
    options: Array.from({ length: 9 }, (_, index) => ({
      id: `m${index + 1}`,
      label: `Mock ${index + 1}`,
      media: {
        url: `https://media.example.test/matrix/m${index + 1}.svg`,
        width: 320,
        height: 320,
      },
    })),
    recommend: 'm5',
    blocking: true,
    pick: 'many',
    opened_at: '2026-11-07T17:41:00.000Z',
    review_number: 2,
  };
}

// A Command opened with no short summary (#594): aiur's own Decision API then hands the whole question over as the
// title, the way Kevin's phone showed it. The screen still heads it with a few words.
const LONG_QUESTION =
  'Which of these two voices should the Blobs use for their idle chatter, given that the narrator already sits ' +
  'in the low register and the hub music leaves little room in the mids? Pick the one that reads as small and warm ' +
  'on a phone speaker without getting lost under the music.';

function longCommand(): GameCommand {
  return {
    ...voiceCommand(),
    title: LONG_QUESTION,
    checkpoint_id: 'cp_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e77',
    decision_id: 'd_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e78',
    question: LONG_QUESTION,
    options: voiceCommand().options.slice(0, 2),
    review_number: 3,
  };
}

test.use({ serviceWorkers: 'block', video: 'on' });

test.beforeEach(() => {
  answerBodies.length = 0;
});

test('judges the 6-card voice deck and sends the review with its reasons', async ({ page }, testInfo) => {
  testInfo.setTimeout(120_000);
  await openDeck(page, voiceCommand().review_number!);

  const deck = page.getByRole('region', { name: 'Review Pick the Blobs voices' });
  await expect(deck).toBeVisible();
  await expect(page.locator('.review-deck-progress')).toHaveText('1 of 6');

  // The audio card plays as it appears and offers one tap to hear it again.
  const audio = page.locator('audio').first();
  await expect(audio).toHaveAttribute('src', 'https://media.example.test/voices/v1.wav');
  await expect(page.getByRole('button', { name: 'Replay Voice 1' })).toBeVisible();
  // The card says how long the sample runs, so a long take can be judged without playing all of it.
  await expect(page.locator('.review-deck-length').first()).toHaveText('0:02');
  // The sample really loaded and really played: a refused autoplay would leave the replay button as the only way in.
  await expect.poll(() => audio.evaluate((element) => element.duration)).toBeGreaterThan(0.5);
  await expect(audio.evaluate((element) => element.paused)).resolves.toBe(false);
  // The card is the width of the phone it is judged on, not a thumbnail in a list.
  const card = await deck.locator('.review-deck-card').boundingBox();
  expect(card!.width).toBeGreaterThan(280);
  await capture(page, testInfo, 'voice-deck-card-1');

  // A tap on the card plays the sample again, and never opens the full-screen viewer a still opens.
  const played = await audio.evaluate((element) => {
    const media = element as HTMLAudioElement;
    media.pause();
    return media.paused;
  });
  expect(played).toBe(true);
  await deck
    .locator('.review-deck-card')
    .first()
    .click({ position: { x: 20, y: 20 } });
  await expect(audio.evaluate((element) => element.paused)).resolves.toBe(false);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Like the first, dislike the second with the creator's words, then judge the rest.
  await judgeCard(page, 'like');
  await expect(page.locator('.review-deck-progress')).toHaveText('2 of 6');
  await expect(page.getByRole('button', { name: 'Replay Voice 2' })).toBeVisible();
  await judgeCard(page, 'dislike', 'Too robotic; the sibilants hiss');
  await expect(page.locator('.review-deck-progress')).toHaveText('3 of 6');
  await judgeCard(page, 'like');
  await judgeCard(page, 'dislike');
  await judgeCard(page, 'like');
  await judgeCard(page, 'like');

  // The deck ends on a grid of likes then dislikes; a one-pick Command turns the likes into the shortlist to choose from.
  await expect(page.getByRole('heading', { name: 'Likes', exact: true })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Likes', exact: true }).getByRole('button')).toHaveCount(4);
  await expect(
    page.getByRole('list', { name: 'Dislikes', exact: true }).getByRole('button', { name: /^Like / }),
  ).toHaveCount(2);
  // The summary carries one optional note for the whole set, beside the per-card reasons.
  await page.getByLabel('Anything else about the set?').fill(SET_NOTES);
  await capture(page, testInfo, 'voice-deck-ended');

  await page.getByRole('button', { name: 'Choose Voice 5' }).click();

  await expect(page.getByRole('heading', { name: 'Review sent' })).toBeVisible();
  expect(answerBodies).toEqual([
    {
      option_id: 'v5',
      review: {
        likes: ['v1', 'v3', 'v5', 'v6'],
        dislikes: [{ option_id: 'v2', reason: 'Too robotic; the sibilants hiss' }, { option_id: 'v4' }],
        notes: SET_NOTES,
      },
    },
  ]);
  await capture(page, testInfo, 'voice-deck-sent');
});

test('judges the 9-card image deck with the arrow keys and sends the review', async ({ page }, testInfo) => {
  testInfo.setTimeout(120_000);
  await openDeck(page, imageCommand().review_number!);

  const deck = page.getByRole('region', { name: 'Review Pick the Blobs look' });
  await expect(deck).toBeVisible();
  await expect(page.locator('.review-deck-progress')).toHaveText('1 of 9');
  const firstCard = page.locator('.review-deck-card img').first();
  await expect(firstCard).toHaveAttribute('src', 'https://media.example.test/matrix/m1.svg');
  // The still drew: a broken image would report a zero natural size.
  await expect.poll(() => firstCard.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  // The whole still shows, not a cropped preview: the box takes the sample's own 1:1 shape and contains the image
  // (clamped to the viewport height, so the image is letterboxed rather than cut).
  await expect(firstCard).toHaveCSS('object-fit', 'contain');
  await expect
    .poll(() =>
      firstCard.evaluate((image) => {
        const element = image as HTMLImageElement;
        return element.naturalWidth === element.naturalHeight && element.naturalWidth > 0;
      }),
    )
    .toBe(true);
  const stillBox = (await firstCard.boundingBox())!;
  const cardBox = (await page.locator('.review-deck-card').first().boundingBox())!;
  // The still spans the card's full width instead of sitting in a thumbnail-sized frame.
  expect(stillBox.width).toBeGreaterThan(cardBox.width - 4);
  expect(stillBox.width).toBeGreaterThan(280);
  await capture(page, testInfo, 'image-deck-card-1');

  // Tapping the still opens it at the phone's full size, and Close returns to the same card.
  await firstCard.click();
  const viewer = page.getByRole('dialog', { name: 'Mock 1' });
  await expect(viewer).toBeVisible();
  await expect(viewer.locator('img')).toHaveAttribute('src', 'https://media.example.test/matrix/m1.svg');
  await expect(page.locator('.review-deck-progress')).toHaveText('1 of 9');
  await capture(page, testInfo, 'image-deck-fullscreen');
  await viewer.getByRole('button', { name: 'Close' }).click();
  await expect(viewer).toHaveCount(0);
  await expect(page.locator('.review-deck-progress')).toHaveText('1 of 9');

  // The arrow keys are the same two actions as the thumbs buttons, so the deck judges without a pointer.
  await deck.focus();
  for (let card = 1; card <= 4; card += 1) await page.keyboard.press('ArrowRight');
  await expect(page.locator('.review-deck-progress')).toHaveText('5 of 9');

  // Undo takes the last judgement back and leaves the creator on that card.
  await page.getByRole('button', { name: 'Undo the last swipe' }).click();
  await expect(page.locator('.review-deck-progress')).toHaveText('4 of 9');
  await judgeCard(page, 'like');

  await judgeCard(page, 'dislike', 'The ears read as horns');
  for (let card = 6; card <= 8; card += 1) await judgeCard(page, 'like');
  await judgeCard(page, 'dislike');

  await expect(page.getByRole('heading', { name: 'Likes', exact: true })).toBeVisible();
  const likedGrid = page.getByRole('list', { name: 'Likes', exact: true });
  await expect(likedGrid.getByRole('button', { name: /^Dislike / })).toHaveCount(7);
  // The ending grid shows the whole sample too, never a cropped preview.
  await expect(likedGrid.locator('img')).toHaveCount(7);
  await expect(likedGrid.locator('img').first()).toHaveCSS('object-fit', 'contain');
  // The summary carries one optional note for the whole set, beside the per-card reasons.
  await page.getByLabel('Anything else about the set?').fill('The ears read as horns on all of these.');
  await capture(page, testInfo, 'image-deck-ended');

  // A grid thumbnail opens the same full-screen view.
  await page.getByRole('button', { name: 'Open Mock 2 full screen' }).click();
  const gridViewer = page.getByRole('dialog', { name: 'Mock 2' });
  await expect(gridViewer).toBeVisible();
  await expect(gridViewer.locator('img')).toHaveAttribute('src', 'https://media.example.test/matrix/m2.svg');
  await gridViewer.getByRole('button', { name: 'Close' }).click();
  await expect(gridViewer).toHaveCount(0);

  // A Command that asks for many sends the likes and dislikes as the answer, so the shortlist stays a shortlist. The
  // set-level note travels beside them.
  await page.getByRole('button', { name: 'Send the review' }).click();

  await expect(page.getByRole('heading', { name: 'Review sent' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close' })).toBeVisible();
  expect(answerBodies).toEqual([
    {
      option_id: 'm1',
      review: {
        likes: ['m1', 'm2', 'm3', 'm4', 'm6', 'm7', 'm8'],
        dislikes: [{ option_id: 'm5', reason: 'The ears read as horns' }, { option_id: 'm9' }],
        notes: 'The ears read as horns on all of these.',
      },
    },
  ]);
  await capture(page, testInfo, 'image-deck-sent');
});

test('heads a long-question review with a short title, an X and nothing over the deck', async ({ page }, testInfo) => {
  await openDeck(page, longCommand().review_number!);
  await page.getByRole('button', { name: 'Like', exact: true }).waitFor();
  await capture(page, testInfo, 'long-question');

  // The title is a few words of the question, never the question itself.
  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toHaveText('Which of these two voices…');
  await expect(page.getByRole('button', { name: 'Back to the game' })).toHaveCount(0);

  // The whole question waits in a collapsed line under the options and opens with a tap.
  const body = page.locator('.review-screen-question');
  const deckBottom = await page.locator('.review-deck').evaluate((element) => element.getBoundingClientRect().bottom);
  const bodyTop = await body.evaluate((element) => element.getBoundingClientRect().top);
  expect(bodyTop).toBeGreaterThanOrEqual(deckBottom);
  await expect(body).toHaveJSProperty('open', false);
  const closedHeight = (await body.boundingBox())!.height;
  await body.getByText(LONG_QUESTION, { exact: true }).click();
  await expect(body).toHaveJSProperty('open', true);
  expect((await body.boundingBox())!.height).toBeGreaterThan(closedHeight * 2);
  await body.scrollIntoViewIfNeeded();
  await capture(page, testInfo, 'long-question-open');

  // The screen is the deck's alone: no app menu, logo or chat dock floats over it. Checked by style, not visibility, so
  // an empty dock cannot pass for a hidden one.
  for (const chrome of ['.studio-menu-control', '.studio-logo', '#chat-dock-slot']) {
    await expect(page.locator(chrome)).toHaveCSS('display', 'none');
  }
  // Nothing sits over the X: the point at its centre hits the button itself.
  const close = page.getByRole('button', { name: 'Close' });
  const box = (await close.boundingBox())!;
  const hit = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x!, y!)?.closest('button')?.getAttribute('aria-label'),
    [box.x + box.width / 2, box.y + box.height / 2],
  );
  expect(hit).toBe('Close');
  const viewport = page.viewportSize()!;
  expect(box.x + box.width).toBeGreaterThan(viewport.width - 80);
  await close.click();
  await expect(page).toHaveURL(/\/all\?spotlight=/);
});

// The short link the Executor pushes (#591): the game's slug and the Command's number inside the game.
async function openDeck(page: Page, reviewNumber: number) {
  await installAuthRoutes(page, { signedIn: true });
  await installReviewApi(page);
  await page.goto(`/blobs/review/${reviewNumber}`);
}

// The two decks and the answer route the app's own client calls. Media is served from its own origin so the cards have
// real audio and stills to draw.
async function installReviewApi(page: Page) {
  const commands = [voiceCommand(), imageCommand(), longCommand()];
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
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
    if (path === `/api/v1/games/${gameId}/commands`) return json(route, { commands });
    if (path === '/api/v1/jobs' || path === '/api/v1/jobs/active') return json(route, { jobs: [] });
    if (path.endsWith('/chat/messages')) return json(route, { messages: [], last_seq: 0 });
    if (/\/jobs\/[^/]+\/checkpoints\/[^/]+\/answer$/.test(path)) {
      answerBodies.push(JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>);
      return json(route, {
        status: 'answered',
        decision_id: 'd_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e73',
        option_id: 'v1',
      });
    }
    if (path.endsWith('/checkpoints/budget')) return json(route, { used: 0, max: 3 });
    return json(route, { error: 'not_mocked', path }, 404);
  });
  await page.route('**/media.example.test/voices/*.wav', (route) =>
    route.fulfill({ contentType: 'audio/wav', body: WAV }),
  );
  await page.route('**/media.example.test/matrix/*.svg', (route) => {
    const match = /m(\d+)\.svg$/.exec(new URL(route.request().url()).pathname);
    const index = match ? Number(match[1]) - 1 : 0;
    return route.fulfill({ contentType: 'image/svg+xml', body: cardSvg(index) });
  });
}

// One judgement on the card on screen. A dislike opens its reason sheet in the same tap, so the test closes it with the
// creator's words or with Skip.
async function judgeCard(page: Page, kind: 'like' | 'dislike', reason?: string) {
  await page.getByRole('button', { name: kind === 'like' ? 'Like' : 'Dislike', exact: true }).click();
  if (kind === 'like') return;
  const sheet = page.getByRole('dialog', { name: /^Why did you dislike/ });
  await expect(sheet).toBeVisible();
  if (reason === undefined) {
    await sheet.getByRole('button', { name: 'Skip' }).click();
  } else {
    await sheet.getByLabel(/^Reason for disliking/).fill(reason);
    await sheet.getByRole('button', { name: 'Add the reason' }).click();
  }
  await expect(sheet).toHaveCount(0);
}

// A still per visible step, attached to the run so the desktop and phone evidence sits beside the clip Playwright
// records for each test.
async function capture(page: Page, testInfo: TestInfo, name: string) {
  await page.waitForTimeout(150);
  const path = testInfo.outputPath(`${name}-${testInfo.project.name}.png`);
  await page.screenshot({ path });
  await testInfo.attach(`${name}-${testInfo.project.name}`, { path, contentType: 'image/png' });
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}
