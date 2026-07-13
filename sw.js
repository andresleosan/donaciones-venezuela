// Cascarón PWA y respaldo offline. Los datos privados no se almacenan aquí:
// las lecturas públicas se guardan en IndexedDB desde services/api.js.
const VERSION = '57';
const CACHE = 'ayuda-ve-v' + VERSION;
const OFFLINE_URL = '/offline.html';
const ESTATICOS = [
  '/', '/index.html', '/ventana.html', OFFLINE_URL, '/manifest.json',
  '/css/app.css?v=50',
  '/js/pwa.js?v=50', '/js/core.js?v=50', '/js/wiz.js?v=50',
  '/js/vistas.js?v=50', '/js/panel.js?v=50', '/js/admin.js?v=50', '/js/ventana.js?v=50',
  '/services/api.js?v=7', '/services/leaflet/leaflet.css', '/services/leaflet/leaflet.js',
  '/locales/es.json', '/locales/en.json',
  '/assets/fonts/inter-var.woff2',
  '/assets/icons/icon-192.png', '/assets/icons/icon-512.png',
  '/assets/icons/icon-maskable-512.png', '/assets/icons/favicon-32x32.png'
];

function esRecursoFresco(url) {
  return url.pathname.startsWith('/locales/') || url.pathname === '/manifest.json';
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ESTATICOS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

async function responderNavegacion(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (_) {
    const cache = await caches.open(CACHE);
    return (await cache.match(request)) || (await cache.match('/')) ||
      (await cache.match('/index.html')) || (await cache.match(OFFLINE_URL));
  }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(responderNavegacion(event.request));
    return;
  }
  if (esRecursoFresco(url)) {
    event.respondWith(
      fetch(event.request).then(async (response) => {
        if (response.ok) (await caches.open(CACHE)).put(event.request, response.clone());
        return response;
      }).catch(() => caches.match(event.request))
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then((hit) => hit || fetch(event.request).then(async (response) => {
      if (response.ok) (await caches.open(CACHE)).put(event.request, response.clone());
      return response;
    }))
  );
});

function avisarSincronizacion() {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then((clients) => clients.forEach((client) => client.postMessage({ type: 'dv-sync' })));
}

self.addEventListener('sync', (event) => {
  if (event.tag === 'dv-outbox') event.waitUntil(avisarSincronizacion());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'flush-queue') event.waitUntil(avisarSincronizacion());
});
