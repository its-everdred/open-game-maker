import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, api } from './client';

describe('API client', () => {
  it('announces the role on a successful request', async () => {
    const listener = vi.fn();
    window.addEventListener('ogm:access-state', listener);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('{}', {
          headers: {
            'content-type': 'application/json',
            'x-ogm-user-id': 'u1',
            'x-ogm-capability': 'player',
            'x-ogm-platform-role': 'none',
          },
        }),
      ),
    );
    await api('/games');
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ detail: { userId: 'u1', capability: 'player', platformRole: 'none' } }),
    );
    window.removeEventListener('ogm:access-state', listener);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('preserves structured error bodies', async () => {
    const body = { offers: [{ id: 'small' }] };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(body), {
          status: 402,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    await expect(api('/offers')).rejects.toMatchObject({
      status: 402,
      body,
    } satisfies Partial<ApiError>);
  });

  it('returns undefined for an empty success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    await expect(api('/session', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('posts JSON with first-party credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await api('/games', { method: 'POST', json: { name: 'Frog Run' } });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/games',
      expect.objectContaining({
        body: JSON.stringify({ name: 'Frog Run' }),
        credentials: 'include',
        headers: expect.any(Headers),
      }),
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((request.headers as Headers).get('content-type')).toBe('application/json');
  });

  it('rejects paths without a leading slash', async () => {
    await expect(api('games')).rejects.toThrow('start with /');
  });
});
