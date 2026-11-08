import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, matchRoutes, RouterProvider, useLocation } from 'react-router';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { RESERVED_GAME_SLUGS } from '@ogm/contracts/browser';

import { authClient } from '../lib/api/auth';
import { collectScreenRoutes, screenRouteObjects } from './router';
import type { ScreenRoute } from './screen';

const captureError = vi.hoisted(() => vi.fn());
const soundApi = vi.hoisted(() => ({
  getVolume: vi.fn(() => 1),
  onChange: vi.fn(() => () => undefined),
  setMuted: vi.fn(),
  setVolume: vi.fn(),
  status: vi.fn(() => 'off' as const),
  unlock: vi.fn(),
}));

vi.mock('../features/bug-report', () => ({
  BugButton: () => null,
  BugSheet: () => null,
  captureError,
}));

vi.mock('../features/build-chat/BuildChatDock', () => ({
  BuildChatDock: () => <button type="button">Build chat</button>,
}));

vi.mock('../features/build-chat/jobs', () => ({
  isTerminal: (value: string) => ['done', 'failed', 'cancelled'].includes(value),
  useMyJobs: () => ({ jobs: [], active: [], games: [] }),
}));

vi.mock('../routes/admin/api', () => ({
  useAdminMe: () => ({ data: undefined }),
}));

vi.mock('../lib/notify', () => ({
  Toasts: () => null,
  useNotificationFeed: () => undefined,
}));

vi.mock('../lib/sound', () => soundApi);

vi.mock('../lib/api/session', () => ({ useSession: () => ({ data: null, isPending: false }) }));

const routeTable = [
  '/',
  '/signin',
  '/connect/github',
  '/all',
  '/games',
  '/play/castle-game',
  '/new',
  '/g/game-1',
  '/g/game-1/versions',
  '/g/game-1/releases',
  '/g/game-1/merge',
  '/g/game-1/merge/plan-1',
  '/join/invite-1',
  '/admin',
  '/admin/members',
  '/admin/invites',
  '/admin/budgets',
  '/admin/builds',
  '/admin/builds/job-1',
  '/admin/intake',
  '/settings',
  '/blobs',
  '/blobs/play',
  '/blobs/review/12',
];

describe('screen route collection', () => {
  afterEach(() => {
    cleanup();
    captureError.mockReset();
    soundApi.setMuted.mockReset();
    soundApi.setVolume.mockReset();
    soundApi.unlock.mockReset();
    vi.restoreAllMocks();
  });

  // A mounted better-auth session store unmounts on a 1 s timer that touches `window`; if it outlives the file, it
  // fires after jsdom is gone and fails the run with an unhandled error (#615).
  afterAll(() => {
    expect((authClient.$store.atoms.session as unknown as { active?: boolean }).active).toBeFalsy();
  });

  it.each(routeTable)('resolves %s through a screen module', (path) => {
    expect(matchRoutes(screenRouteObjects, path)).not.toBeNull();
  });

  // A game's short link sits at the top of the path (#591). Every screen's first segment must be a slug the API never
  // hands out, or a game made before the screen existed would hold the screen's address.
  it('reserves every screen’s first path segment as a game slug', () => {
    const segments = screenRouteObjects
      .map((route) => route.path!.split('/')[1]!)
      .filter((segment) => segment !== '' && !segment.startsWith(':'));
    expect(segments.length).toBeGreaterThan(5);
    expect(segments.filter((segment) => !RESERVED_GAME_SLUGS.has(segment))).toEqual([]);
  });

  it.each(['/new', '/settings', '/admin', '/all', '/login'])('keeps %s on its screen, not a game link', (path) => {
    const matched = matchRoutes(screenRouteObjects, path)!;
    expect(matched[0]!.route.path).toBe(path);
  });

  it('collects a fixture screen from the glob result without router edits', () => {
    const fixture: ScreenRoute = {
      path: '/fixture',
      element: <h1>Fixture</h1>,
      chrome: 'bare',
      auth: 'none',
    };

    const routes = collectScreenRoutes({
      '../routes/__fixture__/route.tsx': { route: fixture },
    });

    expect(matchRoutes(routes, '/fixture')).not.toBeNull();
  });

  it('names a module that omits its route export', () => {
    expect(() => collectScreenRoutes({ '../routes/broken/route.tsx': {} })).toThrow('../routes/broken/route.tsx');
  });

  it('keeps the chat dock mounted when a screen render crashes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const routes = collectScreenRoutes({
      '../routes/games/route.tsx': {
        route: {
          path: '/games',
          element: <BrokenPicker />,
          chrome: 'app',
          auth: 'none',
        },
      },
      '../routes/new/route.tsx': {
        route: {
          path: '/new',
          element: <h1>New game</h1>,
          chrome: 'app',
          auth: 'none',
        },
      },
      '../routes/game/route.tsx': {
        route: {
          path: '/g/:gameId',
          element: <BrokenPicker />,
          chrome: 'app',
          auth: 'none',
        },
      },
    });
    const router = createMemoryRouter(routes, { initialEntries: ['/games?spotlight=g_1'] });

    render(<RouterProvider router={router} />);

    expect(await screen.findByRole('button', { name: 'Try again' })).toBeVisible();
    expect(document.querySelector('#chat-dock-slot')).toContainElement(
      screen.getByRole('button', { name: 'Build chat' }),
    );
    await waitFor(() =>
      expect(captureError).toHaveBeenCalledWith(expect.any(Error), { route: '/games', gameId: 'g_1' }),
    );

    await router.navigate('/new');
    expect(await screen.findByRole('heading', { name: 'New game' })).toBeVisible();

    captureError.mockClear();
    await router.navigate('/g/g_2');
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeVisible();
    await waitFor(() =>
      expect(captureError).toHaveBeenCalledWith(expect.any(Error), { route: '/g/g_2', gameId: 'g_2' }),
    );
  }, 10_000);

  it('wraps app routes in the prototype studio chrome', async () => {
    const routes = collectScreenRoutes({
      '../routes/games/route.tsx': {
        route: {
          path: '/games',
          element: <h1>Games</h1>,
          chrome: 'app',
          auth: 'none',
        },
      },
    });
    const router = createMemoryRouter(routes, { initialEntries: ['/games'] });

    render(<RouterProvider router={router} />);

    expect(await screen.findByRole('link', { name: 'Open Game Maker 2000' })).toHaveAttribute('href', '/');
    expect(document.querySelector('.studio-backdrop')).toBeInTheDocument();
    expect(document.querySelector('.studio-backdrop canvas')).not.toBeInTheDocument();
    const menu = screen.getByRole('button', { name: 'Menu' });
    expect(menu).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(menu);

    expect(menu).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Unmute' })).toBeVisible();
  });

  it('retries a crashed screen', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let crashing = true;
    function RecoverableScreen() {
      if (crashing) throw new Error('broken screen');
      return <h1>Games</h1>;
    }

    const routes = collectScreenRoutes({
      '../routes/games/route.tsx': {
        route: {
          path: '/games',
          element: <RecoverableScreen />,
          chrome: 'app',
          auth: 'none',
        },
      },
    });
    const router = createMemoryRouter(routes, { initialEntries: ['/games'] });
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole('button', { name: 'Try again' })).toBeVisible();
    crashing = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('heading', { name: 'Games' })).toBeVisible();
  });

  it('keeps screen state across search-only navigation', async () => {
    const routes = collectScreenRoutes({
      '../routes/new/route.tsx': {
        route: {
          path: '/new',
          element: <StatefulScreen />,
          chrome: 'app',
          auth: 'none',
        },
      },
    });
    const router = createMemoryRouter(routes, { initialEntries: ['/new?step=genre'] });
    render(<RouterProvider router={router} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Adventure' }));
    expect(screen.getByRole('button', { name: 'Adventure' })).toHaveAttribute('aria-pressed', 'true');

    await router.navigate('/new?step=vibe');

    expect(await screen.findByText('?step=vibe')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Adventure' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('resets screen state when the same route selects another game', async () => {
    const routes = collectScreenRoutes({
      '../routes/games/route.tsx': {
        route: {
          path: '/games',
          element: <StatefulScreen />,
          chrome: 'app',
          auth: 'none',
        },
      },
    });
    const router = createMemoryRouter(routes, { initialEntries: ['/games?spotlight=g_1'] });
    render(<RouterProvider router={router} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Adventure' }));
    expect(screen.getByRole('button', { name: 'Adventure' })).toHaveAttribute('aria-pressed', 'true');

    await router.navigate('/games?spotlight=g_2');

    expect(await screen.findByText('?spotlight=g_2')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Adventure' })).toHaveAttribute('aria-pressed', 'false');
  });
});

function BrokenPicker(): never {
  throw new Error('broken picker');
}

function StatefulScreen() {
  const [selected, setSelected] = useState(false);
  const location = useLocation();
  return (
    <>
      <button type="button" aria-pressed={selected} onClick={() => setSelected(true)}>
        Adventure
      </button>
      <output>{location.search}</output>
    </>
  );
}
