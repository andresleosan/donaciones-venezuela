import { getAuth } from 'firebase-admin/auth';

export type Role = 'user' | 'panel' | 'admin';
export type AuthContext = { uid: string; role: Role };

export class AuthError extends Error {
  constructor(
    public readonly code: 'unauthenticated' | 'forbidden',
    public readonly status: 401 | 403,
    message: string,
  ) {
    super(message);
  }
}

type TokenClaims = {
  uid?: unknown;
  role?: unknown;
};

type VerifyIdToken = (token: string) => Promise<TokenClaims>;

type AuthRequest = {
  headers?: {
    authorization?: string;
  };
  get?: (name: string) => string | null | undefined;
};

function getAuthorizationHeader(request: AuthRequest): string | null {
  const authorization = request.headers?.authorization ?? request.get?.('authorization');
  return typeof authorization === 'string' ? authorization : null;
}

function toUnauthenticatedError(): AuthError {
  return new AuthError('unauthenticated', 401, 'Authentication required');
}

export async function authenticateRequest(
  request: AuthRequest,
  verifyIdToken: VerifyIdToken = (token) => getAuth().verifyIdToken(token),
): Promise<AuthContext> {
  try {
    const authorization = getAuthorizationHeader(request);
    if (!authorization?.startsWith('Bearer ')) throw toUnauthenticatedError();

    const token = authorization.slice('Bearer '.length).trim();
    if (!token) throw toUnauthenticatedError();

    const claims = await verifyIdToken(token);
    if (typeof claims.uid !== 'string' || !claims.uid.trim()) {
      throw toUnauthenticatedError();
    }

    const role: Role = claims.role === 'panel' || claims.role === 'admin'
      ? claims.role
      : 'user';

    return { uid: claims.uid, role };
  } catch {
    throw toUnauthenticatedError();
  }
}

export function requireRole(
  context: AuthContext,
  allowedRoles: readonly Role[],
): void {
  if (!allowedRoles.includes(context.role)) {
    throw new AuthError('forbidden', 403, 'Forbidden');
  }
}
