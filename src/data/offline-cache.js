// Caché offline y cola de salida (outbox) en IndexedDB.
//
// Extraído de `services/api.js` sin cambios de comportamiento: mismos nombres de
// base, almacenes y versión, misma política de descarte y el mismo evento
// `dv-offline-change` que escucha `js/pwa.js`. Lo único que cambia es que el
// envío deja de estar cableado a un backend concreto: `enviarConCola` y
// `flushQueue` reciben la función `enviar(payload)` que hace la petición real
// (hoy `src/data/api-client.js`), para que la fachada decida el transporte.
//
// La cola parte cerrada: solo admite acciones declaradas seguras e idempotentes
// por `window.DVOfflinePolicy` (`services/offline-queue-policy.js`), que se carga
// como script clásico antes que este módulo.

export const OFFLINE_DB = 'donaciones-venezuela-offline-v1';
export const OFFLINE_DB_VERSION = 1;
export const OFFLINE_QUEUE = 'outbox';
export const OFFLINE_CACHE = 'snapshots';

let dbPromise = null;
let flushing = null;

// Mismo patrón que js/pwa.js: el texto sale del idioma activo; el respaldo solo
// se usa si core.js aún no ha cargado las traducciones.
function traducir(clave, respaldo) {
  return typeof globalThis.t === 'function' ? globalThis.t(clave) : respaldo;
}

function politica() {
  return globalThis.DVOfflinePolicy;
}

function tieneIndexedDb() {
  return typeof globalThis !== 'undefined' && 'indexedDB' in globalThis;
}

export function abrirDb() {
  if (!tieneIndexedDb()) return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    const request = globalThis.indexedDB.open(OFFLINE_DB, OFFLINE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OFFLINE_QUEUE)) {
        db.createObjectStore(OFFLINE_QUEUE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(OFFLINE_CACHE)) {
        db.createObjectStore(OFFLINE_CACHE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return dbPromise;
}

export function transaccion(store, mode, operation) {
  return abrirDb().then((db) => new Promise((resolve) => {
    if (!db) return resolve(null);
    try {
      const tx = db.transaction(store, mode);
      const request = operation(tx.objectStore(store));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch (_) { resolve(null); }
  }));
}

export function guardarSnapshot(key, value) {
  return transaccion(OFFLINE_CACHE, 'readwrite', (store) => store.put({ key, value, savedAt: Date.now() }));
}

export function leerSnapshot(key) {
  return transaccion(OFFLINE_CACHE, 'readonly', (store) => store.get(key)).then((row) => row && row.value);
}

export function contarCola() {
  return transaccion(OFFLINE_QUEUE, 'readonly', (store) => store.count()).then((count) => Number(count || 0));
}

function emitirCambioCola() {
  return contarCola().then((count) => {
    globalThis.dispatchEvent(new CustomEvent('dv-offline-change', { detail: { count } }));
    return count;
  });
}

export function esAccionOffline(payload) {
  const reglas = politica();
  return Boolean(reglas && reglas.isQueueable(payload));
}

export function esErrorDeRed(err) {
  if (!err) return false;
  if (err.name === 'AbortError' || err.name === 'TypeError' || err.name === 'NetworkError') return true;
  return /failed to fetch|network|offline|load failed|fetch/i.test(String(err.message || err));
}

function registrarSync() {
  const sw = globalThis.navigator && globalThis.navigator.serviceWorker;
  if (!sw || !sw.ready) return;
  sw.ready.then((registration) => {
    if (registration.sync && typeof registration.sync.register === 'function') {
      return registration.sync.register('dv-outbox');
    }
    return null;
  }).catch(() => {});
}

export async function encolar(payload) {
  const reglas = politica();
  if (!reglas) throw new Error('offline-policy-unavailable');
  const row = reglas.createQueueEntry(payload);
  const saved = await transaccion(OFFLINE_QUEUE, 'readwrite', (store) => store.put(row));
  if (!saved) throw new Error(traducir('messages.offlineQueueError', 'No se pudo guardar el formulario sin conexión'));
  registrarSync();
  await emitirCambioCola();
  return {
    success: true,
    queued: true,
    queueId: row.queueId,
    token: 'PENDIENTE-' + row.queueId.slice(-6).toUpperCase()
  };
}

export async function clearOfflineQueue() {
  await transaccion(OFFLINE_QUEUE, 'readwrite', (store) => store.clear());
  return emitirCambioCola();
}

async function depurarCola(rows) {
  const reglas = politica();
  for (const row of rows) {
    if (!esAccionOffline(row.payload) || reglas.shouldDiscard(row)) {
      await transaccion(OFFLINE_QUEUE, 'readwrite', (store) => store.delete(row.id));
    }
  }
}

// Equivalente al `post()` del legado: offline declarado o fallo de red encolan la
// acción si la política la admite; en cualquier otro caso el error sube tal cual.
export async function enviarConCola(payload, enviar) {
  const data = payload || {};
  if (globalThis.navigator.onLine === false && esAccionOffline(data)) return encolar(data);
  try {
    return await enviar(data);
  } catch (err) {
    if (esAccionOffline(data) && esErrorDeRed(err)) return encolar(data);
    throw err;
  }
}

export async function flushQueue(enviar) {
  if (flushing) return flushing;
  if (globalThis.navigator.onLine === false) return { sent: 0, pending: await contarCola() };
  flushing = (async () => {
    let sent = 0;
    const db = await abrirDb();
    if (!db) return { sent, pending: 0 };
    const reglas = politica();
    const rows = await transaccion(OFFLINE_QUEUE, 'readonly', (store) => store.getAll()) || [];
    rows.sort((a, b) => a.createdAt - b.createdAt);
    await depurarCola(rows);
    const pendingRows = rows.filter((row) => esAccionOffline(row.payload) && !reglas.shouldDiscard(row));
    for (const row of pendingRows) {
      try {
        await enviar(row.payload);
        await transaccion(OFFLINE_QUEUE, 'readwrite', (store) => store.delete(row.id));
        sent += 1;
      } catch (err) {
        const failed = reglas.recordFailure(row, err.name || 'request-failed');
        if (reglas.shouldDiscard(failed)) {
          await transaccion(OFFLINE_QUEUE, 'readwrite', (store) => store.delete(row.id));
        } else {
          await transaccion(OFFLINE_QUEUE, 'readwrite', (store) => store.put(failed));
        }
        if (esErrorDeRed(err)) break;
      }
    }
    const pending = await emitirCambioCola();
    return { sent, pending };
  })().finally(() => { flushing = null; });
  return flushing;
}

// Mismos tres disparadores que el legado: volver a estar online, el mensaje
// `dv-sync` del service worker (sw.js) y un intento 1,2 s tras la carga.
export function iniciarSincronizacion(enviar) {
  globalThis.addEventListener('online', () => flushQueue(enviar));
  if (globalThis.navigator.serviceWorker) {
    globalThis.navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'dv-sync') flushQueue(enviar);
    });
  }
  globalThis.setTimeout(() => flushQueue(enviar), 1200);
}
