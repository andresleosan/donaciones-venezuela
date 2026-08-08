import {
  authenticateRequest,
  type AuthContext,
  AuthError,
} from './authorization.js';

type SessionRequest = Parameters<typeof authenticateRequest>[0] & {
  method: string;
};

type SessionResponse = {
  setHeader(name: string, value: string): void;
  status(code: number): SessionResponse;
  json(body: unknown): void;
};

type Authenticator = (request: SessionRequest) => Promise<AuthContext>;

export async function authSessionHandler(
  req: SessionRequest,
  res: SessionResponse,
  authenticate: Authenticator = authenticateRequest,
): Promise<void> {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({
      error: { code: 'method-not-allowed', message: 'Method not allowed' },
    });
    return;
  }

  try {
    const { uid, role } = await authenticate(req);
    res.status(200).json({ uid, role });
  } catch (error) {
    if (error instanceof AuthError) {
      res.status(error.status).json({
        error: { code: error.code, message: error.message },
      });
      return;
    }

    res.status(401).json({
      error: { code: 'unauthenticated', message: 'Authentication required' },
    });
  }
}
