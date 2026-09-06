import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as cache from '../../src/data/offline-cache.js';

// Política permisiva para probar la mecánica de la cola: la real
// (`services/offline-queue-policy.js`) tiene la allowlist vacía a propósito, así
// que hoy ninguna acción se encola. Ver `tests/offline-queue-policy.test.js`.
function politicaDePrueba(permitidas = ['public_ping']) {
  let contador = 0;
  return {
    isQueueable: (payload) => Boolean(payload) && permitidas.includes(String(payload.accion || '')),
    createQueueEntry: (payload) => {
      // Misma guarda que la política real: la entrada nunca se crea sin permiso.
      if (!permitidas.includes(String(payload?.accion || ''))) {
        throw new Error('offline-payload-not-allowed');
      }
      contador += 1;
      const id = `queue-${contador}`;
      return {
        id,
        queueId: id,
        idempotencyKey: id,
        payload,
        createdAt: contador,
        expiresAt: Date.now() + 86400000,
        attempts: 0,
        lastErrorCode: '',
      };
    },
    recordFailure: (row, code) => ({ ...row, attempts: Number(row.attempts || 0) + 1, lastErrorCode: code }),
    shouldDiscard: (row) => Number(row?.attempts || 0) >= 3 || Number(row?.expiresAt || 0) <= Date.now(),
  };
}

// `deleteDatabase` se queda bloqueado mientras el módulo mantiene su conexión
// abierta, así que entre pruebas se vacían los almacenes desde otra conexión.
async function vaciarAlmacenes() {
  const db = await new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(cache.OFFLINE_DB, cache.OFFLINE_DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(cache.OFFLINE_QUEUE, { keyPath: 'id' });
      request.result.createObjectStore(cache.OFFLINE_CACHE, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise((resolve, reject) => {
    const tx = db.transaction([cache.OFFLINE_QUEUE, cache.OFFLINE_CACHE], 'readwrite');
    tx.objectStore(cache.OFFLINE_QUEUE).clear();
    tx.objectStore(cache.OFFLINE_CACHE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

beforeEach(async () => {
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
  globalThis.addEventListener = vi.fn();
  globalThis.dispatchEvent = vi.fn();
  globalThis.DVOfflinePolicy = politicaDePrueba();
  await vaciarAlmacenes();
});

afterEach(() => {
  delete globalThis.navigator;
  delete globalThis.addEventListener;
  delete globalThis.dispatchEvent;
  delete globalThis.DVOfflinePolicy;
  vi.useRealTimers();
});

describe('snapshots', () => {
  it('guarda y relee un snapshot por clave', async () => {
    await cache.guardarSnapshot('all', { lugares: [{ id: 'l1' }] });

    await expect(cache.leerSnapshot('all')).resolves.toEqual({ lugares: [{ id: 'l1' }] });
  });

  it('devuelve undefined cuando la clave no existe', async () => {
    await expect(cache.leerSnapshot('list:lugaresPublicos:')).resolves.toBeUndefined();
  });
});

describe('esErrorDeRed', () => {
  it('reconoce abortos, TypeError y mensajes de red', () => {
    expect(cache.esErrorDeRed(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe(true);
    expect(cache.esErrorDeRed(Object.assign(new Error('x'), { name: 'TypeError' }))).toBe(true);
    expect(cache.esErrorDeRed(new Error('Failed to fetch'))).toBe(true);
    expect(cache.esErrorDeRed(new Error('Load failed'))).toBe(true);
  });

  it('no confunde un error de negocio con un fallo de red', () => {
    expect(cache.esErrorDeRed(new Error('Insumo no encontrado'))).toBe(false);
    expect(cache.esErrorDeRed(null)).toBe(false);
  });
});

describe('encolar', () => {
  it('rechaza una acción fuera de la allowlist', async () => {
    await expect(cache.encolar({ accion: 'reportar_persona', documento: 'V-1' })).rejects.toThrow();
    await expect(cache.contarCola()).resolves.toBe(0);
  });

  it('devuelve el acuse PENDIENTE- y emite dv-offline-change', async () => {
    const resultado = await cache.encolar({ accion: 'public_ping' });

    expect(resultado).toMatchObject({
      success: true,
      queued: true,
      queueId: 'queue-1',
      token: 'PENDIENTE-UEUE-1',
    });
    const evento = globalThis.dispatchEvent.mock.calls.at(-1)[0];
    expect(evento.type).toBe('dv-offline-change');
    expect(evento.detail).toEqual({ count: 1 });
  });

  it('falla si la política no está cargada', async () => {
    delete globalThis.DVOfflinePolicy;

    await expect(cache.encolar({ accion: 'public_ping' })).rejects.toThrow('offline-policy-unavailable');
  });
});

describe('enviarConCola', () => {
  it('encola sin llamar a la red cuando el navegador está offline', async () => {
    globalThis.navigator.onLine = false;
    const enviar = vi.fn();

    await expect(cache.enviarConCola({ accion: 'public_ping' }, enviar))
      .resolves.toMatchObject({ queued: true });
    expect(enviar).not.toHaveBeenCalled();
  });

  it('propaga el error cuando la acción no es encolable estando offline', async () => {
    globalThis.navigator.onLine = false;
    const enviar = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'TypeError' }));

    await expect(cache.enviarConCola({ accion: 'reportar_persona' }, enviar)).rejects.toThrow();
    await expect(cache.contarCola()).resolves.toBe(0);
  });

  it('encola tras un fallo de red y devuelve la respuesta viva si la red responde', async () => {
    const enviar = vi.fn().mockResolvedValue({ success: true, id: 'x1' });
    await expect(cache.enviarConCola({ accion: 'public_ping' }, enviar))
      .resolves.toEqual({ success: true, id: 'x1' });

    enviar.mockRejectedValue(new Error('Failed to fetch'));
    await expect(cache.enviarConCola({ accion: 'public_ping' }, enviar))
      .resolves.toMatchObject({ queued: true });
    await expect(cache.contarCola()).resolves.toBe(1);
  });

  it('no encola un error de negocio', async () => {
    const enviar = vi.fn().mockRejectedValue(new Error('Insumo no encontrado'));

    await expect(cache.enviarConCola({ accion: 'public_ping' }, enviar))
      .rejects.toThrow('Insumo no encontrado');
    await expect(cache.contarCola()).resolves.toBe(0);
  });
});

describe('flushQueue', () => {
  it('no toca la red estando offline y reporta lo pendiente', async () => {
    globalThis.navigator.onLine = false;
    await cache.encolar({ accion: 'public_ping' });
    const enviar = vi.fn();

    await expect(cache.flushQueue(enviar)).resolves.toEqual({ sent: 0, pending: 1 });
    expect(enviar).not.toHaveBeenCalled();
  });

  it('envía en orden de creación y borra lo entregado', async () => {
    await cache.encolar({ accion: 'public_ping', n: 1 });
    await cache.encolar({ accion: 'public_ping', n: 2 });
    const enviar = vi.fn().mockResolvedValue({ success: true });

    await expect(cache.flushQueue(enviar)).resolves.toEqual({ sent: 2, pending: 0 });
    expect(enviar.mock.calls.map(([payload]) => payload.n)).toEqual([1, 2]);
  });

  it('purga entradas que ya no cumplen la política', async () => {
    await cache.encolar({ accion: 'public_ping' });
    globalThis.DVOfflinePolicy = politicaDePrueba([]);
    const enviar = vi.fn();

    await expect(cache.flushQueue(enviar)).resolves.toEqual({ sent: 0, pending: 0 });
    expect(enviar).not.toHaveBeenCalled();
  });

  it('cuenta el fallo y deja la entrada pendiente hasta el tercer intento', async () => {
    await cache.encolar({ accion: 'public_ping' });
    const enviar = vi.fn().mockRejectedValue(new Error('Insumo no encontrado'));

    await expect(cache.flushQueue(enviar)).resolves.toEqual({ sent: 0, pending: 1 });
    await expect(cache.flushQueue(enviar)).resolves.toEqual({ sent: 0, pending: 1 });
    await expect(cache.flushQueue(enviar)).resolves.toEqual({ sent: 0, pending: 0 });
    expect(enviar).toHaveBeenCalledTimes(3);
  });

  it('se detiene en el primer fallo de red y conserva el resto', async () => {
    await cache.encolar({ accion: 'public_ping', n: 1 });
    await cache.encolar({ accion: 'public_ping', n: 2 });
    const enviar = vi.fn().mockRejectedValue(new Error('Failed to fetch'));

    await expect(cache.flushQueue(enviar)).resolves.toEqual({ sent: 0, pending: 2 });
    expect(enviar).toHaveBeenCalledTimes(1);
  });

  it('reutiliza el vaciado en curso en vez de duplicarlo', async () => {
    await cache.encolar({ accion: 'public_ping' });
    let resolver;
    const enviar = vi.fn(() => new Promise((resolve) => { resolver = resolve; }));

    const primera = cache.flushQueue(enviar);
    await vi.waitFor(() => expect(enviar).toHaveBeenCalledTimes(1));
    const segunda = cache.flushQueue(enviar);
    resolver({ success: true });

    await expect(Promise.all([primera, segunda]))
      .resolves.toEqual([{ sent: 1, pending: 0 }, { sent: 1, pending: 0 }]);
    expect(enviar).toHaveBeenCalledTimes(1);
  });
});

describe('clearOfflineQueue', () => {
  it('vacía la cola completa para el cierre de sesión', async () => {
    await cache.encolar({ accion: 'public_ping' });

    await expect(cache.clearOfflineQueue()).resolves.toBe(0);
    await expect(cache.contarCola()).resolves.toBe(0);
  });
});

describe('iniciarSincronizacion', () => {
  it('engancha online, el mensaje del service worker y el intento diferido', () => {
    vi.useFakeTimers();
    const escuchaSw = vi.fn();
    globalThis.navigator.serviceWorker = { addEventListener: escuchaSw };
    const enviar = vi.fn().mockResolvedValue({ success: true });

    cache.iniciarSincronizacion(enviar);

    expect(globalThis.addEventListener).toHaveBeenCalledWith('online', expect.any(Function));
    expect(escuchaSw).toHaveBeenCalledWith('message', expect.any(Function));
    expect(vi.getTimerCount()).toBe(1);
  });
});
