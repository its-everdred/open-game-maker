import { expect, test, type Frame, type Page, type Route } from '@playwright/test';

import { installAuthRoutes } from './fixtures/auth-routes';
import { installGameApi } from './support/mock-game-api';

type GameHook = { bridgeState: string; headRev: number; mode: string };
type FixtureHook = {
  applies: Array<{ doc: { globals?: Record<string, unknown> }; patches: unknown[]; rev: number }>;
  cameras: Array<{ mode: string; target?: string }>;
  selected: string[];
};
type FakeRoomHook = {
  emit(message: unknown): void;
  setState(state: object): void;
};

test.use({ serviceWorkers: 'block' });

test('scripts watcher catch-up, phases, and host-left through the fake session', async ({ page }, testInfo) => {
  await installAuthRoutes(page, { signedIn: true });
  await installGameApi(page);
  await page.route('**/api/v1/games/game/branches/main', (route) =>
    json(route, { name: 'Main room', version: '0.0.4' }),
  );
  await page.goto('/g/game?test');
  await expect.poll(() => gameState(page).then((state) => state?.bridgeState), { timeout: 5_000 }).toBe('ready');
  await expect.poll(() => hasFakeRoom(page)).toBe(true);
  const frame = gameFrame(page);

  await roomFake(page, 'emit', {
    t: 'welcome',
    you: { userId: 'watcher', playerIndex: 1, sessionId: 'watcher-session' },
    state: {
      protocol: 1,
      pin: { gameId: 'game', branchId: 'main', buildId: 'b_01BX5ZZKBKACTAV9WEVGEMMVRZ' },
      ownerId: 'owner',
      editorSessionId: 'owner-session',
      phase: 'editing',
      phaseAt: Date.now(),
      playRev: 5,
      lastRev: 5,
      maxPlayers: 4,
      members: {
        owner: {
          userId: 'owner',
          name: 'Kim',
          role: 'owner',
          playerIndex: 0,
          connected: true,
          sessions: ['owner-session'],
        },
        watcher: {
          userId: 'watcher',
          name: 'Sam',
          role: 'player',
          playerIndex: 1,
          connected: true,
          sessions: ['watcher-session'],
        },
      },
      presence: { selection: ['e-1'], privateMode: false },
    },
  });
  await expect.poll(() => gameState(page).then((current) => current?.mode)).toBe('edit');
  await expect(page.locator('.room-version-badge')).toHaveText('Main room · v0.0.4');
  await expect.poll(() => fixtureState(frame).then((state) => state.selected)).toEqual(['e-1']);

  const follow = page.getByRole('button', { name: 'Follow' });
  const free = page.getByRole('button', { name: 'Free' });
  await expect(follow).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => fixtureState(frame).then((state) => state.cameras)).toEqual([{ mode: 'follow' }]);
  await free.click();
  await expect(free).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(() => fixtureState(frame).then((state) => state.cameras))
    .toEqual([{ mode: 'follow' }, { mode: 'free' }]);
  await follow.click();
  await expect
    .poll(() => fixtureState(frame).then((state) => state.cameras))
    .toEqual([{ mode: 'follow' }, { mode: 'free' }, { mode: 'follow' }]);
  if (testInfo.project.name === 'phone') {
    const box = await free.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  for (const rev of [6, 7, 8]) {
    await roomFake(page, 'emit', {
      t: 'design.tx',
      tx: {
        branchId: 'main',
        rev,
        baseRev: rev - 1,
        actor: 'owner',
        kind: 'manual',
        patches: [
          {
            op: rev === 6 ? 'add' : 'replace',
            path: ['globals', 'roomRevision'],
            value: rev,
          },
        ],
      },
    });
  }
  await expect.poll(() => gameState(page).then((state) => state?.headRev)).toBe(8);
  await expect
    .poll(() => fixtureState(frame).then((state) => state.applies.at(-1)))
    .toMatchObject({
      rev: 8,
      doc: { globals: { roomRevision: 8 } },
      patches: [{ op: 'replace', path: ['globals', 'roomRevision'], value: 8 }],
    });

  await roomFake(page, 'setState', { presence: { selection: ['e-1'], privateMode: true } });
  await expect(page.getByText('talking to the builder…')).toBeVisible();
  await expect.poll(() => fixtureState(frame).then((state) => state.selected)).toEqual([]);
  await roomFake(page, 'setState', { presence: { selection: ['e-1'], privateMode: false } });
  await expect(page.getByText('talking to the builder…')).toBeHidden();
  await expect.poll(() => fixtureState(frame).then((state) => state.selected)).toEqual(['e-1']);

  await free.click();
  await roomFake(page, 'setState', { phase: 'playing', phaseAt: Date.now() });
  await expect.poll(() => gameState(page).then((state) => state?.mode), { timeout: 500 }).toBe('play');
  await expect(free).toBeHidden();
  /* The game keeps Free through a play round, so the toggle must still show Free when editing resumes. */
  await roomFake(page, 'setState', { phase: 'editing', phaseAt: Date.now() });
  await expect(free).toHaveAttribute('aria-pressed', 'true');
  await roomFake(page, 'setState', { phase: 'pausedForHost', phaseAt: Date.now() });
  await expect(page.getByRole('heading', { name: "Kim's connection dropped" })).toBeVisible();
  await roomFake(page, 'emit', { t: 'ended', reason: 'host-left' });

  const leave = page.getByRole('button', { name: 'Leave' });
  await expect(leave).toBeVisible();
  if (testInfo.project.name === 'phone') {
    const box = await leave.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(64);
    expect(box?.height).toBeGreaterThanOrEqual(64);
  }
});

test('copies a fresh owner invite when the share sheet is unavailable', async ({ context, page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
  });
  await installAuthRoutes(page, { signedIn: true });
  await installGameApi(page);
  await page.route('**/api/v1/games/game/rooms', (route) =>
    json(route, {
      roomId: 'room-1',
      grant: 'memory-only',
      pin: { gameId: 'game', branchId: 'main', buildId: 'b_01BX5ZZKBKACTAV9WEVGEMMVRZ' },
      roomsUrl: 'ws://127.0.0.1:9',
    }),
  );
  await page.route('**/api/v1/rooms/room-1/invites', (route) =>
    json(route, { url: 'http://127.0.0.1:43170/join/invite-1' }),
  );
  await page.goto('/g/game?test');
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(page.url()).origin });

  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: 'Invite' }).click();
  await expect(page.getByText('Copied')).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('/join/');
});

function gameState(page: Page): Promise<GameHook | undefined> {
  return page.evaluate(() => (window as Window & { __ogmHost?: { game?: GameHook } }).__ogmHost?.game);
}

function hasFakeRoom(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    type TestWindow = Window & { __ogmHost?: { room?: { fake?: FakeRoomHook } } };
    return (window as TestWindow).__ogmHost?.room?.fake !== undefined;
  });
}

function roomFake(page: Page, method: keyof FakeRoomHook, value: unknown): Promise<void> {
  return page.evaluate(
    ({ method, value }) => {
      type TestWindow = Window & { __ogmHost?: { room?: { fake?: FakeRoomHook } } };
      const fake = (window as TestWindow).__ogmHost?.room?.fake;
      if (fake === undefined) throw new Error('fake room session is not installed');
      (fake[method] as (input: unknown) => void)(value);
    },
    { method, value },
  );
}

function gameFrame(page: Page): Frame {
  const frame = page.frames().find((candidate) => {
    if (candidate === page.mainFrame()) return false;
    return new URL(candidate.url()).pathname.startsWith('/g/');
  });
  if (!frame) throw new Error('cross-origin game frame was not mounted');
  return frame;
}

function fixtureState(frame: Frame): Promise<FixtureHook> {
  return frame.evaluate(() => (window as Window & { __fixture: FixtureHook }).__fixture);
}

async function json(route: Route, body: unknown): Promise<void> {
  await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
}
