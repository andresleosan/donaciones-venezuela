import { expect, it, vi } from 'vitest';
import {
  canAccessPrivateFile,
  canDeletePrivateFile,
  privateUrlExpiresAt,
  validatePrivateStoragePath,
} from '../../functions/src/private-file-access.js';
import { AuthError } from '../../functions/src/auth/authorization.js';
import { RateLimitError } from '../../functions/src/security/rate-limit.js';
import {
  deletePrivateFileHandler,
  getPrivateFileUrlHandler,
  type PrivateFileDependencies,
} from '../../functions/src/private-file-access-http.js';

it('extrae propietario, categoria y extension del path canonico', () => {
  expect(validatePrivateStoragePath('private/owner-1/reports/evidence.pdf'))
    .toEqual({
      path: 'private/owner-1/reports/evidence.pdf',
      ownerUid: 'owner-1',
      category: 'reports',
      fileName: 'evidence.pdf',
      extension: 'pdf',
    });
});

it.each([
  'public/owner-1/needs/photo.png',
  'private/owner-1/unknown/photo.png',
  'private/owner-1/reports/../photo.png',
  'private/owner-1/reports/a/b.png',
  'private/owner-1/reports/.png',
  'private//reports/photo.png',
  'private/owner-1/reports/file.txt',
  'private/owner-1/reports/file.png.exe',
  'private/owner-1/reports/file\u0000.png',
])('rechaza path invalido %s', (path) => {
  expect(() => validatePrivateStoragePath(path)).toThrow('invalid-private-storage-path');
});

it.each([
  'private//reports/photo.png',
  'private/owner-1/reports/\u0000photo.png',
])('rechaza UID vacio o caracteres de control: %s', (path) => {
  expect(() => validatePrivateStoragePath(path)).toThrow('invalid-private-storage-path');
});

it('aplica la matriz de acceso y eliminación', () => {
  const reports = validatePrivateStoragePath('private/owner-1/reports/evidence.pdf');
  const needs = validatePrivateStoragePath('private/owner-1/needs/photo.png');

  expect(canAccessPrivateFile({ uid: 'owner-1', role: 'user' }, reports)).toBe(true);
  expect(canAccessPrivateFile({ uid: 'panel-1', role: 'panel' }, reports)).toBe(false);
  expect(canAccessPrivateFile({ uid: 'panel-1', role: 'panel' }, needs)).toBe(true);
  expect(canAccessPrivateFile({ uid: 'admin-1', role: 'admin' }, reports)).toBe(true);
  expect(canDeletePrivateFile({ uid: 'panel-1', role: 'panel' }, reports)).toBe(false);
  expect(canDeletePrivateFile({ uid: 'panel-1', role: 'panel' }, needs)).toBe(true);
  expect(canDeletePrivateFile({ uid: 'owner-1', role: 'user' }, reports)).toBe(true);
  expect(canDeletePrivateFile({ uid: 'admin-1', role: 'admin' }, needs)).toBe(true);
});

// `centers` lleva la cedula de la persona responsable de un centro: es la unica
// categoria que el rol 'panel' NO puede leer, ni siquiera la de otro centro.
it('reserva la categoria centers al admin y a quien la subio', () => {
  const centers = validatePrivateStoragePath('private/owner-1/centers/cedula.jpg');

  expect(centers.category).toBe('centers');
  expect(canAccessPrivateFile({ uid: 'owner-1', role: 'user' }, centers)).toBe(true);
  expect(canAccessPrivateFile({ uid: 'admin-1', role: 'admin' }, centers)).toBe(true);
  expect(canAccessPrivateFile({ uid: 'panel-1', role: 'panel' }, centers)).toBe(false);
  expect(canDeletePrivateFile({ uid: 'panel-1', role: 'panel' }, centers)).toBe(false);
});

// `volunteers` y `drivers` (Task 3.2) llevan cedulas y la placa de un vehiculo.
// Como `canAccessPrivateFile` solo abre `receipts` y `needs` al rol 'panel',
// bastaba anadirlas a la lista de categorias para que quedaran cerradas; esta
// prueba fija esa consecuencia, que es la que importa.
it('reserva las categorias de identidad de personas al admin y a quien las subio', () => {
  for (const ruta of [
    'private/owner-1/volunteers/cedula.jpg',
    'private/owner-1/drivers/placa.png',
    'private/owner-1/drivers/cedula.jpg',
  ]) {
    const descriptor = validatePrivateStoragePath(ruta);

    expect(canAccessPrivateFile({ uid: 'owner-1', role: 'user' }, descriptor)).toBe(true);
    expect(canAccessPrivateFile({ uid: 'admin-1', role: 'admin' }, descriptor)).toBe(true);
    expect(canAccessPrivateFile({ uid: 'panel-1', role: 'panel' }, descriptor)).toBe(false);
    expect(canAccessPrivateFile({ uid: 'otro-1', role: 'user' }, descriptor)).toBe(false);
    expect(canDeletePrivateFile({ uid: 'panel-1', role: 'panel' }, descriptor)).toBe(false);
  }
});

it('rechaza contextos sin UID aunque tengan rol privilegiado', () => {
  const descriptor = validatePrivateStoragePath('private/owner-1/needs/photo.png');

  expect(canAccessPrivateFile({ uid: '', role: 'admin' }, descriptor)).toBe(false);
  expect(canDeletePrivateFile({ uid: ' ', role: 'admin' }, descriptor)).toBe(false);
});

it('suma exactamente el TTL de 15 minutos', () => {
  const now = new Date('2026-08-12T12:00:00.000Z');

  expect(privateUrlExpiresAt(now).toISOString()).toBe('2026-08-12T12:15:00.000Z');
});

function createResponse() {
  const result: { status?: number; body?: unknown; headers: Record<string, string> } = {
    headers: {},
  };
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

function requestWithPath(path: string, overrides: Record<string, unknown> = {}) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: { path },
    ...overrides,
  };
}

function createFile(metadata: Record<string, string> = {
  ownerUid: 'owner-1',
  category: 'receipts',
  visibility: 'private',
}) {
  return {
    exists: vi.fn(async () => [true] as [boolean]),
    getMetadata: vi.fn(async () => [{ metadata }] as [{ metadata?: Record<string, string> }]),
    getSignedUrl: vi.fn(async () => ['https://signed.example/temporary'] as [string]),
    delete: vi.fn(async () => undefined),
  };
}

function createDependencies(
  file = createFile(),
  overrides: Partial<PrivateFileDependencies> = {},
): PrivateFileDependencies {
  return {
    authenticate: async () => ({ uid: 'owner-1', role: 'user' as const }),
    getFile: vi.fn(() => file),
    rateLimiter: vi.fn(async () => ({ allowed: true as const, hits: 1, retryAfter: 0 as const })),
    now: () => new Date('2026-08-12T12:00:00.000Z'),
    deleteFile: vi.fn(async (target) => target.delete()),
    ...overrides,
  };
}

it('devuelve URL temporal sin filtrar metadata', async () => {
  const { res, result } = createResponse();
  const file = createFile();
  const dependencies = createDependencies(file);

  await getPrivateFileUrlHandler(
    requestWithPath('private/owner-1/receipts/r1.pdf'),
    res,
    dependencies,
  );

  expect(result.status).toBe(200);
  expect(result.body).toEqual({
    url: 'https://signed.example/temporary',
    expiresAt: '2026-08-12T12:15:00.000Z',
  });
  expect(JSON.stringify(result.body)).not.toMatch(/ownerUid|visibility|token/i);
  expect(dependencies.rateLimiter).toHaveBeenCalledWith('archivos', 'owner-1', Date.parse('2026-08-12T12:00:00.000Z'));
  expect(file.getSignedUrl).toHaveBeenCalledWith({
    version: 'v4',
    action: 'read',
    expires: new Date('2026-08-12T12:15:00.000Z'),
  });
});

it('exige App Check cuando el modo es enforced', async () => {
  for (const handler of [getPrivateFileUrlHandler, deletePrivateFileHandler]) {
    const { res, result } = createResponse();
    const dependencies = createDependencies(createFile(), { appCheckMode: 'enforced' });

    await handler(requestWithPath('private/owner-1/receipts/r1.pdf'), res, dependencies);

    expect(result.status).toBe(403);
    expect(result.body).toEqual({
      error: { code: 'app-check-required', message: 'App Check required' },
    });
    expect(dependencies.getFile).not.toHaveBeenCalled();
    expect(dependencies.rateLimiter).not.toHaveBeenCalled();
  }
});

it('consume el cupo por identidad antes de tocar Storage', async () => {
  const { res } = createResponse();
  const file = createFile();
  const orden: string[] = [];
  const dependencies = createDependencies(file, {
    rateLimiter: vi.fn(async () => {
      orden.push('rateLimiter');
      return { allowed: true as const, hits: 1, retryAfter: 0 as const };
    }),
    getFile: vi.fn(() => {
      orden.push('getFile');
      return file;
    }),
  });

  await getPrivateFileUrlHandler(requestWithPath('private/owner-1/receipts/r1.pdf'), res, dependencies);

  expect(orden).toEqual(['rateLimiter', 'getFile']);
});

it('gasta cupo aunque el path sea invalido o el acceso este prohibido', async () => {
  for (const [path, authenticate] of [
    ['private/owner-1/desconocida/r1.pdf', undefined],
    ['private/owner-1/reports/r1.pdf', async () => ({ uid: 'panel-1', role: 'panel' as const })],
  ] as const) {
    const { res } = createResponse();
    const dependencies = createDependencies(createFile(), authenticate ? { authenticate } : {});

    await getPrivateFileUrlHandler(requestWithPath(path), res, dependencies);

    expect(dependencies.rateLimiter).toHaveBeenCalledWith('archivos', expect.any(String), expect.any(Number));
  }
});

it('mide por IP los intentos sin sesion valida', async () => {
  const { res, result } = createResponse();
  const rateLimiter = vi.fn(async () => ({ allowed: true as const, hits: 1, retryAfter: 0 as const }));
  const request = {
    ...requestWithPath('private/owner-1/receipts/r1.pdf'),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7, 10.0.0.1' },
  };

  await getPrivateFileUrlHandler(request, res, createDependencies(createFile(), {
    authenticate: async () => { throw new AuthError('unauthenticated', 401, 'Authentication required'); },
    rateLimiter,
  }));

  expect(result.status).toBe(401);
  expect(rateLimiter).toHaveBeenCalledWith('request', '203.0.113.7', expect.any(Number));
  expect(rateLimiter).not.toHaveBeenCalledWith('archivos', expect.anything(), expect.anything());
});

it('audita la firma, el borrado y los intentos rechazados sin exponer el path', async () => {
  const audit = vi.fn(async () => {});
  const path = 'private/owner-1/receipts/r1.pdf';

  const firma = createResponse();
  await getPrivateFileUrlHandler(requestWithPath(path), firma.res, createDependencies(createFile(), { audit }));
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({
    actorUid: 'owner-1', accion: 'firmar_url_privada', resultado: 'ok',
  }));

  const borrado = createResponse();
  await deletePrivateFileHandler(requestWithPath(path), borrado.res, createDependencies(createFile(), { audit }));
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({
    accion: 'eliminar_archivo_privado', resultado: 'ok',
  }));

  const prohibido = createResponse();
  await deletePrivateFileHandler(
    requestWithPath('private/owner-1/reports/r1.pdf'),
    prohibido.res,
    createDependencies(createFile(), { audit, authenticate: async () => ({ uid: 'panel-1', role: 'panel' as const }) }),
  );
  expect(prohibido.result.status).toBe(403);
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ resultado: 'forbidden' }));

  for (const call of audit.mock.calls as unknown as [{ entidadId: string }][]) {
    expect(call[0].entidadId).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(call[0])).not.toContain(path);
  }
});

it('permite a admin consultar reports', async () => {
  const { res, result } = createResponse();
  const dependencies = createDependencies(createFile({
    ownerUid: 'owner-1',
    category: 'reports',
    visibility: 'private',
  }), {
    authenticate: async () => ({ uid: 'admin-1', role: 'admin' as const }),
  });

  await getPrivateFileUrlHandler(
    requestWithPath('private/owner-1/reports/evidence.pdf'),
    res,
    dependencies,
  );

  expect(result.status).toBe(200);
});

it('rechaza panel para reports antes de consultar Storage', async () => {
  const { res, result } = createResponse();
  const dependencies = createDependencies(undefined, {
    authenticate: async () => ({ uid: 'panel-1', role: 'panel' as const }),
  });

  await getPrivateFileUrlHandler(
    requestWithPath('private/owner-1/reports/evidence.pdf'),
    res,
    dependencies,
  );

  expect(result.status).toBe(403);
  expect(dependencies.getFile).not.toHaveBeenCalled();
});

it.each([
  ['GET', { 'content-type': 'application/json' }],
  ['POST', { 'content-type': 'text/plain' }],
] as const)('rechaza método o Content-Type inválido', async (method, headers) => {
  const { res, result } = createResponse();
  const authenticate = vi.fn(async () => ({ uid: 'owner-1', role: 'user' as const }));

  await getPrivateFileUrlHandler(
    requestWithPath('private/owner-1/receipts/r1.pdf', { method, headers }),
    res,
    createDependencies(undefined, { authenticate }),
  );

  expect(result.status).toBe(method === 'GET' ? 405 : 400);
  expect(authenticate).not.toHaveBeenCalled();
});

it('autentica antes de leer un body inválido', async () => {
  const { res, result } = createResponse();
  const authenticate = vi.fn(async () => { throw new Error('private auth details'); });

  await getPrivateFileUrlHandler(
    requestWithPath('private/owner-1/receipts/r1.pdf', { body: { uid: 'attacker' } }),
    res,
    createDependencies(undefined, { authenticate }),
  );

  expect(result.status).toBe(401);
  expect(result.body).toEqual({ error: { code: 'unauthenticated', message: 'Authentication required' } });
});

it('rechaza body distinto de { path } sin consultar Storage', async () => {
  const { res, result } = createResponse();
  const dependencies = createDependencies(undefined, {
    getFile: vi.fn(),
  });

  await getPrivateFileUrlHandler(
    requestWithPath('private/owner-1/receipts/r1.pdf', { body: { path: 'private/owner-1/receipts/r1.pdf', uid: 'attacker' } }),
    res,
    dependencies,
  );

  expect(result.status).toBe(400);
  expect(result.body).toEqual({ error: { code: 'invalid-input', message: 'Invalid input' } });
  expect(dependencies.getFile).not.toHaveBeenCalled();
});

it('responde file-not-found sin detalles para objeto ausente o metadata pública', async () => {
  for (const file of [
    { ...createFile(), exists: vi.fn(async () => [false] as [boolean]) },
    { ...createFile(), getMetadata: vi.fn(async () => [{}] as [{ metadata?: Record<string, string> }]) },
    createFile({ ownerUid: 'owner-1', category: 'receipts', visibility: 'public' }),
  ]) {
    const { res, result } = createResponse();
    await getPrivateFileUrlHandler(
      requestWithPath('private/owner-1/receipts/r1.pdf'),
      res,
      createDependencies(file),
    );
    expect(result.status).toBe(404);
    expect(result.body).toEqual({ error: { code: 'file-not-found', message: 'File not found' } });
    expect(JSON.stringify(result.body)).not.toMatch(/private\/owner-1|ownerUid|public/i);
  }
});

it('devuelve 429 con Retry-After y no firma la URL', async () => {
  const { res, result } = createResponse();
  const file = createFile();
  const rateLimiter = vi.fn(async () => { throw new RateLimitError(37); });

  await getPrivateFileUrlHandler(
    requestWithPath('private/owner-1/receipts/r1.pdf'),
    res,
    createDependencies(file, { rateLimiter }),
  );

  expect(result.status).toBe(429);
  expect(result.headers['Retry-After']).toBe('37');
  expect(file.getSignedUrl).not.toHaveBeenCalled();
});

it('elimina un archivo autorizado y responde solo success', async () => {
  const { res, result } = createResponse();
  const file = createFile();
  const dependencies = createDependencies(file);

  await deletePrivateFileHandler(
    requestWithPath('private/owner-1/receipts/r1.pdf'),
    res,
    dependencies,
  );

  expect(result.status).toBe(200);
  expect(result.body).toEqual({ success: true });
  expect(dependencies.deleteFile).toHaveBeenCalledWith(file);
});

it('no elimina un archivo ajeno aunque exista', async () => {
  const { res, result } = createResponse();
  const file = createFile();
  const dependencies = createDependencies(file, {
    authenticate: async () => ({ uid: 'other-1', role: 'user' as const }),
  });

  await deletePrivateFileHandler(
    requestWithPath('private/owner-1/receipts/r1.pdf'),
    res,
    dependencies,
  );

  expect(result.status).toBe(403);
  expect(dependencies.getFile).not.toHaveBeenCalled();
  expect(dependencies.deleteFile).not.toHaveBeenCalled();
});
