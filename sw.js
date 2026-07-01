const CACHE_NAME = 'ayuda-ve-v2';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './services/leaflet/leaflet.css',
  './services/leaflet/leaflet.js',
  './services/leaflet/images/marker-icon.png',
  './services/leaflet/images/marker-icon-2x.png',
  './services/leaflet/images/marker-shadow.png',
  './assets/icons/icon-192.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Para las peticiones al Apps Script, aplicamos Network First
  if (event.request.url.includes('script.google.com')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        // La propia aplicación maneja el fallback a localStorage, 
        // así que el SW simplemente dejará que falle si no hay red, 
        // o podríamos devolver un JSON vacío para evitar el error de red brusco.
        return new Response(JSON.stringify({ error: "offline" }), {
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // Para Nominatim y mapas, Network First
  if (event.request.url.includes('openstreetmap.org')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match(event.request);
      })
    );
    return;
  }

  // Para el resto (HTML, CSS, JS locales), Cache First o Stale-while-revalidate
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Hacemos fetch en background para actualizar (Stale-while-revalidate)
        event.waitUntil(
          fetch(event.request).then((networkResponse) => {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, networkResponse.clone());
            });
          }).catch(() => {})
        );
        return cachedResponse;
      }
      return fetch(event.request);
    })
  );
});
