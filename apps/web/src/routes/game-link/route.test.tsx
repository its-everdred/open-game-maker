import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GameCommand } from '@ogm/contracts';

import { collectScreenRoutes } from '../../app/router';
import { api, ApiError } from '../../lib/api/client';
import { resetReviewDrafts } from '../../features/commands-inbox/drafts';
import { route as reviewRoute } from '../review/route';
import { route as gameLinkRoute } from './route';

vi.mock('../../lib/api/client', async (original) => {
  const actual = await original<typeof import('../../lib/api/client')>();
  return { ...actual, api: vi.fn() };
});
vi.mock('../../features/commands-inbox/ReviewDeck', async () => {
  const { markSent } = await import('../../features/commands-inbox/drafts');
  return {
    ReviewDeck: ({ command, onAnswered }: { command: GameCommand; onAnswered?(): void }) => (
      <>
        <p>Deck for {command.decision_id}</p>
        <button
          type="button"
          onClick={() => {
            markSent(command);
            onAnswered?.();
          }}
        >
          Answer
        </button>
      </>
    ),
  };
});

const mockedApi = vi.mocked(api);

const game = {
  id: 'g_blobs',
  familyId: 'f_house',
  ownerId: 'u_owner',
  title: 'Blobs',
  slug: 'blobs',
  visibility: 'listed' as const,
  repo: null,
  createdAt: '2026-11-01T00:00:00.000Z',
};

function command(decisionId: string, reviewNumber: number): GameCommand {
  return {
    job_id: null,
    ticket: '570',
    title: `Pick ${decisionId}`,
    checkpoint_id: `cp_${decisionId}`,
    decision_id: decisionId,
    version: 1,
    question: 'Which voice?',
    options: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ],
    blocking: true,
    opened_at: '2026-11-07T17:40:00.000Z',
    review_number: reviewNumber,
  };
}

// Resolving answers to the game's current slug, an old slug and its id; anything else is not a game.
function serve(commands: GameCommand[]) {
  mockedApi.mockImplementation(async (path: string) => {
    const resolved = /^\/games\/resolve\/(.+)$/.exec(path);
    if (resolved) {
      if (['blobs', 'old-blobs', game.id].includes(decodeURIComponent(resolved[1]!))) return { game };
      throw new ApiError(404, { error: 'game_not_found' });
    }
    if (path === `/games/${game.id}/commands`) return { commands };
    if (path === `/games/${game.id}/review-drafts`) return { drafts: [] };
    throw new Error(`unexpected ${path}`);
  });
}

function Location() {
  const location = useLocation();
  return <output>{`${location.pathname}${location.search}`}</output>;
}

// The real route modules (paths and children) without the session guard and chrome, beside stand-ins for the screens
// a link lands on.
function renderAt(entry: string) {
  const routes = collectScreenRoutes({
    '../routes/game-link/route.tsx': { route: { ...gameLinkRoute, chrome: 'bare', auth: 'none' } },
    '../routes/review/route.tsx': { route: { ...reviewRoute, chrome: 'bare', auth: 'none' } },
  });
  const router = createMemoryRouter(
    [...routes, { path: '/all', element: <Location /> }, { path: '/g/:gameId', element: <Location /> }],
    { initialEntries: [entry] },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return Object.assign(router, { client });
}

beforeEach(() => {
  mockedApi.mockReset();
});

afterEach(() => {
  cleanup();
  resetReviewDrafts();
});

describe('short game links', () => {
  it('opens the review the number names', async () => {
    serve([command('d_two', 2), command('d_one', 1)]);

    renderAt('/blobs/review/1');

    expect(await screen.findByText('Deck for d_one')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Pick d_one' })).toBeVisible();
  });

  it('heals a link made before the game was renamed', async () => {
    serve([command('d_one', 1)]);

    const router = renderAt('/old-blobs/review/1');

    expect(await screen.findByText('Deck for d_one')).toBeVisible();
    expect(router.state.location.pathname).toBe('/blobs/review/1');
  });

  it('lists the game’s open reviews as rows at /<slug>/review, healing an old slug', async () => {
    serve([command('d_two', 2), command('d_one', 1)]);

    const router = renderAt('/old-blobs/review');

    const first = await screen.findByRole('link', { name: 'Pick d_one, open' });
    expect(router.state.location.pathname).toBe('/blobs/review');
    expect(first).toHaveAttribute('href', '/blobs/review/1');
    expect(screen.getByRole('link', { name: 'Pick d_two, open' })).toHaveAttribute('href', '/blobs/review/2');
  });

  // The arrows walk the game's numbered reviews. Once an answer lands, aiur closes that review and the next refetch
  // drops it from the list; the sent screen must still lead on to its neighbours, not strand the creator.
  it('keeps the arrows on the sent screen after the answered review leaves the list', async () => {
    serve([command('d_one', 1), command('d_two', 2), command('d_three', 3)]);
    const router = renderAt('/blobs/review/2');

    expect(await screen.findByText('Deck for d_two')).toBeVisible();
    // The deck's only controls are its votes (#631); the arrows wait on the sent screen.
    expect(screen.queryByRole('link', { name: 'Previous question' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
    serve([command('d_one', 1), command('d_three', 3)]);
    await act(() => router.client.invalidateQueries());

    expect(await screen.findByRole('heading', { name: 'Review sent' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Previous question' })).toHaveAttribute('href', '/blobs/review/1');
    expect(screen.getByRole('link', { name: 'Next question' })).toHaveAttribute('href', '/blobs/review/3');
  });

  // Coming back to a review already sent (the list still has it until aiur closes it) shows it as sent, never a deck
  // that would answer it a second time.
  it('shows a sent review as sent when the creator comes back to it', async () => {
    serve([command('d_one', 1), command('d_two', 2)]);
    const router = renderAt('/blobs/review/1');

    fireEvent.click(await screen.findByRole('button', { name: 'Answer' }));
    fireEvent.click(await screen.findByRole('link', { name: 'Next question' }));
    expect(await screen.findByText('Deck for d_two')).toBeVisible();
    await act(() => router.navigate('/blobs/review/1'));

    expect(await screen.findByRole('heading', { name: 'Review sent' })).toBeVisible();
    expect(screen.queryByText('Deck for d_one')).not.toBeInTheDocument();
  });

  it('says the review is not open when no Command has that number', async () => {
    serve([command('d_one', 1)]);

    renderAt('/blobs/review/7');

    expect(await screen.findByText('That review is not open. It may already be answered.')).toBeVisible();
  });

  it('says the link points at nothing for a slug no game has', async () => {
    serve([]);

    renderAt('/nobody/review/1');

    expect(await screen.findByText(/This link doesn’t point at a game\./)).toBeVisible();
  });

  it('opens the game’s page from /<slug>', async () => {
    serve([]);

    renderAt('/blobs');

    expect(await screen.findByText('/all?spotlight=g_blobs')).toBeVisible();
  });

  it('plays the game from /<slug>/play, keeping the link’s query', async () => {
    serve([]);

    renderAt('/blobs/play?chat=j_1');

    expect(await screen.findByText('/g/g_blobs?chat=j_1&mode=play')).toBeVisible();
  });
});

describe('the old review link', () => {
  it('moves /game/<id>/review/<checkpoint> to the short form', async () => {
    serve([command('d_two', 2)]);

    const router = renderAt(`/game/${game.id}/review/cp_d_two`);

    expect(await screen.findByText('Deck for d_two')).toBeVisible();
    expect(router.state.location.pathname).toBe('/blobs/review/2');
  });

  it('moves a link built from the decision id too', async () => {
    serve([command('d_two', 2)]);

    const router = renderAt(`/game/${game.id}/review/d_two`);

    expect(await screen.findByText('Deck for d_two')).toBeVisible();
    expect(router.state.location.pathname).toBe('/blobs/review/2');
  });

  it('stays put and says so when the Command is no longer open', async () => {
    serve([]);

    const router = renderAt(`/game/${game.id}/review/cp_gone`);

    expect(await screen.findByText('That review is not open. It may already be answered.')).toBeVisible();
    expect(router.state.location.pathname).toBe(`/game/${game.id}/review/cp_gone`);
  });
});
