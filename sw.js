// Keeps the app shell available offline, and keeps photos on the device once seen.
// Item data always comes from the network.
// Bump VERSION when shipping changes so phones pick up the new files.
const VERSION = 'v11';
const PHOTO_CACHE = 'photos';
const SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/config.js',
  './js/taxonomy.js',
  './js/image.js',
  './js/color.js',
  './js/importer.js',
  './js/outfit.js',
  './js/demo-data.js',
  './js/store-supabase.js',
  './js/store-local.js',
  './manifest.webmanifest',
  './icons/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== PHOTO_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Photos are signed links whose token changes every time the list loads, but the file at a
// path never changes (each upload gets a new path). So cache by path, ignoring the token.
const isPhoto = (url) => url.pathname.includes('/storage/v1/object/sign/photos/');

async function cachedPhoto(request) {
  const url = new URL(request.url);
  const key = url.origin + url.pathname;
  const cache = await caches.open(PHOTO_CACHE);
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.type !== 'opaque') await cache.put(key, res.clone());
  return res;
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (isPhoto(url)) return e.respondWith(cachedPhoto(e.request));
  if (url.origin !== location.origin) return;

  // Network first for our own files, falling back to the cache when offline.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
