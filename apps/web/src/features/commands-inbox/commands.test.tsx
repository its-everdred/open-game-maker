import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { useCreatorReviewCommands, useGameCommands } from './commands';

const calls: Array<{ url: string; method: string }> = [];

function ReviewCommandsProbe() {
  useCreatorReviewCommands('creator-1');
  return null;
}

function GameCommandsProbe() {
  useGameCommands('g_1');
  return null;
}

afterEach(() => {
  cleanup();
  calls.length = 0;
  vi.unstubAllGlobals();
});

it('requests missing media for hidden incomplete Commands from the creator review feed', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ url, method });
      if (method === 'GET')
        return new Response(
          JSON.stringify({
            commands: [],
            missing_media_commands: [{ game_id: 'g_1', decision_id: 'd_missing' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={client}>
      <ReviewCommandsProbe />
    </QueryClientProvider>,
  );

  await waitFor(() =>
    expect(calls).toContainEqual({
      url: '/api/v1/games/g_1/commands/d_missing/missing-media',
      method: 'POST',
    }),
  );
});

it('requests missing media for hidden incomplete Commands from the game inbox', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ url, method });
      if (method === 'GET')
        return new Response(
          JSON.stringify({
            commands: [],
            missing_media_commands: [{ game_id: 'g_1', decision_id: 'd_missing' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={client}>
      <GameCommandsProbe />
    </QueryClientProvider>,
  );

  await waitFor(() =>
    expect(calls).toContainEqual({
      url: '/api/v1/games/g_1/commands/d_missing/missing-media',
      method: 'POST',
    }),
  );
});

it('retries a transient missing-media request once', async () => {
  let posts = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET')
        return new Response(
          JSON.stringify({ missing_media_commands: [{ game_id: 'g_1', decision_id: 'd_retry' }], commands: [] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      calls.push({ url: String(input), method });
      posts += 1;
      return new Response('{}', { status: posts === 1 ? 503 : 200 });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={client}>
      <GameCommandsProbe />
    </QueryClientProvider>,
  );

  await waitFor(() => expect(posts).toBe(2), { timeout: 4000 });
});
