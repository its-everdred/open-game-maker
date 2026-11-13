import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useWorkers } from './useWorkers';

const api = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api/client', () => ({ api }));

describe('game workers', () => {
  it('reads only the active game and keeps ticket identifiers game-scoped', async () => {
    api.mockResolvedValue({ workers: [{ ticket: '12', title: 'Forest backdrop', percent: 50, etaSeconds: 10 }] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, unmount } = renderHook(() => useWorkers([{ id: 'one' }, { id: 'two' }], 'two'), { wrapper });
    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(api).toHaveBeenCalledWith('/games/two/workers');
    expect(api).toHaveBeenCalledTimes(1);
    expect(result.current[0]?.ticket).toBe('two:12');
    unmount();
    client.clear();
  });
});
