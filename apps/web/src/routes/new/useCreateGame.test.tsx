import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCreateGame } from './useCreateGame';

beforeEach(() => {
  localStorage.setItem('ogm.repoVisibility', 'public');
});

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('useCreateGame', () => {
  it('uses the stored repository visibility', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'g_1' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(() => useCreateGame());

    await act(async () => {
      await result.current({ genre: { picks: ['adventure'] }, vibe: { picks: ['cozy'] } }, false);
    });

    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toMatchObject({
      repoVisibility: 'public',
      allowAiGeneratedAssets: false,
    });
  });

  it('creates only once when the talk step renders again', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'g_1' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(() => useCreateGame());

    await act(async () => {
      await Promise.all([result.current({}, true), result.current({}, true)]);
    });

    expect(fetch).toHaveBeenCalledOnce();
  });

  it('syncs the latest asset setting while creation is pending and after it completes', async () => {
    let finishCreate!: (response: Response) => void;
    const createResponse = new Promise<Response>((resolve) => {
      finishCreate = resolve;
    });
    const fetch = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return createResponse;
      return Promise.resolve(
        new Response(JSON.stringify({ id: 'g_1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(() => useCreateGame());

    const first = result.current({}, true);
    const latest = result.current({}, false);
    finishCreate(
      new Response(JSON.stringify({ id: 'g_1' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await act(async () => {
      await Promise.all([first, latest]);
    });
    await act(async () => {
      await result.current({}, true);
    });

    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(
      fetch.mock.calls
        .filter(([, init]) => init?.method === 'PATCH')
        .map(([, init]) => JSON.parse(init!.body as string)),
    ).toEqual([{ allowAiGeneratedAssets: false }, { allowAiGeneratedAssets: true }]);
    expect(fetch.mock.calls.at(-1)?.[0]).toMatch(/\/api\/v1\/games\/g_1$/);
  });

  it('retries after a failed creation request', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'g_2' }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(() => useCreateGame());

    await act(async () => {
      await expect(result.current({}, true)).rejects.toThrow('api 503');
    });
    await act(async () => {
      await expect(result.current({}, true)).resolves.toBe('g_2');
    });

    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
