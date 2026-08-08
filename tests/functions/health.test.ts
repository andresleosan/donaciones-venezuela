import { expect, it } from 'vitest';
import { healthHandler } from '../../functions/src/health.js';

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

it('responde solo estado, versión y timestamp', () => {
  const { res, result } = createResponse();

  healthHandler({ method: 'GET' }, res, () => new Date('2026-08-06T12:00:00.000Z'));

  expect(result.status).toBe(200);
  expect(result.body).toEqual({
    status: 'ok',
    version: 'local',
    timestamp: '2026-08-06T12:00:00.000Z',
  });
  expect(JSON.stringify(result.body)).not.toMatch(/secret|project|env|token/i);
});

it('rechaza POST sin filtrar detalles', () => {
  const { res, result } = createResponse();

  healthHandler({ method: 'POST' }, res);

  expect(result.status).toBe(405);
  expect(result.headers.Allow).toBe('GET');
  expect(result.body).toEqual({
    error: { code: 'method-not-allowed', message: 'Method not allowed' },
  });
});
