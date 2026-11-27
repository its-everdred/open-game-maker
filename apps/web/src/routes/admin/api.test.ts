import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
vi.mock('../../lib/api/session', () => ({ useSession: () => ({ data: { user: { id: 'u1' } } }) }));

import { queryClient } from '../../app/query';
import { api } from '../../lib/api/client';
import { adminRequest, fetchAdminBuilds, useAdminMe } from './api';

describe('admin requests', () => {
  it('updates the mounted account capability when a later request reports demotion', async () => {
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
                : { games: [] },
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
    const { result } = renderHook(() => useAdminMe(), { wrapper });
    await waitFor(() => expect(result.current.data?.capability).toBe('creator'));
    role = 'player';
    await act(async () => {
      await api('/games');
    });
    await waitFor(() => expect(result.current.data?.capability).toBe('player'));
    act(() =>
      window.dispatchEvent(
        new CustomEvent('ogm:access-state', {
          detail: { userId: 'u1', capability: 'creator', platformRole: 'none' },
        }),
      ),
    );
    expect(result.current.data?.capability).toBe('player');
    await waitFor(() => expect(result.current.data?.capability).toBe('player'));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('invalidates the role query when an admin request is rejected', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 403 })));
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await expect(adminRequest('/admin/members')).rejects.toMatchObject({ status: 403 });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'me'] });
  });

  it('joins the family build list with every family game and member, not only those with builds', async () => {
    const game = (id: string) => ({ id, title: id, ownerId: 'u1', visibility: 'private', delistedAt: null });
    const builds = [{ job: { id: 'j1' }, game: game('g1'), member: { userId: 'u2', email: null }, retries: 0 }];
    const games = [game('g1'), { ...game('g2'), delistedAt: '2026-11-01T00:00:00.000Z' }];
    const members = [
      { userId: 'u1', email: 'owner@example.test' },
      { userId: 'u2', email: 'kid@example.test' },
    ];
    const bodies: Record<string, unknown> = {
      '/api/v1/admin/builds': { builds },
      '/api/v1/admin/games?includeDelisted=1': { games },
      '/api/v1/admin/members': { members },
    };
    const request = vi.fn((path: string) =>
      Promise.resolve(
        new Response(JSON.stringify(bodies[path] ?? {}), {
          status: path in bodies ? 200 : 404,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', request);

    await expect(fetchAdminBuilds()).resolves.toEqual({ builds, games, members });
    expect(request).toHaveBeenCalledTimes(3);
  });
});
