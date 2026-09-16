/**
 * Offline support for menyo lite.
 *
 * The app shell is cached on install so a kiosk keeps taking orders when the
 * venue's Wi-Fi drops. Menus and orders live in localStorage, not here.
 *
 * Bump CACHE whenever a shell file changes so iPads pick up the new version.
 */
const CACHE = 'menyo-lite-v2';

const SHELL = [
  'index.html',
  'css/styles.css',
  'js/app.js',
  'js/admin.js',
  'js/store.js',
  'js/order.js',
  'js/share.js',
  'js/menu-ai.js',
  'js/menu-quality.js',
  'js/qr.js',
  'js/ui.js',
  'js/util.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'sample-menu.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // addAll fails the whole install if one optional file is missing, so add
      // them one at a time and let the misses through.
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never touch the Gemini or relay calls

  // Any in-app URL should boot the shell; the hash router takes it from there.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          cachePut(request, response.clone());
          return response;
        })
        .catch(() => caches.match('index.html').then((cached) => cached || Response.error()))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) cachePut(request, response.clone());
          return response;
        })
        .catch(() => cached || Response.error());
      // Serve from cache immediately, refresh it in the background.
      return cached || network;
    })
  );
});

function cachePut(request, response) {
  caches.open(CACHE).then((cache) => cache.put(request, response)).catch(() => null);
}
