import { expect, test, type Locator, type Page, type Route, type TestInfo } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { openReviewDeck, openReviewItem } from '../../../packages/gm-cli/src/qa-review-checks';
import { installAuthRoutes } from './fixtures/auth-routes';
import { isGameLaunch } from './support/game-launch';

// #1133: the in-app Needs Review deck against the review page Kevin used until now (#1124 items 1-9). One fixture per
// kind of card the page shows: a game's like/dislike Command, an inventory decision, a NUC core matrix with an
// original and a pipeline row, a PC core clip deck, and a prototype round. Each test walks one item on a 390x844
// phone and leaves a still in the run for docs/review-parity.md.
const gameId = 'g_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e81';
const FIXTURES = resolve(import.meta.dirname, '../../../packages/gm-cli/qa/review-e2e');
// eslint-disable-next-line no-restricted-properties
const gamesOrigin = `http://127.0.0.1:${process.env.OGM_WEB_BRIDGE_PORT ?? '10001'}`;
const bridgeDesign = JSON.parse(
  readFileSync(resolve(import.meta.dirname, 'fixtures/bridge-game/design/design.json'), 'utf8'),
) as unknown;

const meta = (kind: string, extra: Record<string, unknown> = {}) => ({
  kind,
  model: 'gpt-image-1',
  cost_usd: 0.04,
  skill: 'gm-image-mock',
  tool: 'route_media',
  created_at: '2026-11-22T09:15:00.000Z',
  ai_generated: true,
  ...extra,
});

const still = (name: string) => ({
  url: `https://media.example.test/${name}.svg`,
  kind: 'image',
  width: 320,
  height: 320,
});

// A game's Command from its NUC games daemon: three looks, liked or disliked one by one.
const fontCommand = () => ({
  game_id: gameId,
  game_title: 'Moon Vault',
  job_id: null,
  ticket: '211',
  title: 'HUD font',
  summary: 'HUD font',
  command_id: 'd_font',
  decision_id: 'd_font',
  version: 1,
  question: 'Which HUD font reads best on a phone?',
  options: [
    { id: 'serif', label: 'Serif', media: still('serif'), meta: meta('image generation') },
    { id: 'mono', label: 'Mono', media: still('mono'), meta: meta('image generation') },
    {
      id: 'pixel',
      label: 'Pixel',
      media: still('pixel'),
      meta: meta('pack original', { model: undefined, cost_usd: null, ai_generated: false }),
    },
  ],
  recommend: 'mono',
  blocking: false,
  pick: 'many',
  opened_at: '2026-11-22T09:00:00.000Z',
});

// An inventory decision (docs/<slug>/decisions.json): `gm decisions raise` posts it as a creator Command.
const inventoryCommand = () => ({
  ...fontCommand(),
  ticket: '214',
  title: 'Torch style',
  summary: 'Torch style',
  command_id: 'd_torch',
  decision_id: 'd_torch',
  question: 'Which torch fits the vault?',
  options: [
    { id: 'iron', label: 'Iron', media: still('iron') },
    { id: 'brass', label: 'Brass', media: still('brass') },
  ],
  recommend: 'iron',
  opened_at: '2026-11-22T09:05:00.000Z',
  // A `phase:mock` ticket: the card carries the phase strip and its Approve button (#1124).
  phase: 'mock',
});

// The NUC core daemon's matrix: each row leads with the original, and the knight's row is a pipeline.
const matrixCommand = () => ({
  source: 'core',
  job_id: null,
  ticket: '1201',
  title: 'Clone variants',
  summary: 'Clone variants',
  command_id: 'd_matrix',
  decision_id: 'd_matrix',
  version: 1,
  question: 'Which clone variants keep the pack look?',
  options: [
    {
      id: 'tower-orig',
      label: 'Tower',
      media: still('tower-orig'),
      meta: meta('pack original', { model: undefined, cost_usd: null, ai_generated: false }),
      layout: { row: 'Tower', stage: 'original' },
    },
    {
      id: 'tower-tall',
      label: 'Tall tower',
      media: still('tower-tall'),
      meta: meta('3D model render', { model: 'blender', cost_usd: null }),
      layout: { row: 'Tower', stage: 'candidate' },
    },
    {
      id: 'tower-short',
      label: 'Short tower',
      media: still('tower-short'),
      meta: meta('3D model render', { model: 'blender', cost_usd: null }),
      layout: { row: 'Tower', stage: 'candidate' },
    },
    {
      id: 'knight-2d',
      label: 'Knight pixel',
      media: still('knight-2d'),
      meta: meta('3D→2D sprite', { model: undefined, cost_usd: null }),
      layout: { row: 'Knight', stage: '2d' },
    },
    {
      id: 'knight-orig',
      label: 'Knight',
      media: still('knight-orig'),
      meta: meta('pack original', { model: undefined, cost_usd: null, ai_generated: false }),
      layout: { row: 'Knight', stage: 'original' },
    },
    {
      id: 'knight-3d',
      label: 'Knight 3D',
      media: still('knight-3d'),
      meta: meta('3D model render', { model: 'trellis' }),
      layout: { row: 'Knight', stage: '3d' },
    },
  ],
  blocking: false,
  pick: 'many',
  opened_at: '2026-11-22T09:10:00.000Z',
});

// The PC core daemon's Command: looping clips and a sound to judge.
const pcCommand = () => ({
  source: 'core',
  daemon: 'pc',
  job_id: null,
  ticket: '88',
  title: 'Walk cycle',
  summary: 'Walk cycle',
  command_id: 'd_walk',
  decision_id: 'd_walk',
  version: 1,
  question: 'Which walk loop and footstep?',
  options: [
    {
      id: 'walk-a',
      label: 'Walk A',
      media: { url: '/qa-media/clip.mp4', kind: 'video', width: 100, height: 100 },
      meta: meta('in-game capture', { model: undefined, cost_usd: null, ai_generated: false }),
    },
    { id: 'step', label: 'Footstep', media: { url: '/qa-media/sound.mp3', kind: 'audio' } },
  ],
  recommend: 'walk-a',
  blocking: false,
  pick: 'many',
  opened_at: '2026-11-22T09:12:00.000Z',
});

// A prototype review: the play link, the clip, what works, what doesn't and what to weigh in on.
const prototypeRound = () => ({
  id: 'r_proto',
  ticket: '215',
  question: 'Moon gate prototype',
  track: 'prototype-publish',
  buildId: 'b_proto',
  playUrl: `https://app.example.test/g/${gameId}?mode=edit&build=b_proto`,
  clipStatus: 'captured',
  works: ['The gate opens at full moon', 'Phone controls'],
  limitations: ['No sound yet'],
  decisionIds: ['gate-colour'],
  media: [
    {
      kind: 'clip',
      url: '/qa-media/clip.mp4',
      meta: meta('in-game capture', { model: undefined, cost_usd: null, ai_generated: false }),
    },
  ],
});

type Answer = { path: string; body: Record<string, unknown>; at: number };
type Api = { answers: Answer[]; roundAnswers: Record<string, unknown>[] };

// The iPhone 13 project brings touch and a phone user agent; the viewport is the full 390x844 screen the page was judged on.
test.use({ serviceWorkers: 'block', reducedMotion: 'reduce', viewport: { width: 390, height: 844 } });

test.skip(({ isMobile }) => !isMobile, 'phone parity only');

test("every source reaches one deck and each answer reaches its worker in Kevin's words (items 1, 8, 9)", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const api = await install(page);
  const dialog = await openReviewDeck(page, 20_000, 'HUD font', [
    'Moon gate prototype',
    'HUD font',
    'Torch style',
    'Clone variants',
    'Walk cycle',
  ]);
  expect(page.viewportSize()).toEqual({ width: 390, height: 844 });

  // Item 8: the Recommended line sits above the options, and nothing runs off the side of the phone.
  const card = dialog.getByRole('region', { name: 'HUD font' });
  const recommended = card.getByText('Recommended: B: Mono');
  await expect(recommended).toBeVisible();
  expect((await recommended.boundingBox())!.y).toBeLessThan(
    (await card.locator('.worker-review-options').boundingBox())!.y,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await capture(page, testInfo, 'parity-command-card');

  // Item 1: like one, dislike another with a reason, note the liked one and the whole card.
  await card.getByRole('button', { name: 'View option B' }).click();
  await rate(card, 'B: Mono', '👍');
  await card.getByLabel('Note for B (optional)').fill('Mono, one size bigger');
  await card.getByRole('button', { name: 'View option A' }).click();
  await rate(card, 'A: Serif', '👎');
  await card.getByLabel('Note for A (optional)').fill('Serif blurs at 12 px');
  await card.getByLabel('Note (optional)').first().fill('Keep the HUD quiet');
  // Every tappable control on the card is big enough for a thumb.
  for (const button of await card.getByRole('button').all()) {
    if (await button.isVisible()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(32);
  }
  const sent = Date.now();
  await card.getByRole('button', { name: 'Send' }).click();
  await expect(card.getByRole('status')).toContainText('Saved · sent to agent');
  // Item 9: the answer leaves the phone in Kevin's exact words (the worker-side minute is timed live in the doc).
  const font = api.answers.find(({ path }) => path === `/api/v1/games/${gameId}/commands/d_font/answer`)!;
  expect(font.at - sent).toBeLessThan(5_000);
  expect(font.body).toEqual({
    option_id: 'mono',
    version: 1,
    review: {
      likes: ['mono'],
      dislikes: [{ option_id: 'serif', reason: 'Serif blurs at 12 px' }],
      liked_notes: [{ option_id: 'mono', reason: 'Mono, one size bigger' }],
      notes: 'Keep the HUD quiet',
    },
  });

  // Item 1: an inventory decision answered with a note alone.
  await reopen(page, 'Torch style');
  const torch = dialog.getByRole('region', { name: 'Torch style' });
  await torch.getByLabel('Note (optional)').first().fill('Neither; try a lantern');
  await torch.getByRole('button', { name: 'Send' }).click();
  await expect(torch.getByRole('status')).toContainText('Saved');
  expect(api.answers.find(({ path }) => path.endsWith('/commands/d_torch/answer'))!.body).toEqual({
    option_id: 'iron',
    version: 1,
    review: { likes: [], dislikes: [], notes: 'Neither; try a lantern' },
  });

  // Item 9: the PC core daemon's Command answers through the PC daemon, None of these.
  await reopen(page, 'Walk cycle');
  const walk = dialog.getByRole('region', { name: 'Walk cycle' });
  await walk.getByRole('button', { name: 'None of these' }).click();
  await expect(walk.getByRole('status')).toContainText('Ticket state: in-review');
  const pc = api.answers.find(({ path }) => path.includes('/core/commands/d_walk/answer'))!;
  expect(pc.path).toBe('/api/v1/core/commands/d_walk/answer?daemon=pc');
  expect(pc.body.review).toEqual({ likes: [], dislikes: [{ option_id: 'walk-a' }, { option_id: 'step' }] });
  await capture(page, testInfo, 'parity-sources-answered');
});

test('matrix cards: original first, pipeline in order, vote and note in place or enlarged (items 2, 5, 6)', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const api = await install(page);
  const dialog = await openReviewDeck(page, 20_000, 'Clone variants');
  const card = dialog.getByRole('region', { name: 'Clone variants' });

  // Item 6: the original leads every row; the pipeline row reads Original | 3D | 2D pixel whatever order it arrived in.
  const tower = card.getByRole('region', { name: 'Tower' });
  const knight = card.getByRole('region', { name: 'Knight' });
  await expect(tower.locator('.review-matrix-cell > p')).toHaveText(['Original', 'Tall tower', 'Short tower']);
  await expect(knight.locator('.review-matrix-cell > p')).toHaveText(['Original', 'Knight 3D', 'Knight pixel']);
  // The original is for comparison: it carries no vote.
  await expect(tower.getByRole('button', { name: 'Like Tower', exact: true })).toHaveCount(0);

  // Item 2: cells are at least 96 px and the row scrolls sideways rather than squeezing them.
  for (const cell of await card.locator('.review-matrix-cell').all()) {
    expect((await cell.boundingBox())!.width).toBeGreaterThanOrEqual(96);
  }
  const cells = tower.locator('.review-matrix-cells');
  expect(await cells.evaluate((row) => getComputedStyle(row).overflowX)).toBe('auto');

  // Item 5: metadata under every image, originals included.
  await expect(card.locator('.review-matrix-cell .media-meta')).toHaveCount(6);
  await expect(tower.locator('.media-meta').first()).toHaveText(
    'pack original · free · gm-image-mock · route_media · 09:15',
  );
  await expect(knight.locator('.media-meta').nth(1)).toHaveText(
    '3D model render · trellis · $0.04 · gm-image-mock · route_media · 09:15 · AI',
  );
  await capture(page, testInfo, 'parity-matrix');

  // Item 2: inline thumbs under a cell, then the enlarged view with the original beside it, the same buttons and a note.
  await card.getByRole('button', { name: 'Like Tall tower', exact: true }).click();
  await card.getByRole('button', { name: 'Enlarge Short tower' }).click();
  const zoom = page.getByRole('dialog', { name: 'Short tower' });
  await expect(zoom.locator('.review-matrix-compare img')).toHaveCount(2);
  await zoom.getByRole('button', { name: 'Dislike Short tower' }).click();
  await zoom.getByRole('textbox', { name: 'Note for Short tower' }).fill('Too squat for the skyline');
  await capture(page, testInfo, 'parity-matrix-enlarged');
  await zoom.getByRole('button', { name: 'Close' }).click();
  await card.getByRole('button', { name: 'Send' }).click();
  await expect(card.getByRole('status')).toContainText('Saved');
  const answer = api.answers.find(({ path }) => path.startsWith('/api/v1/core/commands/d_matrix/answer'))!;
  expect(answer.path).toBe('/api/v1/core/commands/d_matrix/answer');
  expect(answer.body.review).toEqual({
    likes: ['tower-tall'],
    dislikes: [{ option_id: 'tower-short', reason: 'Too squat for the skyline' }],
  });
});

test('clips loop muted inline and sound waits for a tap (item 3)', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await install(page);
  const dialog = await openReviewDeck(page, 20_000, 'Walk cycle');
  const card = dialog.getByRole('region', { name: 'Walk cycle' });
  const video = card.locator('video');
  await expect(video).toHaveJSProperty('muted', true);
  await expect(video).toHaveJSProperty('loop', true);
  await expect(video).toHaveAttribute('playsinline', '');
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0);
  await expect(card.locator('.media-meta')).toHaveText('in-game capture · free · gm-image-mock · route_media · 09:15');
  await capture(page, testInfo, 'parity-clip');

  await card.getByRole('button', { name: 'View option B' }).click();
  const audio = card.getByLabel('Footstep', { exact: true });
  await expect(audio).toHaveAttribute('controls', '');
  await page.waitForTimeout(1_000);
  await expect(audio).toHaveJSProperty('paused', true);
});

test('answered cards collapse to the title and the saved answer, and reopen to change (item 4)', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const api = await install(page);
  const dialog = await openReviewDeck(page, 20_000, 'HUD font');
  const card = dialog.getByRole('region', { name: 'HUD font' });
  await rate(card, 'A: Serif', '👍');
  await card.getByLabel('Note (optional)').first().fill('Serif after all');
  await card.getByRole('button', { name: 'Send' }).click();
  await expect(card.getByRole('status')).toContainText('Saved');

  await dialog.getByRole('button', { name: 'Next' }).click();
  const answered = dialog.getByRole('region', { name: 'Answered reviews' }).getByRole('button', { name: /^HUD font/ });
  await expect(answered).toContainText('Liked Serif · Serif after all');
  await capture(page, testInfo, 'parity-collapsed');

  // A closed Command reopens read-only: the saved answer, and the worker already has it.
  // The row is the session's copy until the ledger poll lands; either one reopens to the same answer.
  await answered.click();
  await expect(dialog.locator('.worker-review-saved')).toContainText('Liked Serif');
  await expect(dialog.locator('.worker-review-saved')).toContainText('Serif after all');
  await expect(dialog.getByRole('status')).toHaveText('The worker already has this answer.');

  // A core Command has no ledger: its row keeps the answer the deck sent, in Kevin's words.
  await reopen(page, 'Clone variants');
  const matrix = dialog.getByRole('region', { name: 'Clone variants' });
  await matrix.getByRole('button', { name: 'Dislike Short tower', exact: true }).click();
  await matrix.getByLabel('Note (optional)').fill('Keep the tall one only');
  await matrix.getByRole('button', { name: 'Send' }).click();
  await expect(matrix.getByRole('status')).toContainText('Saved');
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(
    dialog.getByRole('region', { name: 'Answered reviews' }).getByRole('button', { name: /^Clone variants/ }),
  ).toContainText('disliked Short tower · Keep the tall one only');
  expect(api.answers).toHaveLength(2);
});

// #1124: Kevin no longer types "move on to prototyping"; the card names the rung and approves it in one tap.
test('a phase ticket card shows its rung and approves it in one tap', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const api = await install(page);
  const dialog = await openReviewDeck(page, 20_000, 'HUD font');
  await reopen(page, 'Torch style');
  const card = dialog.getByRole('region', { name: 'Torch style' });
  const strip = card.getByRole('list', { name: 'Phase' });
  await expect(strip.getByRole('listitem')).toHaveText(['Mock', 'Prototype', 'Build']);
  await expect(strip.locator('[aria-current="step"]')).toHaveText('Mock');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await capture(page, testInfo, 'phase-strip');
  await card.getByRole('button', { name: 'Approve → Prototype' }).click();
  await expect(card.getByRole('status')).toContainText('Saved');
  expect(api.answers.find(({ path }) => path.endsWith('/commands/d_torch/answer'))!.body).toEqual({
    option_id: 'iron',
    version: 1,
    review: { likes: [], dislikes: [] },
    advance: 'prototype',
  });
  await capture(page, testInfo, 'phase-approved');
});

test('a prototype card shows the play link, the clip, works now, limitations and what to weigh in on (item 7)', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const api = await install(page);
  const dialog = await openReviewDeck(page, 20_000, 'Moon gate prototype');
  const card = dialog.getByRole('region', { name: 'Review for ticket 215' });
  await expect(card.getByRole('link', { name: 'Play this build' })).toHaveAttribute(
    'href',
    `/g/${gameId}?mode=edit&build=b_proto`,
  );
  await expect
    .poll(() => card.locator('video').evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeGreaterThan(0);
  await expect(card.locator('.media-meta')).toBeVisible();
  await expect(card.getByText('Works now:')).toBeVisible();
  await expect(card.getByText('The gate opens at full moon; Phone controls')).toBeVisible();
  await expect(card.getByText('Known limitations:')).toBeVisible();
  await expect(card.getByText('Weigh in on:')).toBeVisible();
  // A prototype round carries its build; nothing claims its media is missing.
  await expect(dialog.getByText('No media; asking the agent…')).toHaveCount(0);
  await capture(page, testInfo, 'parity-prototype');
  expect(api.roundAnswers).toEqual([]);
});

// #1278: from the home-screen app, a build link left for the browser on the games host. It opens the game's editor.
test("Play this build opens that build in the game's editor without leaving the home-screen app", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { value: true });
    const matchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query: string) =>
      query.includes('display-mode: standalone')
        ? ({ ...matchMedia(query), matches: true, media: query } as MediaQueryList)
        : matchMedia(query);
  });
  await install(page);
  const frames: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith(gamesOrigin)) frames.push(request.url());
  });
  const dialog = await openReviewDeck(page, 20_000, 'Moon gate prototype');
  const card = dialog.getByRole('region', { name: 'Review for ticket 215' });
  const appOrigin = new URL(page.url()).origin;
  await card.getByRole('link', { name: 'Play this build' }).tap();
  await expect(page).toHaveURL(`${appOrigin}/g/${gameId}?mode=edit&build=b_proto`);
  await expect(page.getByRole('dialog', { name: 'Needs Review' })).toHaveCount(0);
  expect(context.pages()).toHaveLength(1);
  await expect(page.locator('.game-screen.is-editing')).toBeVisible();
  /* The reviewed build boots in the editor's preview, not the branch head. */
  await expect.poll(() => frames.find((url) => url.includes(`/g/${gameId}/b_proto/`))).toBeTruthy();
  expect(frames.some((url) => url.includes('/b_head/'))).toBe(false);
  await expect(page.locator('.game-frame iframe')).toHaveAttribute('src', new RegExp(`/g/${gameId}/b_proto/`));
  await capture(page, testInfo, 'build-link-editor');
  /* The bridge fixture never reports its load done, so its cover stays up; this still hides it to show the frame. */
  const path = testInfo.outputPath('build-link-editor-frame.png');
  await page.screenshot({ path, style: '.game-loading-layer { display: none !important; }' });
  await testInfo.attach('build-link-editor-frame', { path, contentType: 'image/png' });
});

// Back to the Builds rows and into another card, the way Kevin moves between sources.
async function reopen(page: Page, title: string) {
  await page.getByRole('dialog', { name: 'Needs Review' }).getByRole('button', { name: 'Close' }).first().click();
  await openReviewItem(page, title);
}

async function rate(card: Locator, option: string, vote: '👍' | '👎') {
  await card.getByLabel(`Rate ${option}`).getByRole('button', { name: vote }).click();
}

// The APIs the Needs Review deck reads and answers through. An answered Command leaves its list and, for a game, lands
// in the game's review ledger, the way the server behaves.
async function install(page: Page): Promise<Api> {
  await installAuthRoutes(page, { signedIn: true });
  const answers: Answer[] = [];
  const roundAnswers: Record<string, unknown>[] = [];
  const creator = [fontCommand(), inventoryCommand()];
  const core = [matrixCommand(), pcCommand()];
  const ledger: Record<string, unknown>[] = [];
  await page.route('**/qa-media/*', (route) => {
    const file = new URL(route.request().url()).pathname.split('/').pop()!;
    return route.fulfill({
      path: resolve(FIXTURES, file),
      contentType: file.endsWith('.mp4') ? 'video/mp4' : 'audio/mpeg',
    });
  });
  await page.route('**/media.example.test/*.svg', (route) => {
    const name = new URL(route.request().url()).pathname.slice(1, -4);
    return route.fulfill({ contentType: 'image/svg+xml', body: svg(name) });
  });
  await page.route('**/api/v1/**', async (route) => {
    if (isGameLaunch(route.request().url())) return route.fallback();
    const url = new URL(route.request().url());
    const path = url.pathname;
    const post = route.request().method() === 'POST';
    if (path === '/api/v1/me/commands') return json(route, { commands: creator, sessions: [] });
    if (path === '/api/v1/me/core-commands') return json(route, { commands: core, targets: [] });
    const answer = /\/commands\/([^/]+)\/answer$/.exec(path);
    if (answer && post) {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      answers.push({ path: path + url.search, body, at: Date.now() });
      const list = path.startsWith('/api/v1/core/') ? core : creator;
      const index = list.findIndex(({ decision_id }) => decision_id === answer[1]);
      const [command] = list.splice(index, 1);
      if (command && 'game_id' in command) {
        const review = body.review as {
          likes: string[];
          dislikes: { option_id: string; reason?: string }[];
          notes?: string;
        };
        const label = (id: string) => command.options.find((option) => option.id === id)!.label;
        ledger.push({
          id: `rv_${answer[1]}`,
          game_id: gameId,
          job_id: null,
          ticket: command.ticket,
          title: command.title,
          command_id: command.command_id,
          decision_id: command.decision_id,
          question: command.question,
          option_id: body.option_id,
          likes: review.likes.map((id) => ({ option_id: id, label: label(id) })),
          dislikes: review.dislikes.map(({ option_id, reason }) => ({
            option_id,
            label: label(option_id),
            reason: reason ?? null,
          })),
          notes: review.notes ?? null,
          at: new Date().toISOString(),
        });
      }
      return json(route, { status: 'answered', decision_id: answer[1], option_id: body.option_id });
    }
    if (/^\/api\/v1\/core\/tickets\/[^/]+\/state$/.test(path)) return json(route, { state: 'in-review' });
    if (path === `/api/v1/games/${gameId}/reviews`) return json(route, { reviews: ledger });
    if (path === `/api/v1/games/${gameId}/review-rounds`) return json(route, { rounds: [prototypeRound()] });
    if (/\/review-rounds\/[^/]+\/answer$/.test(path)) {
      roundAnswers.push(route.request().postDataJSON() as Record<string, unknown>);
      return json(route, { status: 'answered' });
    }
    if (path === `/api/v1/games/${gameId}/previews`) return json(route, { previews: [] });
    /* The game's editor page, where a build link lands: the branch head is another build than the reviewed one. */
    if (path === `/api/v1/games/${gameId}`)
      return json(route, {
        id: gameId,
        familyId: 'family-1',
        ownerId: 'u1',
        title: 'Moon Vault',
        visibility: 'private',
      });
    if (path === `/api/v1/games/${gameId}/branches/main/design`)
      return json(route, { rev: 3, buildId: 'b_head', doc: bridgeDesign });
    if (path === `/api/v1/games/${gameId}/builds/b_proto/design`)
      return json(route, { rev: 0, buildId: 'b_proto', doc: bridgeDesign });
    if (path === '/api/v1/notifications/stream') {
      return route.fulfill({ contentType: 'text/event-stream', body: 'retry: 60000\n\n' });
    }
    if (path === '/api/v1/games') {
      return json(route, {
        games: [
          {
            id: gameId,
            familyId: 'family-1',
            ownerId: 'u1',
            title: 'Moon Vault',
            repo: null,
            createdAt: '2026-11-03T17:00:00.000Z',
          },
        ],
      });
    }
    if (path === '/api/v1/jobs') return json(route, { jobs: [] });
    if (/^\/api\/v1\/games\/[^/]+\/commands$/.test(path)) return json(route, { commands: [] });
    if (/^\/api\/v1\/games\/[^/]+\/workers$/.test(path)) return json(route, { workers: [] });
    if (path.endsWith('/branches')) return json(route, { branches: [] });
    if (path === '/api/v1/me') return json(route, { platformRole: 'none' });
    return json(route, { error: 'not_mocked', path }, 404);
  });
  await page.goto('/all');
  return { answers, roundAnswers };
}

function svg(name: string): string {
  const hue = [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320"><rect width="320" height="320" fill="hsl(${hue} 32% 30%)"/><text x="160" y="170" font-family="sans-serif" font-size="32" fill="#ebdbb2" text-anchor="middle">${name}</text></svg>`;
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await page.waitForTimeout(200);
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}
