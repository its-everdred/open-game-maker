import { cachePlanSchema, type CachePlan, type CachePlanEntry, type Tier } from '@ogm/contracts/assets';
import type { GameToHost } from '@ogm/contracts/bridge';
import { openDB, type DBSchema } from 'idb';

import {
  ASSET_CACHE_NAME,
  CACHE_LOCK_NAME,
  scheduleAssetCacheEviction,
  type CacheEvictionDependencies,
  type CacheEvictionLedger,
} from './evict.js';

export const CACHE_DATABASE_NAME = 'gm-cache';
export { ASSET_CACHE_NAME, CACHE_LOCK_NAME };

const PERSIST_REQUESTED_KEY = 'gm-cache.persist-requested-v1';
const FETCH_CONCURRENCY = 6;
const PROGRESS_INTERVAL_MS = 100;

type LoadEnvelope = Extract<GameToHost, { t: 'load.progress' | 'load.done' }>;
type LoadType = LoadEnvelope['t'];

export type LoadMessage = {
  [Type in LoadType]: {
    t: Type;
    payload: Extract<LoadEnvelope, { t: Type }>['payload'];
  };
}[LoadType];

export type LoadSender = <Type extends LoadType>(
  type: Type,
  payload: Extract<LoadEnvelope, { t: Type }>['payload'],
) => void;

export interface LedgerBuild {
  key: string;
  gameId: string;
  buildId: string;
  channel: 'published' | 'draft' | 'test';
  tier: Tier;
  hashes: string[];
  hashBytes?: Record<string, number>;
  bytes: number;
  firstPlayedAt: number;
  lastPlayedAt: number;
  plays: number;
}

interface CacheDatabase extends DBSchema {
  builds: { key: string; value: LedgerBuild };
}

type LockManagerLike = CacheEvictionDependencies['locks'];

interface StorageManagerLike {
  persisted?(): Promise<boolean>;
  estimate?(): Promise<{ usage?: number; quota?: number }>;
  persist?(): Promise<boolean>;
}

interface PermissionManagerLike {
  query(descriptor: { name: string }): Promise<{ state: string }>;
}

type PartitionStorage = Pick<Storage, 'getItem' | 'setItem'> | Map<string, string>;

export interface PrepareOptions {
  plan: string | URL;
  tier: Tier;
  send: LoadSender;
  channel?: LedgerBuild['channel'];
}

export interface PrepareDependencies {
  fetcher?: typeof globalThis.fetch;
  cacheStorage?: Pick<CacheStorage, 'open'>;
  locks?: LockManagerLike;
  storage?: StorageManagerLike;
  permissions?: PermissionManagerLike;
  localStorage?: PartitionStorage;
  userAgent?: string;
  databaseName?: string;
  now?: () => number;
  dateNow?: () => number;
  evictionScheduler?: (dependencies: CacheEvictionDependencies) => void;
}

export interface PrepareResult {
  plan: CachePlan;
  fetchedBytes: number;
  cachedBytes: number;
  fetchedFiles: number;
  cachedFiles: number;
}

interface PhaseResult {
  fetchedBytes: number;
  cachedBytes: number;
  fetchedFiles: number;
  cachedFiles: number;
}

let persistRequestedWithoutStorage = false;
const activePersistRequests = new WeakSet<object>();

export async function prepare(
  options: PrepareOptions,
  dependencies: PrepareDependencies = {},
): Promise<PrepareResult | undefined> {
  const planUrl = absoluteUrl(options.plan);
  const fetcher = dependencies.fetcher ?? globalThis.fetch;
  const response = await fetcher(planUrl);
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`Failed to load cache plan ${planUrl}: HTTP ${response.status}`);
  if (response.headers.get('content-type')?.toLowerCase().includes('text/html')) return undefined;
  const plan = cachePlanSchema.parse(await response.json());
  const selected = plan.entries.filter(
    (entry) =>
      (entry.tiers.includes('*') || entry.tiers.includes(options.tier)) &&
      (entry.assetPhasesByTier?.[options.tier]?.includes('boot') ?? true),
  );
  const run = async () => {
    const ready = await fetchPhase(
      selected.filter((entry) => entry.phase === 'ready'),
      'ready',
      planUrl,
      options.send,
      dependencies,
    );
    const storage = dependencies.storage ?? defaultStorageManager();
    const persisted = (await storage?.persisted?.().catch(() => null)) ?? null;
    const estimate = await storage?.estimate?.().catch(() => undefined);
    options.send('load.done', {
      ms: Math.max(0, (dependencies.now ?? defaultNow)()),
      fetchedBytes: ready.fetchedBytes,
      cachedBytes: ready.cachedBytes,
      fetchedFiles: ready.fetchedFiles,
      cachedFiles: ready.cachedFiles,
      persisted,
      ...(estimate?.usage === undefined ? {} : { usage: estimate.usage }),
      ...(estimate?.quota === undefined ? {} : { quota: estimate.quota }),
    });

    await recordPlay(plan, options.tier, options.channel ?? 'test', dependencies).catch(() => undefined);
    scheduleEviction(dependencies);
    void requestPersistence(storage, persisted, dependencies);
    return { plan, ...ready };
  };

  const locks = dependencies.locks ?? defaultLockManager();
  const result = await (locks ? locks.request(CACHE_LOCK_NAME, { mode: 'shared' }, run) : run());
  const stream = () =>
    fetchPhase(
      selected.filter((entry) => entry.phase === 'stream'),
      'stream',
      planUrl,
      options.send,
      dependencies,
    );
  void (locks ? locks.request(CACHE_LOCK_NAME, { mode: 'shared' }, stream) : stream()).catch(() => undefined);
  return result;
}

export async function matchCachedAsset(
  url: string,
  cacheStorage: Pick<CacheStorage, 'open'> | undefined = defaultCacheStorage(),
): Promise<Response | undefined> {
  if (!cacheStorage || !isSharedAssetUrl(url)) return undefined;
  try {
    return (await (await cacheStorage.open(ASSET_CACHE_NAME)).match(url)) ?? undefined;
  } catch {
    return undefined;
  }
}

async function fetchPhase(
  entries: CachePlanEntry[],
  phase: 'ready' | 'stream',
  planUrl: string,
  send: LoadSender,
  dependencies: PrepareDependencies,
): Promise<PhaseResult> {
  if (entries.length === 0) return { fetchedBytes: 0, cachedBytes: 0, fetchedFiles: 0, cachedFiles: 0 };
  const cache = await openAssetCache(dependencies.cacheStorage ?? defaultCacheStorage());
  const resolved = entries.map((entry) => ({ entry, url: new URL(entry.url, planUrl).toString() }));
  const cached = await Promise.all(
    resolved.map(async (item) => ({ ...item, hit: cache ? await safeMatch(cache, item.url) : undefined })),
  );
  const hits = cached.filter((item) => item.hit !== undefined);
  const misses = cached.filter((item) => item.hit === undefined);
  const cachedBytes = hits.reduce((sum, item) => sum + item.entry.bytes, 0);
  const total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  let fetchedBytes = 0;
  const progress = createProgressReporter(send, phase, total, cachedBytes, dependencies.now ?? defaultNow);
  progress.update(cachedBytes);

  try {
    await concurrent(misses, FETCH_CONCURRENCY, async ({ entry, url }) => {
      const fetcher = dependencies.fetcher ?? globalThis.fetch;
      const response = await fetcher(url, { priority: phase === 'ready' ? 'high' : 'low' } as RequestInit);
      if (!response.ok) throw new Error(`Failed to fetch cache asset ${url}: HTTP ${response.status}`);
      const cacheWrite = cache ? putAsset(cache, url, response.clone()) : Promise.resolve();
      const byteCount = countResponseBytes(response, (chunkBytes) => {
        fetchedBytes += chunkBytes;
        progress.update(Math.min(total, cachedBytes + fetchedBytes));
      });
      const [counted, cached] = await Promise.allSettled([byteCount, cacheWrite]);
      if (counted.status === 'rejected') throw counted.reason;
      if (cached.status === 'rejected') throw cached.reason;
      if (counted.value === 0 && entry.bytes > 0) {
        progress.update(Math.min(total, cachedBytes + fetchedBytes));
      }
    });
    await progress.finish(total);
  } catch (error) {
    progress.cancel();
    throw error;
  }

  return {
    fetchedBytes,
    cachedBytes,
    fetchedFiles: misses.length,
    cachedFiles: hits.length,
  };
}

async function openAssetCache(cacheStorage: Pick<CacheStorage, 'open'> | undefined): Promise<Cache | undefined> {
  if (!cacheStorage) return undefined;
  try {
    return await cacheStorage.open(ASSET_CACHE_NAME);
  } catch {
    return undefined;
  }
}

async function safeMatch(cache: Cache, url: string): Promise<Response | undefined> {
  try {
    return (await cache.match(url)) ?? undefined;
  } catch {
    return undefined;
  }
}

async function putAsset(cache: Cache, url: string, response: Response): Promise<void> {
  try {
    await cache.put(url, response);
  } catch (error) {
    if (!isQuotaExceeded(error)) throw error;
  }
}

async function countResponseBytes(response: Response, onChunk: (bytes: number) => void): Promise<number> {
  if (!response.body) {
    const bytes = (await response.arrayBuffer()).byteLength;
    onChunk(bytes);
    return bytes;
  }
  const reader = response.body.getReader();
  let total = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    onChunk(next.value.byteLength);
  }
  return total;
}

function createProgressReporter(
  send: LoadSender,
  phase: 'ready' | 'stream',
  total: number,
  cachedBytes: number,
  now: () => number,
) {
  let lastSentAt = Number.NEGATIVE_INFINITY;
  let lastSentLoaded = -1;
  let pendingLoaded: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolvePending: (() => void) | undefined;

  const emit = (loaded: number) => {
    if (loaded === lastSentLoaded) return;
    lastSentLoaded = loaded;
    lastSentAt = now();
    send('load.progress', { phase, loaded, total, cachedBytes });
  };
  const schedule = () => {
    if (timer !== undefined || pendingLoaded === undefined) return;
    const delay = Math.max(0, PROGRESS_INTERVAL_MS - (now() - lastSentAt));
    timer = setTimeout(() => {
      timer = undefined;
      const loaded = pendingLoaded;
      pendingLoaded = undefined;
      if (loaded !== undefined) emit(loaded);
      resolvePending?.();
      resolvePending = undefined;
      if (pendingLoaded !== undefined) schedule();
    }, delay);
  };

  return {
    update(loaded: number) {
      const bounded = Math.max(0, Math.min(total, loaded));
      if (now() - lastSentAt >= PROGRESS_INTERVAL_MS) emit(bounded);
      else {
        pendingLoaded = bounded;
        schedule();
      }
    },
    async finish(loaded: number) {
      this.update(loaded);
      while (timer !== undefined) {
        await new Promise<void>((resolve) => {
          resolvePending = resolve;
        });
      }
      if (lastSentLoaded !== loaded) emit(loaded);
    },
    cancel() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      pendingLoaded = undefined;
      resolvePending?.();
      resolvePending = undefined;
    },
  };
}

async function concurrent<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  let failed = false;
  let firstError: unknown;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        if (failed) return;
        const index = next++;
        const item = items[index];
        if (item === undefined) return;
        try {
          await task(item);
        } catch (error) {
          if (!failed) {
            failed = true;
            firstError = error;
          }
          return;
        }
      }
    }),
  );
  if (failed) throw firstError;
}

async function recordPlay(
  plan: CachePlan,
  tier: Tier,
  channel: LedgerBuild['channel'],
  dependencies: PrepareDependencies,
): Promise<void> {
  if (!plan.gameId || !plan.buildId || typeof indexedDB === 'undefined') return;
  const database = await openCacheDatabase(dependencies.databaseName);
  try {
    const key = `${plan.gameId}/${plan.buildId}`;
    const transaction = database.transaction('builds', 'readwrite');
    const previous = await transaction.store.get(key);
    const playedAt = (dependencies.dateNow ?? Date.now)();
    // Retain lazy hashes too: they may enter the shared cache after prepare has recorded this build.
    const selected = plan.entries.filter((entry) => entry.tiers.includes('*') || entry.tiers.includes(tier));
    await transaction.store.put({
      key,
      gameId: plan.gameId,
      buildId: plan.buildId,
      channel,
      tier,
      hashes: selected.map((entry) => entry.sha256),
      hashBytes: Object.fromEntries(selected.map((entry) => [entry.sha256, entry.bytes])),
      bytes: selected.reduce((sum, entry) => sum + entry.bytes, 0),
      firstPlayedAt: previous?.firstPlayedAt ?? playedAt,
      lastPlayedAt: playedAt,
      plays: (previous?.plays ?? 0) + 1,
    });
    await transaction.done;
  } finally {
    database.close();
  }
}

function openCacheDatabase(databaseName = CACHE_DATABASE_NAME) {
  return openDB<CacheDatabase>(databaseName, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('builds')) db.createObjectStore('builds', { keyPath: 'key' });
    },
  });
}

function evictionLedger(databaseName: string | undefined): CacheEvictionLedger {
  return {
    async list() {
      const database = await openCacheDatabase(databaseName);
      try {
        return await database.getAll('builds');
      } finally {
        database.close();
      }
    },
    async delete(keys) {
      const database = await openCacheDatabase(databaseName);
      try {
        const transaction = database.transaction('builds', 'readwrite');
        await Promise.all(keys.map((key) => transaction.store.delete(key)));
        await transaction.done;
      } finally {
        database.close();
      }
    },
  };
}

function scheduleEviction(dependencies: PrepareDependencies): void {
  const cacheStorage = dependencies.cacheStorage ?? defaultCacheStorage();
  const locks = dependencies.locks ?? defaultLockManager();
  const storage = dependencies.storage ?? defaultStorageManager();
  if (!cacheStorage || !locks || !storage || typeof indexedDB === 'undefined') return;

  const schedule = dependencies.evictionScheduler ?? scheduleAssetCacheEviction;
  schedule({
    ledger: evictionLedger(dependencies.databaseName),
    caches: cacheStorage,
    locks,
    storage: {
      async estimate() {
        return (await storage.estimate?.()) ?? {};
      },
    },
    now: dependencies.dateNow,
  });
}

async function requestPersistence(
  storage: StorageManagerLike | undefined,
  persisted: boolean | null,
  dependencies: PrepareDependencies,
): Promise<void> {
  if (!storage?.persist) return;
  if (persisted) return;
  const partitionStorage = dependencies.localStorage ?? defaultLocalStorage();
  if (readPartitionFlag(partitionStorage)) return;
  if (!partitionStorage && persistRequestedWithoutStorage) return;
  const identity = (partitionStorage ?? storage) as object;
  if (activePersistRequests.has(identity)) return;
  activePersistRequests.add(identity);

  const userAgent = dependencies.userAgent ?? globalThis.navigator?.userAgent ?? '';
  const permissions = dependencies.permissions ?? defaultPermissions();
  if (/Gecko\//.test(userAgent) && /Firefox\//.test(userAgent) && permissions) {
    const permission = await permissions.query({ name: 'persistent-storage' }).catch(() => undefined);
    if (permission?.state === 'prompt') return;
  }

  if (partitionStorage) writePartitionFlag(partitionStorage);
  else persistRequestedWithoutStorage = true;
  await storage.persist().catch(() => false);
}

function readPartitionFlag(storage: PartitionStorage | undefined): boolean {
  try {
    if (!storage) return false;
    return storage instanceof Map
      ? storage.get(PERSIST_REQUESTED_KEY) === '1'
      : storage.getItem(PERSIST_REQUESTED_KEY) === '1';
  } catch {
    return false;
  }
}

function writePartitionFlag(storage: PartitionStorage): void {
  try {
    if (storage instanceof Map) storage.set(PERSIST_REQUESTED_KEY, '1');
    else storage.setItem(PERSIST_REQUESTED_KEY, '1');
  } catch {
    persistRequestedWithoutStorage = true;
  }
}

function absoluteUrl(url: string | URL): string {
  if (url instanceof URL) return url.toString();
  try {
    return new URL(url).toString();
  } catch {
    if (!globalThis.location?.href) throw new TypeError(`Cache plan URL must be absolute outside a browser: ${url}`);
    return new URL(url, globalThis.location.href).toString();
  }
}

function isSharedAssetUrl(url: string): boolean {
  try {
    return new URL(url, globalThis.location?.href).pathname.startsWith('/a/');
  } catch {
    return false;
  }
}

function isQuotaExceeded(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'QuotaExceededError';
}

function defaultNow(): number {
  return globalThis.performance?.now() ?? 0;
}

function defaultCacheStorage(): CacheStorage | undefined {
  return typeof globalThis.caches === 'undefined' ? undefined : globalThis.caches;
}

function defaultLockManager(): LockManagerLike | undefined {
  return globalThis.navigator?.locks as LockManagerLike | undefined;
}

function defaultStorageManager(): StorageManagerLike | undefined {
  return globalThis.navigator?.storage;
}

function defaultPermissions(): PermissionManagerLike | undefined {
  return globalThis.navigator?.permissions as PermissionManagerLike | undefined;
}

function defaultLocalStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}
