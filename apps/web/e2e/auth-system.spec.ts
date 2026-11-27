import { expect, test as base, type Page } from '@playwright/test';

import { startBrowserSystem } from '../../../services/api/test/browser-system-harness';
import { startDictationSystemServer } from '../../../packages/voice-client/e2e/dictation-system-server';

import { launchArgs } from './support/gpu';
import { bridgeOrigin } from './support/visibility';

type System = Awaited<ReturnType<typeof startBrowserSystem>>;
type TestWindow = Window & {
  advanceTime?: (ms: number) => void;
  render_game_to_text?: () => string;
  __gm?: { runtime: { clock: { paused: boolean } } };
};
const test = base.extend<{ system: System }>({
  system: async ({ page, baseURL }, use) => {
    if (!baseURL) throw new Error('browser base URL is required');
    // A prepared copy avoids compiling the same template per viewport on loaded test hosts.
    // eslint-disable-next-line no-restricted-properties -- optional test-only fixture path.
    const system = await startBrowserSystem(baseURL, process.env.OGM_TEST_TEMPLATE_DIST);
    let closing = false;
    try {
      // Forward browser requests to the local API; no auth or API response is stubbed.
      await page.route(/\/(auth|api)\//, async (route) => {
        const incoming = new URL(route.request().url());
        if (incoming.origin !== new URL(baseURL).origin) return route.continue();
        const target = new URL(incoming.pathname + incoming.search, system.origin);
        // A live event stream must not be buffered by route.fetch.
        if (
          incoming.pathname === '/api/v1/notifications/stream' ||
          (route.request().method() === 'GET' &&
            (/\/jobs\/[^/]+\/chat$/.test(incoming.pathname) || /\/transactions$/.test(incoming.pathname)))
        ) {
          return route.continue({ url: target.href });
        }
        try {
          await route.fulfill({ response: await route.fetch({ url: target.href, maxRedirects: 0 }) });
        } catch {
          if (!closing && !page.isClosed()) {
            // Let the browser observe a failed request, including navigation-cancelled background reads.
            await route.abort('failed').catch(() => undefined);
          }
        }
      });
      await use(system);
    } finally {
      closing = true;
      try {
        if (!page.isClosed()) await page.close();
      } finally {
        await system.close();
      }
    }
  },
});

test.use({
  serviceWorkers: 'block',
  isMobile: true,
  hasTouch: true,
  permissions: ['microphone'],
  launchOptions: { args: [...launchArgs(), '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
});

async function signIn(page: Page, system: System) {
  await page.goto('/all', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/signin/, { timeout: 30_000 });
  await page.getByLabel('Email').fill('player@example.test');
  await page.getByRole('button', { name: 'Send sign-in link' }).tap();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  expect(system.outbox()).toHaveLength(1);
  const link = system.outbox()[0]?.text.match(/https?:\/\/\S+/)?.[0];
  if (!link) throw new Error('local outbox has no magic link');
  await page.goto(link, { waitUntil: 'domcontentloaded' });
  const offer = page.getByRole('button', { name: 'Not now' });
  await expect(offer).toBeVisible({ timeout: 30_000 });
  await offer.tap();
  await expect(page).toHaveURL(/\/all/);
}

async function openChat(page: Page, system: System) {
  await signIn(page, system);
  system.seedChat();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: /^Test game:/ })).toBeVisible({ timeout: 30_000 });
  const volume = page.locator('.studio-library-volume button');
  await expect(volume).toBeVisible();
  const bounds = await volume.boundingBox();
  if (!bounds) throw new Error('library menu control is missing');
  const touch = await page.context().newCDPSession(page);
  const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await expect(page.getByRole('group', { name: 'Menu' })).toBeVisible();
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await touch.detach();
  await page.getByRole('button', { name: /^Jobs:/ }).tap();
  await page
    .getByRole('list', { name: 'Build progress' })
    .getByRole('button', { name: /^Build a lantern/ })
    .tap();
  return page.locator('aiur-composer').first();
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
]) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.beforeEach(async ({ page, browserName }, testInfo) => {
      test.skip(
        testInfo.project.name !== 'desktop' || browserName !== 'chromium',
        'the test supplies both mobile viewports',
      );
      test.setTimeout(300_000);
      await page.setViewportSize(viewport);
    });

    test('email sign-in enforces permissions', async ({ page, system }) => {
      await page.goto('/all', { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(/\/signin/);
      const anonymous = await page.evaluate(() => fetch('/api/v1/admin/users').then((response) => response.status));
      expect(anonymous).toBe(401);
      await signIn(page, system);
      const admin = await page.evaluate(() => fetch('/api/v1/admin/users').then((response) => response.status));
      expect(admin).toBe(403);
      const commands = await page.evaluate(() => fetch('/api/v1/me/commands').then((response) => response.status));
      expect(commands).toBe(200);
      expect(system.reviewLog()).toContain('creator_commands');
    });

    test('build chat stores the message', async ({ page, system }) => {
      const composer = await openChat(page, system);
      await composer.locator('textarea').fill('Make the lantern glow blue');
      await composer.getByRole('button', { name: 'Send' }).tap();
      await expect.poll(() => system.chatTexts()).toEqual(['Make the lantern glow blue']);
      await expect(page.getByText('Make the lantern glow blue', { exact: true })).toBeVisible();
    });

    test('dictation reaches the chat composer', async ({ page, system }) => {
      const provider = await startDictationSystemServer();
      try {
        system.configureVoice(provider.url);
        const composer = await openChat(page, system);
        const mic = composer.getByRole('button', { name: 'Hold to dictate' });
        const bounds = await mic.boundingBox();
        if (!bounds) throw new Error('dictation control is missing');
        const touch = await page.context().newCDPSession(page);
        await touch.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }],
        });
        await expect.poll(() => provider.stats().audioFrames, { timeout: 30_000 }).toBeGreaterThan(0);
        await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await touch.detach();
        await expect(composer.locator('textarea')).toHaveValue('Make the lantern glow blue');
        expect(provider.stats().commits).toBe(1);
      } finally {
        await provider.close();
      }
    });

    test('review records a verdict and note', async ({ page, system }) => {
      await signIn(page, system);
      system.seedChat();
      system.seedReview();
      await page.goto('/test-game/review', { waitUntil: 'domcontentloaded' });
      const review = page.getByRole('region', { name: 'Review for ticket 42' });
      await expect(review.getByText('Is the lantern ready?')).toBeVisible();
      await review.getByLabel('Note (optional)').fill('Make the glow softer');
      await review.getByRole('button', { name: 'Needs work' }).tap();
      await expect
        .poll(() => system.reviewVerdict())
        .toMatchObject({ verdict: 'needs_work', notes: 'Make the glow softer' });
    });

    test('resource limits are visible and refuse a consuming job', async ({ page, system }) => {
      await signIn(page, system);
      system.seedChat();
      system.exhaustWeeklyJobs();
      await page.goto('/settings', { waitUntil: 'domcontentloaded' });
      await page.getByRole('link', { name: 'Minerals and Gas' }).tap();
      await expect(page.getByRole('heading', { name: /Minerals and Gas:/ })).toBeVisible();
      await expect(page.getByText('Interim edit limit', { exact: true })).toBeVisible();
      await expect(page.getByText(/0 of 0 left.*resets/)).toHaveCount(2);
      await expect(page.getByText('Actual paid API spend: Unknown')).toBeVisible();
      const refusal = await page.evaluate(async () => {
        const response = await fetch('/api/v1/jobs', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            gameId: 'g_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e01',
            branchId: 'main',
            kind: 'feature',
            complexity: 1,
            plan: {
              title: 'Add a lantern',
              summary: 'Add a lantern',
              scope: { included: ['lantern'], excluded: [] },
              tickets: [{ key: 'T1', skills: [], dependsOn: [], acceptanceCriteria: ['It glows'] }],
            },
            start: 'now',
          }),
        });
        return { status: response.status, body: await response.json() };
      });
      expect(refusal).toMatchObject({
        status: 402,
        body: { error: 'energy_limit_reached', reason: 'weekly_user', window: 'week', resetsAt: expect.any(String) },
      });
      await page.goto('/all', { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('button', { name: /^Test game:/ })).toBeVisible({ timeout: 30_000 });
    });

    test('manual edit persists through the real game host', async ({ page, system }) => {
      test.setTimeout(600_000);
      await signIn(page, system);
      system.seedChat();
      const game = await system.seedEditor();
      await page.route(
        (url) => [bridgeOrigin, 'http://127.0.0.1:10000'].includes(url.origin),
        async (route) => {
          const incoming = new URL(route.request().url());
          const target = new URL(incoming.pathname + incoming.search, game.origin);
          await route.fulfill({ response: await route.fetch({ url: target.href, maxRedirects: 0 }) });
        },
      );
      await page.goto(`/g/${game.gameId}?mode=edit&test`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByLabel('Game editor')).toBeVisible({ timeout: 120_000 });
      await page.getByLabel('Game editor').tap();
      await page.getByRole('button', { name: 'Light', exact: true }).tap();
      await page.getByRole('button', { name: 'Night', exact: true }).tap();
      await expect
        .poll(() => system.editorTransactions(), { timeout: 30_000 })
        .toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              label: 'Changed scenery light',
              commands: expect.arrayContaining([
                expect.objectContaining({ op: 'set', control: 'scenery.lighting', targets: 'global', value: 'night' }),
              ]),
            }),
          ]),
        );
      const gameFrame = () =>
        page
          .frames()
          .find((candidate) =>
            [bridgeOrigin, 'http://127.0.0.1:10000'].some((origin) => candidate.url().startsWith(`${origin}/g/`)),
          );
      await expect.poll(() => Boolean(gameFrame()), { timeout: 30_000 }).toBe(true);
      const frame = gameFrame()!;
      await frame.waitForFunction(() => typeof (window as TestWindow).advanceTime === 'function');
      await page.getByRole('button', { name: 'Play', exact: true }).tap();
      const tick = () => frame.evaluate(() => JSON.parse((window as TestWindow).render_game_to_text!()).tick as number);
      await frame.evaluate(() => (window as TestWindow).advanceTime!(500));
      const playingTick = await tick();
      expect(playingTick).toBeGreaterThan(0);
      await page.getByRole('button', { name: 'Menu', exact: true }).tap();
      const paused = page.getByRole('dialog', { name: 'Paused' });
      await expect(paused).toBeVisible();
      await expect.poll(() => frame.evaluate(() => (window as TestWindow).__gm?.runtime.clock.paused)).toBe(true);
      const pausedTick = await tick();
      await frame.evaluate(() => (window as TestWindow).advanceTime!(500));
      expect(await tick()).toBe(pausedTick);
      await paused.getByRole('button', { name: 'Resume' }).tap();
      await expect(paused).toBeHidden();
      await expect.poll(() => frame.evaluate(() => (window as TestWindow).__gm?.runtime.clock.paused)).toBe(false);
      await frame.evaluate(() => (window as TestWindow).advanceTime!(500));
      expect(await tick()).toBeGreaterThan(pausedTick);
    });
  });
}
