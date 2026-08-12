import { expect, it, vi } from 'vitest';
import { AuthError } from '../../functions/src/auth/authorization.js';
import {
  applyConsentTransaction,
  setVolunteerPublicConsentHandler,
} from '../../functions/src/volunteers/public-consent-http.js';

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

const request = {
  method: 'POST',
  body: {
    volunteerId: 'v1',
    enabled: true,
    consentVersion: 'volunteer-public-v1',
  },
};

it('rechaza metodos distintos de POST', async () => {
  const { res, result } = createResponse();
  await setVolunteerPublicConsentHandler({ method: 'GET' }, res, vi.fn());

  expect(result.status).toBe(405);
  expect(result.headers.Allow).toBe('POST');
});

it('devuelve exito minimo al activar', async () => {
  const { res, result } = createResponse();
  await setVolunteerPublicConsentHandler(
    request,
    res,
    async () => ({ success: true, enabled: true, volunteerId: 'v1' }),
  );

  expect(result.status).toBe(200);
  expect(result.body).toEqual({ success: true, enabled: true, volunteerId: 'v1' });
  expect(JSON.stringify(result.body)).not.toMatch(/email|telefono|authUid|token|claim/i);
});

it('omite campos sensibles de un resultado de applyConsent no confiable', async () => {
  const { res, result } = createResponse();
  await setVolunteerPublicConsentHandler(
    request,
    res,
    async () => ({
      success: true,
      enabled: true,
      volunteerId: 'wrong-id',
      email: 'private@example.test',
      token: 'secret-token',
      authUid: 'private-uid',
    } as never),
  );

  expect(result.status).toBe(200);
  expect(result.body).toEqual({ success: true, enabled: true, volunteerId: 'v1' });
  expect(JSON.stringify(result.body)).not.toMatch(/email|token|authUid|wrong-id/i);
});

it('normaliza errores desconocidos', async () => {
  const { res, result } = createResponse();
  await setVolunteerPublicConsentHandler(
    request,
    res,
    async () => { throw new Error('private@example.test firestore path'); },
  );

  expect(result.status).toBe(500);
  expect(result.body).toEqual({ error: { code: 'internal', message: 'Internal error' } });
});

it('conserva errores publicos de autenticacion', async () => {
  const { res, result } = createResponse();
  await setVolunteerPublicConsentHandler(
    request,
    res,
    async () => { throw new AuthError('unauthenticated', 401, 'private token details'); },
  );

  expect(result.status).toBe(401);
  expect(result.body).toEqual({
    error: { code: 'unauthenticated', message: 'Authentication required' },
  });
});

it('rechaza la solicitud sin Bearer antes de tocar el servicio', async () => {
  const { res, result } = createResponse();
  await setVolunteerPublicConsentHandler({ method: 'POST', body: request.body }, res);

  expect(result.status).toBe(401);
  expect(result.body).toEqual({
    error: { code: 'unauthenticated', message: 'Authentication required' },
  });
});

it.each([
  ['invalid-input', 400, 'Invalid input'],
  ['invalid-consent-version', 400, 'Invalid consent version'],
  ['forbidden', 403, 'Forbidden'],
  ['volunteer-not-found', 404, 'Volunteer not found'],
  ['volunteer-not-active', 409, 'Volunteer not active'],
] as const)('expone el error estable %s', async (code, status, message) => {
  const { res, result } = createResponse();
  await setVolunteerPublicConsentHandler(
    request,
    res,
    async () => { throw new Error(code); },
  );

  expect(result.status).toBe(status);
  expect(result.body).toEqual({ error: { code, message } });
});

it('aplica la mutacion dentro de una transaccion y solo toca los documentos previstos', async () => {
  const transaction = {
    get: vi.fn(async () => ({
      exists: true,
      data: () => ({ authUid: 'uid-1', activo: true, nombre: 'Ana Demo' }),
    })),
    update: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  };
  const privateRef = { path: 'voluntarios/v1' };
  const publicRef = { path: 'voluntariosPublicos/v1' };
  const auditRef = { path: 'auditoriaAdmin/generated-id' };
  const db = {
    collection: vi.fn((name: string) => ({
      doc: vi.fn((id?: string) => {
        if (name === 'voluntarios') return privateRef;
        if (name === 'voluntariosPublicos') return publicRef;
        return id ? { path: `auditoriaAdmin/${id}` } : auditRef;
      }),
    })),
    runTransaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) => (
      callback(transaction)
    )),
  };

  const result = await applyConsentTransaction(
    {
      volunteerId: 'v1',
      enabled: true,
      consentVersion: 'volunteer-public-v1',
    },
    { uid: 'uid-1', role: 'user' },
    db,
    'transaction-now',
  );

  expect(result).toEqual({ success: true, enabled: true, volunteerId: 'v1' });
  expect(transaction.get).toHaveBeenCalledWith(privateRef);
  expect(transaction.update).toHaveBeenCalledWith(privateRef, {
    publicProfileConsent: expect.objectContaining({ enabled: true }),
  });
  expect(transaction.set).toHaveBeenCalledWith(publicRef, {
    nombre: 'Ana Demo',
    activo: true,
  });
  expect(transaction.set).toHaveBeenCalledWith(auditRef, expect.objectContaining({
    actorUid: 'uid-1',
    entidad: 'voluntarios',
    entidadId: 'v1',
    resultado: 'success',
    createdAt: 'transaction-now',
  }));
  expect(transaction.delete).not.toHaveBeenCalled();
});

it('elimina la proyeccion al revocar dentro de la misma transaccion', async () => {
  const transaction = {
    get: vi.fn(async () => ({
      exists: true,
      data: () => ({ authUid: 'uid-1', activo: true }),
    })),
    update: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  };
  const privateRef = { path: 'voluntarios/v1' };
  const publicRef = { path: 'voluntariosPublicos/v1' };
  const auditRef = { path: 'auditoriaAdmin/generated-id' };
  const db = {
    collection: vi.fn((name: string) => ({
      doc: vi.fn((id?: string) => {
        if (name === 'voluntarios') return privateRef;
        if (name === 'voluntariosPublicos') return publicRef;
        return id ? { path: `auditoriaAdmin/${id}` } : auditRef;
      }),
    })),
    runTransaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) => (
      callback(transaction)
    )),
  };

  const result = await applyConsentTransaction(
    {
      volunteerId: 'v1',
      enabled: false,
      consentVersion: 'volunteer-public-v1',
    },
    { uid: 'admin-1', role: 'admin' },
    db,
    'transaction-now',
  );

  expect(result).toEqual({ success: true, enabled: false, volunteerId: 'v1' });
  expect(transaction.delete).toHaveBeenCalledWith(publicRef);
  expect(transaction.set).toHaveBeenCalledWith(auditRef, expect.objectContaining({
    actorUid: 'admin-1',
    accion: 'revocar_consentimiento_publico',
  }));
});

it('rechaza el perfil inexistente sin escribir', async () => {
  const transaction = {
    get: vi.fn(async () => ({ exists: false, data: () => undefined })),
    update: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  };
  const db = {
    collection: vi.fn(() => ({ doc: vi.fn(() => ({ path: 'voluntarios/v1' })) })),
    runTransaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) => (
      callback(transaction)
    )),
  };

  await expect(applyConsentTransaction(
    {
      volunteerId: 'v1',
      enabled: true,
      consentVersion: 'volunteer-public-v1',
    },
    { uid: 'uid-1', role: 'user' },
    db,
    'transaction-now',
  )).rejects.toThrow('volunteer-not-found');
  expect(transaction.update).not.toHaveBeenCalled();
  expect(transaction.set).not.toHaveBeenCalled();
  expect(transaction.delete).not.toHaveBeenCalled();
});
