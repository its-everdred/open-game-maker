import { describe, expect, it, vi } from 'vitest';

import { BoundaryApiClient, BoundaryApiError } from '../../src/boundary/api-client.js';

describe('BoundaryApiClient', () => {
  it('classifies interrupted response reads as transport failures', async () => {
    const api = new BoundaryApiClient({
      baseUrl: 'http://127.0.0.1:3000',
      token: 'secret',
      fetch: async () =>
        ({
          ok: true,
          json: async () => {
            throw new TypeError('connection lost');
          },
        }) as Response,
    });
    await expect(api.activeRepositories()).rejects.toMatchObject({ reason: 'transport' });
  });
  it('preserves HTTP status without exposing response content', async () => {
    const api = new BoundaryApiClient({
      baseUrl: 'http://127.0.0.1:3000',
      token: 'secret',
      fetch: async () => new Response('private', { status: 403 }),
    });
    await expect(api.activeRepositories()).rejects.toMatchObject({
      reason: 'http',
      status: 403,
      message: 'boundary API request failed',
    });
  });
  it('authenticates requests and validates active repository elements', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({
        repositories: [
          { gameId: 'g1', owner: 'alice', name: 'instance', visibility: 'private', path: 'games/g1', slug: 'g1' },
        ],
      }),
    );
    const api = new BoundaryApiClient({ baseUrl: 'http://127.0.0.1:3000/', token: 'secret', fetch: fetchImpl });

    await expect(api.activeRepositories()).resolves.toEqual([
      { gameId: 'g1', owner: 'alice', name: 'instance', visibility: 'private', path: 'games/g1', slug: 'g1' },
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/internal/games/active-repos',
      expect.objectContaining({
        headers: { authorization: 'Bearer secret', 'x-ogm-service': 'commit' },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('rejects malformed repository elements', async () => {
    const api = new BoundaryApiClient({
      baseUrl: 'http://127.0.0.1:3000',
      token: 'secret',
      fetch: async () => Response.json({ repositories: [{ gameId: 'g1', owner: null }] }),
    });

    await expect(api.activeRepositories()).rejects.toBeInstanceOf(BoundaryApiError);
  });

  it('turns a timed-out request into a boundary API error', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
        }),
    );
    const api = new BoundaryApiClient({
      baseUrl: 'http://127.0.0.1:3000',
      token: 'secret',
      fetch: fetchImpl,
      timeoutMs: 1,
    });

    await expect(api.piiTerms('g1')).rejects.toBeInstanceOf(BoundaryApiError);
  });
});
