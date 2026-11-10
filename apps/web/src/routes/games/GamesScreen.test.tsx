import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation, type InitialEntry } from 'react-router';

import { commandFixture } from '../../features/commands-inbox/fixtures';
import { GamesScreen } from './GamesScreen';

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
  return (
    <>
      <output data-testid="location">{`${location.pathname}${location.search}`}</output>
      <output data-testid="location-state">{JSON.stringify(location.state ?? null)}</output>
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
        <GamesScreen />
        <LocationProbe />
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

describe('GamesScreen', () => {
  it('changes an existing game’s AI asset preference in both directions', async () => {
    renderGames('/all?spotlight=g_2');
    const toggle = await screen.findByRole('switch', { name: 'AI-generated assets' });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).not.toBeChecked());
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toBeChecked());
    const patches = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'PATCH');
    expect(patches.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
      { allowAiGeneratedAssets: false },
      { allowAiGeneratedAssets: true },
    ]);
  });
  it('keeps the existing empty state when there are no games', async () => {
    gamesResponse = [];
    renderGames();

    expect(await screen.findByText('No games yet. Start with a new idea.')).toBeVisible();
    expect(screen.queryByRole('region', { name: /spotlight/ })).toBeNull();
  });

  it.each([
    { label: 'one game', count: 1 },
    { label: 'exactly one thumbnail row', count: 3 },
  ])('opens the first game and keeps every thumbnail visible with $label', async ({ count }) => {
    gamesResponse = games.slice(0, count);
    setGridColumns(3);
    const { container } = renderGames('/all?test');

    // The selection and the spotlight mount either side of a paint; allow for a
    // slow first render under the fully parallel suite.
    expect(await screen.findByRole('heading', { name: 'Midnight Crumbs' }, AUTO_SELECT)).toBeVisible();
    expect(screen.getByTestId('location')).toHaveTextContent('spotlight=g_1');
    expect(container.querySelectorAll('.game-tile')).toHaveLength(count);
    expect(container.querySelectorAll('[data-game-id].is-selected')).toHaveLength(1);
  });

  it('keeps the zoomed-out grid when the games overflow one thumbnail row', async () => {
    gamesResponse = [...games, { ...games[2]!, id: 'g_4', title: 'Fourth Game', updatedAt: '2026-10-24T00:00:00Z' }];
    setGridColumns(3);
    const { container } = renderGames('/all?test');

    await screen.findByRole('button', { name: 'Fourth Game' });
    expect(screen.queryByRole('region', { name: /spotlight/ })).toBeNull();
    expect(screen.getByTestId('location')).not.toHaveTextContent('spotlight');
    expect(container.querySelectorAll('.game-tile')).toHaveLength(4);
  });

  it('keeps the grid dismissed after the closing navigation lands', async () => {
    renderGames('/games?test');
    fireEvent.click(await screen.findByRole('button', { name: 'Goblin Cellar' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('spotlight=g_2'));

    fireEvent.keyDown(await screen.findByRole('button', { name: 'Close game' }), { key: 'Escape' });

    await waitFor(() => expect(screen.getByTestId('location')).not.toHaveTextContent('spotlight'));
    expect(screen.getByTestId('location-state')).toHaveTextContent('{"spotlightDismissed":true}');
    expect(screen.queryByRole('region', { name: /spotlight/ })).toBeNull();
  });

  it('waits for active jobs before selecting the first sorted game', async () => {
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

    expect(await screen.findByRole('heading', { name: 'Goblin Cellar' }, AUTO_SELECT)).toBeVisible();
    expect(screen.getByTestId('location')).toHaveTextContent('spotlight=g_2');
    expect(container.querySelector<HTMLElement>('[data-game-id]')?.dataset.gameId).toBe('g_2');
  });

  it('renders real tiles, prioritizes the building game, and shows its friendly progress', async () => {
    const { container } = renderGames();

    await screen.findByRole('button', { name: /^Midnight Crumbs/ });
    const tiles = [...container.querySelectorAll<HTMLElement>('[data-game-id]')];
    expect(tiles.map((tile) => tile.dataset.gameId)).toEqual(['g_1', 'g_2', 'g_3']);
    expect(screen.getByText('Building 40%')).toBeVisible();
    expect(screen.getAllByText('New')).toHaveLength(2);
  }, 10_000);

  it('opens the URL-selected spotlight and falls back to main when branches are unavailable', async () => {
    const { container } = renderGames('/all?spotlight=g_1');

    expect(await screen.findByRole('heading', { name: 'Midnight Crumbs' }, AUTO_SELECT)).toBeVisible();
    expect(container.querySelector('.games-spotlight-media .game-cover')).toBeVisible();
    expect(screen.queryByText(/Your library|My games|Selected game|Choose what happens next|Versions/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Close game' })).toHaveTextContent('×');
    expect(await screen.findByRole('listitem', { name: 'main' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'Play Midnight Crumbs' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit Midnight Crumbs' })).toBeDisabled();
  });

  it('uses the prototype creation affordance without adding helper copy', async () => {
    const { container } = renderGames();

    await screen.findByRole('button', { name: 'New game' });
    const plus = container.querySelector('.games-new .plus');
    expect(plus).not.toHaveTextContent('+');
    expect(plus?.querySelector('svg')).toHaveAttribute('viewBox', '0 0 16 16');
    expect(plus?.querySelector('path')).toHaveAttribute('d', 'M8 2.5v11M2.5 8h11');
    expect(screen.queryByText(/Create a new game|Add another game|Start creating/)).toBeNull();
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
    expect(tile).toHaveFocus();
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

  it('keeps cached tiles visible and offers retry when a refresh fails', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/v1/games')) return json({ error: 'unavailable' }, 503);
      if (url.includes('/api/v1/jobs')) return json({ jobs: [] });
      return json({ error: 'not_found' }, 404);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['games'], games);

    const { container } = renderGames('/all', client);

    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t refresh the library');
    expect(container.querySelectorAll('[data-game-id]')).toHaveLength(3);
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
    expect(container.querySelectorAll('[data-game-id]')).toHaveLength(3);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // The game-level Commands inbox (M3) sits in the spotlight for the selected game, not on every tile.
  it('lists the selected game’s open Commands in its spotlight and answers them', async () => {
    commandsResponse = [commandFixture({ job_id: 'j_1', title: 'Moon gate' })];
    setGridColumns(3);
    renderGames('/games?test');

    const option = await screen.findByRole('button', { name: 'Stone arch' }, { timeout: 3000 });
    expect(screen.getByText('Which gate should the courtyard use?')).toBeVisible();
    expect(screen.getByRole('region', { name: /Midnight Crumbs spotlight/ })).toContainElement(option);

    fireEvent.click(option);

    await waitFor(() =>
      expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).endsWith('/commands/m_3/answer'))).toBe(true),
    );
  });
});
