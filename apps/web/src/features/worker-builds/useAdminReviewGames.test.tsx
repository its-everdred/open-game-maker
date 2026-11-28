import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { useAdminReviewGames } from './useAdminReviewGames';

const api = vi.hoisted(() => vi.fn());
const identity = vi.hoisted(() => ({ sessionId: 'session-1' }));
vi.mock('../../lib/api/session', () => ({
  useSession: () => ({ data: { user: { id: 'user' }, session: { id: identity.sessionId } } }),
}));
vi.mock('../../lib/api/client', () => ({
  api,
  ApiError: class extends Error {
    status = 403;
  },
}));

it('drops cached foreign games immediately when the same user loses administrator eligibility', async () => {
  api.mockResolvedValue({ games: [{ id: 'foreign', ownerId: 'other', title: 'Game', slug: null }] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result, rerender, unmount } = renderHook(({ admin }) => useAdminReviewGames('user', admin), {
    initialProps: { admin: true },
    wrapper,
  });
  await waitFor(() => expect(result.current.data?.games).toHaveLength(1));
  rerender({ admin: false });
  expect(result.current.data).toBeNull();
  unmount();
  client.clear();
});

it('withholds cached foreign games while a new session is rechecked', async () => {
  let resolve!: (value: unknown) => void;
  api.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['admin-review-games', 'user', 'session-1'], {
    games: [{ id: 'foreign', ownerId: 'other', title: 'Game', slug: null }],
  });
  identity.sessionId = 'session-2';
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result, unmount } = renderHook(() => useAdminReviewGames('user', true), { wrapper });
  expect(result.current.data).toBeNull();
  await act(async () => resolve(null));
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data).toBeNull();
  identity.sessionId = 'session-1';
  unmount();
  client.clear();
});
