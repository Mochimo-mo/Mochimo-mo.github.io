// Bump this name when card artwork changes so old images are replaced.
const ART_CACHE = "luna-art-20260930-1";
const ART_PATH = /\/assets\/(?:cardback\.webp|cards\/(?:thumbs\/)?[a-z-]+\.(?:avif|webp))$/;

self.addEventListener("install", event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith("luna-art-") && name !== ART_CACHE).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if(request.method !== "GET" || url.origin !== self.location.origin || !ART_PATH.test(url.pathname)) return;

  event.respondWith((async () => {
    let cache;
    try {
      cache = await caches.open(ART_CACHE);
      const saved = await cache.match(request);
      if(saved) return saved;
    } catch {}

    const response = await fetch(request);
    if(cache && response.ok) {
      try { await cache.put(request, response.clone()); } catch {}
    }
    return response;
  })());
});
