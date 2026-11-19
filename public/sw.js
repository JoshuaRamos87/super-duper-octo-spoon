const APP_CACHE = 'clipshrink-app-v2';
const WASM_CACHE = 'clipshrink-wasm-v2';
const ACTIVE_CACHES = new Set([APP_CACHE, WASM_CACHE]);

function withCoiHeaders(response) {
  if (
    !response ||
    response.status === 0 ||
    response.status === 204 ||
    response.status === 205 ||
    response.status === 304
  ) {
    return response;
  }

  const newHeaders = new Headers(response.headers);
  newHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');
  newHeaders.set('Cross-Origin-Embedder-Policy', 'require-corp');
  newHeaders.set('Cross-Origin-Resource-Policy', 'cross-origin');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => !ACTIVE_CACHES.has(key))
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
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const scopeUrl = new URL(self.registration.scope);
  const basePath = scopeUrl.pathname.endsWith('/')
    ? scopeUrl.pathname
    : `${scopeUrl.pathname}/`;

  // 1. Cache-first for FFmpeg ST (/ffmpeg/) and MT (/ffmpeg-mt/) WASM & worker/core scripts
  if (
    url.pathname.startsWith(`${basePath}ffmpeg/`) ||
    url.pathname.startsWith(`${basePath}ffmpeg-mt/`)
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(WASM_CACHE);
        const cached = await cache.match(request);
        if (cached) return withCoiHeaders(cached);

        const response = await fetch(request);
        if (!response.ok) return response;

        const coiResponse = withCoiHeaders(response);
        cache.put(request, coiResponse.clone()).catch(() => {});
        return coiResponse;
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
        if (cached) return withCoiHeaders(cached);

        const response = await fetch(request);
        if (!response.ok) return response;

        const coiResponse = withCoiHeaders(response);
        cache.put(request, coiResponse.clone()).catch(() => {});
        return coiResponse;
      })()
    );
    return;
  }

  // 3. Network-first with cache fallback + COI headers for HTML navigation requests
  if (
    request.mode === 'navigate' ||
    url.pathname === basePath ||
    url.pathname === `${basePath}index.html`
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(APP_CACHE);
        try {
          const response = await fetch(request);
          if (response.ok) {
            const coiResponse = withCoiHeaders(response);
            cache.put(request, coiResponse.clone()).catch(() => {});
            return coiResponse;
          }
          return withCoiHeaders(response);
        } catch {
          const cached = await cache.match(request);
          if (cached) return withCoiHeaders(cached);
          const fallback = await cache.match(`${basePath}index.html`);
          return fallback ? withCoiHeaders(fallback) : Response.error();
        }
      })()
    );
    return;
  }

  // 4. Default same-origin GET: ensure COI headers are preserved
  event.respondWith(
    fetch(request).then((response) => withCoiHeaders(response))
  );
});
