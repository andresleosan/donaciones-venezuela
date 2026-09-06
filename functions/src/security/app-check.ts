import { getAppCheck } from 'firebase-admin/app-check';

export type AppCheckMode = 'disabled' | 'log-only' | 'enforced';

export class AppCheckError extends Error {
  constructor(
    public readonly code: 'app-check-required' = 'app-check-required',
    public readonly status: 403 = 403,
    message = 'App Check required',
  ) {
    super(message);
    this.name = 'AppCheckError';
  }
}

type AppCheckRequest = {
  headers?: Record<string, unknown>;
  get?: (name: string) => string | null | undefined;
};

export type AppCheckVerifier = (token: string) => Promise<unknown>;

// Fail-closed: un valor ausente o desconocido pasa a 'enforced'. La unica
// excepcion es Emulator Suite, donde no hay proveedor de atestacion y exigirla
// dejaria toda la suite sin poder llamar a ninguna Function.
export function getAppCheckMode(
  value: unknown = process.env.APP_CHECK_MODE,
  isEmulator: boolean = process.env.FUNCTIONS_EMULATOR === 'true',
): AppCheckMode {
  if (value === 'log-only' || value === 'enforced' || value === 'disabled') return value;
  return isEmulator ? 'disabled' : 'enforced';
}

function getAppCheckToken(request: AppCheckRequest): string | null {
  const token = request.get?.('x-firebase-appcheck')
    ?? request.get?.('X-Firebase-AppCheck')
    ?? request.headers?.['x-firebase-appcheck']
    ?? request.headers?.['X-Firebase-AppCheck'];
  return typeof token === 'string' && token.trim() ? token.trim() : null;
}

const defaultVerifier: AppCheckVerifier = (token) => getAppCheck().verifyToken(token);

export async function verifyConfiguredAppCheck(
  request: AppCheckRequest,
  verifier: AppCheckVerifier = defaultVerifier,
  configuredMode: unknown = process.env.APP_CHECK_MODE,
): Promise<{ mode: AppCheckMode; verified: boolean }> {
  const mode = getAppCheckMode(configuredMode);
  if (mode === 'disabled') return { mode, verified: false };

  const token = getAppCheckToken(request);
  if (!token) {
    if (mode === 'enforced') throw new AppCheckError();
    return { mode, verified: false };
  }

  try {
    await verifier(token);
    return { mode, verified: true };
  } catch {
    if (mode === 'enforced') throw new AppCheckError();
    return { mode, verified: false };
  }
}
