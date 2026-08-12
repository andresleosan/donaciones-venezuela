import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  authenticateRequest,
  AuthError,
  type AuthContext,
} from '../auth/authorization.js';
import {
  assertConsentPermission,
  buildConsentMutation,
  parseConsentRequest,
  type ConsentRequest,
} from './public-consent.js';
import {
  AppCheckError,
  verifyConfiguredAppCheck,
  type AppCheckMode,
  type AppCheckVerifier,
} from '../security/app-check.js';
import {
  consumeRateLimit,
  RateLimitError,
} from '../security/rate-limit.js';

type ConsentRequestHttp = {
  method: string;
  ip?: string;
  body?: unknown;
  headers?: {
    authorization?: string;
    'content-type'?: string;
    'x-firebase-appcheck'?: string;
    'X-Firebase-AppCheck'?: string;
  };
  get?: (name: string) => string | null | undefined;
};

type ConsentResponse = {
  setHeader(name: string, value: string): void;
  status(code: number): ConsentResponse;
  json(body: unknown): void;
};

type ConsentResult = {
  success: true;
  enabled: boolean;
  volunteerId: string;
};

type DocumentReference = { path?: string };
type DocumentSnapshot = {
  exists: boolean;
  data(): unknown;
};

type Transaction = {
  get(reference: DocumentReference): Promise<DocumentSnapshot>;
  update(reference: DocumentReference, data: unknown): void;
  set(reference: DocumentReference, data: unknown): void;
  delete(reference: DocumentReference): void;
};

type FirestoreAdapter = {
  collection(name: string): {
    doc(id?: string): DocumentReference;
  };
  runTransaction<T>(callback: (transaction: Transaction) => Promise<T>): Promise<T>;
};

type ConsentApplier = (
  request: ConsentRequestHttp,
  context?: AuthContext,
) => Promise<ConsentResult>;
type RateLimiter = (
  bucket: 'uid' | 'request',
  keyValue: string,
  now: number,
) => Promise<{ allowed: true; hits: number; retryAfter: 0 }>;
type ConsentGuardDependencies = {
  appCheckMode?: AppCheckMode;
  verifyAppCheck?: AppCheckVerifier;
  authenticate?: typeof authenticateRequest;
  rateLimiter?: RateLimiter;
  now?: () => number;
};

const PUBLIC_ERRORS: Record<string, { status: number; message: string }> = {
  'invalid-input': { status: 400, message: 'Invalid input' },
  'invalid-consent-version': { status: 400, message: 'Invalid consent version' },
  forbidden: { status: 403, message: 'Forbidden' },
  'volunteer-not-found': { status: 404, message: 'Volunteer not found' },
  'volunteer-not-active': { status: 409, message: 'Volunteer not active' },
  'app-check-required': { status: 403, message: 'App Check required' },
  'rate-limit-exceeded': { status: 429, message: 'Too many requests' },
};

function errorCode(error: unknown): string | null {
  if (isRecord(error) && typeof error.code === 'string') return error.code;
  return error instanceof Error ? error.message : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function defaultFirestore(): FirestoreAdapter {
  return getFirestore() as unknown as FirestoreAdapter;
}

function hasJsonContentType(request: ConsentRequestHttp): boolean {
  const contentType = request.get?.('content-type') ?? request.headers?.['content-type'];
  return typeof contentType === 'string'
    && contentType.split(';', 1)[0]?.trim().toLowerCase() === 'application/json';
}

export async function applyConsentTransaction(
  input: ConsentRequest,
  context: AuthContext,
  db: FirestoreAdapter = defaultFirestore(),
  now: unknown = FieldValue.serverTimestamp(),
): Promise<ConsentResult> {
  return db.runTransaction(async (transaction) => {
    const privateRef = db.collection('voluntarios').doc(input.volunteerId);
    const privateSnapshot = await transaction.get(privateRef);

    if (!privateSnapshot.exists) throw new Error('volunteer-not-found');

    const profile = privateSnapshot.data();
    if (!isRecord(profile)) throw new Error('volunteer-not-found');

    assertConsentPermission(context, profile, input.enabled);
    const mutation = buildConsentMutation(input, profile, {
      now,
      actorUid: context.uid,
    });

    transaction.update(privateRef, mutation.privatePatch);

    const publicRef = db.collection('voluntariosPublicos').doc(input.volunteerId);
    if (mutation.publicDocument) {
      transaction.set(publicRef, mutation.publicDocument);
    } else {
      transaction.delete(publicRef);
    }

    const auditRef = db.collection('auditoriaAdmin').doc();
    transaction.set(auditRef, mutation.audit);

    return {
      success: true,
      enabled: mutation.enabled,
      volunteerId: input.volunteerId,
    };
  });
}

async function applyConsent(
  request: ConsentRequestHttp,
  context?: AuthContext,
): Promise<ConsentResult> {
  const authenticatedContext = context ?? await authenticateRequest(request);
  const input = parseConsentRequest(request.body);
  return applyConsentTransaction(input, authenticatedContext);
}

export async function setVolunteerPublicConsentHandler(
  req: ConsentRequestHttp,
  res: ConsentResponse,
  apply: ConsentApplier = applyConsent,
  dependencies: ConsentGuardDependencies = {},
): Promise<void> {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({
      error: { code: 'method-not-allowed', message: 'Method not allowed' },
    });
    return;
  }

  if (!hasJsonContentType(req)) {
    res.status(400).json({
      error: { code: 'invalid-input', message: 'Invalid input' },
    });
    return;
  }

  try {
    await verifyConfiguredAppCheck(req, dependencies.verifyAppCheck, dependencies.appCheckMode);

    const authenticate = dependencies.authenticate ?? authenticateRequest;
    const rateLimiter = dependencies.rateLimiter ?? ((bucket, keyValue, now) => (
      consumeRateLimit(bucket, keyValue, now)
    ));
    const now = dependencies.now?.() ?? Date.now();
    let context: AuthContext;
    try {
      context = await authenticate(req);
    } catch (error) {
      if (!(error instanceof AuthError)) throw error;
      const requestIp = req.ip?.trim();
      if (requestIp) await rateLimiter('request', requestIp, now);
      throw error;
    }

    await rateLimiter('uid', context.uid, now);
    const result = await apply(req, context);
    const body = isRecord(req.body) ? req.body : undefined;
    const volunteerId = typeof body?.volunteerId === 'string' ? body.volunteerId.trim() : '';
    res.status(200).json({
      success: Boolean(result.success),
      enabled: Boolean(result.enabled),
      volunteerId,
    });
  } catch (error) {
    if (error instanceof RateLimitError) {
      res.setHeader('Retry-After', String(error.retryAfter));
      res.status(429).json({
        error: { code: error.code, message: 'Too many requests' },
      });
      return;
    }

    if (error instanceof AppCheckError) {
      res.status(403).json({
        error: { code: error.code, message: 'App Check required' },
      });
      return;
    }

    if (error instanceof AuthError) {
      res.status(error.status).json({
        error: {
          code: error.code,
          message: error.code === 'forbidden' ? 'Forbidden' : 'Authentication required',
        },
      });
      return;
    }

    const code = errorCode(error);
    const publicError = code ? PUBLIC_ERRORS[code] : undefined;
    if (publicError) {
      res.status(publicError.status).json({
        error: { code, message: publicError.message },
      });
      return;
    }

    res.status(500).json({
      error: { code: 'internal', message: 'Internal error' },
    });
  }
}
