import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthError } from '../../functions/src/auth/authorization.js';
import { RateLimitError } from '../../functions/src/security/rate-limit.js';
import { ApiError, type ActionDefinition } from '../../functions/src/api/contract.js';
import { API_MESSAGES, apiHandler, type ApiDependencies } from '../../functions/src/api/http.js';
import { defineAction, getAction, listActions, resetActions } from '../../functions/src/api/registry.js';

function createResponse() {
  const result: { status?: number; body?: unknown; headers: Record<string, string> } = { headers: {} };
  const res = {
    setHeader(name: string, value: string) { result.headers[name] = value; },
    status(code: number) { result.status = code; return res; },
    json(body: unknown) { result.body = body; },
  };
  return { res, result };
}

const peticion = (body: unknown, extra: Record<string, unknown> = {}) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
  body,
  ...extra,
});

const handlers = {
  publica: vi.fn(async () => ({ ok: true })),
  usuario: vi.fn(async () => ({ ok: true })),
  panel: vi.fn(async () => ({ ok: true })),
  admin: vi.fn(async () => ({ ok: true })),
};

function registrarAcciones() {
  resetActions();
  defineAction({ nombre: 'accion_publica', auth: 'anon', cubo: 'publico', handler: handlers.publica });
  defineAction({ nombre: 'accion_usuario', auth: 'user', cubo: 'lectura', handler: handlers.usuario });
  defineAction({ nombre: 'accion_panel', auth: 'panel', cubo: 'panel', handler: handlers.panel });
  defineAction({ nombre: 'accion_admin', auth: 'admin', cubo: 'admin', handler: handlers.admin });
}

function dependencias(overrides: Partial<ApiDependencies> = {}): ApiDependencies {
  return {
    authenticate: async () => ({ uid: 'uid-1', role: 'user' as const }),
    rateLimiter: vi.fn(async () => ({ allowed: true, hits: 1, retryAfter: 0 })),
    now: () => new Date('2026-09-06T12:00:00.000Z'),
    db: () => ({}) as never,
    lookupAction: getAction,
    appCheckMode: 'disabled',
    ...overrides,
  };
}

beforeEach(() => {
  registrarAcciones();
  for (const handler of Object.values(handlers)) handler.mockClear();
});

describe('registro de acciones', () => {
  it('registra, consulta y lista acciones sin duplicados', () => {
    expect(listActions()).toEqual(['accion_admin', 'accion_panel', 'accion_publica', 'accion_usuario']);
    expect(getAction('accion_publica')?.auth).toBe('anon');
    expect(getAction('no_existe')).toBeUndefined();
    expect(() => defineAction({ nombre: 'accion_publica', auth: 'anon', cubo: 'publico', handler: handlers.publica }))
      .toThrow('accion-duplicada:accion_publica');
    expect(() => defineAction({ nombre: '  ', auth: 'anon', cubo: 'publico', handler: handlers.publica }))
      .toThrow('accion-sin-nombre');
  });
});

describe('envoltura HTTP', () => {
  it('responde 204 al preflight', async () => {
    const { res, result } = createResponse();
    await apiHandler({ method: 'OPTIONS' }, res, dependencias());
    expect(result.status).toBe(204);
  });

  it.each(['GET', 'PUT', 'DELETE'])('rechaza %s con 405 y el mensaje del contrato legado', async (method) => {
    const { res, result } = createResponse();
    await apiHandler({ ...peticion({ accion: 'accion_publica' }), method }, res, dependencias());
    expect(result.status).toBe(405);
    expect(result.body).toEqual({ success: false, error: API_MESSAGES.soloPost });
    expect(result.headers.Allow).toBe('POST');
  });

  it('exige content-type JSON y un cuerpo objeto', async () => {
    const sinTipo = createResponse();
    await apiHandler(
      { method: 'POST', headers: {}, body: { accion: 'accion_publica' } },
      sinTipo.res,
      dependencias(),
    );
    expect(sinTipo.result.status).toBe(400);
    expect(sinTipo.result.body).toEqual({ success: false, error: API_MESSAGES.formato });

    for (const cuerpo of [null, 'texto', [1, 2], 42]) {
      const { res, result } = createResponse();
      await apiHandler(peticion(cuerpo), res, dependencias());
      expect(result.status).toBe(400);
      expect(result.body).toEqual({ success: false, error: API_MESSAGES.formato });
    }
  });

  it('responde "accion desconocida" sin ejecutar nada', async () => {
    const { res, result } = createResponse();
    await apiHandler(peticion({ accion: 'no_existe' }), res, dependencias());
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ success: false, error: API_MESSAGES.desconocida });
  });

  it('devuelve success:true y fusiona el resultado de la accion', async () => {
    const { res, result } = createResponse();
    handlers.publica.mockResolvedValueOnce({ token: 'DV-AAAA-BBBB-CCCC', recaudado: 10 } as never);

    await apiHandler(peticion({ accion: 'accion_publica', nombre: 'Centro' }), res, dependencias());

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ success: true, token: 'DV-AAAA-BBBB-CCCC', recaudado: 10 });
  });

  it('no le pasa la clave accion al handler', async () => {
    const { res } = createResponse();
    await apiHandler(peticion({ accion: 'accion_publica', nombre: 'Centro', pin: '1234' }), res, dependencias());
    expect(handlers.publica).toHaveBeenCalledWith(expect.anything(), { nombre: 'Centro', pin: '1234' });
  });
});

describe('autorizacion por accion', () => {
  it('permite una accion publica sin token', async () => {
    const { res, result } = createResponse();
    const authenticate = vi.fn();
    await apiHandler(peticion({ accion: 'accion_publica' }), res, dependencias({ authenticate }));
    expect(result.status).toBe(200);
    expect(authenticate).not.toHaveBeenCalled();
    expect(handlers.publica.mock.calls[0]?.[0]).toMatchObject({ uid: null, role: 'anon' });
  });

  it('ignora un token vencido en una accion publica', async () => {
    const { res, result } = createResponse();
    const authenticate = vi.fn(async () => { throw new AuthError('unauthenticated', 401, 'x'); });

    await apiHandler(
      peticion({ accion: 'accion_publica' }, { headers: { 'content-type': 'application/json', authorization: 'Bearer viejo' } }),
      res,
      dependencias({ authenticate }),
    );

    expect(result.status).toBe(200);
    expect(handlers.publica.mock.calls[0]?.[0]).toMatchObject({ uid: null, role: 'anon' });
  });

  it('exige sesion en una accion de usuario', async () => {
    const { res, result } = createResponse();
    const authenticate = vi.fn(async () => { throw new AuthError('unauthenticated', 401, 'detalle interno'); });

    await apiHandler(peticion({ accion: 'accion_usuario' }), res, dependencias({ authenticate }));

    expect(result.status).toBe(401);
    expect(result.body).toEqual({ success: false, error: API_MESSAGES.sesion });
    expect(JSON.stringify(result.body)).not.toContain('detalle interno');
    expect(handlers.usuario).not.toHaveBeenCalled();
  });

  it('rechaza a un usuario y a un panel en una accion admin', async () => {
    for (const role of ['user', 'panel'] as const) {
      const { res, result } = createResponse();
      await apiHandler(peticion({ accion: 'accion_admin' }), res, dependencias({
        authenticate: async () => ({ uid: 'uid-1', role, panelLugarId: 'lugar-1' }),
      }));
      expect(result.status).toBe(403);
      expect(result.body).toEqual({ success: false, error: API_MESSAGES.permiso });
      expect(handlers.admin).not.toHaveBeenCalled();
    }
  });

  it('acepta admin en una accion de panel y rechaza a un usuario', async () => {
    const admin = createResponse();
    await apiHandler(peticion({ accion: 'accion_panel' }), admin.res, dependencias({
      authenticate: async () => ({ uid: 'admin-1', role: 'admin' as const }),
    }));
    expect(admin.result.status).toBe(200);

    const usuario = createResponse();
    await apiHandler(peticion({ accion: 'accion_panel' }), usuario.res, dependencias({
      authenticate: async () => ({ uid: 'uid-1', role: 'user' as const }),
    }));
    expect(usuario.result.status).toBe(403);
  });

  it('rechaza un panel sin centro asignado', async () => {
    const { res, result } = createResponse();
    await apiHandler(peticion({ accion: 'accion_panel' }), res, dependencias({
      authenticate: async () => ({ uid: 'panel-1', role: 'panel' as const }),
    }));
    expect(result.status).toBe(403);
    expect(result.body).toEqual({ success: false, error: API_MESSAGES.panelSinCentro });
  });

  it('entrega al handler el centro del panel', async () => {
    const { res } = createResponse();
    await apiHandler(peticion({ accion: 'accion_panel' }), res, dependencias({
      authenticate: async () => ({ uid: 'panel-1', role: 'panel' as const, panelLugarId: 'lugar-9' }),
    }));
    expect(handlers.panel.mock.calls[0]?.[0]).toMatchObject({ uid: 'panel-1', role: 'panel', panelLugarId: 'lugar-9' });
  });
});

describe('limites de tasa', () => {
  it('cobra la rafaga por IP y el cubo de la accion por identidad', async () => {
    const rateLimiter = vi.fn(async () => ({ allowed: true, hits: 1, retryAfter: 0 }));
    const { res } = createResponse();

    await apiHandler(peticion({ accion: 'accion_admin' }), res, dependencias({
      rateLimiter,
      authenticate: async () => ({ uid: 'admin-1', role: 'admin' as const }),
    }));

    expect(rateLimiter.mock.calls).toEqual([
      ['rafaga', '203.0.113.7', Date.parse('2026-09-06T12:00:00.000Z')],
      ['admin', 'admin-1', Date.parse('2026-09-06T12:00:00.000Z')],
    ]);
  });

  it('cobra por IP el cubo de una accion publica', async () => {
    const rateLimiter = vi.fn(async () => ({ allowed: true, hits: 1, retryAfter: 0 }));
    const { res } = createResponse();

    await apiHandler(peticion({ accion: 'accion_publica' }), res, dependencias({ rateLimiter }));

    expect(rateLimiter.mock.calls.map((call) => call[0])).toEqual(['rafaga', 'publico']);
    expect(rateLimiter.mock.calls[1]?.[1]).toBe('203.0.113.7');
  });

  it('responde 429 con Retry-After sin ejecutar la accion', async () => {
    const { res, result } = createResponse();
    const rateLimiter = vi.fn(async () => { throw new RateLimitError(42); });

    await apiHandler(peticion({ accion: 'accion_publica' }), res, dependencias({ rateLimiter }));

    expect(result.status).toBe(429);
    expect(result.headers['Retry-After']).toBe('42');
    expect(result.body).toEqual({ success: false, error: API_MESSAGES.demasiadas });
    expect(handlers.publica).not.toHaveBeenCalled();
  });

  it('no crea un cubo global cuando no hay IP utilizable', async () => {
    const rateLimiter = vi.fn(async () => ({ allowed: true, hits: 1, retryAfter: 0 }));
    const { res, result } = createResponse();

    await apiHandler(
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: { accion: 'accion_publica' } },
      res,
      dependencias({ rateLimiter }),
    );

    expect(result.status).toBe(200);
    expect(rateLimiter).not.toHaveBeenCalled();
  });
});

describe('origen de la peticion', () => {
  it('acepta una peticion sin cabecera Origin (cliente que no es navegador)', async () => {
    const { res, result } = createResponse();
    await apiHandler(peticion({ accion: 'accion_publica' }), res, dependencias());
    expect(result.status).toBe(200);
  });

  it('acepta los origenes de la allowlist, con o sin barra final', async () => {
    for (const origin of ['http://localhost:5173', 'https://donacionesvenezuela.vercel.app/']) {
      const { res, result } = createResponse();
      await apiHandler(
        peticion({ accion: 'accion_publica' }, {
          headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7', origin },
        }),
        res,
        dependencias(),
      );
      expect(result.status).toBe(200);
    }
  });

  it('rechaza un origen ajeno antes de mirar el metodo o el cuerpo', async () => {
    const { res, result } = createResponse();
    await apiHandler(
      {
        method: 'GET',
        headers: { origin: 'https://sitio-ajeno.example' },
        body: { accion: 'accion_publica' },
      },
      res,
      dependencias(),
    );
    expect(result.status).toBe(403);
    expect(result.body).toEqual({ success: false, error: API_MESSAGES.origen });
    expect(handlers.publica).not.toHaveBeenCalled();
  });

  it('respeta una allowlist inyectada', async () => {
    const { res, result } = createResponse();
    await apiHandler(
      peticion({ accion: 'accion_publica' }, {
        headers: { 'content-type': 'application/json', origin: 'https://staging.example' },
      }),
      res,
      dependencias({ origenesPermitidos: ['https://staging.example'] }),
    );
    expect(result.status).toBe(200);
  });
});

describe('errores', () => {
  it('propaga el mensaje y el status de un ApiError', async () => {
    const { res, result } = createResponse();
    handlers.publica.mockRejectedValueOnce(new ApiError('nombre requerido') as never);

    await apiHandler(peticion({ accion: 'accion_publica' }), res, dependencias());

    expect(result.status).toBe(400);
    expect(result.body).toEqual({ success: false, error: 'nombre requerido' });
  });

  it.each([
    [409, 'Este presupuesto ya esta financiado'],
    [404, 'Factura no encontrada'],
  ] as const)('respeta el status %s de la accion', async (status, mensaje) => {
    const { res, result } = createResponse();
    handlers.publica.mockRejectedValueOnce(new ApiError(mensaje, status) as never);

    await apiHandler(peticion({ accion: 'accion_publica' }), res, dependencias());

    expect(result.status).toBe(status);
    expect(result.body).toEqual({ success: false, error: mensaje });
  });

  it('convierte cualquier otro fallo en 500 sin filtrar detalles', async () => {
    const { res, result } = createResponse();
    handlers.publica.mockRejectedValueOnce(new Error('detalle interno de Firestore') as never);

    await apiHandler(peticion({ accion: 'accion_publica' }), res, dependencias());

    expect(result.status).toBe(500);
    expect(result.body).toEqual({ success: false, error: API_MESSAGES.interno });
    expect(JSON.stringify(result.body)).not.toContain('Firestore');
  });

  it('exige App Check cuando el modo es enforced', async () => {
    const { res, result } = createResponse();

    await apiHandler(peticion({ accion: 'accion_publica' }), res, dependencias({ appCheckMode: 'enforced' }));

    expect(result.status).toBe(403);
    expect(result.body).toEqual({ success: false, error: API_MESSAGES.appCheck });
    expect(handlers.publica).not.toHaveBeenCalled();
  });
});

describe('definiciones registradas', () => {
  it('toda accion declara un cubo y una autorizacion validos', () => {
    for (const nombre of listActions()) {
      const definicion = getAction(nombre) as ActionDefinition;
      expect(['anon', 'user', 'panel', 'admin']).toContain(definicion.auth);
      expect(typeof definicion.handler).toBe('function');
    }
  });
});
