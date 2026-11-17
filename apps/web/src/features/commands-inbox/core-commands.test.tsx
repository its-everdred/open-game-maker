import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useCoreReviewCommands } from './commands';

const api = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api/client', async (actual) => ({
  ...(await actual<typeof import('../../lib/api/client')>()),
  api,
}));
const { ApiError } = await import('../../lib/api/client');

function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useCoreReviewCommands('creator'), { wrapper });
}

describe('core review Commands', () => {
  // A creator who is not the instance owner has no core Commands; the deck must not say it could not load reviews.
  it('reads a refusal for a creator who is not the instance owner as no core Commands', async () => {
    api.mockRejectedValue(new ApiError(403, { error: 'forbidden' }));
    const { result } = render();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ commands: [], targets: [], error: false });
  });

  it('still reports an unreachable core instance', async () => {
    api.mockRejectedValue(new ApiError(502, { error: 'core_daemon_unavailable' }));
    const { result } = render();
    await waitFor(() => expect(result.current.error).toBe(true));
  });
});
