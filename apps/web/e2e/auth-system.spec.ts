import { chromium, expect, test as base, type BrowserContext, type Locator, type Page } from '@playwright/test';

import { startBrowserSystem } from '../../../services/api/test/browser-system-harness';
import {
  GRANT_SECRET,
  INTERNAL_SECRET,
  defaultTimings,
  joinOptions,
  newRoom,
  startHarness,
} from '../../../services/rooms/test/helpers';
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
    const system = await startBrowserSystem(baseURL, process.env.OGM_TEST_TEMPLATE_DIST, bridgeOrigin);
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
          (route.request().method() === 'GET' && incoming.pathname === '/auth/get-session') ||
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

async function signIn(page: Page, system: System, email = 'player@example.test') {
  const sentBefore = system.outbox().length;
  await page.goto('/all', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/signin/, { timeout: 30_000 });
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send sign-in link' }).tap();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  expect(system.outbox()).toHaveLength(sentBefore + 1);
  const link = system.outbox()[sentBefore]?.text.match(/https?:\/\/\S+/)?.[0];
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

async function touchControl(control: Locator) {
  await control.tap({ timeout: 120_000 });
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

    test('room invites admit a separate signed-in player', async ({ page, system, browser }) => {
      test.setTimeout(600_000);
      await signIn(page, system);
      system.seedChat();
      const game = await system.seedEditor();
      const rooms = await startHarness({ timings: { ...defaultTimings, idleDisposeSec: 300 } }, 0);
      let context: BrowserContext | undefined;
      try {
        context = await browser.newContext({ baseURL: new URL(page.url()).origin, viewport, hasTouch: true });
        const address = rooms.gameServer.transport.server?.address();
        if (!address || typeof address === 'string') throw new Error('rooms server did not bind');
        system.configureRooms(`http://127.0.0.1:${address.port}`, INTERNAL_SECRET, GRANT_SECRET);
        const peer = await context.newPage();
        await peer.route(/\/(auth|api)\//, async (route) => {
          const incoming = new URL(route.request().url());
          if (incoming.origin !== new URL(page.url()).origin) return route.continue();
          const target = new URL(incoming.pathname + incoming.search, system.origin);
          if (incoming.pathname === '/api/v1/notifications/stream' || incoming.pathname === '/auth/get-session')
            return route.continue({ url: target.href });
          try {
            await route.fulfill({ response: await route.fetch({ url: target.href, maxRedirects: 0 }) });
          } catch {
            await route.abort('failed').catch(() => undefined);
          }
        });
        await signIn(peer, system, 'peer@example.test');
        system.addPeerToFamily();
        const created = await page.evaluate(async ({ gameId, branchId, buildId }) => {
          const response = await fetch(`/api/v1/games/${gameId}/rooms`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ branchId, buildId, protocol: 2, mode: 'per-seat', maxPlayers: 2 }),
          });
          return { status: response.status, body: await response.json() };
        }, game);
        expect(created.status).toBe(201);
        const roomId = created.body.roomId as string;
        expect(roomId).toBeTruthy();
        expect(await peer.evaluate((id) => fetch(`/api/v1/rooms/${id}/grant`).then((r) => r.status), roomId)).toBe(403);
        const invitation = await page.evaluate(async (id) => {
          const response = await fetch(`/api/v1/rooms/${id}/invites`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
          });
          return { status: response.status, body: await response.json() };
        }, roomId);
        expect(invitation.status).toBe(201);
        await peer.goto(new URL(invitation.body.url as string).pathname, { waitUntil: 'domcontentloaded' });
        await expect(peer).toHaveURL(new RegExp(`/g/${game.gameId}.*room=${roomId}`), { timeout: 120_000 });
        const admitted = await peer.evaluate(async (id) => {
          const response = await fetch(`/api/v1/rooms/${id}/grant`);
          return { status: response.status, body: await response.json() };
        }, roomId);
        expect(admitted).toMatchObject({
          status: 200,
          body: { roomId, pin: { gameId: game.gameId, buildId: game.buildId } },
        });
        expect(admitted.body.grant).not.toBe(created.body.grant);
      } finally {
        try {
          await context?.close();
        } finally {
          await rooms.testServer.shutdown();
        }
      }
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
        await composer.getByRole('button', { name: 'Dictate' }).tap();
        await expect(composer).toHaveAttribute('data-recording', '');
        await expect.poll(() => provider.stats().audioFrames, { timeout: 30_000 }).toBeGreaterThan(0);
        await composer.getByRole('button', { name: 'Stop and send' }).tap();
        await expect.poll(() => system.chatTexts(), { timeout: 30_000 }).toEqual(['Make the lantern glow blue']);
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

    test('player files a bug from a hosted game', async ({ page, system }) => {
      test.setTimeout(600_000);
      await signIn(page, system);
      system.seedChat();
      const game = await system.seedEditor();
      system.makePlayer();
      await page.route(
        (url) => [bridgeOrigin, 'http://127.0.0.1:10000'].includes(url.origin),
        async (route) => {
          const incoming = new URL(route.request().url());
          const target = new URL(incoming.pathname + incoming.search, game.origin);
          await route.fulfill({ response: await route.fetch({ url: target.href, maxRedirects: 0 }) });
        },
      );
      await page.goto(`/g/${game.gameId}?test`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'Menu', exact: true }).tap({ timeout: 120_000 });
      const paused = page.getByRole('dialog', { name: 'Paused' });
      await paused.getByRole('button', { name: 'File a bug' }).tap();
      const bug = page.getByRole('dialog', { name: 'File a bug' });
      await bug.getByRole('textbox', { name: 'Describe the issue' }).fill('The lantern vanished');
      await bug.getByRole('button', { name: 'Send', exact: true }).tap();
      await expect
        .poll(() => system.reports(), { timeout: 30_000 })
        .toEqual([
          expect.objectContaining({
            game_id: game.gameId,
            build_hash: game.buildId,
            text: expect.stringContaining('The lantern vanished'),
          }),
        ]);
      await expect(bug.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
    });

    test('hosted Blobs starts a CPU match', async ({ page, system }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(String(error)));
      // eslint-disable-next-line no-restricted-properties -- the real game is built outside this repository.
      const dist = process.env.OGM_BLOBS_DIST;
      test.skip(!dist, 'OGM_BLOBS_DIST must point to a local Blobs draft build');
      test.setTimeout(1_200_000);
      await signIn(page, system);
      system.seedChat();
      const game = await system.seedEditor(dist);
      await page.route(
        (url) => [bridgeOrigin, 'http://127.0.0.1:10000'].includes(url.origin),
        async (route) => {
          const incoming = new URL(route.request().url());
          const target = new URL(incoming.pathname + incoming.search, game.origin);
          try {
            await route.fulfill({ response: await route.fetch({ url: target.href, maxRedirects: 0 }) });
          } catch {
            await route.abort('failed').catch(() => undefined);
          }
        },
      );
      await page.goto(`/g/${game.gameId}?test`, { waitUntil: 'domcontentloaded' });
      await expect
        .poll(
          () =>
            page.evaluate(
              () =>
                (window as Window & { __ogmHost?: { game?: { bridgeState: string } } }).__ogmHost?.game?.bridgeState,
            ),
          { timeout: 120_000 },
        )
        .toBe('ready');
      await expect(page.getByRole('alert').getByRole('button', { name: 'Try again' })).toHaveCount(0);
      await expect(page.getByRole('progressbar', { name: 'Loading' })).toBeHidden({ timeout: 600_000 });
      const flow = page.frameLocator('.game-frame iframe').locator('#blobs-flow');
      await touchControl(flow.getByRole('button', { name: 'Play', exact: true }));
      await touchControl(flow.getByRole('button', { name: 'Versus CPU', exact: true }));
      await touchControl(flow.getByRole('button', { name: 'Blocks', exact: true }));
      await touchControl(flow.getByRole('button', { name: 'Play', exact: true }));
      const frame = page.frames().find((candidate) => candidate.url().startsWith(`${bridgeOrigin}/d/`));
      if (!frame) throw new Error('hosted Blobs frame is missing');
      await frame.waitForFunction(() => typeof (window as TestWindow).advanceTime === 'function');
      for (let step = 0; step < 60 && (await flow.getAttribute('data-screen')) !== null; step += 1) {
        await frame.evaluate(() => (window as TestWindow).advanceTime!(1000));
      }
      await expect(flow).not.toHaveAttribute('data-screen', /.+/);
      // Let gravity finish each round; the deterministic clock advances without hundreds of
      // cross-process key events, while the actual game and CPU decide the result.
      for (let step = 0; step < 60; step += 1) {
        if (await flow.getByRole('button', { name: 'Rematch', exact: true }).isVisible()) break;
        await frame.evaluate(() => (window as TestWindow).advanceTime!(10_000));
      }
      await expect(flow.locator('.results__reason')).toHaveText(/^(You win|CPU wins) the match$/);
      expect(errors).toEqual([]);
    });

    test('hosted Blobs starts an online match with two players', async ({ page, system }, testInfo) => {
      // eslint-disable-next-line no-restricted-properties -- the real game is built outside this repository.
      const dist = process.env.OGM_BLOBS_DIST;
      test.skip(!dist, 'OGM_BLOBS_DIST must point to a local Blobs draft build');
      test.setTimeout(1_200_000);
      await signIn(page, system);
      system.seedChat();
      const game = await system.seedEditor(dist);
      const rooms = await startHarness({}, 0);
      let peerBrowser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
      let peerPage: Page | undefined;
      let onlineRoom: Awaited<ReturnType<typeof newRoom>> | undefined;
      try {
        peerBrowser = await chromium.launch({ headless: true, args: launchArgs() });
        const peerContext = await peerBrowser.newContext({
          baseURL: new URL(page.url()).origin,
          storageState: await page.context().storageState(),
          viewport,
          isMobile: true,
          hasTouch: true,
          serviceWorkers: 'block',
        });
        const peer = await peerContext.newPage();
        peerPage = peer;
        const address = rooms.gameServer.transport.server?.address();
        if (!address || typeof address === 'string') throw new Error('rooms server did not bind');
        const room = await newRoom(rooms.testServer, {
          protocol: 2,
          mode: 'per-seat',
          gameId: game.gameId,
          branchId: game.branchId,
          buildId: game.buildId,
          maxPlayers: 2,
          timings: { idleDisposeSec: 300, seatReconnectSec: 30 },
        });
        onlineRoom = room;
        const ownerGrant = await joinOptions(room, 'owner', 'owner');
        const peerGrant = await joinOptions(room, 'peer', 'player');
        // The second context copies the real sign-in session; requests still reach the local API.
        await peer.route(/\/(auth|api)\//, async (route) => {
          const incoming = new URL(route.request().url());
          if (incoming.origin !== new URL(page.url()).origin) return route.continue();
          const target = new URL(incoming.pathname + incoming.search, system.origin);
          if (
            incoming.pathname === '/api/v1/notifications/stream' ||
            (route.request().method() === 'GET' && incoming.pathname === '/auth/get-session') ||
            (route.request().method() === 'GET' && /\/transactions$/.test(incoming.pathname))
          ) {
            return route.continue({ url: target.href });
          }
          try {
            await route.fulfill({ response: await route.fetch({ url: target.href, maxRedirects: 0 }) });
          } catch {
            await route.abort('failed').catch(() => undefined);
          }
        });
        for (const [target, grant] of [
          [page, ownerGrant.grant],
          [peer, peerGrant.grant],
        ] as const) {
          await target.route(
            (url) => [bridgeOrigin, 'http://127.0.0.1:10000'].includes(url.origin),
            async (route) => {
              const incoming = new URL(route.request().url());
              const destination = new URL(incoming.pathname + incoming.search, game.origin);
              try {
                await route.fulfill({ response: await route.fetch({ url: destination.href, maxRedirects: 0 }) });
              } catch {
                await route.abort('failed').catch(() => undefined);
              }
            },
          );
          // Grants are fixture-issued; transport, room and both hosted games are real local services.
          await target.route('**/api/v1/rooms/*/grant', (route) =>
            route.fulfill({
              json: {
                roomId: room.roomId,
                grant,
                pin: { gameId: game.gameId, branchId: game.branchId, buildId: game.buildId },
                roomsUrl: `ws://127.0.0.1:${address.port}`,
              },
            }),
          );
          await target.goto(`/g/${game.gameId}?room=${room.roomId}&test`, { waitUntil: 'domcontentloaded' });
          await expect
            .poll(
              () =>
                target.evaluate(
                  () =>
                    (
                      window as Window & { __ogmHost?: { room?: { state(): { status?: string } } } }
                    ).__ogmHost?.room?.state().status,
                ),
              { timeout: 120_000 },
            )
            .toBe('connected');
        }
        await page.evaluate(() => (window as Window & { __ogmHost: { room: { play(): void } } }).__ogmHost.room.play());
        await expect.poll(() => room.state.phase, { timeout: 120_000 }).toBe('playing');
        for (const target of [page, peer]) {
          await target.bringToFront();
          await expect(target.getByRole('progressbar', { name: 'Loading' })).toBeHidden({ timeout: 600_000 });
          const flow = target.frameLocator('.game-frame iframe').locator('#blobs-flow');
          await touchControl(flow.getByRole('button', { name: 'Play', exact: true }));
          await touchControl(flow.getByRole('button', { name: 'Online', exact: true }));
          await touchControl(flow.getByRole('button', { name: 'Blocks', exact: true }));
          await touchControl(flow.locator('.lobby-seat--local').getByRole('button', { name: 'Ready up' }));
        }
        await page.bringToFront();
        const ownerFlow = page.frameLocator('.game-frame iframe').locator('#blobs-flow');
        await expect(ownerFlow.getByRole('button', { name: 'Start match' })).toBeEnabled({ timeout: 120_000 });
        await ownerFlow.getByRole('button', { name: 'Start match' }).tap();
        await expect.poll(() => room.state.epoch, { timeout: 120_000 }).not.toBe('');
        for (const target of [page, peer]) {
          const frame = target.frames().find((candidate) => candidate.url().startsWith(`${bridgeOrigin}/d/`));
          if (!frame) throw new Error('hosted Blobs frame is missing');
          await expect
            .poll(
              () =>
                frame.evaluate(() => {
                  const snapshot = JSON.parse((window as TestWindow).render_game_to_text!()) as {
                    tick: number;
                    net: { players: unknown[] };
                    state: { entities?: Record<string, unknown> };
                  };
                  return {
                    tick: snapshot.tick,
                    players: snapshot.net.players.length,
                    entities: Object.keys(snapshot.state.entities ?? {}).length,
                  };
                }),
              { timeout: 120_000 },
            )
            .toMatchObject({ tick: expect.any(Number), players: 2, entities: 2 });
          await expect
            .poll(() =>
              frame.evaluate(
                () => (JSON.parse((window as TestWindow).render_game_to_text!()) as { tick: number }).tick,
              ),
            )
            .toBeGreaterThan(0);
        }
      } catch (error) {
        if (onlineRoom) {
          await testInfo.attach('room-state', {
            body: JSON.stringify(onlineRoom.state.toJSON()),
            contentType: 'application/json',
          });
        }
        if (peerPage && !peerPage.isClosed()) {
          const frame = peerPage.frames().find((candidate) => candidate.url().startsWith(`${bridgeOrigin}/d/`));
          const lobby = await frame
            ?.locator('#blobs-flow')
            .textContent({ timeout: 5_000 })
            .catch(() => null);
          await testInfo.attach('peer-lobby', {
            body: lobby ?? 'game frame or lobby unavailable',
            contentType: 'text/plain',
          });
          const seat = await frame
            ?.evaluate(
              () =>
                (window as unknown as { __gm?: { runtime: { net: { localSeat: number | null } } } }).__gm?.runtime.net
                  .localSeat,
            )
            .catch(() => undefined);
          await testInfo.attach('peer-local-seat', {
            body: JSON.stringify(seat ?? null),
            contentType: 'application/json',
          });
        }
        throw error;
      } finally {
        try {
          await peerBrowser?.close();
        } finally {
          await rooms.testServer.shutdown();
        }
      }
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
      const gameFrame = () =>
        page
          .frames()
          .find((candidate) =>
            [bridgeOrigin, 'http://127.0.0.1:10000'].some((origin) => candidate.url().startsWith(`${origin}/d/`)),
          );
      await expect.poll(() => Boolean(gameFrame()), { timeout: 30_000 }).toBe(true);
      const frame = gameFrame()!;
      await frame.waitForFunction(() => typeof (window as TestWindow).advanceTime === 'function');
      await frame.evaluate(() => {
        const instance = (
          window as unknown as { __gm: { runtime: { instance: { applyDesign: (...args: unknown[]) => unknown } } } }
        ).__gm.runtime.instance;
        const apply = instance.applyDesign;
        (window as unknown as { appliedLights: unknown[] }).appliedLights = [];
        instance.applyDesign = function (...args) {
          const design = args[0] as { globals?: Record<string, unknown> };
          (window as unknown as { appliedLights: unknown[] }).appliedLights.push(design.globals?.['scenery.lighting']);
          return apply.apply(this, args);
        };
      });
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
      await expect
        .poll(() => frame.evaluate(() => (window as unknown as { appliedLights: unknown[] }).appliedLights))
        .toContain('night');
      const snapshot = () =>
        frame.evaluate(() => {
          const { tick, mode } = JSON.parse((window as TestWindow).render_game_to_text!()) as {
            tick: number;
            mode: string;
          };
          return { tick, mode };
        });
      await page.getByRole('button', { name: 'Menu', exact: true }).tap();
      const editMenu = page.getByRole('dialog', { name: 'Paused' });
      await editMenu.getByRole('button', { name: 'More', exact: true }).tap();
      await editMenu.getByRole('button', { name: 'select', exact: true }).tap();
      await editMenu.getByRole('button', { name: 'Resume', exact: true }).tap();
      await expect.poll(async () => (await snapshot()).mode).toBe('edit');
      const beforePlay = (await snapshot()).tick;
      await page.getByRole('button', { name: 'Play', exact: true }).tap();
      await expect.poll(async () => (await snapshot()).mode).toBe('play');
      const tick = async () => (await snapshot()).tick;
      await frame.evaluate(() => (window as TestWindow).advanceTime!(500));
      const playingTick = await tick();
      expect(playingTick).toBeGreaterThan(beforePlay);
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
