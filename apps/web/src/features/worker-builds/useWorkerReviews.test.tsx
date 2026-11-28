import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useWorkerReviews } from './useWorkerReviews';
const api = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api/client', () => ({ api }));

describe('worker reviews', () => {
  it('loads open ledger rounds and playable previews for the creator', async () => {
    api.mockImplementation((path: string) =>
      Promise.resolve(
        path.includes('/review-rounds?')
          ? {
              rounds: [
                { id: 'r', ticket: '12', question: null, media: [] },
                { id: 'g', ticket: '13', question: null, media: [], category: 'gameplay', buildId: 'b' },
              ],
            }
          : {
              previews: [
                { ticket: '13', buildId: 'b' },
                { ticket: '99', buildId: 'unbacked' },
              ],
            },
      ),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, unmount } = renderHook(() => useWorkerReviews([{ id: 'game' }], 'owner'), { wrapper });
    await waitFor(() =>
      expect(result.current.reviews).toEqual([
        { kind: 'round', gameId: 'game', round: { id: 'r', ticket: '12', question: null, media: [] } },
        {
          kind: 'preview',
          gameId: 'game',
          preview: { ticket: '13', buildId: 'b' },
          round: { id: 'g', ticket: '13', question: null, media: [], category: 'gameplay', buildId: 'b' },
        },
        { kind: 'standalone-preview', gameId: 'game', preview: { ticket: '99', buildId: 'unbacked' } },
      ]),
    );
    unmount();
    client.clear();
  });
  it('does not expose a build-backed round before its preview query settles', async () => {
    let resolvePreview!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      resolvePreview = resolve;
    });
    api.mockImplementation((path: string) =>
      path.includes('/review-rounds?')
        ? Promise.resolve({
            rounds: [{ id: 'r', ticket: '12', category: 'art', buildId: 'b', question: null, media: [] }],
          })
        : pending,
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, unmount } = renderHook(() => useWorkerReviews([{ id: 'game' }], 'owner'), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(result.current.reviews).toEqual([]);
    await act(async () => resolvePreview({ previews: [{ ticket: '12', buildId: 'b' }] }));
    await waitFor(() => expect(result.current.reviews[0]?.kind).toBe('preview'));
    unmount();
    client.clear();
  });
  it('shows a live round without waiting for the preview query', async () => {
    api.mockImplementation((path: string) =>
      path.includes('/review-rounds?')
        ? Promise.resolve({
            rounds: [{ id: 'r', ticket: '12', category: 'gameplay', buildId: 'live-r', question: null, media: [] }],
          })
        : new Promise(() => {}),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, unmount } = renderHook(() => useWorkerReviews([{ id: 'game' }], 'owner'), { wrapper });
    await waitFor(() =>
      expect(result.current.reviews[0]).toMatchObject({ kind: 'round', round: { buildId: 'live-r' } }),
    );
    unmount();
    client.clear();
  });
});
