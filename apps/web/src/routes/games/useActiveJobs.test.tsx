import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { nextActiveJobsPoll, useActiveJobs } from './useActiveJobs';

vi.mock('../../lib/api/session', () => ({ useSession: () => ({ data: { user: { id: 'u_creator' } } }) }));

const activeJob = {
  id: 'j_1',
  gameId: 'g_1',
  kind: 'new_game' as const,
  state: 'running' as const,
  friendlyState: 'Building',
  progressPercent: 40,
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useActiveJobs', () => {
  it('does not request private jobs when access is disabled', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useActiveJobs(false), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stops polling when creator access is removed', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ jobs: [activeJob] }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, rerender, unmount } = renderHook(({ enabled }) => useActiveJobs(enabled), {
      wrapper,
      initialProps: { enabled: true },
    });
    await vi.waitFor(() => expect(result.current.data).toEqual([activeJob]));
    rerender({ enabled: false });
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(fetchMock).toHaveBeenCalledOnce();
    unmount();
    client.clear();
  });

  it('selects a 10-second interval only while a job is active', () => {
    expect(nextActiveJobsPoll([activeJob])).toBe(10_000);
    expect(nextActiveJobsPoll([{ ...activeJob, state: 'done' }])).toBe(false);
    expect(nextActiveJobsPoll([])).toBe(false);
  });

  it('polls the jobs route every 10 seconds and stops after the job becomes terminal', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ jobs: [activeJob] }))
      .mockResolvedValueOnce(Response.json({ jobs: [{ ...activeJob, state: 'done' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { result, unmount } = renderHook(() => useActiveJobs(), { wrapper });
    await vi.waitFor(() => expect(result.current.data).toEqual([activeJob]));
    expect(fetchMock).toHaveBeenCalledOnce();

    await act(() => vi.advanceTimersByTimeAsync(10_000));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    unmount();
    client.clear();
  });

  it('degrades an unavailable jobs route to an empty list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useActiveJobs(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});
