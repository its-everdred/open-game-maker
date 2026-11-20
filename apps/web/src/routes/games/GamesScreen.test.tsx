import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, MemoryRouter, useLocation, useNavigate, type InitialEntry } from 'react-router';

import { commandFixture } from '../../features/commands-inbox/fixtures';
import { App } from '../../app/App';
import { GameMenuProvider, useGameMenu } from '../../app/GameMenu';
import { GamesScreen } from './GamesScreen';
import { startTrailer } from './trailerVideo';

const session = vi.hoisted(() => ({ userId: undefined as string | undefined }));
vi.mock('../../lib/api/session', () => ({
  useSession: () => ({ data: session.userId ? { user: { id: session.userId } } : undefined }),
}));
vi.mock('../../lib/sound', () => ({ set: vi.fn(), getVolume: () => 1, status: () => 'on', onChange: () => () => {} }));

const games = [
  {
    id: 'g_1',
    title: 'Midnight Crumbs',
    ownerId: 'u_1',
    familyId: 'f_1',
    repo: null,
    coverUrl: null,
    publishedReleaseId: null,
    tagline: 'A cozy midnight adventure',
    choices: { genre: ['adventure'], vibe: ['cozy', 'creepy'] },
    createdAt: '2026-11-01T05:00:00Z',
    updatedAt: '2026-11-01T05:10:00Z',
  },
  {
    id: 'g_2',
    title: 'Goblin Cellar',
    ownerId: 'u_1',
    familyId: 'f_1',
    repo: { owner: 'its-everdred', name: 'goblin-cellar', url: 'https://example.test/goblin-cellar' },
    coverUrl: 'https://example.test/goblin.png',
    publishedReleaseId: 'r_7',
    choices: { genre: ['rpg', 'roguelike'] },
    createdAt: '2026-10-20T00:00:00Z',
    updatedAt: '2026-10-30T00:00:00Z',
  },
  {
    id: 'g_3',
    title: 'Sky Delivery',
    ownerId: 'u_1',
    familyId: 'f_1',
    repo: null,
    coverUrl: null,
    publishedReleaseId: null,
    choices: {},
    createdAt: '2026-10-25T00:00:00Z',
    updatedAt: '2026-10-25T00:00:00Z',
  },
];

let gamesResponse = games;

const jobs = [
  {
    id: 'j_1',
    gameId: 'g_1',
    kind: 'new_game',
    state: 'running',
    friendlyState: 'Building',
    progressPercent: 40,
  },
];

let jobsResponse = jobs;
let commandsResponse: unknown[] = [];

const branches = [
  {
    id: 'main',
    gameId: 'g_2',
    name: 'main',
    gitRef: 'main',
    forkPoint: null,
    headRev: 40,
    latestBuildId: 'b_13',
    status: 'active',
    createdBy: 'u_1',
    createdAt: '2026-10-20T00:00:00Z',
  },
];

// Auto-selection waits for a layout measurement and a data round trip; jsdom needs more than the 1s default when CI
// runs the suites in parallel.
const AUTO_SELECT = { timeout: 3_000 } as const;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => navigate(-1)}>Back</button>
      <output data-testid="location">{`${location.pathname}${location.search}`}</output>
      <output data-testid="location-state">{JSON.stringify(location.state ?? null)}</output>
    </>
  );
}

function MenuProbe() {
  const { controls } = useGameMenu();
  return (
    <>
      {controls?.actions.map((action) => (
        <button key={action.id} type="button" onClick={action.onSelect}>
          {action.label}
        </button>
      ))}
    </>
  );
}

function renderGames(
  entry: InitialEntry = '/all',
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <GameMenuProvider>
          <GamesScreen />
          <LocationProbe />
          <MenuProbe />
        </GameMenuProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function setGridColumns(columns: number) {
  const original = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudoElement) => {
    const styles = original(element, pseudoElement);
    if (!element.classList.contains('games-grid')) return styles;
    return new Proxy(styles, {
      get(target, property, receiver) {
        if (property === 'gridTemplateColumns') return Array.from({ length: columns }, () => '320px').join(' ');
        return Reflect.get(target, property, receiver);
      },
    });
  });
}

beforeEach(() => {
  session.userId = undefined;
  localStorage.clear();
  gamesResponse = games;
  jobsResponse = jobs;
  commandsResponse = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/games/g_2') && init?.method === 'PATCH') {
        const preference = JSON.parse(String(init.body)) as { allowAiGeneratedAssets: boolean };
        gamesResponse = gamesResponse.map((game) => (game.id === 'g_2' ? { ...game, ...preference } : game));
        return json(gamesResponse.find((game) => game.id === 'g_2'));
      }
      if (url.endsWith('/api/v1/games')) return json({ games: gamesResponse });
      if (url.includes('/api/v1/jobs')) return json({ jobs: jobsResponse });
      if (url.endsWith('/commands')) return json({ commands: commandsResponse });
      if (url.endsWith('/api/v1/games/g_2/branches')) return json({ branches });
      if (url.includes('/branches')) return json({ error: 'not_found' }, 404);
      return json({ error: 'unexpected' }, 500);
    }),
  );
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false })),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('orders played games newest first ahead of the existing unplayed order', async () => {
  gamesResponse = [...games, { ...games[0]!, id: 'g_4', title: 'Fourth', updatedAt: '2026-01-01T00:00:00Z' }].map(
    (game) => ({
      ...game,
      lastPlayedAt: game.id === 'g_3' ? '2026-11-03T00:00:00Z' : game.id === 'g_1' ? '2026-11-04T00:00:00Z' : null,
    }),
  );
  renderGames();
  await waitFor(() => {
    const ids = [...document.querySelectorAll('[data-game-id]')].map((node) => node.getAttribute('data-game-id'));
    expect(ids.slice(0, 2)).toEqual(['g_1', 'g_3']);
    expect(ids.indexOf('g_2')).toBeGreaterThan(1);
    expect(ids.indexOf('g_4')).toBeGreaterThan(ids.indexOf('g_2'));
  });
});

describe('GamesScreen', () => {
  it('opens the selected prototype showcase even when Goblin Cellar has a build', async () => {
    renderGames();
    fireEvent.click(await screen.findByRole('button', { name: /^RestoreBound:/ }, AUTO_SELECT));
    expect(await screen.findByText('A sleepy village, one repair at a time.')).toBeVisible();
    const play = await screen.findByRole('button', { name: 'Play RestoreBound' });
    await waitFor(() => expect(play).toBeEnabled());
    fireEvent.click(play);
    expect(screen.getByTestId('location')).toHaveTextContent('/g/showcase/restorebound?mode=play');
  });
  it('opens the prototype demo for a showcase game before Goblin Cellar is registered', async () => {
    gamesResponse = [];
    renderGames();
    fireEvent.click(await screen.findByRole('button', { name: /^RestoreBound:/ }, AUTO_SELECT));
    fireEvent.click(await screen.findByRole('button', { name: 'Play RestoreBound' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/g/showcase/restorebound?mode=play');
  });
  it('does not show a share button for a selected game', async () => {
    const { container } = renderGames('/all?spotlight=g_2');
    await screen.findByRole('heading', { name: 'Goblin Cellar' });
    expect(container.querySelector('.game-copy')).toBeNull();
    expect(screen.queryByRole('button', { name: /Copy link/ })).toBeNull();
  });
  it('keeps the prototype showcase when there are no real games', async () => {
    gamesResponse = [];
    renderGames();

    expect(await screen.findByRole('button', { name: /^RestoreBound:/ })).toBeVisible();
    expect(screen.queryByRole('region', { name: /spotlight/ })).toBeNull();
  });

  it.each([
    { label: 'one game', count: 1 },
    { label: 'exactly one thumbnail row', count: 3 },
  ])('keeps the showcase unselected with $label', async ({ count }) => {
    gamesResponse = games.slice(0, count);
    setGridColumns(3);
    const { container } = renderGames('/all?test');

    // The selection and the spotlight mount either side of a paint; allow for a
    // slow first render under the fully parallel suite.
    await screen.findByRole('button', { name: /^Midnight Crumbs/ });
    expect(screen.getByTestId('location')).not.toHaveTextContent('spotlight');
    expect(container.querySelectorAll('.game-tile')).toHaveLength(7 + count - (count >= 2 ? 1 : 0));
    expect(container.querySelectorAll('[data-game-id].is-selected')).toHaveLength(0);
  });

  it('keeps the zoomed-out grid when the games overflow one thumbnail row', async () => {
    gamesResponse = [...games, { ...games[2]!, id: 'g_4', title: 'Fourth Game', updatedAt: '2026-10-24T00:00:00Z' }];
    setGridColumns(3);
    const { container } = renderGames('/all?test');

    await screen.findByRole('button', { name: 'Fourth Game' });
    expect(screen.queryByRole('region', { name: /spotlight/ })).toBeNull();
    expect(screen.getByTestId('location')).not.toHaveTextContent('spotlight');
    expect(container.querySelectorAll('.game-tile')).toHaveLength(16);
  });

  it('starts a selected trailer during the tile click and adopts that video', async () => {
    gamesResponse = games.map((game) => (game.id === 'g_1' ? { ...game, trailerUrl: '/trailer.mp4' } : game));
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockReturnValue(false);
    renderGames('/all?test');
    fireEvent.click(await screen.findByRole('button', { name: /^Midnight Crumbs:/ }));
    expect(play).toHaveBeenCalledOnce();
    const started = play.mock.instances[0];
    await waitFor(() => expect(document.querySelector('.game-trailer-layer video')).toBe(started), AUTO_SELECT);
  });

  it('stops a queued trailer when browser Back removes the selection', async () => {
    gamesResponse = games.map((game) => (game.id === 'g_1' ? { ...game, trailerUrl: '/trailer.mp4' } : game));
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    renderGames('/all?test');
    fireEvent.click(await screen.findByRole('button', { name: /^Midnight Crumbs:/ }));
    fireEvent.click(screen.getByText('Back'));
    await waitFor(() => expect(screen.getByTestId('location')).not.toHaveTextContent('spotlight'));
    await waitFor(() => expect(pause).toHaveBeenCalled());
  });

  it('does not open a game via Enter while its new build is running', async () => {
    jobsResponse = [{ ...jobs[0]!, gameId: 'g_2' }];
    renderGames('/all?test');
    const tile = await screen.findByRole('button', { name: /^Goblin Cellar:/ });
    fireEvent.click(tile);
    expect(await screen.findByRole('button', { name: 'Play Goblin Cellar' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('grid', { name: 'Your games' }), { key: 'Enter' });
    expect(screen.getByTestId('location')).toHaveTextContent('/all');
  });

  it('stops a gesture-started trailer if the screen unmounts before the detail mounts', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const { unmount } = renderGames('/all?test');
    startTrailer({ trailerUrl: '/trailer.mp4' });
    unmount();
    await waitFor(() => expect(pause).toHaveBeenCalled(), { timeout: 2000 });
  });

  it('expands the selected game inside its existing grid position and restores it on close', async () => {
    const { container } = renderGames('/all?test');
    const tile = await screen.findByRole('button', { name: /^Goblin Cellar:/ });
    const cell = tile.closest('[data-game-id]')!;
    const cover = cell.querySelector('.game-cover-host .game-cover-image');
    expect(cover).not.toBeNull();
    const id = cell.getAttribute('data-game-id');
    const order = [...container.querySelectorAll('[data-game-id]')].map((item) => item.getAttribute('data-game-id'));
    fireEvent.click(tile);
    const spotlight = await screen.findByRole('region', { name: /Goblin Cellar spotlight/ });
    expect(screen.queryByRole('button', { name: 'New game' })).not.toBeInTheDocument();
    expect(spotlight.closest('[data-game-id]')).toHaveAttribute('data-game-id', id);
    expect(spotlight.querySelector('.games-spotlight-media .game-cover-image')).toBe(cover);
    expect([...container.querySelectorAll('[data-game-id]')].map((item) => item.getAttribute('data-game-id'))).toEqual(
      order,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close game' }));
    expect(screen.getByRole('button', { name: 'New game' })).toBeVisible();
    expect(await screen.findByRole('button', { name: /^Goblin Cellar:/ })).toBeVisible();
    expect(container.querySelector('[data-game-id="g_2"] .game-cover-image')).toBe(cover);
  });

  it('keeps the grid dismissed after the closing navigation lands', async () => {
    renderGames('/games?test');
    fireEvent.click(await screen.findByRole('button', { name: /^Goblin Cellar:/ }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('spotlight=g_2'));

    fireEvent.keyDown(await screen.findByRole('button', { name: 'Close game' }), { key: 'Escape' });

    await waitFor(() => expect(screen.getByTestId('location')).not.toHaveTextContent('spotlight'));
    expect(screen.getByTestId('location-state')).toHaveTextContent('{"spotlightDismissed":true}');
    expect(screen.queryByRole('region', { name: /spotlight/ })).toBeNull();
  });

  it('updates build progress without selecting a game', async () => {
    let resolveJobs!: (response: Response) => void;
    const pendingJobs = new Promise<Response>((resolve) => {
      resolveJobs = resolve;
    });
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/v1/games')) return json({ games });
      if (url.includes('/api/v1/jobs')) return pendingJobs;
      if (url.endsWith('/commands')) return json({ commands: commandsResponse });
      if (url.endsWith('/api/v1/games/g_2/branches')) return json({ branches });
      if (url.includes('/branches')) return json({ error: 'not_found' }, 404);
      return json({ error: 'unexpected' }, 500);
    });
    setGridColumns(3);
    const { container } = renderGames('/all?test');

    await screen.findByRole('button', { name: /^Midnight Crumbs/ });
    expect(screen.queryByRole('region', { name: /spotlight/ })).toBeNull();

    resolveJobs(json({ jobs: [{ ...jobs[0]!, gameId: 'g_2' }] }));

    expect(await screen.findByText('Building 40%')).toBeVisible();
    expect(screen.getByTestId('location')).not.toHaveTextContent('spotlight');
    expect(container.querySelector<HTMLElement>('[data-game-id]')?.dataset.gameId).toBe('g_2');
  });

  it('renders real tiles, prioritizes the building game, and shows its friendly progress', async () => {
    const { container } = renderGames();

    await screen.findByRole('button', { name: /^Midnight Crumbs/ });
    const tiles = [...container.querySelectorAll<HTMLElement>('[data-game-id]')];
    expect(tiles[0]?.dataset.gameId).toBe('g_2');
    expect(tiles.slice(-2).map((tile) => tile.dataset.gameId)).toEqual(['g_1', 'g_3']);
    expect(screen.getByText('Building 40%')).toBeVisible();
    expect(screen.getAllByText('New').length).toBeGreaterThanOrEqual(2);
  }, 10_000);

  it('opens the URL-selected spotlight and falls back to main when branches are unavailable', async () => {
    const { container } = renderGames('/all?spotlight=g_1');

    expect(await screen.findByRole('heading', { name: 'Midnight Crumbs' }, AUTO_SELECT)).toBeVisible();
    expect(container.querySelector('.games-spotlight-media .game-cover')).toBeVisible();
    expect(screen.queryByText(/Your library|My games|Selected game|Choose what happens next|Versions/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Close game' })).toContainHTML('<svg');
    expect(screen.queryByRole('listitem', { name: 'main' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play Midnight Crumbs' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit Midnight Crumbs' })).toBeDisabled();
  });

  it('uses the prototype creation affordance without adding helper copy', async () => {
    const { container } = renderGames();

    await screen.findByRole('button', { name: 'New game' });
    expect(screen.getByRole('button', { name: 'New game' }).textContent).toBe('');
    const plus = container.querySelector('.games-new .plus');
    expect(plus).not.toHaveTextContent('+');
    expect(plus?.querySelector('svg')).toHaveAttribute('viewBox', '0 0 16 16');
    expect(plus?.querySelector('path')).toHaveAttribute('d', 'M8 2.5v11M2.5 8h11');
    expect(screen.queryByText(/Create a new game|Add another game|Start creating/)).toBeNull();
  });

  it('commits keyboard selection before a subsequent Escape', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createMemoryRouter(
      [
        {
          path: '/all',
          element: (
            <GameMenuProvider>
              <GamesScreen />
            </GameMenuProvider>
          ),
        },
      ],
      { initialEntries: ['/all?test'] },
    );
    render(
      <QueryClientProvider client={client}>
        <App router={router} />
      </QueryClientProvider>,
    );
    const tile = await screen.findByRole('button', { name: /^Goblin Cellar/ });
    act(() => {
      tile.focus();
      tile.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(screen.getByRole('button', { name: 'Close game' })).toHaveFocus();
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await waitFor(() => expect(router.state.location.search).not.toContain('spotlight'));
    expect(router.state.location.search).toContain('test');
    expect(router.state.location.state).toEqual({ spotlightDismissed: true });
  });

  it('writes selection to the URL and returns focus to the tile after closing with Escape', async () => {
    renderGames('/all?test');
    const tile = await screen.findByRole('button', { name: /^Goblin Cellar/ });

    fireEvent.click(tile);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('spotlight=g_2'));
    expect(await screen.findByRole('button', { name: 'Play Goblin Cellar' })).toBeEnabled();

    const close = screen.getByRole('button', { name: 'Close game' });
    await waitFor(() => expect(close).toHaveFocus());
    fireEvent.keyDown(close, { key: 'Escape' });
    await waitFor(() => expect(screen.getByTestId('location')).not.toHaveTextContent('spotlight'));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Goblin Cellar/ })).toHaveFocus());
  });

  it('focuses the close control when reopening during the exit animation', async () => {
    renderGames('/all?test');
    const tile = await screen.findByRole('button', { name: /^Goblin Cellar/ });
    fireEvent.click(tile);
    const close = await screen.findByRole('button', { name: 'Close game' });
    fireEvent.keyDown(close, { key: 'Escape' });
    expect(close.closest('.game-cell-exiting')).not.toBeNull();
    fireEvent.click(tile);
    expect(screen.getByRole('button', { name: 'Close game' })).toBe(close);
    expect(close).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(screen.getByTestId('location')).not.toHaveTextContent('spotlight'));
  });

  it('does not auto-select again when a user chooses and closes a game before measurement settles', async () => {
    let template = 'none';
    vi.stubGlobal('ResizeObserver', undefined);
    const original = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudoElement) => {
      const styles = original(element, pseudoElement);
      if (!element.classList.contains('games-grid')) return styles;
      return new Proxy(styles, {
        get(target, property, receiver) {
          if (property === 'gridTemplateColumns') return template;
          return Reflect.get(target, property, receiver);
        },
      });
    });
    renderGames('/all?test');
    const tile = await screen.findByRole('button', { name: /^Goblin Cellar/ });

    fireEvent.click(tile);
    const close = await screen.findByRole('button', { name: 'Close game' });
    fireEvent.keyDown(close, { key: 'Escape' });
    await waitFor(() => expect(screen.getByTestId('location')).not.toHaveTextContent('spotlight'));

    template = '320px 320px 320px';
    fireEvent(window, new Event('resize'));

    expect(screen.getByTestId('location')).not.toHaveTextContent('spotlight');
    expect(screen.queryByRole('region', { name: /spotlight/ })).toBeNull();
  });

  it('shows the saved library immediately while refreshing it', async () => {
    session.userId = 'user-1';
    localStorage.setItem('ogm.games.v1.user-1', JSON.stringify(games));
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/api/v1/games')) return new Promise<Response>(() => {});
      return json({ jobs });
    });
    setGridColumns(20);
    renderGames();
    expect(screen.getAllByRole('button', { name: /Midnight Crumbs/ }).length).toBeGreaterThan(0);
    expect(await screen.findByText('Building 40%')).toBeVisible();
    expect(screen.queryByRole('progressbar', { name: 'Loading' })).toBeNull();
    expect(screen.getByTestId('location')).not.toHaveTextContent('spotlight');
  });

  it('shows a wordless loading bar while the first library request is pending', () => {
    vi.mocked(fetch).mockImplementation(async () => new Promise<Response>(() => {}));
    renderGames();
    expect(screen.getByRole('progressbar', { name: 'Loading' })).toBeInTheDocument();
    expect(screen.queryByText('Loading your games…')).toBeNull();
  });

  it('keeps cached tiles visible and offers retry when a refresh fails', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/v1/games')) return json({ error: 'unavailable' }, 503);
      if (url.includes('/api/v1/jobs')) return json({ jobs: [] });
      return json({ error: 'not_found' }, 404);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['games', undefined], games);

    const { container } = renderGames('/all', client);

    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t refresh the library');
    expect(container.querySelectorAll('[data-game-id]')).toHaveLength(15);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  it('loads the library without an error banner when only the jobs poll fails', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/v1/games')) return json({ games });
      if (url.includes('/api/v1/jobs')) return json({ error: 'unavailable' }, 503);
      return json({ error: 'not_found' }, 404);
    });

    const { container } = renderGames();

    await screen.findByRole('button', { name: /^Midnight Crumbs/ });
    expect(container.querySelectorAll('[data-game-id]')).toHaveLength(15);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // The game-level Commands inbox (M3) sits in the spotlight for the selected game, not on every tile.
  it('lists the selected game’s open Commands in its spotlight and answers them', async () => {
    commandsResponse = [commandFixture({ job_id: 'j_1', title: 'Moon gate' })];
    setGridColumns(3);
    renderGames('/games?test&spotlight=g_1');

    const option = await screen.findByRole('button', { name: 'Stone arch' }, { timeout: 3000 });
    expect(screen.getByText('Which gate should the courtyard use?')).toBeVisible();
    expect(screen.getByRole('region', { name: /Midnight Crumbs spotlight/ })).toContainElement(option);

    fireEvent.click(option);

    await waitFor(() =>
      expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).endsWith('/commands/m_3/answer'))).toBe(true),
    );
  });
});
