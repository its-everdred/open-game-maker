import { describe, expect, it, vi } from 'vitest';

import { RepoResolver } from '../src/repo-resolver.js';

describe('RepoResolver', () => {
  it('resolves one game per request with the service bearer', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          owner: 'alice',
          name: 'instance',
          visibility: 'private',
          path: 'games/castle-game',
          slug: 'castle-game',
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    const resolver = new RepoResolver('http://127.0.0.1:4300/', 'service-secret', fetchImpl);
    await expect(resolver.resolve('game/1')).resolves.toEqual({
      owner: 'alice',
      name: 'instance',
      visibility: 'private',
      path: 'games/castle-game',
      slug: 'castle-game',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:4300/internal/games/game%2F1/repo',
      expect.objectContaining({ headers: { authorization: 'Bearer service-secret', 'x-ogm-service': 'commit' } }),
    );
    expect(fetchImpl.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('refuses malformed API responses', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ owner: 'alice', name: 'instance', visibility: 'internal', path: 'games/a', slug: 'a' }),
        ),
      );
    await expect(
      new RepoResolver('http://127.0.0.1:4300', 'service-secret', fetchImpl).resolve('game-1'),
    ).rejects.toThrow('invalid response');
  });

  it('bounds a stalled repository lookup', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async (_input, init) =>
        new Promise<Response>((resolve, reject) => {
          const signal = init?.signal;
          const timer = setTimeout(
            () =>
              resolve(
                new Response(
                  JSON.stringify({
                    owner: 'alice',
                    name: 'instance',
                    visibility: 'private',
                    path: 'games/a',
                    slug: 'a',
                  }),
                ),
              ),
            20,
          );
          signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              reject(signal.reason);
            },
            { once: true },
          );
        }),
    );
    const resolver = new RepoResolver('http://127.0.0.1:4300', 'service-secret', fetchImpl, 1);
    await expect(resolver.resolve('game-1')).rejects.toBeDefined();
  });
});
