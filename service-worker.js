/*
 * Service worker: keeps a copy of the app on the phone so it works offline.
 * It only serves this app's own files. It never sends anything anywhere.
 *
 * When you change anything in the app (for example the numbers in DOSE_PLAN),
 * change CACHE_VERSION below (v1 → v2 → v3 …) or phones will keep the old version.
 */
const CACHE_VERSION = 'v9';
const CACHE_NAME = 'insulin-dose-' + CACHE_VERSION;

const APP_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // cache: 'reload' skips the browser's own cache so the newest files are saved
      cache.addAll(APP_FILES.map((url) => new Request(url, { cache: 'reload' })))
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('insulin-dose-') && k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// The page asks for this when a new version is ready and it is safe to switch
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      caches.open(CACHE_NAME)
        .then((cache) => cache.match('./index.html'))
        .then((cached) => cached || fetch(request))
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME)
      .then((cache) => cache.match(request, { ignoreSearch: true }))
      .then((cached) => cached || fetch(request))
  );
});
