import 'fake-indexeddb/auto';

import type { CachePlan, CachePlanEntry } from '@ogm/contracts/assets';
import { deleteDB, openDB } from 'idb';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ASSET_CACHE_NAME,
  prepare,
  type LedgerBuild,
  type LoadMessage,
  type LoadSender,
  type PrepareDependencies,
} from './cache.js';

const databases: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(databases.splice(0).map((name) => deleteDB(name)));
});

class MemoryCache {
  readonly entries = new Map<string, Response>();
  readonly quotaUrls = new Set<string>();

  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    return this.entries.get(String(request))?.clone();
  }

  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    const url = String(request);
    if (this.quotaUrls.has(url)) throw new DOMException('full', 'QuotaExceededError');
    this.entries.set(url, response.clone());
  }
}

class MemoryCacheStorage {
  readonly cache = new MemoryCache();
  readonly opened: string[] = [];

  async open(name: string): Promise<Cache> {
    this.opened.push(name);
    return this.cache as unknown as Cache;
  }
}

interface TestContext extends PrepareDependencies {
  cacheStorage: MemoryCacheStorage;
  databaseName: string;
  fetcher: ReturnType<typeof vi.fn<typeof globalThis.fetch>>;
  localStorage: Map<string, string>;
  locks: NonNullable<PrepareDependencies['locks']>;
  messages: LoadMessage[];
  requestOrder: string[];
  send: LoadSender;
  evictionScheduler: ReturnType<typeof vi.fn<NonNullable<PrepareDependencies['evictionScheduler']>>>;
  storage: NonNullable<PrepareDependencies['storage']> & {
    persisted: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
    estimate: ReturnType<typeof vi.fn<() => Promise<{ usage: number; quota: number }>>>;
    persist: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
  };
}

const entry = (digest: string, bytes: number, phase: CachePlanEntry['phase'] = 'ready'): CachePlanEntry => ({
  sha256: digest.repeat(64),
  url: `/a/${digest.repeat(64)}.${phase === 'stream' ? 'mp3' : 'webp'}`,
  bytes,
  kind: phase === 'stream' ? 'music' : 'sprite',
  phase,
  tiers: ['*'],
});

function plan(entries: CachePlanEntry[]): CachePlan {
  const totals = Object.fromEntries(
    ['desktop', 'mobile', 'low'].map((tier) => [
      tier,
      Object.fromEntries(
        ['boot', 'ready', 'stream'].map((phase) => {
          const selected = entries.filter(
            (item) => item.phase === phase && (item.tiers.includes('*') || item.tiers.includes(tier as never)),
          );
          return [phase, { bytes: selected.reduce((sum, item) => sum + item.bytes, 0), files: selected.length }];
        }),
      ),
    ]),
  ) as CachePlan['totals'];
  return {
    version: 1,
    gameId: 'game',
    buildId: 'build',
    built: '2026-11-02T20:00:00.000Z',
    sdkVersion: 'test',
    tiers: ['desktop', 'mobile', 'low'],
    entries,
    totals,
  };
}

function setup(cachePlan: CachePlan, cacheStorage = new MemoryCacheStorage()): TestContext {
  const messages: LoadMessage[] = [];
  const requestOrder: string[] = [];
  const databaseName = `gm-cache-test-${crypto.randomUUID()}`;
  databases.push(databaseName);
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requestOrder.push(`${url}:${String((init as (RequestInit & { priority?: string }) | undefined)?.priority ?? '')}`);
    if (url.endsWith('cache-plan.json')) return Response.json(cachePlan);
    const item = cachePlan.entries.find((candidate) => new URL(candidate.url, url).toString() === url);
    return new Response(new Uint8Array(item?.bytes ?? 0).fill(1));
  });
  const locks: NonNullable<PrepareDependencies['locks']> = {
    async request<T>(_name: string, options: LockOptions, callback: (lock: Lock | null) => Promise<T> | T): Promise<T> {
      expect(options.mode).toBe('shared');
      return callback({} as Lock);
    },
  };
  const storage = {
    persisted: vi.fn(async () => false),
    estimate: vi.fn(async () => ({ usage: 123, quota: 456 })),
    persist: vi.fn(async () => false),
  };
  const localStorage = new Map<string, string>();
  const evictionScheduler = vi.fn<NonNullable<PrepareDependencies['evictionScheduler']>>();
  return {
    cacheStorage,
    databaseName,
    fetcher,
    localStorage,
    evictionScheduler,
    locks,
    messages,
    requestOrder,
    storage,
    send: ((type, payload) => {
      messages.push({ t: type, payload } as LoadMessage);
    }) as LoadSender,
  };
}

describe('prepare asset cache', () => {
  it('does not fetch lazy-only entries during ready or stream preparation', async () => {
    const ready = { ...entry('a', 4), assetPhasesByTier: { desktop: ['boot'] } };
    const lazy = { ...entry('b', 4), assetPhasesByTier: { desktop: ['lazy:backdrop-nim'] } };
    const lazyStream = { ...entry('c', 4, 'stream'), assetPhasesByTier: { desktop: ['lazy:backdrop-nim'] } };
    const context = setup(plan([ready, lazy, lazyStream]));
    await prepare({ plan: 'https://game.test/assets/cache-plan.json', tier: 'desktop', send: context.send }, context);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(context.requestOrder.some((url) => url.includes(ready.url))).toBe(true);
    expect(context.requestOrder.some((url) => url.includes(lazy.url))).toBe(false);
    expect(context.requestOrder.some((url) => url.includes(lazyStream.url))).toBe(false);
  });

  it('uses phase ownership for the selected tier when a file is shared', async () => {
    const shared = {
      ...entry('d', 4),
      assetPhasesByTier: { desktop: ['boot'], mobile: ['lazy:backdrop-nim'] },
    };
    const context = setup(plan([shared]));
    await prepare({ plan: 'https://game.test/assets/cache-plan.json', tier: 'mobile', send: context.send }, context);
    expect(context.requestOrder.some((url) => url.includes(shared.url))).toBe(false);
  });

  it('retains lazy hashes in the build ledger for future cache eviction', async () => {
    const lazy = { ...entry('e', 4), assetPhasesByTier: { mobile: ['lazy:backdrop-nim'] } };
    const context = setup(plan([lazy]));
    await prepare({ plan: 'https://game.test/assets/cache-plan.json', tier: 'mobile', send: context.send }, context);
    const database = await openDB(context.databaseName, 1);
    const row = (await database.get('builds', 'game/build')) as LedgerBuild;
    database.close();
    expect(row.hashes).toContain(lazy.sha256);
    expect(context.requestOrder.some((url) => url.includes(lazy.url))).toBe(false);
  });
  it('fetches a cold ready set six at a time with monotonic byte progress', async () => {
    const entries = Array.from({ length: 7 }, (_, index) => entry(String(index + 1), index + 1));
    const cachePlan = plan(entries);
    const context = setup(cachePlan);
    let active = 0;
    let maximumActive = 0;
    context.fetcher.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      context.requestOrder.push(
        `${url}:${String((init as (RequestInit & { priority?: string }) | undefined)?.priority ?? '')}`,
      );
      if (url.endsWith('cache-plan.json')) return Response.json(cachePlan);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      const item = entries.find((candidate) => url.endsWith(candidate.url));
      return new Response(new Uint8Array(item?.bytes ?? 0));
    });

    await prepare(
      { plan: 'https://game.test/g/game/build/assets/cache-plan.json', tier: 'desktop', send: context.send },
      context,
    );

    const progress = context.messages.filter((message) => message.t === 'load.progress');
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.map((message) => message.payload.loaded)).toEqual(
      [...progress.map((message) => message.payload.loaded)].sort((left, right) => left - right),
    );
    expect(progress.at(-1)?.payload).toMatchObject({ loaded: 28, total: 28, cachedBytes: 0 });
    expect(maximumActive).toBe(6);
    expect(context.requestOrder.filter((request) => request.endsWith(':high'))).toHaveLength(7);
    expect(context.cacheStorage.opened).toContain(ASSET_CACHE_NAME);
  });

  it('limits progress to ten updates per second and still reports the final total', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const ready = entry('a', 6);
    const cachePlan = plan([ready]);
    const context = setup(cachePlan);
    context.now = () => Date.now();
    context.fetcher.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('cache-plan.json')) return Response.json(cachePlan);
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2]));
            controller.enqueue(new Uint8Array([3, 4]));
            controller.enqueue(new Uint8Array([5, 6]));
            controller.close();
          },
        }),
      );
    });

    const pending = prepare(
      { plan: 'https://game.test/g/game/build/assets/cache-plan.json', tier: 'desktop', send: context.send },
      context,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(context.messages.filter((message) => message.t === 'load.progress')).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(99);
    expect(context.messages.filter((message) => message.t === 'load.progress')).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    await vi.runAllTimersAsync();
    await pending;
    expect(
      context.messages.filter((message) => message.t === 'load.progress').map((message) => message.payload.loaded),
    ).toEqual([0, 6]);
  });

  it('waits for started workers and cancels progress before rejecting a failed phase', async () => {
    const entries = Array.from({ length: 7 }, (_, index) => entry(String(index + 1), 10));
    const cachePlan = plan(entries);
    const context = setup(cachePlan);
    let resolveSlow!: (response: Response) => void;
    const slowResponse = new Promise<Response>((resolve) => {
      resolveSlow = resolve;
    });
    context.fetcher.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      context.requestOrder.push(
        `${url}:${String((init as (RequestInit & { priority?: string }) | undefined)?.priority ?? '')}`,
      );
      if (url.endsWith('cache-plan.json')) return Response.json(cachePlan);
      if (url.endsWith(entries[0]!.url)) return new Response(null, { status: 500 });
      if (url.endsWith(entries[1]!.url)) return slowResponse;
      return new Response(new Uint8Array(10));
    });

    const pending = prepare(
      { plan: 'https://game.test/g/game/build/assets/cache-plan.json', tier: 'desktop', send: context.send },
      context,
    );
    let settled = false;
    void pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await vi.waitFor(() => expect(context.requestOrder.filter((request) => request.endsWith(':high'))).toHaveLength(6));
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveSlow(new Response(new Uint8Array(10)));
    await expect(pending).rejects.toThrow('HTTP 500');
    expect(
      context.requestOrder.some((request) =>
        request.startsWith(new URL(entries[6]!.url, 'https://game.test').toString()),
      ),
    ).toBe(false);
    const messageCount = context.messages.length;
    await new Promise((resolve) => setTimeout(resolve, 110));
    expect(context.messages).toHaveLength(messageCount);
  });

  it('does no asset fetches for a warm plan and reports zero fetched bytes', async () => {
    const ready = entry('a', 10);
    const cachePlan = plan([ready]);
    const context = setup(cachePlan);
    context.cacheStorage.cache.entries.set(new URL(ready.url, 'https://game.test').toString(), new Response('cached'));

    await prepare(
      { plan: 'https://game.test/g/game/build/assets/cache-plan.json', tier: 'desktop', send: context.send },
      context,
    );

    expect(context.fetcher).toHaveBeenCalledTimes(1);
    expect(context.messages.find((message) => message.t === 'load.done')?.payload).toMatchObject({
      fetchedBytes: 0,
      fetchedFiles: 0,
      cachedBytes: 10,
      cachedFiles: 1,
      persisted: false,
      usage: 123,
      quota: 456,
    });
  });

  it('fetches only the missing hashes from a half-warm plan', async () => {
    const warm = entry('a', 10);
    const missing = entry('b', 20);
    const cachePlan = plan([warm, missing]);
    const context = setup(cachePlan);
    context.cacheStorage.cache.entries.set(new URL(warm.url, 'https://game.test').toString(), new Response('cached'));

    await prepare(
      { plan: 'https://game.test/g/game/build/assets/cache-plan.json', tier: 'desktop', send: context.send },
      context,
    );

    expect(context.requestOrder.filter((request) => request.endsWith(':high'))).toEqual([
      `${new URL(missing.url, 'https://game.test')}:high`,
    ]);
  });

  it('starts stream fetches only after load.done', async () => {
    const ready = entry('a', 10);
    const stream = entry('b', 20, 'stream');
    const cachePlan = plan([ready, stream]);
    const context = setup(cachePlan);
    const events: string[] = [];
    const send: LoadSender = (type, payload) => {
      events.push(type);
      context.messages.push({ t: type, payload } as LoadMessage);
    };
    context.send = send;
    context.fetcher.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('cache-plan.json')) return Response.json(cachePlan);
      events.push(`fetch:${String((init as (RequestInit & { priority?: string }) | undefined)?.priority)}`);
      const item = cachePlan.entries.find((candidate) => url.endsWith(candidate.url));
      return new Response(new Uint8Array(item?.bytes ?? 0));
    });

    await prepare(
      { plan: 'https://game.test/g/game/build/assets/cache-plan.json', tier: 'desktop', send: context.send },
      context,
    );

    await vi.waitFor(() => expect(events).toContain('fetch:low'));
    expect(events.indexOf('load.done')).toBeLessThan(events.indexOf('fetch:low'));
  });

  it('continues when a completed response cannot be cached for quota', async () => {
    const ready = entry('a', 10);
    const cachePlan = plan([ready]);
    const context = setup(cachePlan);
    context.cacheStorage.cache.quotaUrls.add(new URL(ready.url, 'https://game.test').toString());

    await expect(
      prepare(
        { plan: 'https://game.test/g/game/build/assets/cache-plan.json', tier: 'desktop', send: context.send },
        context,
      ),
    ).resolves.toBeDefined();
    expect(context.messages.some((message) => message.t === 'load.done')).toBe(true);
    expect(context.cacheStorage.cache.entries).toHaveLength(0);
  });

  it('sends no load messages when the build has no cache plan', async () => {
    const context = setup(plan([]));
    context.fetcher.mockResolvedValue(new Response(null, { status: 404 }));

    await expect(
      prepare(
        { plan: 'https://game.test/g/old/build/assets/cache-plan.json', tier: 'desktop', send: context.send },
        context,
      ),
    ).resolves.toBeUndefined();
    expect(context.messages).toEqual([]);
  });

  it('treats an HTML app fallback as a missing cache plan', async () => {
    const context = setup(plan([]));
    context.fetcher.mockResolvedValue(
      new Response('<!doctype html><title>Game</title>', { headers: { 'content-type': 'text/html' } }),
    );

    await expect(
      prepare({ plan: 'https://game.test/assets/cache-plan.json', tier: 'desktop', send: context.send }, context),
    ).resolves.toBeUndefined();
    expect(context.messages).toEqual([]);
  });

  it('writes the build ledger after load.done, schedules eviction, and increments repeat plays', async () => {
    const ready = entry('a', 10);
    const cachePlan = plan([ready]);
    const context = setup(cachePlan);
    const lifecycle: string[] = [];
    let scheduled: Parameters<NonNullable<PrepareDependencies['evictionScheduler']>>[0] | undefined;
    context.send = ((type, payload) => {
      lifecycle.push(type);
      context.messages.push({ t: type, payload } as LoadMessage);
    }) as LoadSender;
    context.evictionScheduler.mockImplementation((dependencies) => {
      lifecycle.push('eviction');
      scheduled = dependencies;
    });
    const options = {
      plan: 'https://game.test/g/game/build/assets/cache-plan.json',
      tier: 'desktop' as const,
      channel: 'published' as const,
      send: context.send,
    };
    await prepare(options, context);
    await prepare(options, context);

    const database = await openDB(context.databaseName, 1);
    const row = (await database.get('builds', 'game/build')) as LedgerBuild;
    database.close();
    expect(context.messages.findIndex((message) => message.t === 'load.done')).toBeGreaterThanOrEqual(0);
    expect(row).toMatchObject({
      key: 'game/build',
      gameId: 'game',
      buildId: 'build',
      channel: 'published',
      tier: 'desktop',
      hashes: [ready.sha256],
      bytes: 10,
      plays: 2,
    });
    expect(row.lastPlayedAt).toBeGreaterThanOrEqual(row.firstPlayedAt);
    expect(lifecycle.filter((event) => event === 'load.done' || event === 'eviction')).toEqual([
      'load.done',
      'eviction',
      'load.done',
      'eviction',
    ]);
    expect(scheduled).toBeDefined();
    expect((await scheduled!.ledger.list()).map((entry) => entry.key)).toEqual(['game/build']);
    await scheduled!.ledger.delete(['game/build']);

    const emptied = await openDB(context.databaseName, 1);
    expect(await emptied.get('builds', 'game/build')).toBeUndefined();
    emptied.close();
  });

  it('atomically increments the build ledger for concurrent plays', async () => {
    const cachePlan = plan([]);
    const context = setup(cachePlan);
    const options = {
      plan: 'https://game.test/g/game/build/assets/cache-plan.json',
      tier: 'desktop' as const,
      channel: 'published' as const,
      send: context.send,
    };

    await Promise.all([prepare(options, context), prepare(options, context)]);

    const database = await openDB(context.databaseName, 1);
    const row = (await database.get('builds', 'game/build')) as LedgerBuild;
    database.close();
    expect(row.plays).toBe(2);
  });

  it('requests persistence once per partition and skips a Gecko prompt', async () => {
    const cachePlan = plan([]);
    const sharedLocalStorage = new Map<string, string>();
    const first = setup(cachePlan);
    const second = setup(cachePlan);
    first.localStorage = sharedLocalStorage;
    second.localStorage = sharedLocalStorage;

    const options = {
      plan: 'https://game.test/g/game/build/assets/cache-plan.json',
      tier: 'desktop' as const,
      send: first.send,
    };
    await prepare(options, first);
    await prepare({ ...options, send: second.send }, second);
    await vi.waitFor(() => expect(first.storage.persist).toHaveBeenCalledOnce());
    expect(first.storage.persist).toHaveBeenCalledOnce();
    expect(second.storage.persist).not.toHaveBeenCalled();

    const gecko = setup(cachePlan);
    gecko.permissions = { query: vi.fn(async () => ({ state: 'prompt' })) };
    gecko.userAgent = 'Mozilla/5.0 Gecko/20100101 Firefox/145.0';
    await prepare({ ...options, send: gecko.send }, gecko);
    expect(gecko.storage.persist).not.toHaveBeenCalled();
  });
});
