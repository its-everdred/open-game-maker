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

it('keeps updates disabled when the dialog is reopened during a save', async () => {
  let finish!: (value: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init?: RequestInit) =>
      init?.method === 'PUT'
        ? new Promise<Response>((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(
            new Response(
              JSON.stringify({
                users: [
                  { email: 'editor@example.test', name: 'Editor', userId: 'editor', role: 'maker', access: 'play' },
                ],
              }),
              { headers: { 'content-type': 'application/json' } },
            ),
          ),
    ),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <GameAccess gameId="game" ownerId="owner" onClose={vi.fn()} />
    </QueryClientProvider>,
  );
  fireEvent.click(
    within(await screen.findByRole('group', { name: 'Editor access' })).getByRole('button', { name: 'Edit' }),
  );
  await waitFor(() => expect(finish).toBeDefined());
  view.rerender(
    <QueryClientProvider client={client}>
      <div />
    </QueryClientProvider>,
  );
  view.rerender(
    <QueryClientProvider client={client}>
      <GameAccess gameId="game" ownerId="owner" onClose={vi.fn()} />
    </QueryClientProvider>,
  );
  expect(
    within(await screen.findByRole('group', { name: 'Editor access' })).getByRole('button', { name: 'Play' }),
  ).toBeDisabled();
  finish(new Response('{}', { headers: { 'content-type': 'application/json' } }));
  await waitFor(() =>
    expect(
      within(screen.getByRole('group', { name: 'Editor access' })).getByRole('button', { name: 'Play' }),
    ).toBeEnabled(),
  );
});
