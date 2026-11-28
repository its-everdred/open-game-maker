import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { useAdminMe } from './api';

vi.mock('../../lib/api/session', () => ({
  useSession: () => ({ data: { user: { id: 'u' }, session: { id: 'new-session' } } }),
}));

it('does not attest a returning account from a previous session cache', async () => {
  let resolve!: (response: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    ),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['admin', 'me', 'u', 'old-session'], {
    user: { id: 'u', email: 'u@example.test' },
    capability: 'creator',
    platformRole: 'admin',
    family: null,
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result, unmount } = renderHook(() => useAdminMe(), { wrapper });
  expect(result.current.attested).toBe(false);
  await act(async () =>
    resolve(
      Response.json({
        user: { id: 'u', email: 'u@example.test' },
        capability: 'player',
        platformRole: 'none',
        family: null,
      }),
    ),
  );
  await waitFor(() => expect(result.current.attested).toBe(true));
  expect(result.current.data?.capability).toBe('player');
  unmount();
  client.clear();
  vi.unstubAllGlobals();
});
