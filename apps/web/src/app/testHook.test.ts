import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

import { installTestHook, registerTestApi } from './testHook';

describe('browser test hook', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
    delete window.__ogmHost;
  });

  it('is absent without the test query parameter', () => {
    const router = fakeRouter('/');

    installTestHook(router);

    expect(window.__ogmHost).toBeUndefined();
  });

  it('reports navigation and registered screen APIs in test mode', () => {
    window.history.replaceState(null, '', '/?test');
    const router = fakeRouter('/');

    installTestHook(router);
    registerTestApi('games', { refresh: true });

    expect(window.__ogmHost?.version).toBe(1);
    expect(window.__ogmHost?.route()).toBe('/');
    expect(window.__ogmHost?.get('games')).toEqual({ refresh: true });
    expect(window.__ogmHost?.snapshot()).toEqual({
      route: '/',
      registered: ['games'],
    });
    window.__ogmHost?.navigate('/new');
    expect(router.navigate).toHaveBeenCalledWith('/new');
  });

  it('rejects duplicate registrations', () => {
    window.history.replaceState(null, '', '/?test');
    installTestHook(fakeRouter('/'));
    window.__ogmHost?.register('games', {});

    expect(() => window.__ogmHost?.register('games', {})).toThrow('already registered');
  });

  it('reports Activity ready only after every feed settles successfully', async () => {
    window.history.replaceState(null, '', '/?test');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const host = installTestHook(fakeRouter('/'), client)!;
    const api = host.activity!;
    const ids = ['one', 'two'];
    expect(api.settled('u1', ids)).toBe(false);
    for (const id of ids) {
      client.setQueryData(['game-workers', 'u1', id], { workers: [] });
      client.setQueryData(['game-review-rounds', id, 'u1'], { rounds: [] });
      client.setQueryData(['completed-tickets', 'u1', id], { tickets: [] });
    }
    client.setQueryData(['game-previews', 'one', 'u1'], { previews: [] });
    let finish!: (value: { previews: never[] }) => void;
    const pending = client.fetchQuery({
      queryKey: ['game-previews', 'two', 'u1'],
      queryFn: () => new Promise<{ previews: never[] }>((resolve) => (finish = resolve)),
    });
    expect(api.settled('u1', ids)).toBe(false);
    finish({ previews: [] });
    await pending;
    expect(api.settled('u1', ids)).toBe(true);
    expect(api.settled('another-user', ids)).toBe(false);
    expect(api.settled('u1', [])).toBe(false);
    await expect(
      client.fetchQuery({
        queryKey: ['game-review-rounds', 'one', 'u1'],
        queryFn: () => Promise.reject(new Error('offline')),
      }),
    ).rejects.toThrow('offline');
    expect(api.settled('u1', ids)).toBe(false);
    client.setQueryData(['game-review-rounds', 'one', 'u1'], { rounds: [] });
    client.setQueryData(['completed-tickets', 'u1', 'two'], { tickets: [], stale: true });
    expect(api.settled('u1', ids)).toBe(false);
    client.clear();
  });
});

function fakeRouter(pathname: string) {
  return {
    navigate: vi.fn(),
    state: { location: { pathname } },
  };
}
