import { describe, expect, it } from 'vitest';

// La Function `api` corriendo de verdad en Emulator Suite. Prueba la envoltura
// (metodo, formato, contrato de respuesta) y sobre todo el CORS: con `cors:false`
// el navegador bloqueaba cualquier llamada desde el frontend, y ninguna prueba
// en proceso lo habria detectado.
const apiUrl = 'http://127.0.0.1:5001/demo-donaciones-venezuela/us-east1/api';
const ORIGEN_PERMITIDO = 'http://localhost:5173';

const postJson = (body: unknown, headers: Record<string, string> = {}) => fetch(apiUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

describe('Function api en Emulator Suite', () => {
  it('responde el preflight con el origen permitido', async () => {
    const response = await fetch(apiUrl, {
      method: 'OPTIONS',
      headers: {
        Origin: ORIGEN_PERMITIDO,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,authorization',
      },
    });

    expect(response.status).toBeLessThan(300);
    expect(response.headers.get('access-control-allow-origin')).toBe(ORIGEN_PERMITIDO);
  });

  it('rechaza una peticion desde un origen fuera de la allowlist', async () => {
    // El CORS del navegador no basta: el emulador (y cualquier cliente que no sea
    // un navegador) puede ignorarlo. La Function comprueba el origen ella misma.
    const response = await postJson(
      { accion: 'no_existe' },
      { Origin: 'https://sitio-ajeno.example' },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ success: false, error: 'origen no permitido' });
  });

  it('rechaza una accion desconocida con el contrato del legado', async () => {
    const response = await postJson({ accion: 'no_existe' }, { Origin: ORIGEN_PERMITIDO });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ success: false, error: 'accion desconocida' });
    expect(response.headers.get('access-control-allow-origin')).toBe(ORIGEN_PERMITIDO);
  });

  it('rechaza metodos distintos de POST', async () => {
    const response = await fetch(apiUrl, { method: 'GET' });

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({ success: false, error: 'solo POST' });
  });

  it('rechaza un cuerpo que no es JSON', async () => {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'accion=no_existe',
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ success: false, error: 'formato invalido' });
  });

  it('no filtra detalles internos ante un cuerpo vacio', async () => {
    const response = await postJson({});

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({ success: false, error: 'accion desconocida' });
    expect(JSON.stringify(body)).not.toMatch(/firestore|stack|at Object|internal/i);
  });
});
