import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useWorkerReviews } from './useWorkerReviews';

const api = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api/client', () => ({ api }));

describe('worker reviews', () => {
  it('links a pending game preview to its review and retains its worker title', async () => {
    api.mockResolvedValue({ previews: [{ ticket: '12', buildId: 'build-1', title: 'Forest backdrop' }] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, unmount } = renderHook(() => useWorkerReviews([{ id: 'game', slug: 'forest' }], [], 'owner'), {
      wrapper,
    });
    await waitFor(() =>
      expect(result.current).toEqual([
        { ticket: 'game:12', title: 'Forest backdrop', href: '/forest/review#preview-build-1' },
      ]),
    );
    unmount();
    client.clear();
  });
});
