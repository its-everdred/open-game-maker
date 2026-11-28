import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';

import { connect, joinOptions, newRoom, startHarness } from '../../../services/rooms/test/helpers';
import { installAuthRoutes } from './fixtures/auth-routes';
import { buildId, installGameApi } from './support/mock-game-api';
import { launchArgs } from './support/gpu';

test.use({
  serviceWorkers: 'block',
  launchOptions: {
    args: [
      ...launchArgs(),
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
  },
});

test('a room pause freezes both game frames until the shared countdown ends', async ({
  browser,
  baseURL,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'one two-client run covers the shared room behavior');
  test.setTimeout(180_000);
  const port = await availablePort();
  const harness = await startHarness({}, port);
  const room = await newRoom(harness.testServer, {
    protocol: 2,
    gameId: 'game',
    branchId: 'main',
    buildId,
    maxPlayers: 2,
    timings: { idleDisposeSec: 120 },
  });
  const ownerGrant = await joinOptions(room, 'owner', 'owner');
  const peerGrant = await joinOptions(room, 'peer', 'player');
  const ownerContext = await browser.newContext({ baseURL });
  const peerContext = await browser.newContext({ baseURL });
  const owner = await ownerContext.newPage();
  const peer = await peerContext.newPage();
  try {
    await Promise.all(
      [
        [owner, ownerGrant.grant],
        [peer, peerGrant.grant],
      ].map(async ([page, grant]) => {
        const target = page as Page;
        await installAuthRoutes(target, { signedIn: true });
        await installGameApi(target);
        await target.route('**/api/v1/rooms/*/grant', (route) =>
          route.fulfill({
            json: {
              roomId: room.roomId,
              grant,
              pin: { gameId: 'game', branchId: 'main', buildId },
              roomsUrl: `ws://127.0.0.1:${port}`,
            },
          }),
        );
        await target.route('http://127.0.0.1:10001/g/game/**/index.html*', async (route) =>
          route.fulfill({
            contentType: 'text/html',
            body: await readFile(new URL('./fixtures/fall-game/index.html', import.meta.url)),
          }),
        );
        /* A routed page is not on loopback to Chrome, so its own fetches are routed too: an opaque frame may not reach
           loopback. */
        await target.route('http://127.0.0.1:10001/g/game/**/manifest.json', async (route) =>
          route.fulfill({
            contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' },
            body: await readFile(new URL('./fixtures/fall-game/manifest.json', import.meta.url)),
          }),
        );
        await target.goto(`/g/game?room=${room.roomId}&test`);
        await expect.poll(() => roomState(target), { timeout: 30_000 }).toBe('connected');
        await expect.poll(() => framePaused(target), { timeout: 30_000 }).toBe(false);
      }),
    );
    await owner.evaluate(() => (window as Window & { __ogmHost: { room: { play(): void } } }).__ogmHost.room.play());
    await expect.poll(() => room.state.phase).toBe('playing');
    await owner.getByRole('button', { name: 'Menu' }).click({ force: true });
    await expect(peer.getByText('Paused by owner')).toBeVisible();
    await expect.poll(() => framePaused(owner)).toBe(true);
    await expect.poll(() => framePaused(peer)).toBe(true);
    const pausedPosition = await framePosition(peer);
    expect(typeof pausedPosition).toBe('number');
    await peer.waitForTimeout(500);
    expect(await framePosition(peer)).toBe(pausedPosition);
    await peer.getByRole('button', { name: 'Resume' }).click();
    await expect(peer.getByRole('button', { name: 'Resume' })).toBeDisabled();
    await expect.poll(() => room.state.matchPausedBy, { timeout: 15_000 }).toBe('');
    await expect.poll(() => framePaused(peer), { timeout: 15_000 }).toBe(false);
    await expect.poll(() => framePaused(owner)).toBe(false);
    await expect(owner.getByRole('button', { name: 'Resume' })).not.toBeVisible();
    await expect(peer.getByRole('button', { name: 'Resume' })).not.toBeVisible();
  } finally {
    await ownerContext.close();
    await peerContext.close();
    await harness.testServer.shutdown();
  }
});

test('two SDK clients stop and resume on the same per-seat tick', async ({ browser, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'one two-client run covers the shared room behavior');
  test.setTimeout(180_000);
  const result = await build({
    entryPoints: [fileURLToPath(new URL('./fixtures/per-seat-game.ts', import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    define: { __GM_BUILD__: '"test"' },
    write: false,
  });
  const bundle = Buffer.from(result.outputFiles[0]!.contents);
  const port = await availablePort();
  const harness = await startHarness({}, port);
  const room = await newRoom(harness.testServer, {
    protocol: 2,
    mode: 'per-seat',
    gameId: 'game',
    branchId: 'main',
    buildId,
    maxPlayers: 2,
    startLeadMs: 1000,
    timings: { idleDisposeSec: 120, seatReconnectSec: 5 },
  });
  const ownerGrant = await joinOptions(room, 'owner', 'owner');
  const peerGrant = await joinOptions(room, 'peer', 'player');
  const contexts = await Promise.all([browser.newContext({ baseURL }), browser.newContext({ baseURL })]);
  const [owner, peer] = await Promise.all(contexts.map((context) => context.newPage()));
  try {
    for (const [page, grant] of [
      [owner!, ownerGrant.grant],
      [peer!, peerGrant.grant],
    ] as const) {
      await installAuthRoutes(page, { signedIn: true });
      await installGameApi(page);
      await page.route('**/api/v1/rooms/*/grant', (route) =>
        route.fulfill({
          json: {
            roomId: room.roomId,
            grant,
            pin: { gameId: 'game', branchId: 'main', buildId },
            roomsUrl: `ws://127.0.0.1:${port}`,
          },
        }),
      );
      await page.route('http://127.0.0.1:10001/g/game/**/index.html*', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: '<html><body><script type="module" src="./per-seat-game.js"></script></body></html>',
        }),
      );
      await page.route('http://127.0.0.1:10001/g/game/**/per-seat-game.js', (route) =>
        /* The game runs as an opaque document, so its module script needs CORS. */
        route.fulfill({
          contentType: 'text/javascript',
          headers: { 'access-control-allow-origin': '*' },
          body: bundle,
        }),
      );
      await page.goto(`/g/game?room=${room.roomId}&test`);
      await expect.poll(() => roomState(page), { timeout: 30_000 }).toBe('connected');
      await expect.poll(() => sdkState(page), { timeout: 30_000 }).toBeDefined();
    }
    await owner!.evaluate(() => (window as Window & { __ogmHost: { room: { play(): void } } }).__ogmHost.room.play());
    await expect.poll(() => room.state.phase).toBe('playing');
    const starter = await connect(harness.testServer, room, 'owner', 'owner');
    starter.send('net.start.request', { force: true });
    await expect.poll(() => room.state.epoch).not.toBe('');
    await starter.leave(true);
    await expect.poll(async () => (await sdkState(peer!))?.tick ?? 0, { timeout: 15_000 }).toBeGreaterThan(2);
    await owner!.getByRole('button', { name: 'Menu' }).click({ force: true });
    // The menu freezes each clock at once; the room's prepared boundary then runs both to one shared tick.
    await expect
      .poll(
        async () => {
          const [a, b] = await Promise.all([sdkState(owner!), sdkState(peer!)]);
          return a?.paused === true && b?.paused === true && a.tick === b.tick ? a.tick : undefined;
        },
        { timeout: 15_000 },
      )
      .toBeGreaterThan(2);
    await peer!.getByRole('button', { name: 'Resume' }).click();
    await expect.poll(async () => (await sdkState(peer!))?.paused, { timeout: 15_000 }).toBe(false);
    await expect.poll(async () => (await sdkState(owner!))?.paused, { timeout: 15_000 }).toBe(false);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await harness.testServer.shutdown();
  }
});

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no local test port');
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return address.port;
}

async function roomState(page: Page): Promise<string | undefined> {
  return page.evaluate(
    () =>
      (window as Window & { __ogmHost?: { room?: { state(): { status?: string } } } }).__ogmHost?.room?.state().status,
  );
}

async function framePaused(page: Page): Promise<boolean | undefined> {
  const frame = page.frames().find((item) => item.url().startsWith('http://127.0.0.1:10001/g/'));
  return frame?.evaluate(() => (window as Window & { __fixture?: { paused?: boolean } }).__fixture?.paused);
}

async function framePosition(page: Page): Promise<number | undefined> {
  const frame = page.frames().find((item) => item.url().startsWith('http://127.0.0.1:10001/g/'));
  return frame?.evaluate(() => (window as Window & { __fixture?: { firstY?: number } }).__fixture?.firstY);
}

async function sdkState(page: Page): Promise<{ tick: number; paused: boolean } | undefined> {
  const frame = page.frames().find((item) => item.url().startsWith('http://127.0.0.1:10001/g/'));
  if (!frame || frame.isDetached()) return undefined;
  try {
    return await frame.evaluate(() => {
      const runtime = (window as Window & { __pauseFixture?: { clock: { tick: number; paused: boolean } } })
        .__pauseFixture;
      return runtime ? { tick: runtime.clock.tick, paused: runtime.clock.paused } : undefined;
    });
  } catch {
    return undefined;
  }
}
