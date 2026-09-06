import { expect, it } from 'vitest';
import {
  RATE_LIMITS,
  clientIp,
  consumeRateLimit,
  createRateLimitKey,
  createRequestRateLimitKey,
  createUidRateLimitKey,
  hashRateLimitKey,
} from '../../functions/src/security/rate-limit.js';

type RateLimitDocument = {
  bucket: 'uid' | 'request';
  windowStart: number;
  hits: number;
  expiresAt: number | { toMillis(): number };
};

function expiresAtMillis(document: unknown): number {
  const value = (document as RateLimitDocument).expiresAt;
  return typeof value === 'number' ? value : value.toMillis();
}

function createRateLimitDb(options: {
  failOnSet?: boolean;
  initialDocuments?: Record<string, unknown>;
} = {}) {
  const committedDocuments: Record<string, unknown> = { ...options.initialDocuments };
  const references = new Map<string, { path: string }>();
  const referenceFor = (path: string) => {
    const existing = references.get(path);
    if (existing) return existing;
    const reference = { path };
    references.set(path, reference);
    return reference;
  };

  const db = {
    collection(name: string) {
      return {
        doc(id?: string) {
          return referenceFor(`${name}/${id ?? 'generated'}`);
        },
      };
    },
    async runTransaction<T>(callback: (transaction: {
      get(reference: { path: string }): Promise<{ exists: boolean; data(): unknown }>;
      set(reference: { path: string }, data: RateLimitDocument): void;
    }) => Promise<T>): Promise<T> {
      const pending = new Map<string, RateLimitDocument>();
      const transaction = {
        async get(reference: { path: string }) {
          const data = pending.get(reference.path) ?? committedDocuments[reference.path];
          return { exists: data !== undefined, data: () => data };
        },
        set(reference: { path: string }, data: RateLimitDocument) {
          if (options.failOnSet) throw new Error('private firestore details');
          pending.set(reference.path, data);
        },
      };

      const result = await callback(transaction);
      for (const [path, data] of pending) committedDocuments[path] = data;
      return result;
    },
    committed() {
      return { ...committedDocuments };
    },
  };

  return db;
}

it('hashea la clave sin guardar el valor original', () => {
  expect(hashRateLimitKey('uid-1')).toMatch(/^[a-f0-9]{64}$/);
  expect(hashRateLimitKey('uid-1')).not.toContain('uid-1');
  expect(createUidRateLimitKey('uid-1')).toBe(`uid:uid:${hashRateLimitKey('uid-1')}`);
  expect(createRequestRateLimitKey('203.0.113.7')).toBe(
    `ip:request:${hashRateLimitKey('203.0.113.7')}`,
  );
});

it('separa el cupo por cubo: dos endpoints no comparten cuota con la misma identidad', async () => {
  expect(createRateLimitKey('uid', 'uid-1')).not.toBe(createRateLimitKey('archivos', 'uid-1'));

  const db = createRateLimitDb();
  for (let attempt = 1; attempt <= RATE_LIMITS.uid.limit; attempt += 1) {
    await consumeRateLimit('uid', 'uid-1', 0, db);
  }
  await expect(consumeRateLimit('uid', 'uid-1', 0, db)).rejects.toMatchObject({
    code: 'rate-limit-exceeded',
  });

  // El mismo uid conserva intacto el cupo de archivos.
  await expect(consumeRateLimit('archivos', 'uid-1', 0, db)).resolves.toMatchObject({
    allowed: true,
    hits: 1,
  });
});

it.each([
  ['publico', 30, 3_600_000, 'ip'],
  ['lectura', 240, 3_600_000, 'ip'],
  ['denuncia', 400, 3_600_000, 'ip'],
  ['panel', 120, 3_600_000, 'uid'],
  ['admin', 60, 3_600_000, 'uid'],
  ['adminLectura', 600, 3_600_000, 'uid'],
  ['rafaga', 12, 1000, 'ip'],
  ['archivos', 60, 3_600_000, 'uid'],
] as const)('el cubo %s conserva el limite del contrato legado', (bucket, limit, windowMs, key) => {
  expect(RATE_LIMITS[bucket]).toEqual({ limit, windowMs, key });
});

it('la rafaga usa una ventana de un segundo', async () => {
  const db = createRateLimitDb();
  for (let attempt = 1; attempt <= RATE_LIMITS.rafaga.limit; attempt += 1) {
    await consumeRateLimit('rafaga', '203.0.113.7', 1_000_500, db);
  }
  await expect(consumeRateLimit('rafaga', '203.0.113.7', 1_000_500, db)).rejects.toMatchObject({
    code: 'rate-limit-exceeded',
    retryAfter: 1,
  });
  // Un segundo despues la ventana ya es otra.
  await expect(consumeRateLimit('rafaga', '203.0.113.7', 1_001_500, db)).resolves.toMatchObject({
    allowed: true,
    hits: 1,
  });
});

it('rechaza un cubo que no existe', async () => {
  await expect(consumeRateLimit('inventado', 'uid-1', 0)).rejects.toThrow('rate-limit-bucket-invalid');
  expect(() => createUidRateLimitKey('uid-1', 'publico')).toThrow('rate-limit-bucket-invalid');
  expect(() => createRequestRateLimitKey('203.0.113.7', 'panel')).toThrow('rate-limit-bucket-invalid');
});

it('clientIp toma el primer salto de X-Forwarded-For y descarta basura', () => {
  expect(clientIp({ headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1, 172.16.0.1' } })).toBe('203.0.113.7');
  expect(clientIp({ get: () => ' 198.51.100.4 ' })).toBe('198.51.100.4');
  expect(clientIp({ headers: { 'x-forwarded-for': '2001:db8::1, 10.0.0.1' } })).toBe('2001:db8::1');
  expect(clientIp({ headers: { 'x-forwarded-for': 'no-es-una-ip' } })).toBe('desconocida');
  expect(clientIp({ headers: { 'x-forwarded-for': '999.1.1.1' } })).toBe('desconocida');
  expect(clientIp({})).toBe('desconocida');
  // Nunca cae a req.ip: en Cloud Run es la direccion del proxy de Google.
  expect(clientIp({ ip: '10.0.0.1' })).toBe('desconocida');
});

it('permite cinco requests UID y rechaza la sexta', async () => {
  const db = createRateLimitDb();
  for (let attempt = 1; attempt <= RATE_LIMITS.uid.limit; attempt += 1) {
    await expect(consumeRateLimit('uid', 'uid-1', 0, db)).resolves.toMatchObject({
      allowed: true,
      hits: attempt,
    });
  }

  await expect(consumeRateLimit('uid', 'uid-1', 0, db)).rejects.toMatchObject({
    code: 'rate-limit-exceeded',
    retryAfter: 3600,
  });
});

it('limita requests por IP a veinte dentro de una hora', async () => {
  const db = createRateLimitDb();
  for (let attempt = 1; attempt <= RATE_LIMITS.request.limit; attempt += 1) {
    await expect(consumeRateLimit('request', '203.0.113.7', 0, db)).resolves.toMatchObject({
      allowed: true,
      hits: attempt,
    });
  }

  await expect(consumeRateLimit('request', '203.0.113.7', 0, db)).rejects.toMatchObject({
    code: 'rate-limit-exceeded',
    retryAfter: 3600,
  });
});

it('reinicia una ventana expirada', async () => {
  const db = createRateLimitDb();
  await consumeRateLimit('uid', 'uid-1', 0, db);

  await expect(consumeRateLimit('uid', 'uid-1', 3600001, db)).resolves.toMatchObject({
    allowed: true,
    hits: 1,
  });
});

it('rechaza IP ausente sin usar una clave global', async () => {
  expect(() => createRequestRateLimitKey('')).toThrow('request-identity-required');
  expect(() => createRequestRateLimitKey('   ')).toThrow('request-identity-required');
  expect(() => createRequestRateLimitKey(undefined)).toThrow('request-identity-required');
  expect(() => createRequestRateLimitKey(42 as never)).toThrow('request-identity-required');
});

it('normaliza los fallos al inicializar Firestore o construir la referencia', async () => {
  const db = {
    collection() {
      throw new Error('private adapter details');
    },
  } as NonNullable<Parameters<typeof consumeRateLimit>[3]>;

  await expect(consumeRateLimit('uid', 'uid-1', 0, db)).rejects.toThrow(
    'rate-limit-storage-failed',
  );
});

it('normaliza el fallo del Firestore por defecto sin filtrar detalles', async () => {
  await expect(consumeRateLimit('uid', 'uid-1', 0)).rejects.toThrow('rate-limit-storage-failed');
});

it('no deja write committed cuando falla la transaccion', async () => {
  const db = createRateLimitDb({ failOnSet: true });

  await expect(consumeRateLimit('uid', 'uid-1', 0, db)).rejects.toThrow('rate-limit-storage-failed');
  expect(db.committed()).toEqual({});
});

it('persiste solo datos derivados del limite sin valores sensibles', async () => {
  const db = createRateLimitDb();
  await consumeRateLimit('request', '203.0.113.7', 0, db);

  const serialized = JSON.stringify(db.committed());
  expect(serialized).not.toContain('203.0.113.7');
  expect(serialized).not.toMatch(/token|email|body|header|raw.?ip/i);
  const [document] = Object.values(db.committed());
  expect(document).toMatchObject({ bucket: 'request', windowStart: 0, hits: 1 });
  expect(document).not.toHaveProperty('expiresAt', 3600000);
  expect(expiresAtMillis(document)).toBe(3600000);
});

it('guarda expiresAt como Timestamp para que la politica TTL de Firestore purgue la ventana', async () => {
  const db = createRateLimitDb();
  await consumeRateLimit('uid', 'uid-1', 7_200_000 + 15, db);

  const [document] = Object.values(db.committed()) as RateLimitDocument[];
  expect(typeof document.expiresAt).toBe('object');
  expect(typeof (document.expiresAt as { toMillis(): number }).toMillis).toBe('function');
  expect(expiresAtMillis(document)).toBe(7_200_000 + RATE_LIMITS.uid.windowMs);
  expect(document.windowStart).toBe(7_200_000);
});

it('acepta un documento heredado con expiresAt numerico y lo reescribe como Timestamp', async () => {
  const keyHash = hashRateLimitKey(createUidRateLimitKey('uid-1'));
  const db = createRateLimitDb({
    initialDocuments: {
      [`rateLimits/${keyHash}`]: { bucket: 'uid', windowStart: 0, hits: 1, expiresAt: 3600000 },
    },
  });

  await expect(consumeRateLimit('uid', 'uid-1', 0, db)).resolves.toEqual({ allowed: true, hits: 2, retryAfter: 0 });
  const document = db.committed()[`rateLimits/${keyHash}`] as RateLimitDocument;
  expect(document.hits).toBe(2);
  expect(typeof document.expiresAt).toBe('object');
  expect(expiresAtMillis(document)).toBe(3600000);
});

it('rechaza un Timestamp de expiracion que no coincide con la ventana', async () => {
  const keyHash = hashRateLimitKey(createUidRateLimitKey('uid-1'));
  const db = createRateLimitDb({
    initialDocuments: {
      [`rateLimits/${keyHash}`]: {
        bucket: 'uid', windowStart: 0, hits: 1, expiresAt: { toMillis: () => 3600001 },
      },
    },
  });

  await expect(consumeRateLimit('uid', 'uid-1', 0, db)).rejects.toThrow('rate-limit-storage-failed');
});

it.each([
  { hits: Number.NaN },
  { hits: -1 },
  { hits: 1.5 },
  { windowStart: Number.POSITIVE_INFINITY },
  { windowStart: -1 },
  { windowStart: 0.5 },
  { expiresAt: Number.NaN },
  { expiresAt: -1 },
  { expiresAt: 0.5 },
])('rechaza documentos de limite corruptos: %s', async (corruption) => {
  const keyHash = hashRateLimitKey(createUidRateLimitKey('uid-1'));
  const db = createRateLimitDb({
    initialDocuments: {
      [`rateLimits/${keyHash}`]: {
        bucket: 'uid',
        windowStart: 0,
        hits: 1,
        expiresAt: 3600000,
        ...corruption,
      },
    },
  });

  await expect(consumeRateLimit('uid', 'uid-1', 0, db)).rejects.toThrow(
    'rate-limit-storage-failed',
  );
});

it('rechaza un documento cuyo bucket no coincide con el solicitado', async () => {
  const keyHash = hashRateLimitKey(createUidRateLimitKey('uid-1'));
  const db = createRateLimitDb({
    initialDocuments: {
      [`rateLimits/${keyHash}`]: {
        bucket: 'request',
        windowStart: 0,
        hits: 1,
        expiresAt: 3600000,
      },
    },
  });

  await expect(consumeRateLimit('uid', 'uid-1', 0, db)).rejects.toThrow(
    'rate-limit-storage-failed',
  );
  expect(db.committed()).toEqual({
    [`rateLimits/${keyHash}`]: {
      bucket: 'request',
      windowStart: 0,
      hits: 1,
      expiresAt: 3600000,
    },
  });
});

it('rechaza ventanas almacenadas inconsistentes con su bucket', async () => {
  const keyHash = hashRateLimitKey(createUidRateLimitKey('uid-1'));
  const db = createRateLimitDb({
    initialDocuments: {
      [`rateLimits/${keyHash}`]: {
        bucket: 'uid',
        windowStart: 0,
        hits: 1,
        expiresAt: 3600001,
      },
    },
  });

  await expect(consumeRateLimit('uid', 'uid-1', 0, db)).rejects.toThrow(
    'rate-limit-storage-failed',
  );
  expect(db.committed()).toEqual({
    [`rateLimits/${keyHash}`]: {
      bucket: 'uid',
      windowStart: 0,
      hits: 1,
      expiresAt: 3600001,
    },
  });
});
