const CACHE_NAME = 'atlas-v5';

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/app.css?v=2',
  './src/app.js',
  './icons/icon-source.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './fonts/lexend-400.woff2',
  './fonts/lexend-700.woff2',
  './licenses/Lexend-OFL.txt',
  './docs/README-KO.md',
  './docs/USER-GUIDE-KO.md',
  './docs/TEST-REPORT.md',
  './docs/GITHUB-PAGES-KO.md',
  '../shared/v1/sync.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => Promise.all(
      PRECACHE_URLS.map((url) => cache.add(url).catch(() => null))
    )).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name.startsWith('atlas-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const requestUrl = new URL(request.url);
  if (requestUrl.hostname === 'api.github.com') return;
  if (requestUrl.origin !== self.location.origin) return;

  const scopeUrl = new URL(self.registration.scope);
  const sharedModuleUrl = new URL('../shared/v1/sync.js', scopeUrl).href;
  const isAtlasRequest = requestUrl.pathname.startsWith(scopeUrl.pathname);
  if (!isAtlasRequest && requestUrl.href !== sharedModuleUrl) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        if (!response || !response.ok) return response;
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => null);
        return response;
      });
    })
  );
});
