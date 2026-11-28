import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api, ApiError } from '../../lib/api/client';
import { PlayScreen } from './PlayScreen';

vi.mock('../../lib/api/client', async (original) => {
  const actual = await original<typeof import('../../lib/api/client')>();
  return { ...actual, api: vi.fn() };
});

const mockedApi = vi.mocked(api);

const game = {
  id: 'g_castle',
  familyId: 'f_house',
  ownerId: 'u_owner',
  title: 'Castle Game',
  slug: 'castle-game',
  visibility: 'listed' as const,
  repo: null,
  createdAt: '2026-11-01T00:00:00.000Z',
};

function Location() {
  const location = useLocation();
  return <output>{`${location.pathname}${location.search}`}</output>;
}

function renderPlay(entry: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/play/:ref" element={<PlayScreen />} />
          <Route path="/g/:gameId" element={<Location />} />
          <Route path="/all" element={<h1>Your games</h1>} />
          <Route path="/signin" element={<Location />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockedApi.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('a shared /play link', () => {
  it('shows coming soon without sending the visitor to sign in', async () => {
    mockedApi.mockRejectedValue(new ApiError(403, { error: 'coming_soon' }));
    renderPlay('/play/dusk-helm');
    expect(await screen.findByText(/Coming Soon/)).toBeVisible();
  });
  it('preserves the requested path when a released game needs sign in', async () => {
    mockedApi.mockRejectedValue(new ApiError(401, { error: 'unauthenticated' }));
    renderPlay('/play/castle-game?chat=one');
    expect(await screen.findByText('/signin?next=%2Fplay%2Fcastle-game%3Fchat%3Done')).toBeVisible();
  });
  it('opens the game in play mode from its slug', async () => {
    mockedApi.mockResolvedValue({ game });

    renderPlay('/play/castle-game');

    expect(await screen.findByText('/g/g_castle?mode=play')).toBeVisible();
    expect(mockedApi).toHaveBeenCalledWith('/games/resolve/castle-game');
  });

  it('keeps the link query, so a chat notification still lands in its game', async () => {
    mockedApi.mockResolvedValue({ game });

    renderPlay('/play/castle-game?chat=job-1');

    expect(await screen.findByText('/g/g_castle?chat=job-1&mode=play')).toBeVisible();
  });

  it('resolves the id form too', async () => {
    mockedApi.mockResolvedValue({ game });

    renderPlay('/play/g_castle');

    expect(await screen.findByText('/g/g_castle?mode=play')).toBeVisible();
  });

  it('rewrites a slug the game has outgrown to the current one before opening it', async () => {
    mockedApi.mockResolvedValue({ game });

    renderPlay('/play/old-castle-name');

    expect(await screen.findByText('/g/g_castle?mode=play')).toBeVisible();
    expect(mockedApi.mock.calls).toEqual([['/games/resolve/old-castle-name'], ['/games/resolve/castle-game']]);
  });

  it('says the visitor has no access rather than showing an error', async () => {
    mockedApi.mockRejectedValue(new ApiError(403, { error: 'private_game' }));

    renderPlay('/play/castle-game');

    expect(await screen.findByRole('status')).toHaveTextContent('You don’t have access to this game.');
    expect(screen.getByRole('link', { name: 'Your games' })).toHaveAttribute('href', '/all');
  });

  it('says the link points at nothing when no game ever had that slug', async () => {
    mockedApi.mockRejectedValue(new ApiError(404, { error: 'game_not_found' }));

    renderPlay('/play/nothing-here');

    expect(await screen.findByRole('status')).toHaveTextContent('This link doesn’t point at a game.');
  });
});
