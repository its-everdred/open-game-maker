import { describe, expect, it, vi } from 'vitest';

import {
  CACHE_EVICTION_POLICY,
  evictAssetCaches,
  scheduleAssetCacheEviction,
  type CacheEvictionDependencies,
  type CacheEvictionLedger,
} from './evict.js';
import type { LedgerBuild } from './cache.js';

const DAY_MS = 24 * 60 * 60 * 1_000;
const NOW = Date.UTC(2026, 10, 2);

function build(overrides: Partial<LedgerBuild> & Pick<LedgerBuild, 'gameId' | 'buildId'>): LedgerBuild {
  const { gameId, buildId, ...rest } = overrides;
  const lastPlayedAt = overrides.lastPlayedAt ?? NOW;
  const hashes = overrides.hashes ?? [`hash-${gameId}-${buildId}`];
  const bytes = overrides.bytes ?? 10;
  return {
    key: `${gameId}/${buildId}`,
    gameId,
    buildId,
    channel: 'published',
    tier: 'desktop',
    hashes,
    hashBytes: Object.fromEntries(hashes.map((hash) => [hash, bytes / hashes.length])),
    bytes,
    firstPlayedAt: lastPlayedAt,
    lastPlayedAt,
    plays: 1,
    ...rest,
  };
}

class FakeCache {
  readonly urls: Set<string>;

  constructor(urls: string[]) {
    this.urls = new Set(urls);
  }

  async keys(): Promise<Request[]> {
    return [...this.urls].map((url) => new Request(url));
  }

  async delete(request: RequestInfo | URL): Promise<boolean> {
    const url = request instanceof Request ? request.url : new URL(request.toString(), 'https://games.test').toString();
    return this.urls.delete(url);
  }
}

class FakeLedger implements CacheEvictionLedger {
  readonly builds: Map<string, LedgerBuild>;

  constructor(builds: LedgerBuild[]) {
    this.builds = new Map(builds.map((entry) => [entry.key, entry]));
  }

  async list(): Promise<LedgerBuild[]> {
    return [...this.builds.values()];
  }

  async delete(keys: string[]): Promise<void> {
    for (const key of keys) this.builds.delete(key);
  }
}

function setup(
  builds: LedgerBuild[],
  options: {
    blobHashes?: string[];
    buildUrls?: string[];
    quota?: number;
    lockAvailable?: boolean;
  } = {},
): {
  dependencies: CacheEvictionDependencies;
  ledger: FakeLedger;
  blobs: FakeCache;
  buildCache: FakeCache;
} {
  const ledger = new FakeLedger(builds);
  const blobs = new FakeCache(
    (options.blobHashes ?? builds.flatMap((entry) => entry.hashes)).map((hash) => `https://games.test/a/${hash}.webp`),
  );
  const buildCache = new FakeCache(
    options.buildUrls ?? builds.map((entry) => `https://games.test/g/${entry.gameId}/${entry.buildId}/main.js`),
  );
  const caches = new Map([
    ['gm-blobs-v1', blobs],
    ['gm-builds-v1', buildCache],
  ]);

  return {
    ledger,
    blobs,
    buildCache,
    dependencies: {
      now: () => NOW,
      ledger,
      caches: {
        async open(name) {
          const cache = caches.get(name);
          if (!cache) throw new Error(`Unexpected cache: ${name}`);
          return cache;
        },
      },
      locks: {
        async request(name, lockOptions, callback) {
          expect(name).toBe('gm-cache');
          expect(lockOptions).toEqual({ mode: 'exclusive', ifAvailable: true });
          return callback(options.lockAvailable === false ? null : ({} as Lock));
        },
      },
      storage: {
        async estimate() {
          return { quota: options.quota ?? 10_000 };
        },
      },
    },
  };
}

describe('evictAssetCaches', () => {
  it('does not charge unrequested lazy hashes against the cache budget', async () => {
    const game = build({
      gameId: 'game',
      buildId: 'only',
      hashes: ['boot', 'lazy'],
      bytes: 1010,
      hashBytes: { boot: 10, lazy: 1000 },
    });
    const { dependencies, ledger, blobs } = setup([game], { blobHashes: ['boot'], quota: 400 });
    await evictAssetCaches(dependencies);
    expect(ledger.builds.has(game.key)).toBe(true);
    expect(blobs.urls.has('https://games.test/a/boot.webp')).toBe(true);
  });
  it('keeps a shared hash while any retained build references it', async () => {
    const stale = build({
      gameId: 'game',
      buildId: 'old',
      hashes: ['shared', 'stale-only'],
      lastPlayedAt: NOW - 31 * DAY_MS,
    });
    const current = build({ gameId: 'game', buildId: 'new', hashes: ['shared', 'current-only'] });
    const { dependencies, ledger, blobs, buildCache } = setup([stale, current]);

    await evictAssetCaches(dependencies);

    expect(blobs.urls).toEqual(new Set(['https://games.test/a/shared.webp', 'https://games.test/a/current-only.webp']));
    expect(buildCache.urls).toEqual(new Set(['https://games.test/g/game/new/main.js']));
    expect([...ledger.builds]).toHaveLength(1);
    expect(ledger.builds.has(current.key)).toBe(true);
  });

  it('keeps an old build only when it is the newest played build for its game', async () => {
    const newestOld = build({ gameId: 'quiet', buildId: 'only', lastPlayedAt: NOW - 31 * DAY_MS });
    const supersededOld = build({ gameId: 'active', buildId: 'old', lastPlayedAt: NOW - 31 * DAY_MS });
    const current = build({ gameId: 'active', buildId: 'new', lastPlayedAt: NOW - DAY_MS });
    const { dependencies, ledger } = setup([newestOld, supersededOld, current]);

    await evictAssetCaches(dependencies);

    expect([...ledger.builds.keys()].sort()).toEqual([current.key, newestOld.key].sort());
  });

  it('drops the third-newest draft even when it was played recently', async () => {
    const drafts = [
      build({ gameId: 'game', buildId: 'draft-1', channel: 'draft', lastPlayedAt: NOW - 3_000 }),
      build({ gameId: 'game', buildId: 'draft-2', channel: 'draft', lastPlayedAt: NOW - 2_000 }),
      build({ gameId: 'game', buildId: 'draft-3', channel: 'draft', lastPlayedAt: NOW - 1_000 }),
    ];
    const { dependencies, ledger } = setup(drafts);

    await evictAssetCaches(dependencies);

    expect([...ledger.builds.keys()].sort()).toEqual(['game/draft-2', 'game/draft-3']);
  });

  it('drops the least recently played game first when retained builds exceed the budget', async () => {
    const leastRecent = build({ gameId: 'old-game', buildId: 'only', bytes: 60, lastPlayedAt: NOW - 2_000 });
    const mostRecent = build({ gameId: 'new-game', buildId: 'only', bytes: 60, lastPlayedAt: NOW - 1_000 });
    const { dependencies, ledger } = setup([leastRecent, mostRecent], { quota: 400 });

    await evictAssetCaches(dependencies);

    expect(CACHE_EVICTION_POLICY.quotaRatio).toBe(0.25);
    expect([...ledger.builds.keys()]).toEqual([mostRecent.key]);
  });

  it('counts shared hashes once when applying the storage budget', async () => {
    const sharedOlder = build({
      gameId: 'old-game',
      buildId: 'only',
      bytes: 60,
      hashes: ['shared'],
      hashBytes: { shared: 60 },
      lastPlayedAt: NOW - 2_000,
    });
    const sharedNewer = build({
      gameId: 'new-game',
      buildId: 'only',
      bytes: 60,
      hashes: ['shared'],
      hashBytes: { shared: 60 },
      lastPlayedAt: NOW - 1_000,
    });
    const { dependencies, ledger } = setup([sharedOlder, sharedNewer], { quota: 400 });

    await evictAssetCaches(dependencies);

    expect([...ledger.builds.keys()].sort()).toEqual([sharedNewer.key, sharedOlder.key].sort());
  });

  it('caps the storage budget at one GiB when quota is larger', async () => {
    const bytes = 600 * 1024 ** 2;
    const leastRecent = build({ gameId: 'old-game', buildId: 'only', bytes, lastPlayedAt: NOW - 2_000 });
    const mostRecent = build({ gameId: 'new-game', buildId: 'only', bytes, lastPlayedAt: NOW - 1_000 });
    const { dependencies, ledger } = setup([leastRecent, mostRecent], { quota: 20 * 1024 ** 3 });

    await evictAssetCaches(dependencies);

    expect(CACHE_EVICTION_POLICY.maxBytes).toBe(1024 ** 3);
    expect([...ledger.builds.keys()]).toEqual([mostRecent.key]);
  });

  it('deletes orphan blob entries without ledger rows', async () => {
    const current = build({ gameId: 'game', buildId: 'current', hashes: ['live'] });
    const { dependencies, blobs } = setup([current], { blobHashes: ['live', 'orphan'] });

    await evictAssetCaches(dependencies);

    expect(blobs.urls).toEqual(new Set(['https://games.test/a/live.webp']));
  });

  it('does nothing while a shared cache lock is held', async () => {
    const stale = build({ gameId: 'game', buildId: 'stale', lastPlayedAt: NOW - 31 * DAY_MS });
    const current = build({ gameId: 'game', buildId: 'current' });
    const { dependencies, ledger, blobs, buildCache } = setup([stale, current], { lockAvailable: false });
    const beforeBlobs = new Set(blobs.urls);
    const beforeBuilds = new Set(buildCache.urls);

    await evictAssetCaches(dependencies);

    expect(blobs.urls).toEqual(beforeBlobs);
    expect(buildCache.urls).toEqual(beforeBuilds);
    expect([...ledger.builds.keys()].sort()).toEqual([current.key, stale.key].sort());
  });

  it('runs from an idle callback with a five-second deadline', async () => {
    const stale = build({ gameId: 'game', buildId: 'stale', lastPlayedAt: NOW - 31 * DAY_MS });
    const current = build({ gameId: 'game', buildId: 'current' });
    const { dependencies, ledger } = setup([stale, current]);
    let idleCallback: IdleRequestCallback | undefined;
    let timeout: number | undefined;

    scheduleAssetCacheEviction(dependencies, {
      requestIdleCallback(callback, options) {
        idleCallback = callback;
        timeout = options?.timeout;
        return 1;
      },
      setTimeout() {
        throw new Error('idle callback should be preferred');
      },
    });

    expect(timeout).toBe(5_000);
    expect(ledger.builds.has(stale.key)).toBe(true);
    idleCallback?.({ didTimeout: false, timeRemaining: () => 10 });
    await vi.waitFor(() => expect(ledger.builds.has(stale.key)).toBe(false));
  });

  it('falls back to a five-second timer when idle callbacks are unavailable', async () => {
    const stale = build({ gameId: 'game', buildId: 'stale', lastPlayedAt: NOW - 31 * DAY_MS });
    const current = build({ gameId: 'game', buildId: 'current' });
    const { dependencies, ledger } = setup([stale, current]);
    let timeoutCallback: (() => void) | undefined;
    let timeout: number | undefined;

    scheduleAssetCacheEviction(dependencies, {
      setTimeout(callback, delay) {
        timeoutCallback = callback;
        timeout = delay;
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
    });

    expect(timeout).toBe(5_000);
    expect(ledger.builds.has(stale.key)).toBe(true);
    timeoutCallback?.();
    await vi.waitFor(() => expect(ledger.builds.has(stale.key)).toBe(false));
  });
});
