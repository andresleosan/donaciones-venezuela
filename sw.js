// Cascarón PWA y respaldo offline. Los datos privados no se almacenan aquí:
// las lecturas públicas se guardan en IndexedDB desde services/api.js.
const VERSION = '77';
const CACHE = 'ayuda-ve-v' + VERSION;
const OFFLINE_URL = '/offline.html';
// El sufijo sale de VERSION: antes estaba cableado (?v=60) mientras las páginas
// ya pedían ?v=68, así que el precache bajaba archivos que nadie usaba.
const V = '?v=' + VERSION;
// ponytail: aquí solo van URLs que responden 200. NO añadir /donar-dinero ni
// /mi-cuenta (son vistas dentro de index.html: dan 404) ni /ofrecer-insumo (es un
// redirect 307) — un 404 hace que cache.addAll rechace y el install del SW falle
// entero. Esas tres páginas ya quedan cubiertas offline por '/' e '/index.html'.
const ESTATICOS = [
  '/', '/index.html', '/ventana.html', OFFLINE_URL, '/manifest.json',
  '/css/app.css' + V,
  '/js/pwa.js' + V, '/js/core.js' + V, '/js/wiz.js' + V,
  '/js/vistas.js' + V, '/js/panel.js' + V, '/js/admin.js' + V, '/js/ventana.js' + V,
  '/js/viaje.js' + V, '/js/denuncias.js' + V,
  '/services/api.js' + V, '/services/leaflet/leaflet.css', '/services/leaflet/leaflet.js',
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
