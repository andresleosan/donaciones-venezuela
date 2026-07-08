// Service worker: cache del cascarón estático para uso offline.
// Los datos (Supabase) NUNCA se cachean. Los locales van network-first
// (se actualizan seguido; nunca deben quedar viejos). Una sola VERSION
// controla el nombre de caché y las URLs versionadas — súbela por release.
const VERSION = '19';
const CACHE = 'ayuda-ve-v' + VERSION;
const ESTATICOS = [
  '/',
  '/ventana.html',
  '/css/app.css?v=11',
  '/js/core.js?v=' + VERSION,
  '/js/vistas.js?v=' + VERSION,
  '/js/panel.js?v=' + VERSION,
  '/js/admin.js?v=' + VERSION,
  '/js/ventana.js?v=' + VERSION,
  '/services/api.js?v=5',
  '/assets/fonts/inter-var.woff2',
  '/assets/icons/icon-192.png',
  '/assets/icons/favicon-32x32.png'
];

// Recursos que deben estar siempre frescos: se sirven de red y solo caen
// a caché si no hay conexión.
function esFresco(url) {
  return url.pathname.startsWith('/locales/') || url.pathname === '/manifest.json';
}

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(ESTATICOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (ev) => {
  const url = new URL(ev.request.url);
  if (ev.request.method !== 'GET' || url.origin !== self.location.origin) return; // Supabase y POSTs pasan directo

  if (ev.request.mode === 'navigate') {
    ev.respondWith(fetch(ev.request).catch(() => caches.match('/')));
    return;
  }

  if (esFresco(url)) {
    // Network-first: locales siempre al día; caché solo como respaldo offline
    ev.respondWith(
      fetch(ev.request).then((resp) => {
        if (resp.ok) { const copia = resp.clone(); caches.open(CACHE).then((c) => c.put(ev.request, copia)); }
        return resp;
      }).catch(() => caches.match(ev.request))
    );
    return;
  }

  // Estáticos versionados: caché primero
  ev.respondWith(
    caches.match(ev.request).then((hit) => hit || fetch(ev.request).then((resp) => {
      if (resp.ok) { const copia = resp.clone(); caches.open(CACHE).then((c) => c.put(ev.request, copia)); }
      return resp;
    }))
  );
});
