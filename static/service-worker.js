const CACHE_NAME = 'wallpaper-generator-v1';
const ASSETS = [
  '/',
  '/static/index.html',
  '/static/css/app.css',
  '/static/js/main.js',
  '/static/js/controls.js',
  '/static/js/state.js',
  '/static/js/utils.js',
  '/static/js/renderer.js',
  '/static/js/presets.js',
  '/static/js/webgl/shaders.js',
  '/static/presets.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.status === 200) {
          const cloned = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, cloned));
        }
        return response;
      });
    })
  );
});
