import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { GameAccess } from './GameAccess';

afterEach(() => vi.unstubAllGlobals());

it('lets the owner change an editor’s access and disables Edit for players', async () => {
  const fetcher = vi.fn(
    async (_url: string, init?: RequestInit) =>
      new Response(
        JSON.stringify(
          init?.method === 'PUT'
            ? {}
            : {
                users: [
                  { email: 'owner@example.test', name: 'Owner', userId: 'owner', role: 'maker', access: 'play' },
                  { email: 'editor@example.test', name: 'Editor', userId: 'editor', role: 'maker', access: 'play' },
                  { email: 'player@example.test', name: 'Player', userId: 'player', role: 'player', access: 'hide' },
                ],
              },
        ),
        { headers: { 'content-type': 'application/json' } },
      ),
  );
  vi.stubGlobal('fetch', fetcher);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <GameAccess gameId="game" ownerId="owner" onClose={vi.fn()} />
    </QueryClientProvider>,
  );
  const editor = await screen.findByRole('group', { name: 'Editor access' });
  expect(
    within(screen.getByRole('group', { name: 'Player access' })).getByRole('button', { name: 'Edit' }),
  ).toBeDisabled();
  fireEvent.click(within(editor).getByRole('button', { name: 'Edit' }));
  await waitFor(() =>
    expect(fetcher).toHaveBeenCalledWith(
      '/api/v1/games/game/access/editor%40example.test',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ access: 'edit' }) }),
    ),
  );
});
