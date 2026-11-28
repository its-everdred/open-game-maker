import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { collectScreenRoutes } from '../../app/router';
import { api, ApiError } from '../../lib/api/client';
import { route as playRoute } from './route';

const session = vi.hoisted(() => ({
  current: { data: { user: { id: 'u_player' } } as { user: { id: string } } | null, isPending: false },
}));

vi.mock('../../lib/api/session', () => ({ useSession: () => session.current }));
vi.mock('../../lib/api/client', async (original) => {
  const actual = await original<typeof import('../../lib/api/client')>();
  return { ...actual, api: vi.fn() };
});

function Location() {
  const location = useLocation();
  return <output>{`${location.pathname}${location.search}`}</output>;
}

// The real route module keeps the path and its open guard, so a Coming Soon game can answer a signed-out visitor; the
// screen sends a visitor to sign in only when the API asks for it. `element` swaps the body for the signed-in case.
function router(entry: string, element = playRoute.element) {
  const routes = collectScreenRoutes({
    '../routes/play/route.tsx': { route: { ...playRoute, element, chrome: 'bare' } },
  });
  return createMemoryRouter([...routes, { path: '/signin', element: <Location /> }], { initialEntries: [entry] });
}

function renderWithClient(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

describe('signed-out deep link', () => {
  afterEach(() => {
    cleanup();
    session.current = { data: { user: { id: 'u_player' } }, isPending: false };
  });

  it('sends a signed-out visitor through sign-in and back to the shared game', async () => {
    session.current = { data: null, isPending: false };
    vi.mocked(api).mockRejectedValue(new ApiError(401, { error: 'unauthenticated' }));

    renderWithClient(<RouterProvider router={router('/play/castle-game?chat=job-1')} />);

    await waitFor(() => expect(screen.getByText('/signin?next=%2Fplay%2Fcastle-game%3Fchat%3Djob-1')).toBeVisible());
  });

  it('opens the shared game for a signed-in visitor', async () => {
    renderWithClient(<RouterProvider router={router('/play/castle-game', <p>Play screen</p>)} />);

    expect(await screen.findByText('Play screen')).toBeVisible();
  });
});
