'use strict';

// Offline support for a hosted (HTTPS) copy: the app's own files are fetched fresh when online
// and served from this cache when the phone has no signal. Estimate data lives in IndexedDB,
// not here, so updating this cache never touches saved estimates.
const CACHE = 'apex-chimney-v6';
const SHELL = [
  './', './index.html', './styles.css', './manifest.webmanifest', './icon.svg',
  './js/util.js', './js/db.js', './js/seed.js', './js/photos.js', './js/sizes.js', './js/store.js', './js/generate.js',
  './js/customer.js', './js/pdf.js', './js/private.js', './js/ai.js', './js/app.js',
  './js/views/estimates.js', './js/views/identify.js', './js/views/wizard.js', './js/views/editor.js',
  './js/views/preview.js', './js/views/catalog.js', './js/views/settings.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Network first (so updates arrive right away), cache as the offline fallback.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const cacheable = e.request.method === 'GET'
    && url.origin === location.origin;
  if (!cacheable) return;
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(hit => hit || caches.match('./index.html'))));
});
