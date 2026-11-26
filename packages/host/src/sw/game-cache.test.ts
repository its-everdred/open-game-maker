import { expect, it, vi } from 'vitest';
import { needsAccessCheck, retireCaches } from './game-cache.js';

it('requires network authorization for builds and shared assets', () => {
  for (const path of ['/g/game/build/index.html', '/a/hash.glb']) {
    expect(needsAccessCheck(new Request(`https://games.test${path}`), 'https://games.test')).toBe(true);
  }
  expect(needsAccessCheck(new Request('https://other.test/g/game/build/index.html'), 'https://games.test')).toBe(false);
});

it('retires old build caches so they cannot bypass access checks', async () => {
  const deleted: string[] = [];
  const cacheStorage = {
    delete: vi.fn(async (name: string) => {
      deleted.push(name);
      return true;
    }),
  } as unknown as CacheStorage;
  await retireCaches(cacheStorage);
  expect(deleted).toEqual(['gm-assets', 'gm-pages', 'gm-blobs-v1', 'gm-builds-v1']);
});
