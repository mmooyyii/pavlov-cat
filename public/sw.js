// Minimal offline cache: stale-while-revalidate for GET requests. Serves the
// cached copy instantly (offline-capable after first visit) while refreshing it
// in the background. Asset names are content-hashed by Vite, so we cache by URL
// rather than pre-listing a manifest.
const CACHE = 'pavlov-cat-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || !req.url.startsWith('http')) return;
  event.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(req);
      const network = fetch(req)
        .then(res => {
          if (res && res.status === 200 && res.type === 'basic') cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
