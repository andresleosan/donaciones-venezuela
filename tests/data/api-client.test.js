import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { API_BASE_DESARROLLO, TIMEOUT_MS, apiUrl, post } from '../../src/data/api-client.js';

const BASE = 'http://127.0.0.1:5001/demo/us-east1';

function respuesta(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: () => Promise.resolve(body) };
}

beforeEach(() => {
  globalThis.fetch = vi.fn(() => Promise.resolve(respuesta({ success: true })));
});

afterEach(() => {
  delete globalThis.fetch;
  delete globalThis.DV_ENTORNO;
  vi.useRealTimers();
});

describe('apiUrl', () => {
  it('usa el emulador del proyecto demo cuando no hay base configurada', () => {
    // vitest corre con import.meta.env.DEV activo, igual que `npm run dev`.
    expect(apiUrl()).toBe(`${API_BASE_DESARROLLO}/api`);
  });

  it('respeta la base explícita y le quita las barras finales', () => {
    expect(apiUrl({ apiBase: `${BASE}///` })).toBe(`${BASE}/api`);
  });

  it('toma la base de window.DV_ENTORNO cuando no hay override', () => {
    globalThis.DV_ENTORNO = { apiBase: BASE };
    expect(apiUrl()).toBe(`${BASE}/api`);
  });
});

describe('post', () => {
  it('envía JSON por POST sin Authorization cuando no hay sesión', async () => {
    await post({ accion: 'listar_ofertas' }, { apiBase: BASE });

    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toBe(`${BASE}/api`);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({ accion: 'listar_ofertas' });
  });

  it('adjunta Bearer solo si hay idToken', async () => {
    await post({ accion: 'panel_ver' }, { apiBase: BASE, idToken: 'id-token-123' });

    const [, init] = globalThis.fetch.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer id-token-123');
  });

  it('devuelve el JSON crudo de la acción', async () => {
    globalThis.fetch.mockResolvedValue(respuesta({ success: true, token: 'ABCD-EFGH-IJKL' }));

    await expect(post({ accion: 'donar_dinero' }, { apiBase: BASE }))
      .resolves.toEqual({ success: true, token: 'ABCD-EFGH-IJKL' });
  });

  it('lanza el mensaje de la acción cuando success es false', async () => {
    globalThis.fetch.mockResolvedValue(respuesta({ success: false, error: 'Insumo no encontrado' }));

    await expect(post({ accion: 'panel_insumo' }, { apiBase: BASE }))
      .rejects.toThrow('Insumo no encontrado');
  });

  it('lanza el mensaje de respaldo cuando el cuerpo no es JSON', async () => {
    globalThis.fetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.reject(new Error('bad json')) });

    await expect(post({ accion: 'donar_dinero' }, { apiBase: BASE }))
      .rejects.toThrow('No se pudo guardar');
  });

  it('propaga el status HTTP en el error', async () => {
    globalThis.fetch.mockResolvedValue(respuesta({ error: 'Demasiadas solicitudes' }, { ok: false, status: 429 }));

    await expect(post({ accion: 'donar_dinero' }, { apiBase: BASE }))
      .rejects.toMatchObject({ message: 'Demasiadas solicitudes', status: 429 });
  });

  it('usa HTTP <status> cuando el error no trae mensaje', async () => {
    globalThis.fetch.mockResolvedValue(respuesta(null, { ok: false, status: 503 }));

    await expect(post({ accion: 'donar_dinero' }, { apiBase: BASE }))
      .rejects.toThrow('HTTP 503');
  });

  it('aborta a los 45 s', async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      });
    }));

    const pendiente = post({ accion: 'donar_dinero' }, { apiBase: BASE });
    const esperado = expect(pendiente).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    await esperado;
  });
});
