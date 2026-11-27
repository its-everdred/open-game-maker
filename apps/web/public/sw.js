// Two caches keep app code deploy-specific while durable art survives deploys.
const BUILD = '__BUILD__',
  CACHE = 'ogm-' + BUILD,
  ASSETS = 'ogm-assets';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('ogm-') && !key.startsWith('ogm-proto-') && key !== CACHE && key !== ASSETS)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== 'GET' ||
    url.origin !== location.origin ||
    url.pathname.endsWith('/sw.js') ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/auth/') ||
    url.searchParams.has('ogm-version')
  ) {
    return;
  }

  const fresh = () =>
    fetch(request.mode === 'navigate' ? request.url : request, {
      cache: 'no-cache',
    });
  const keep = async (response) => {
    if (response.ok && response.type === 'basic') {
      const cache = await caches.open(CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  };

  if (request.mode === 'navigate') {
    event.respondWith(
      fresh()
        .then(keep)
        .catch(() => caches.match(request)),
    );
    return;
  }

  if (/\/(town\/models|art)\//.test(url.pathname) && !url.pathname.includes('/bake/')) {
    const assetCache = caches.open(ASSETS);
    const network = assetCache.then(async (cache) => {
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') {
        await cache.put(request, response.clone());
      }
      return response;
    });
    event.waitUntil(network.catch(() => undefined));
    event.respondWith(assetCache.then((cache) => cache.match(request)).then((hit) => hit || network));
    return;
  }

  event.respondWith(caches.match(request, { ignoreSearch: false }).then((hit) => hit || fresh().then(keep)));
});

self.addEventListener('push', (event) => {
  const payload = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(payload.title ?? 'Open Game Maker', {
      body: payload.body,
      ...(payload.id ? { tag: payload.id } : {}),
      data: { url: payload.url ?? '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(event.notification.data?.url ?? '/'));
});
