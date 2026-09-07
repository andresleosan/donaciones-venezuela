import { createHash } from 'node:crypto';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

// Cubos portados del backend legado (docs/reference/contrato-acciones-legado.md,
// seccion "Reglas transversales") mas los dos cubos propios de Functions.
//
// `key` dice sobre que identidad se cuenta: 'uid' exige sesion, 'ip' no.
// El nombre del cubo forma parte de la clave del documento, asi que dos
// endpoints distintos nunca comparten cuota aunque cuenten sobre el mismo uid.
export const RATE_LIMITS = {
  // Consentimiento publico de voluntariado (endpoint propio, muy acotado).
  uid: { limit: 5, windowMs: 60 * 60 * 1000, key: 'uid' },
  request: { limit: 20, windowMs: 60 * 60 * 1000, key: 'ip' },
  // Clases de accion del contrato legado.
  publico: { limit: 30, windowMs: 60 * 60 * 1000, key: 'ip' },
  lectura: { limit: 240, windowMs: 60 * 60 * 1000, key: 'ip' },
  denuncia: { limit: 400, windowMs: 60 * 60 * 1000, key: 'ip' },
  panel: { limit: 120, windowMs: 60 * 60 * 1000, key: 'uid' },
  admin: { limit: 60, windowMs: 60 * 60 * 1000, key: 'uid' },
  adminLectura: { limit: 600, windowMs: 60 * 60 * 1000, key: 'uid' },
  // Anti-rafaga: ventana de un segundo por IP.
  rafaga: { limit: 12, windowMs: 1000, key: 'ip' },
  // URLs firmadas y borrado de archivos privados.
  archivos: { limit: 60, windowMs: 60 * 60 * 1000, key: 'uid' },
  // Revelar un dato de contacto de una persona, de uno en uno
  // (`contactar_motorizado`, y `contactar_vacante` en la Task 3.3). Va por uid y
  // no por IP a proposito: el cubo `lectura` (240/h por IP) dejaria a un solo
  // host recolectar cientos de telefonos por hora, que es justo lo que se evita
  // sacandolos de la proyeccion publica.
  contacto: { limit: 30, windowMs: 60 * 60 * 1000, key: 'uid' },
} as const;

export type RateLimitBucket = keyof typeof RATE_LIMITS;

type RateLimitDocument = {
  bucket: RateLimitBucket;
  windowStart: number;
  hits: number;
  // Timestamp (no número): es el campo que purga la política TTL de Firestore
  // (`gcloud firestore fields ttls update expiresAt --collection-group=rateLimits --enable-ttl`).
  expiresAt: Timestamp;
};

type ExpiresAtLike = { toMillis(): number };

// Acepta Timestamp (formato vigente) y número (documentos escritos antes del TTL)
// para no bloquear una clave por un documento heredado; devuelve NaN si no es válido.
function expiresAtMillis(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value !== null && typeof value === 'object' && typeof (value as ExpiresAtLike).toMillis === 'function') {
    const millis = (value as ExpiresAtLike).toMillis();
    return typeof millis === 'number' ? millis : Number.NaN;
  }
  return Number.NaN;
}

type DocumentReference = { path?: string };

type DocumentSnapshot = {
  exists: boolean;
  data(): unknown;
};

type Transaction = {
  get(reference: DocumentReference): Promise<DocumentSnapshot>;
  set(reference: DocumentReference, data: RateLimitDocument): void;
};

type FirestoreAdapter = {
  collection(name: string): {
    doc(id?: string): DocumentReference;
  };
  runTransaction<T>(callback: (transaction: Transaction) => Promise<T>): Promise<T>;
};

export class RateLimitError extends Error {
  readonly code = 'rate-limit-exceeded';

  constructor(public readonly retryAfter: number) {
    super('Too many requests');
    this.name = 'RateLimitError';
  }
}

export function hashRateLimitKey(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

// La clave lleva el cubo dentro: `<uid|ip>:<cubo>:<hash de la identidad>`.
// Sin el cubo, el consentimiento y las URLs firmadas se agotarian entre si.
export function createRateLimitKey(bucket: RateLimitBucket, identity: string): string {
  const rateLimit = RATE_LIMITS[bucket];
  const normalized = typeof identity === 'string' ? identity.trim() : '';
  if (!normalized) {
    throw new Error(rateLimit.key === 'uid' ? 'uid-identity-required' : 'request-identity-required');
  }
  return `${rateLimit.key}:${bucket}:${hashRateLimitKey(normalized)}`;
}

export function createUidRateLimitKey(uid: string, bucket: RateLimitBucket = 'uid'): string {
  if (RATE_LIMITS[bucket].key !== 'uid') throw new Error('rate-limit-bucket-invalid');
  if (typeof uid !== 'string' || !uid.trim()) throw new Error('uid-identity-required');
  return createRateLimitKey(bucket, uid);
}

export function createRequestRateLimitKey(reqIp: string | undefined, bucket: RateLimitBucket = 'request'): string {
  if (RATE_LIMITS[bucket].key !== 'ip') throw new Error('rate-limit-bucket-invalid');
  if (typeof reqIp !== 'string') throw new Error('request-identity-required');
  if (!reqIp.trim()) throw new Error('request-identity-required');
  return createRateLimitKey(bucket, reqIp);
}

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const IPV6 = /^[0-9a-f:]{3,45}$/i;

// IP del cliente detras del proxy de Cloud Run: primer salto de X-Forwarded-For.
// `req.ip` no sirve (devuelve la direccion del front-end de Google y colapsaria
// todo el trafico anonimo en un solo cubo).
export function clientIp(request: {
  headers?: Record<string, string | string[] | undefined>;
  get?: (name: string) => string | null | undefined;
  ip?: string;
}): string {
  const raw = request.get?.('x-forwarded-for')
    ?? request.headers?.['x-forwarded-for']
    ?? request.headers?.['X-Forwarded-For'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  const first = typeof header === 'string' ? header.split(',')[0]?.trim() ?? '' : '';
  if (IPV4.test(first) && first.split('.').every((part) => Number(part) <= 255)) return first;
  if (first.includes(':') && IPV6.test(first)) return first;
  return 'desconocida';
}

function defaultFirestore(): FirestoreAdapter {
  return getFirestore() as unknown as FirestoreAdapter;
}

function isRateLimitBucket(value: string): value is RateLimitBucket {
  return Object.prototype.hasOwnProperty.call(RATE_LIMITS, value);
}

function isRateLimitDocument(
  value: unknown,
  bucket: RateLimitBucket,
  windowMs: number,
): value is RateLimitDocument {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const document = value as Record<string, unknown>;
  const expiresAt = expiresAtMillis(document.expiresAt);
  return document.bucket === bucket
    && typeof document.windowStart === 'number'
    && Number.isSafeInteger(document.windowStart)
    && document.windowStart >= 0
    && document.windowStart % windowMs === 0
    && typeof document.hits === 'number'
    && Number.isSafeInteger(document.hits)
    && document.hits >= 0
    && Number.isSafeInteger(expiresAt)
    && expiresAt === document.windowStart + windowMs;
}

export async function consumeRateLimit(
  bucket: string,
  keyValue: string,
  now: number,
  db?: FirestoreAdapter,
): Promise<{ allowed: true; hits: number; retryAfter: 0 }> {
  if (!isRateLimitBucket(bucket)) throw new Error('rate-limit-bucket-invalid');
  if (!Number.isFinite(now) || now < 0) throw new Error('rate-limit-clock-invalid');

  const rateLimit = RATE_LIMITS[bucket];
  const rateLimitKey = createRateLimitKey(bucket, keyValue);
  const keyHash = hashRateLimitKey(rateLimitKey);
  const windowStart = Math.floor(now / rateLimit.windowMs) * rateLimit.windowMs;
  const expiresAt = windowStart + rateLimit.windowMs;

  try {
    const firestore = db ?? defaultFirestore();
    const reference = firestore.collection('rateLimits').doc(keyHash);
    return await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const snapshotData = snapshot.data();
      if (snapshot.exists && !isRateLimitDocument(snapshotData, bucket, rateLimit.windowMs)) {
        throw new Error('rate-limit-document-corrupt');
      }
      const previous = snapshot.exists ? snapshotData as RateLimitDocument : undefined;
      const current = previous?.windowStart === windowStart
        ? previous.hits
        : 0;

      if (current >= rateLimit.limit) {
        const retryAfter = Math.max(1, Math.ceil((expiresAt - now) / 1000));
        throw new RateLimitError(retryAfter);
      }

      const hits = current + 1;
      transaction.set(reference, {
        bucket,
        windowStart,
        hits,
        expiresAt: Timestamp.fromMillis(expiresAt),
      });

      return { allowed: true, hits, retryAfter: 0 };
    });
  } catch (error) {
    if (error instanceof RateLimitError) throw error;
    throw new Error('rate-limit-storage-failed');
  }
}
