import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// Integración de la cola de salida con la política real
// (`services/offline-queue-policy.js`, allowlist vacía a propósito): ninguna
// acción de hoy debe llegar a IndexedDB. La mecánica de la cola con una política
// permisiva se prueba en `tests/data/offline-cache.test.js`.

let cache;

async function putLegacyRow(row) {
  await cache.contarCola();
  await new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open('donaciones-venezuela-offline-v1', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const transaction = request.result.transaction('outbox', 'readwrite');
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => {
        request.result.close();
        resolve();
      };
      transaction.objectStore('outbox').put(row);
    };
  });
}

beforeEach(async () => {
  vi.resetModules();
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: false },
    configurable: true,
  });
  globalThis.addEventListener = vi.fn();
  globalThis.dispatchEvent = vi.fn();
  await import('../services/offline-queue-policy.js');
  cache = await import('../src/data/offline-cache.js');
  await cache.clearOfflineQueue();
});

afterEach(() => {
  delete globalThis.navigator;
  delete globalThis.addEventListener;
  delete globalThis.dispatchEvent;
  delete globalThis.DVOfflinePolicy;
});

it('no persiste reportes sensibles cuando está offline', async () => {
  const enviar = vi.fn().mockRejectedValue(new Error('Failed to fetch'));

  await expect(cache.enviarConCola({
    accion: 'reportar_persona',
    documento: 'V-1',
    foto: 'data:image/png;base64,AA',
  }, enviar)).rejects.toThrow();

  expect(await cache.contarCola()).toBe(0);
});

it('purga entradas legacy que ya no cumplen la política', async () => {
  await putLegacyRow({
    id: 'legacy-1',
    payload: { accion: 'reportar_persona', documento: 'V-1' },
    createdAt: 1,
    attempts: 0,
  });
  globalThis.navigator.onLine = true;
  const enviar = vi.fn();

  const result = await cache.flushQueue(enviar);

  expect(result).toEqual({ sent: 0, pending: 0 });
  expect(enviar).not.toHaveBeenCalled();
  expect(await cache.contarCola()).toBe(0);
});

it('expone una purga total para el cierre de sesión', async () => {
  await putLegacyRow({
    id: 'legacy-2',
    payload: { accion: 'donar_dinero', monto: 10 },
    createdAt: 1,
    attempts: 0,
  });

  await cache.clearOfflineQueue();

  expect(await cache.contarCola()).toBe(0);
});
