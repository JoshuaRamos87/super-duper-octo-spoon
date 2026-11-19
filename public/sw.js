const APP_CACHE = 'clipshrink-app-v1';
const WASM_CACHE = 'clipshrink-wasm-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== APP_CACHE && key !== WASM_CACHE)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (data && data.type === 'CLEAR_WASM_CACHE') {
    event.waitUntil(
      caches.delete(WASM_CACHE).then(() => {
        if (event.ports && event.ports[0]) {
          event.ports[0].postMessage({ cleared: true });
        }
      })
    );
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const scopeUrl = new URL(self.registration.scope);
  const basePath = scopeUrl.pathname.endsWith('/')
    ? scopeUrl.pathname
    : `${scopeUrl.pathname}/`;

  // 1. Cache-first for FFmpeg WASM & worker/core scripts
  if (url.pathname.startsWith(`${basePath}ffmpeg/`)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(WASM_CACHE);
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) {
          cache.put(request, response.clone()).catch(() => {});
        }
        return response;
      })()
    );
    return;
  }

  // 2. Cache-first for Vite hashed static assets & static icons/manifest
  if (
    url.pathname.startsWith(`${basePath}assets/`) ||
    url.pathname === `${basePath}icon.svg` ||
    url.pathname === `${basePath}manifest.webmanifest`
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(APP_CACHE);
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) {
          cache.put(request, response.clone()).catch(() => {});
        }
        return response;
      })()
    );
    return;
  }

  // 3. Network-first with cache fallback for HTML navigation requests
  if (request.mode === 'navigate' || url.pathname === basePath || url.pathname === `${basePath}index.html`) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(APP_CACHE);
        try {
          const response = await fetch(request);
          if (response.ok) {
            cache.put(request, response.clone()).catch(() => {});
          }
          return response;
        } catch {
          const cached = await cache.match(request);
          if (cached) return cached;
          return (await cache.match(`${basePath}index.html`)) || Response.error();
        }
      })()
    );
  }
});
