import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test';

import type { GameCommand } from '@ogm/contracts';

import { installAuthRoutes } from './fixtures/auth-routes';

// The review deck's first real decks (A3): the Blobs' six voice samples (Open-Games #53) and the 3x3 image-mock matrix
// (Open-Games games/blobs/review/mock-matrix). Each Command opens as one link on a phone and judges its cards one at a
// time; once every card has a vote the deck answers with the whole like/dislike map and the creator's reasons (#631).
const gameId = 'g_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e01';

const VOICE_DECK = 'cp_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e72';
const IMAGE_DECK = 'cp_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e75';

const answerBodies: Array<Record<string, unknown>> = [];
// Every vote is saved on the server as it is cast (#631): the draft bodies in the order they were sent.
const draftBodies: Array<{ cards: unknown[] }> = [];

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

// Reduced motion holds the review's drifting glows still: under CI's software renderer, repainting them every frame
// starves screenshots and clicks past the test timeout.
test.use({ serviceWorkers: 'block', video: 'on', reducedMotion: 'reduce' });

test.beforeEach(() => {
  answerBodies.length = 0;
  draftBodies.length = 0;
});

test('judges the 6-card voice deck and answers once every card has a vote', async ({ page }, testInfo) => {
  testInfo.setTimeout(120_000);
  await openDeck(page, voiceCommand().review_number!);

  const deck = page.getByRole('region', { name: 'Review Pick the Blobs voices' });
  await expect(deck).toBeVisible();
  await expect(page.locator('.review-deck-progress')).toHaveText('1 of 6');
  // No Send: the votes are the only controls, undo first, then thumbs down, then thumbs up.
  expect(
    await deck.getByRole('button').evaluateAll((buttons) => buttons.map((b) => b.getAttribute('aria-label'))),
  ).toEqual(['Undo the last swipe', 'Dislike', 'Like']);

  // The audio card plays as it appears.
  const audio = deck.locator('audio');
  await expect(audio).toHaveAttribute('src', 'https://media.example.test/voices/v1.wav');
  // The card says how long the sample runs, so a long take can be judged without playing all of it.
  await expect(page.locator('.review-deck-length').first()).toHaveText('0:02');
  // The sample really loaded and really played.
  await expect.poll(() => audio.evaluate((element) => element.duration)).toBeGreaterThan(0.5);
  await expect(audio.evaluate((element) => element.paused)).resolves.toBe(false);
  // The card is the width of the phone it is judged on, not a thumbnail in a list.
  const card = await deck.locator('.review-deck-card').boundingBox();
  expect(card!.width).toBeGreaterThan(280);
  await capture(page, testInfo, 'voice-deck-card-1');

  // A tap on the card plays the sample again, and never opens the full-screen viewer a still opens.
  await audio.evaluate((element) => (element as HTMLAudioElement).pause());
  await deck
    .locator('.review-deck-card')
    .first()
    .click({ position: { x: 40, y: 40 } });
  await expect(audio.evaluate((element) => element.paused)).resolves.toBe(false);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Like the first, dislike the second with the creator's words, then judge the rest.
  await judgeCard(page, 'like');
  await expect(page.locator('.review-deck-progress')).toHaveText('2 of 6');
  // The next card's voice is already playing: it started inside the vote.
  await expect(audio).toHaveAttribute('src', 'https://media.example.test/voices/v2.wav');
  await judgeCard(page, 'dislike', 'Too robotic; the sibilants hiss');
  await expect(page.locator('.review-deck-progress')).toHaveText('3 of 6');
  await judgeCard(page, 'like');
  await judgeCard(page, 'dislike');
  await judgeCard(page, 'like');
  expect(answerBodies).toEqual([]);
  await judgeCard(page, 'like');

  // The last vote answers the Command with the whole map.
  await expect(page.getByRole('heading', { name: 'Review sent' })).toBeVisible();
  expect(answerBodies).toEqual([
    {
      option_id: 'v1',
      review: {
        likes: ['v1', 'v3', 'v5', 'v6'],
        dislikes: [{ option_id: 'v2', reason: 'Too robotic; the sibilants hiss' }, { option_id: 'v4' }],
      },
    },
  ]);
  // Each vote was saved as a draft on the way.
  await expect.poll(() => draftBodies.at(-1)?.cards.length).toBe(6);
  await capture(page, testInfo, 'voice-deck-sent');
});

test('judges the 9-card image deck with the arrow keys and answers on the last vote', async ({ page }, testInfo) => {
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
  await page.locator('.review-deck-card').first().click();
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

  // A Command that asks for many answers with the likes and dislikes as soon as the last card has its vote.
  await expect(page.getByRole('heading', { name: 'Review sent' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close' })).toBeVisible();
  expect(answerBodies).toEqual([
    {
      option_id: 'm1',
      review: {
        likes: ['m1', 'm2', 'm3', 'm4', 'm6', 'm7', 'm8'],
        dislikes: [{ option_id: 'm5', reason: 'The ears read as horns' }, { option_id: 'm9' }],
      },
    },
  ]);
  await capture(page, testInfo, 'image-deck-sent');
});

test('heads a long-question review with a short title, an X and nothing over the deck', async ({ page }, testInfo) => {
  testInfo.setTimeout(120_000);
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
  // The X closes the deck onto the game's rows; the rows' X goes back to the game.
  await close.click();
  await expect(page).toHaveURL(/\/blobs\/review$/);
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page).toHaveURL(/\/all\?spotlight=/);
});

// The inbox as rows: every open question with its first sample, a short title and its state. A tap opens a deck, each
// question keeps its own draft, and swiping the last card answers it.
test('opens questions from the rows, keeps each draft and answers one by swipe', async ({ page }, testInfo) => {
  testInfo.setTimeout(120_000);
  await installAuthRoutes(page, { signedIn: true });
  await installReviewApi(page);
  await page.goto('/blobs/review');

  const rows = page.getByRole('list', { name: 'Reviews' });
  await expect(rows.getByRole('link')).toHaveCount(3);
  await expect(rows.getByRole('link', { name: 'Pick the Blobs voices, open' })).toBeVisible();
  await expect(rows.getByRole('link', { name: 'Which of these two voices…, open' })).toBeVisible();
  const lookThumb = rows.getByRole('link', { name: 'Pick the Blobs look, open' }).locator('img');
  await expect.poll(() => lookThumb.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  // The review is the glossy surface: the glows sit behind it, not a flat panel.
  await expect(page.locator('.glow-backdrop span')).toHaveCount(5);
  await capture(page, testInfo, 'rows-open');

  // Open the look and judge two of its cards.
  await rows.getByRole('link', { name: 'Pick the Blobs look, open' }).click();
  await expect(page).toHaveURL(/\/blobs\/review\/2$/);
  await judgeCard(page, 'like');
  await judgeCard(page, 'like');
  await expect(page.locator('.review-deck-progress')).toHaveText('3 of 9');
  // A card shows its letter, not a sentence.
  await expect(page.locator('.review-deck-label')).toHaveText('C');
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(rows.getByRole('link', { name: 'Pick the Blobs look, draft' })).toBeVisible();

  // Answer the third question by swiping: right likes A, left dislikes B, and that last vote answers it.
  await rows.getByRole('link', { name: 'Which of these two voices…, open' }).click();
  await expect(page).toHaveURL(/\/blobs\/review\/3$/);
  await expect(page.locator('.review-deck-progress')).toHaveText('1 of 2');
  await swipe(page, 'right');
  await expect(page.locator('.review-deck-progress')).toHaveText('2 of 2');
  await swipe(page, 'left');
  await page
    .getByRole('dialog', { name: /^Why did you dislike/ })
    .getByRole('button', { name: 'Skip' })
    .click();
  await expect(page.getByRole('heading', { name: 'Review sent' })).toBeVisible();
  expect(answerBodies).toEqual([{ option_id: 'v1', review: { likes: ['v1'], dislikes: [{ option_id: 'v2' }] } }]);

  // Back on the rows: the swiped question is sent and the look is still a draft.
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page).toHaveURL(/\/blobs\/review$/);
  await expect(rows.getByRole('link', { name: 'Which of these two voices…, sent' })).toBeVisible();
  await expect(rows.getByRole('link', { name: 'Pick the Blobs look, draft' })).toBeVisible();
  await capture(page, testInfo, 'rows-after');
});

// A finger drag across the card on screen, far enough to count as a swipe.
async function swipe(page: Page, direction: 'left' | 'right') {
  // Start below the letter, where a drag moves the card.
  const box = (await page.locator('.review-deck-card').first().boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height * 0.2;
  const dx = direction === 'right' ? 240 : -240;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 8; step += 1) await page.mouse.move(x + (dx * step) / 8, y);
  await page.mouse.up();
}

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
    if (path === `/api/v1/games/${gameId}/review-drafts`) return json(route, { drafts: [] });
    if (path.startsWith(`/api/v1/games/${gameId}/review-drafts/`)) {
      draftBodies.push((JSON.parse(route.request().postData() ?? '{}') as { deck: { cards: unknown[] } }).deck);
      return route.fulfill({ status: 204 });
    }
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
