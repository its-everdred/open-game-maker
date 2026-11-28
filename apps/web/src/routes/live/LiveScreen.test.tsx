import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';

import type { MountGameFrameOptions } from '../../features/editor/frame';
import { LiveScreen } from './LiveScreen';

const mounts: MountGameFrameOptions[] = [];
vi.mock('../../features/editor/frame', () => ({
  mountGameFrame: (options: MountGameFrameOptions) => {
    mounts.push(options);
    return { dispose: () => undefined };
  },
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  mounts.length = 0;
});

it('opens the authorized workspace generation at the linked scenario', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (input: RequestInfo | URL) =>
        new Response(
          JSON.stringify(
            String(input).includes('/resolve/')
              ? { game: { id: 'g1', slug: 'demo' } }
              : {
                  gameId: 'g1',
                  accessId: 'lv-token',
                  version: 'generation',
                  design: { rev: 0, doc: { entities: [] } },
                },
          ),
          { headers: { 'content-type': 'application/json' } },
        ),
    ),
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/live/demo/12?scenario=yard']}>
        <Routes>
          <Route path="/live/:slug/:ticket" element={<LiveScreen />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(mounts).toHaveLength(1));
  expect(mounts[0]).toMatchObject({
    gameId: 'g1',
    buildId: 'lv-token',
    live: true,
    liveVersion: 'generation',
    params: { scenario: 'yard' },
  });
});

it('waits for a fresh generation instead of mounting a cached one', async () => {
  let resolveAccess!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    resolveAccess = resolve;
  });
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) =>
      String(input).includes('/resolve/')
        ? Promise.resolve(
            new Response(JSON.stringify({ game: { id: 'g1', slug: 'demo' } }), {
              headers: { 'content-type': 'application/json' },
            }),
          )
        : pending,
    ),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['live-access', 'g1', '12'], {
    gameId: 'g1',
    accessId: 'old',
    version: 'old',
    design: { rev: 0, doc: { entities: [] } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/live/demo/12?scenario=yard']}>
        <Routes>
          <Route path="/live/:slug/:ticket" element={<LiveScreen />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(mounts).toHaveLength(0);
  await act(async () =>
    resolveAccess(
      new Response(
        JSON.stringify({ gameId: 'g1', accessId: 'new', version: 'new', design: { rev: 0, doc: { entities: [] } } }),
        { headers: { 'content-type': 'application/json' } },
      ),
    ),
  );
  await waitFor(() => expect(mounts[0]).toMatchObject({ buildId: 'new', liveVersion: 'new' }));
});
