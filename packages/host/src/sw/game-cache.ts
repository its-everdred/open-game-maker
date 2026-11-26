// Build access can change after a release. A network request must reach the games host on every load, including
// requests for shared content-addressed files, so an old cache entry cannot bypass the current access policy.
export const RETIRED = ['gm-assets', 'gm-pages', 'gm-blobs-v1', 'gm-builds-v1'] as const;

interface ExtendableEventLike extends Event {
  waitUntil(promise: Promise<unknown>): void;
}

interface FetchEventLike extends ExtendableEventLike {
  request: Request;
  respondWith(response: Promise<Response>): void;
}

export function needsAccessCheck(request: Request, origin: string): boolean {
  const url = new URL(request.url);
  return (
    request.method === 'GET' && url.origin === origin && (/^\/g\//u.test(url.pathname) || /^\/a\//u.test(url.pathname))
  );
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
    if (needsAccessCheck(event.request, worker.location.origin)) {
      event.respondWith(fetch(new Request(event.request, { cache: 'no-store' })));
    }
  }) as (event: never) => void);
}

export async function retireCaches(cacheStorage: CacheStorage): Promise<void> {
  await Promise.all(RETIRED.map((name) => cacheStorage.delete(name).catch(() => false)));
}
