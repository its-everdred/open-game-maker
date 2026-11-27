import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api/client';
import { useGames } from './useGames';

vi.mock('../../lib/api/session', () => ({ useSession: () => ({ data: { user: { id: 'u1' } } }) }));

describe('game visibility after demotion', () => {
  it('does not retain cached private games after a request observes the player role', async () => {
    localStorage.clear();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let role = 'creator';
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (path: string) =>
          new Response(
            JSON.stringify(
              path.endsWith('/me')
                ? { user: { id: 'u1', email: 'u@example.test' }, family: null, capability: role, platformRole: 'none' }
                : { games: role === 'creator' ? [{ id: 'private' }] : [] },
            ),
            {
              headers: {
                'content-type': 'application/json',
                'x-ogm-user-id': 'u1',
                'x-ogm-capability': role,
                'x-ogm-platform-role': 'none',
              },
            },
          ),
      ),
    );
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
    const { result, unmount } = renderHook(() => useGames(), { wrapper });
    await waitFor(() => expect(result.current.data?.map((game) => game.id)).toEqual(['private']));
    role = 'player';
    await act(async () => {
      await api('/games');
    });
    await waitFor(() => expect(result.current.data?.map((game) => game.id)).toEqual([]));
    unmount();
    vi.unstubAllGlobals();
  });
});
