import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ConversationReviews } from './ConversationReviews';

vi.mock('../commands-inbox/commands', () => ({ useGameCommands: () => ({ commands: [], refetch: vi.fn() }) }));
vi.mock('./useWorkerReviews', () => ({ useWorkerReviews: () => ({ reviews: [], loading: false, error: false }) }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('shows only this ticket’s reviews in chronological order', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url: RequestInfo | URL) =>
        new Response(
          JSON.stringify(
            String(url).includes('review-rounds')
              ? { rounds: [] }
              : {
                  reviews: [
                    {
                      id: 'new',
                      ticket: '12',
                      title: 'New review',
                      at: '2026-01-02T00:00:00Z',
                      notes: 'New',
                      likes: [],
                      dislikes: [],
                    },
                    {
                      id: 'other',
                      ticket: '13',
                      title: 'Other ticket',
                      at: '2026-01-03T00:00:00Z',
                      notes: 'Other',
                      likes: [],
                      dislikes: [],
                    },
                    {
                      id: 'old',
                      ticket: '12',
                      title: 'Old review',
                      at: '2026-01-01T00:00:00Z',
                      notes: 'Old',
                      likes: [],
                      dislikes: [],
                    },
                  ],
                },
          ),
          { headers: { 'content-type': 'application/json' } },
        ),
    ),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ConversationReviews gameId="game" ticket="12" creatorId="owner" />
    </QueryClientProvider>,
  );
  const list = await screen.findByLabelText('Reviews', {}, { timeout: 30000 });
  await screen.findByText('New review', {}, { timeout: 30000 });
  expect(within(list).queryByText('Other ticket')).toBeNull();
  expect([...list.querySelectorAll('strong')].map((element) => element.textContent)).toEqual([
    'Old review',
    'New review',
  ]);
});
