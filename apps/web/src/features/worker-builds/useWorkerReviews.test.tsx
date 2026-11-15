import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useWorkerReviews } from './useWorkerReviews';
const api = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api/client', () => ({ api }));

describe('worker reviews', () => {
  it('loads open ledger rounds and playable previews for the creator', async () => {
    api.mockImplementation((path: string) =>
      Promise.resolve(
        path.endsWith('/review-rounds')
          ? { rounds: [{ id: 'r', ticket: '12', question: null, media: [] }] }
          : { previews: [{ ticket: '13', buildId: 'b' }] },
      ),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, unmount } = renderHook(() => useWorkerReviews([{ id: 'game' }], 'owner'), { wrapper });
    await waitFor(() =>
      expect(result.current).toEqual([
        { kind: 'round', gameId: 'game', round: { id: 'r', ticket: '12', question: null, media: [] } },
        { kind: 'preview', gameId: 'game', preview: { ticket: '13', buildId: 'b' } },
      ]),
    );
    unmount();
    client.clear();
  });
});
