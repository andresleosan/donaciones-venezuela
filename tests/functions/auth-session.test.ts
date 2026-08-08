import { expect, it, vi } from 'vitest';
import { AuthError } from '../../functions/src/auth/authorization.js';
import { authSessionHandler } from '../../functions/src/auth/session.js';

function createResponse() {
  const result: {
    status?: number;
    body?: unknown;
    headers: Record<string, string>;
  } = { headers: {} };
  const res = {
    setHeader(name: string, value: string) {
      result.headers[name] = value;
    },
    status(code: number) {
      result.status = code;
      return res;
    },
    json(body: unknown) {
      result.body = body;
    },
  };
  return { res, result };
}

it('devuelve solo uid y rol para una sesion autenticada', async () => {
  const { res, result } = createResponse();
  await authSessionHandler(
    { method: 'GET', headers: {} },
    res,
    async () => ({ uid: 'user-1', role: 'panel' }),
  );

  expect(result.status).toBe(200);
  expect(result.body).toEqual({ uid: 'user-1', role: 'panel' });
  expect(JSON.stringify(result.body)).not.toMatch(/token|email|secret|claim/i);
});

it('responde 401 sin revelar el error de verificacion', async () => {
  const { res, result } = createResponse();
  await authSessionHandler(
    { method: 'GET', headers: {} },
    res,
    async () => { throw new AuthError('unauthenticated', 401, 'Authentication required'); },
  );

  expect(result.status).toBe(401);
  expect(result.body).toEqual({
    error: { code: 'unauthenticated', message: 'Authentication required' },
  });
});

it('rechaza metodos diferentes de GET', async () => {
  const { res, result } = createResponse();
  await authSessionHandler({ method: 'POST', headers: {} }, res, vi.fn());

  expect(result.status).toBe(405);
  expect(result.headers.Allow).toBe('GET');
});
