export const BLOB_CACHE = 'gm-blobs-v1';
export const BUILD_CACHE = 'gm-builds-v1';
export const RETIRED = ['gm-assets', 'gm-pages'] as const;

export type CacheRoute = { strategy: 'pass' } | { strategy: 'cache-first'; cacheName: string };

export function classifyGameRequest(request: Request, workerOrigin = location.origin): CacheRoute {
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== workerOrigin) return { strategy: 'pass' };
  if (/^\/g\/[^/]+\/(?:pv|preview)-/u.test(url.pathname)) return { strategy: 'pass' };
  if (/^\/a\/[0-9a-f]{64}\.[a-z0-9]+$/.test(url.pathname)) {
    return { strategy: 'cache-first', cacheName: BLOB_CACHE };
  }
  if (/^\/g\/[^/]+\/[^/]+\/.+/.test(url.pathname)) {
    return { strategy: 'cache-first', cacheName: BUILD_CACHE };
  }
  return { strategy: 'pass' };
}

interface ExtendableEventLike extends Event {
  waitUntil(promise: Promise<unknown>): void;
}

interface FetchEventLike extends ExtendableEventLike {
  request: Request;
  respondWith(response: Promise<Response>): void;
}

interface WorkerScopeLike {
  location: Location;
  caches: CacheStorage;
  clients: { claim(): Promise<void> };
  skipWaiting(): Promise<void>;
  addEventListener(type: string, listener: (event: never) => void): void;
}

const worker = globalThis as unknown as WorkerScopeLike;

if (typeof worker.addEventListener === 'function' && 'clients' in worker) {
  worker.addEventListener('install', ((event: ExtendableEventLike) => {
    event.waitUntil(worker.skipWaiting());
  }) as (event: never) => void);
  worker.addEventListener('activate', ((event: ExtendableEventLike) => {
    event.waitUntil(retireCaches(worker.caches).then(() => worker.clients.claim()));
  }) as (event: never) => void);
  worker.addEventListener('fetch', ((event: FetchEventLike) => {
    const route = classifyGameRequest(event.request, worker.location.origin);
    if (route.strategy === 'pass') return;
    event.respondWith(cacheFirst(event.request, route.cacheName, event));
  }) as (event: never) => void);
}

export async function retireCaches(cacheStorage: CacheStorage): Promise<void> {
  await Promise.all(RETIRED.map((name) => cacheStorage.delete(name).catch(() => false)));
}

export async function cacheFirst(
  request: Request,
  cacheName: string,
  lifetime?: Pick<ExtendableEventLike, 'waitUntil'>,
): Promise<Response> {
  let cache: Cache;
  try {
    cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) return cached;
  } catch {
    return fetch(request);
  }

  const response = await fetch(request);
  if (response.ok) {
    const cacheWrite = cache.put(request, response.clone()).catch(() => undefined);
    lifetime?.waitUntil(cacheWrite);
  }
  return response;
}
