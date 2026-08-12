import { createHash } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';

export const RATE_LIMITS = {
  uid: { limit: 5, windowMs: 60 * 60 * 1000 },
  request: { limit: 20, windowMs: 60 * 60 * 1000 },
} as const;

type RateLimitBucket = keyof typeof RATE_LIMITS;

type RateLimitDocument = {
  bucket: RateLimitBucket;
  windowStart: number;
  hits: number;
  expiresAt: number;
};

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

export function createUidRateLimitKey(uid: string): string {
  if (!uid.trim()) throw new Error('uid-identity-required');
  return `uid:${hashRateLimitKey(uid)}`;
}

export function createRequestRateLimitKey(reqIp: string | undefined): string {
  if (typeof reqIp !== 'string') throw new Error('request-identity-required');
  const normalizedIp = reqIp.trim();
  if (!normalizedIp) throw new Error('request-identity-required');
  return `request:${hashRateLimitKey(normalizedIp)}`;
}

function defaultFirestore(): FirestoreAdapter {
  return getFirestore() as unknown as FirestoreAdapter;
}

function isRateLimitBucket(value: string): value is RateLimitBucket {
  return value === 'uid' || value === 'request';
}

function isRateLimitDocument(
  value: unknown,
  bucket: RateLimitBucket,
  windowMs: number,
): value is RateLimitDocument {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const document = value as Record<string, unknown>;
  return document.bucket === bucket
    && typeof document.windowStart === 'number'
    && Number.isSafeInteger(document.windowStart)
    && document.windowStart >= 0
    && document.windowStart % windowMs === 0
    && typeof document.hits === 'number'
    && Number.isSafeInteger(document.hits)
    && document.hits >= 0
    && typeof document.expiresAt === 'number'
    && Number.isSafeInteger(document.expiresAt)
    && document.expiresAt === document.windowStart + windowMs;
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
  const rateLimitKey = bucket === 'uid'
    ? createUidRateLimitKey(keyValue)
    : createRequestRateLimitKey(keyValue);
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
        expiresAt,
      });

      return { allowed: true, hits, retryAfter: 0 };
    });
  } catch (error) {
    if (error instanceof RateLimitError) throw error;
    throw new Error('rate-limit-storage-failed');
  }
}
