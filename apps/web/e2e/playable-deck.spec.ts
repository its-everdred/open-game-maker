import { expect, test, type Frame, type Page, type Route, type TestInfo } from '@playwright/test';

import type { GameCommand } from '@ogm/contracts';

import { installAuthRoutes } from './fixtures/auth-routes';

// Playable options (#608): a gameplay-feel question is answered by playing each option in the card, not by following a
// link. The deck plays a falling-blocks slice from the games host at each fall speed in turn, pauses it for a verdict,
// and can compare all three back to back. The run's video is the phone and desktop evidence.
const gameId = 'g_fall-8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e90';
const SECONDS = 4;
const answerBodies: Array<Record<string, unknown>> = [];

function fallSpeedCommand(): GameCommand {
  return {
    job_id: 'j_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e91',
    ticket: '608',
    title: 'Fall speed',
    checkpoint_id: 'cp_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e92',
    decision_id: 'd_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e93',
    version: 1,
    // An agent that still pastes a link gets it dropped: the deck never shows a URL as text.
    question: 'Which fall speed feels right? https://games.example.test/g/fall?speed=slow',
    options: (['slow', 'medium', 'fast'] as const).map((speed) => ({
      id: speed,
      label: speed[0]!.toUpperCase() + speed.slice(1),
      playable: {
        scenario: `scenario=sandbox&speed=${speed}`,
        seconds: SECONDS,
        ...(speed === 'medium' ? { lead_in: 'one-chain' } : {}),
      },
    })),
    recommend: 'medium',
    blocking: false,
    pick: 'one',
    opened_at: '2026-11-07T18:10:00.000Z',
    review_number: 1,
  };
}

test.use({ serviceWorkers: 'block', video: 'on' });

test.beforeEach(() => {
  answerBodies.length = 0;
});

test('plays each fall speed in the card, compares them, and sends the pick', async ({ page }, testInfo) => {
  testInfo.setTimeout(120_000);
  await installAuthRoutes(page, { signedIn: true });
  await installApi(page);
  await page.goto('/fall/review/1');

  const deck = page.getByRole('region', { name: 'Review Fall speed' });
  await expect(deck).toBeVisible();
  await expect(page.locator('.review-deck-progress')).toHaveText('1 of 3');
  // Nothing on the page is a link or a URL: the question is tried, not visited.
  await expect(page.locator('.review-screen a[href]')).toHaveCount(0);
  await expect(page.locator('.review-screen')).not.toContainText('://');

  // The first card plays the slow slice from the games host, in a sandboxed frame.
  const slow = await gameFrame(page, 'slow');
  await expect(page.locator('.review-deck-playable iframe')).toHaveAttribute(
    'sandbox',
    'allow-scripts allow-same-origin allow-pointer-lock',
  );
  await expect.poll(() => slow.evaluate(() => window.__fixture.params)).toMatchObject({ scenario: 'sandbox' });
  await expect.poll(() => slow.evaluate(() => window.__fixture.messages.includes('design.apply'))).toBe(true);
  if (testInfo.project.name === 'phone') {
    // On a phone the host's touch controls sit over the game, inside the card.
    await expect(page.locator('.review-deck-playable [role="button"]').first()).toBeVisible();
  } else {
    // On desktop the keys go to the game while it plays, so the arrows move the catcher instead of judging the card.
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(400);
    await page.keyboard.up('ArrowLeft');
    await expect(page.locator('.review-deck-progress')).toHaveText('1 of 3');
  }
  await page.waitForTimeout(1_200);
  await capture(page, testInfo, 'playable-slow');

  // After its seconds the slice pauses, and the deck's verdict and "play again" take over.
  await expect(page.getByRole('button', { name: 'Play Slow again' })).toBeVisible({ timeout: SECONDS * 1000 + 5_000 });
  await expect.poll(() => slow.evaluate(() => window.__fixture.paused)).toBe(true);
  await capture(page, testInfo, 'playable-slow-paused');
  await page.getByRole('button', { name: 'Like', exact: true }).click();

  // The next card's slice starts on its own, with its lead-in chain already stacked.
  await expect(page.locator('.review-deck-progress')).toHaveText('2 of 3');
  const medium = await gameFrame(page, 'medium');
  await expect.poll(() => medium.evaluate(() => window.__fixture.params.lead_in)).toBe('one-chain');
  await page.waitForTimeout(1_500);
  await capture(page, testInfo, 'playable-medium');
  await expect(page.getByRole('button', { name: 'Play Medium again' })).toBeVisible({
    timeout: SECONDS * 1000 + 5_000,
  });

  // Compare plays slow, then medium, then fast, naming the one on screen, and the deck stays on its card. The names
  // and the frames are recorded as they appear: a screenshot on a busy runner can outlast a 4-second slice, and
  // checking each name live then misses one that already played.
  await page.evaluate(() => {
    window.__tags = [];
    new MutationObserver(() => {
      const tag = document.querySelector('.review-deck-playable-tag')?.textContent;
      if (tag && window.__tags.at(-1) !== tag) window.__tags.push(tag);
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  // Each option's own slice loads in turn; the frame for that speed is the evidence it played.
  const loaded: string[] = [];
  page.on('framenavigated', (frame) => {
    const speed = /\/g\/g_fall.*[?&]speed=(\w+)/.exec(frame.url())?.[1];
    if (speed !== undefined && loaded.at(-1) !== speed) loaded.push(speed);
  });
  await page.getByRole('button', { name: 'Compare every option' }).click();
  await expect(page.locator('.review-deck-playable-tag')).toBeVisible();
  await capture(page, testInfo, 'playable-compare');
  await expect
    .poll(() => page.evaluate(() => window.__tags), { timeout: 3 * (SECONDS * 1000 + 5_000) })
    .toEqual(['Slow', 'Medium', 'Fast']);
  expect(loaded).toEqual(['slow', 'medium', 'fast']);
  await expect(page.getByRole('button', { name: 'Play Medium again' })).toBeVisible({
    timeout: SECONDS * 1000 + 5_000,
  });
  await expect(page.locator('.review-deck-progress')).toHaveText('2 of 3');
  await judgeDislike(page);

  await expect(page.locator('.review-deck-progress')).toHaveText('3 of 3');
  await gameFrame(page, 'fast');
  await expect(page.getByRole('button', { name: 'Play Fast again' })).toBeVisible({ timeout: SECONDS * 1000 + 5_000 });
  await page.getByRole('button', { name: 'Like', exact: true }).click();

  // The likes become the shortlist; the pick goes back through the job's checkpoint route.
  await expect(page.getByRole('list', { name: 'Likes', exact: true }).getByRole('button')).toHaveCount(2);
  await capture(page, testInfo, 'playable-ended');
  await page.getByRole('button', { name: 'Choose Fast' }).click();
  await expect(page.getByRole('heading', { name: 'Review sent' })).toBeVisible();
  expect(answerBodies).toEqual([
    { option_id: 'fast', review: { likes: ['slow', 'fast'], dislikes: [{ option_id: 'medium' }] } },
  ]);
});

declare global {
  interface Window {
    __fixture: { params: Record<string, string>; messages: string[]; paused: boolean };
    __tags: string[];
  }
}

// The game frame playing `speed`, once its page has loaded.
async function gameFrame(page: Page, speed: string): Promise<Frame> {
  let found: Frame | undefined;
  await expect
    .poll(() => {
      found = page
        .frames()
        .find((frame) => frame.url().includes('/g/g_fall') && frame.url().includes(`speed=${speed}`));
      return found === undefined ? false : found.evaluate(() => window.__fixture !== undefined).catch(() => false);
    })
    .toBe(true);
  return found!;
}

async function judgeDislike(page: Page) {
  await page.getByRole('button', { name: 'Dislike', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: /^Why did you dislike/ });
  await sheet.getByRole('button', { name: 'Skip' }).click();
  await expect(sheet).toHaveCount(0);
}

async function installApi(page: Page) {
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/notifications/stream') {
      return route.fulfill({ contentType: 'text/event-stream', body: 'retry: 60000\n\n' });
    }
    if (path === '/api/v1/me') return json(route, { platformRole: 'none' });
    if (path === '/api/v1/games/resolve/fall') {
      return json(route, {
        game: {
          id: gameId,
          familyId: 'f_1',
          ownerId: 'u_1',
          title: 'Block Fall',
          slug: 'fall',
          repo: null,
          createdAt: '2026-11-07T17:00:00.000Z',
        },
      });
    }
    if (path === `/api/v1/games/${gameId}/commands`) return json(route, { commands: [fallSpeedCommand()] });
    if (path === `/api/v1/games/${gameId}/branches/main/design`) {
      return json(route, { rev: 1, buildId: 'b_fall', doc: { schemaVersion: 1, globals: {}, entities: {} } });
    }
    if (path === '/api/v1/jobs' || path === '/api/v1/jobs/active') return json(route, { jobs: [] });
    if (/\/jobs\/[^/]+\/checkpoints\/[^/]+\/answer$/.test(path)) {
      answerBodies.push(JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>);
      return json(route, { status: 'answered', decision_id: fallSpeedCommand().decision_id, option_id: 'fast' });
    }
    return json(route, { error: 'not_mocked', path }, 404);
  });
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}-${testInfo.project.name}.png`);
  await page.screenshot({ path });
  await testInfo.attach(`${name}-${testInfo.project.name}`, { path, contentType: 'image/png' });
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}
