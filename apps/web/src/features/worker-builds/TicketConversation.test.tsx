import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TicketConversation } from './TicketConversation';

vi.mock('./CommandReviewCard', () => ({ CommandReviewCard: () => <input aria-label="Review note" /> }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('retries an unconfirmed message with its original ID after reopening', async () => {
  const fetcher = vi.fn(
    async (_url: RequestInfo | URL, init?: RequestInit) =>
      new Response(
        JSON.stringify(
          init?.method === 'POST'
            ? { status: 'sent' }
            : { messages: [{ text: 'Hello', pending: true, id: 'message-1' }] },
        ),
        { headers: { 'content-type': 'application/json' } },
      ),
  );
  vi.stubGlobal('fetch', fetcher);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TicketConversation ticket={{ gameId: 'game', ticket: '12', title: 'Build' }} onClose={() => {}} />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Retry' }, { timeout: 30000 }));
  await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true), {
    timeout: 30000,
  });
  const post = fetcher.mock.calls.find(([, init]) => init?.method === 'POST');
  expect(JSON.parse(String(post?.[1]?.body))).toEqual({ text: 'Hello', id: 'message-1' });
});

it('keeps a new draft when retrying an earlier unconfirmed message', async () => {
  let failed = false;
  const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST' && !failed) {
      failed = true;
      return new Response('', { status: 502 });
    }
    return new Response(
      JSON.stringify(
        init?.method === 'POST'
          ? { status: 'sent' }
          : { messages: failed ? [{ text: 'First', pending: true, id: 'retry-id' }] : [] },
      ),
      { headers: { 'content-type': 'application/json' } },
    );
  });
  vi.stubGlobal('fetch', fetcher);
  vi.spyOn(crypto, 'randomUUID').mockReturnValue('retry-id' as ReturnType<typeof crypto.randomUUID>);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TicketConversation ticket={{ gameId: 'game', ticket: '12', title: 'Build' }} onClose={() => {}} />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByLabelText('Message the builder'), { target: { value: 'First' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  const retry = await screen.findByRole('button', { name: 'Retry' }, { timeout: 30000 });
  fireEvent.change(screen.getByLabelText('Message the builder'), { target: { value: 'New draft' } });
  fireEvent.click(retry);
  await waitFor(() => expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2), {
    timeout: 30000,
  });
  await waitFor(() => expect(screen.getByLabelText('Message the builder')).toBeEnabled(), { timeout: 30000 });
  expect(screen.getByLabelText('Message the builder')).toHaveValue('New draft');
});

it('sends to the ticket and displays the worker reply', async () => {
  let sent = false;
  const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') sent = true;
    return new Response(
      JSON.stringify(
        init?.method === 'POST' ? { status: 'sent' } : { messages: sent ? [{ text: 'Worker reply' }] : [] },
      ),
      { headers: { 'content-type': 'application/json' } },
    );
  });
  vi.stubGlobal('fetch', fetcher);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TicketConversation ticket={{ gameId: 'game', ticket: '12', title: 'Build' }} onClose={() => {}} />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByLabelText('Message the builder'), { target: { value: 'Hello worker' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(screen.getByText('Worker reply')).toBeVisible(), { timeout: 30000 });
  const post = fetcher.mock.calls.find(([, init]) => init?.method === 'POST');
  expect(post?.[0]).toBe('/api/v1/games/game/tickets/12/conversation');
  expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({ text: 'Hello worker', id: expect.any(String) });
});

it('switches between chat and this ticket’s reviews', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL) => {
      const path = String(url);
      const body = path.includes('/conversation')
        ? { messages: [{ text: 'Chat message' }] }
        : path.includes('/reviews')
          ? {
              reviews: [
                {
                  id: 'r1',
                  ticket: '12',
                  title: 'Past review',
                  notes: 'Done',
                  likes: [],
                  dislikes: [],
                  at: '2026-01-01T00:00:00Z',
                },
              ],
            }
          : path.includes('/commands')
            ? { commands: [] }
            : path.includes('/previews')
              ? { previews: [] }
              : { rounds: [] };
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    }),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TicketConversation
        ticket={{ gameId: 'game', ticket: '12', title: 'Build' }}
        creatorId="owner"
        onClose={() => {}}
      />
    </QueryClientProvider>,
  );
  expect(await screen.findByText('Chat message', {}, { timeout: 30000 })).toBeVisible();
  fireEvent.click(screen.getByRole('tab', { name: 'Reviews' }));
  expect(await screen.findByText('Past review', {}, { timeout: 30000 })).toBeVisible();
  expect(screen.queryByText('Chat message')).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: 'Chat' }));
  expect(screen.getByText('Chat message')).toBeVisible();
});

it('keeps an unfinished review when switching tabs', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL) => {
      const path = String(url);
      const body = path.includes('/conversation')
        ? { messages: [] }
        : path.includes('/commands')
          ? { commands: [{ ticket: '12', decision_id: 'd', opened_at: '2026-01-01T00:00:00Z' }] }
          : path.includes('/reviews')
            ? { reviews: [] }
            : path.includes('/previews')
              ? { previews: [] }
              : { rounds: [] };
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    }),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TicketConversation
        ticket={{ gameId: 'game', ticket: '12', title: 'Build' }}
        creatorId="owner"
        onClose={() => {}}
      />
    </QueryClientProvider>,
  );
  const note = await screen.findByLabelText('Review note', {}, { timeout: 30000 });
  fireEvent.change(note, { target: { value: 'Keep this' } });
  fireEvent.click(screen.getByRole('tab', { name: 'Reviews' }));
  expect(screen.getByLabelText('Review note')).toHaveValue('Keep this');
});
