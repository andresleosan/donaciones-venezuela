import { expect, it } from 'vitest';
import {
  RATE_LIMITS,
  consumeRateLimit,
  createRequestRateLimitKey,
  createUidRateLimitKey,
  hashRateLimitKey,
} from '../../functions/src/security/rate-limit.js';

type RateLimitDocument = {
  bucket: 'uid' | 'request';
  windowStart: number;
  hits: number;
  expiresAt: number;
};

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
  expect(createUidRateLimitKey('uid-1')).toBe(`uid:${hashRateLimitKey('uid-1')}`);
  expect(createRequestRateLimitKey('203.0.113.7')).toBe(
    `request:${hashRateLimitKey('203.0.113.7')}`,
  );
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
  expect(Object.values(db.committed())[0]).toEqual({
    bucket: 'request',
    windowStart: 0,
    hits: 1,
    expiresAt: 3600000,
  });
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
