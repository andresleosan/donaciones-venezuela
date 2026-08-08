import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

async function putLegacyRow(row) {
  await globalThis.SheetsService.getQueueCount();
  await new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open('donaciones-venezuela-offline-v1', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const transaction = request.result.transaction('outbox', 'readwrite');
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => resolve();
      transaction.objectStore('outbox').put(row);
    };
  });
}

beforeEach(async () => {
  vi.resetModules();
  Object.defineProperty(globalThis, 'window', {
    value: globalThis,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: false },
    configurable: true,
  });
  globalThis.addEventListener = vi.fn();
  globalThis.dispatchEvent = vi.fn();
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
  await import('../services/offline-queue-policy.js');
  await import('../services/api.js');
});

afterEach(() => {
  delete globalThis.window;
  delete globalThis.navigator;
  delete globalThis.addEventListener;
  delete globalThis.dispatchEvent;
  delete globalThis.CustomEvent;
  delete globalThis.DVOfflinePolicy;
  delete globalThis.SheetsService;
});

it('no persiste reportes sensibles cuando está offline', async () => {
  await expect(globalThis.SheetsService.post({
    accion: 'reportar_persona',
    documento: 'V-1',
    foto: 'data:image/png;base64,AA',
  })).rejects.toThrow();

  expect(await globalThis.SheetsService.getQueueCount()).toBe(0);
});

it('purga entradas legacy que ya no cumplen la política', async () => {
  await putLegacyRow({
    id: 'legacy-1',
    payload: { accion: 'reportar_persona', documento: 'V-1' },
    createdAt: 1,
    attempts: 0,
  });
  globalThis.navigator.onLine = true;

  const result = await globalThis.SheetsService.flushQueue();

  expect(result).toEqual({ sent: 0, pending: 0 });
  expect(await globalThis.SheetsService.getQueueCount()).toBe(0);
});

it('expone una purga total para el cierre de sesión', async () => {
  await putLegacyRow({
    id: 'legacy-2',
    payload: { accion: 'donar_dinero', monto: 10 },
    createdAt: 1,
    attempts: 0,
  });

  await globalThis.SheetsService.clearOfflineQueue();

  expect(await globalThis.SheetsService.getQueueCount()).toBe(0);
});
