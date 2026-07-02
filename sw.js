// Service worker: cache de assets estáticos para uso offline del cascarón.
// Los datos (Supabase) NUNCA se cachean: la app exige información en vivo.
const CACHE = 'ayuda-ve-v2';
const ESTATICOS = [
  '/',
  '/css/app.css?v=4',
  '/js/app.js?v=4',
  '/services/api.js?v=3',
  '/locales/es.json',
  '/locales/en.json',
  '/locales/fr.json',
  '/assets/fonts/inter-var.woff2',
  '/assets/icons/icon-192.png',
  '/assets/icons/favicon-32x32.png'
];

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
    // HTML: red primero, cascarón cacheado si no hay conexión
    ev.respondWith(fetch(ev.request).catch(() => caches.match('/')));
    return;
  }
  // Estáticos: caché primero (las URLs van versionadas con ?v=)
  ev.respondWith(
    caches.match(ev.request).then((hit) => hit || fetch(ev.request).then((resp) => {
      if (resp.ok) {
        const copia = resp.clone();
        caches.open(CACHE).then((c) => c.put(ev.request, copia));
      }
      return resp;
    }))
  );
});
