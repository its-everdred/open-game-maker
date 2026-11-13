import { afterEach, describe, expect, it, vi } from 'vitest';

import { BLOB_CACHE, cacheFirst, classifyGameRequest, retireCaches } from './game-cache.js';

const hash = 'a'.repeat(64);

afterEach(() => vi.unstubAllGlobals());

describe('classifyGameRequest', () => {
  it.each([
    [`/a/${hash}.glb`, 'cache-first', 'gm-blobs-v1'],
    ['/g/a/b/index.html', 'cache-first', 'gm-builds-v1'],
    ['/g/a/b/main.js', 'cache-first', 'gm-builds-v1'],
    ['/g/a/b/assets/manifest.json', 'cache-first', 'gm-builds-v1'],
  ] as const)('classifies %s as %s', (path, strategy, cacheName) => {
    expect(classifyGameRequest(new Request(`https://games.test${path}`), 'https://games.test')).toEqual({
      strategy,
      cacheName,
    });
  });

  it('never caches a revocable preview URL', () => {
    expect(classifyGameRequest(new Request('https://games.test/g/a/pv-123/index.html'), 'https://games.test')).toEqual({
      strategy: 'pass',
    });
    expect(classifyGameRequest(new Request('https://games.test/p/a/pv-123/index.html'), 'https://games.test')).toEqual({
      strategy: 'pass',
    });
  });

  it('passes unrelated, malformed, non-GET, and cross-origin requests through', () => {
    expect(classifyGameRequest(new Request('https://other.test/g/a/b/index.html'), 'https://games.test')).toEqual({
      strategy: 'pass',
    });
    expect(
      classifyGameRequest(new Request('https://games.test/g/a/b/index.html', { method: 'POST' }), 'https://games.test'),
    ).toEqual({ strategy: 'pass' });
    expect(classifyGameRequest(new Request('https://games.test/game-cache.js'), 'https://games.test')).toEqual({
      strategy: 'pass',
    });
    expect(
      classifyGameRequest(new Request(`https://games.test/a/${'a'.repeat(63)}.glb`), 'https://games.test'),
    ).toEqual({
      strategy: 'pass',
    });
  });
});

describe('cache lifecycle', () => {
  it('deletes only explicitly retired cache names and ignores storage failures', async () => {
    const deleted: string[] = [];
    const cacheStorage = {
      delete: vi.fn(async (name: string) => {
        deleted.push(name);
        if (name === 'gm-assets') throw new Error('storage unavailable');
        return true;
      }),
    } as unknown as CacheStorage;

    await retireCaches(cacheStorage);

    expect(deleted).toEqual(['gm-assets', 'gm-pages']);
  });

  it('stores only successful responses', async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    const match = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('caches', { open: vi.fn().mockResolvedValue({ match, put }) });
    const fetch = vi.fn().mockResolvedValueOnce(new Response('missing', { status: 404 }));
    vi.stubGlobal('fetch', fetch);

    const request = new Request(`https://games.test/a/${hash}.glb`);
    await cacheFirst(request, BLOB_CACHE);
    expect(put).not.toHaveBeenCalled();

    fetch.mockResolvedValueOnce(new Response('blob'));
    await cacheFirst(request, BLOB_CACHE);
    expect(put).toHaveBeenCalledOnce();
  });

  it.each(['open', 'match'] as const)('uses the network when cache %s fails', async (failure) => {
    const put = vi.fn().mockResolvedValue(undefined);
    const match = vi.fn().mockRejectedValue(new Error('storage unavailable'));
    const open =
      failure === 'open'
        ? vi.fn().mockRejectedValue(new Error('storage unavailable'))
        : vi.fn().mockResolvedValue({ match, put });
    vi.stubGlobal('caches', { open });
    const fetch = vi.fn().mockResolvedValue(new Response('blob'));
    vi.stubGlobal('fetch', fetch);

    const request = new Request(`https://games.test/a/${hash}.glb`);
    const response = await cacheFirst(request, BLOB_CACHE);

    expect(await response.text()).toBe('blob');
    expect(fetch).toHaveBeenCalledOnce();
    expect(put).not.toHaveBeenCalled();
  });

  it('returns the network response before a failed cache write settles', async () => {
    let rejectWrite: (reason: Error) => void = () => undefined;
    const write = new Promise<void>((_resolve, reject) => {
      rejectWrite = reject;
    });
    const put = vi.fn().mockReturnValue(write);
    vi.stubGlobal('caches', {
      open: vi.fn().mockResolvedValue({ match: vi.fn().mockResolvedValue(undefined), put }),
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('blob')));
    const waitUntil = vi.fn();

    const request = new Request(`https://games.test/a/${hash}.glb`);
    const response = await cacheFirst(request, BLOB_CACHE, { waitUntil });

    expect(await response.text()).toBe('blob');
    expect(waitUntil).toHaveBeenCalledOnce();
    rejectWrite(new Error('quota exceeded'));
    await expect(waitUntil.mock.calls[0]?.[0]).resolves.toBeUndefined();
  });
});
