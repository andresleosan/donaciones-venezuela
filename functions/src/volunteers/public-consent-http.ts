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

type ConsentRequestHttp = {
  method: string;
  body?: unknown;
  headers?: { authorization?: string };
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

type ConsentApplier = (request: ConsentRequestHttp) => Promise<ConsentResult>;

const PUBLIC_ERRORS: Record<string, { status: number; message: string }> = {
  'invalid-input': { status: 400, message: 'Invalid input' },
  'invalid-consent-version': { status: 400, message: 'Invalid consent version' },
  forbidden: { status: 403, message: 'Forbidden' },
  'volunteer-not-found': { status: 404, message: 'Volunteer not found' },
  'volunteer-not-active': { status: 409, message: 'Volunteer not active' },
};

function errorCode(error: unknown): string | null {
  return error instanceof Error ? error.message : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function defaultFirestore(): FirestoreAdapter {
  return getFirestore() as unknown as FirestoreAdapter;
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

async function applyConsent(request: ConsentRequestHttp): Promise<ConsentResult> {
  const context = await authenticateRequest(request);
  const input = parseConsentRequest(request.body);
  return applyConsentTransaction(input, context);
}

export async function setVolunteerPublicConsentHandler(
  req: ConsentRequestHttp,
  res: ConsentResponse,
  apply: ConsentApplier = applyConsent,
): Promise<void> {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({
      error: { code: 'method-not-allowed', message: 'Method not allowed' },
    });
    return;
  }

  try {
    const result = await apply(req);
    res.status(200).json(result);
  } catch (error) {
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
