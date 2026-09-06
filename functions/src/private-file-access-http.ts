import { createHash } from 'node:crypto';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import {
  authenticateRequest,
  AuthError,
  type AuthContext,
} from './auth/authorization.js';
import {
  canAccessPrivateFile,
  canDeletePrivateFile,
  privateUrlExpiresAt,
  validatePrivateStoragePath,
  type PrivateFileDescriptor,
} from './private-file-access.js';
import {
  clientIp,
  consumeRateLimit,
  RateLimitError,
  type RateLimitBucket,
} from './security/rate-limit.js';
import {
  AppCheckError,
  verifyConfiguredAppCheck,
  type AppCheckMode,
  type AppCheckVerifier,
} from './security/app-check.js';

export type PrivateFileRequest = {
  method: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
  get?: (name: string) => string | null | undefined;
};

export type PrivateFileResponse = {
  setHeader(name: string, value: string): void;
  status(code: number): PrivateFileResponse;
  json(body: unknown): void;
};

export type PrivateStorageFile = {
  exists(): Promise<[boolean]>;
  getMetadata(): Promise<[{ metadata?: Record<string, string> }]>;
  getSignedUrl(options: { version: 'v4'; action: 'read'; expires: Date }): Promise<[string]>;
};

export type RateLimitResult = {
  allowed: true;
  hits: number;
  retryAfter: 0;
};

export type PrivateFileAuditEntry = {
  actorUid: string;
  accion: 'firmar_url_privada' | 'eliminar_archivo_privado';
  entidadId: string;
  resultado: 'ok' | 'forbidden' | 'not-found';
};

export type PrivateFileDependencies = {
  authenticate: (request: PrivateFileRequest) => Promise<AuthContext>;
  getFile: (path: string) => PrivateStorageFile;
  rateLimiter: (bucket: RateLimitBucket, keyValue: string, nowMs: number) => Promise<RateLimitResult>;
  now: () => Date;
  deleteFile: (file: PrivateStorageFile) => Promise<void>;
  audit?: (entry: PrivateFileAuditEntry) => Promise<void>;
  signReadUrl?: (file: PrivateStorageFile, expiresAt: Date) => Promise<string>;
  appCheckMode?: AppCheckMode;
  verifyAppCheck?: AppCheckVerifier;
};

type PrivateFileOperation = 'read' | 'delete';

const INTERNAL_ERROR = { status: 500, message: 'Internal error' } as const;
const PUBLIC_ERRORS: Record<string, { status: number; message: string }> = {
  'invalid-input': { status: 400, message: 'Invalid input' },
  'invalid-file-path': { status: 400, message: 'Invalid file path' },
  unauthenticated: { status: 401, message: 'Authentication required' },
  forbidden: { status: 403, message: 'Forbidden' },
  'file-not-found': { status: 404, message: 'File not found' },
  'rate-limit-exceeded': { status: 429, message: 'Too many requests' },
  'app-check-required': { status: 403, message: 'App Check required' },
  internal: INTERNAL_ERROR,
};

const AUDIT_ACCION: Record<PrivateFileOperation, PrivateFileAuditEntry['accion']> = {
  read: 'firmar_url_privada',
  delete: 'eliminar_archivo_privado',
};

// El path nunca se guarda en claro en la auditoria: identifica al archivo por su
// hash, suficiente para correlacionar accesos sin filtrar rutas privadas.
function auditEntityId(path: string): string {
  return createHash('sha256').update(path, 'utf8').digest('hex');
}

function defaultGetFile(path: string): PrivateStorageFile {
  const configured = process.env.STORAGE_BUCKET?.trim();
  const bucket = configured ? getStorage().bucket(configured) : getStorage().bucket();
  return bucket.file(path) as unknown as PrivateStorageFile;
}

function defaultRateLimiter(
  bucket: RateLimitBucket,
  keyValue: string,
  nowMs: number,
): Promise<RateLimitResult> {
  return consumeRateLimit(bucket, keyValue, nowMs);
}

function defaultDeleteFile(file: PrivateStorageFile): Promise<void> {
  const deletable = file as PrivateStorageFile & { delete?: () => Promise<void> };
  if (!deletable.delete) throw new Error('storage-delete-unavailable');
  return deletable.delete();
}

// Fail-soft, igual que la bitacora del backend legado: perder una linea de
// auditoria es malo, impedir que el admin abra una evidencia en plena emergencia
// es peor. El fallo queda en los logs de la Function.
async function defaultAudit(entry: PrivateFileAuditEntry): Promise<void> {
  try {
    await getFirestore().collection('auditoriaAdmin').add({
      ...entry,
      entidad: 'storage',
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.error('auditoriaAdmin', (error as Error).name);
  }
}

function defaultDependencies(): PrivateFileDependencies {
  return {
    authenticate: authenticateRequest,
    getFile: defaultGetFile,
    rateLimiter: defaultRateLimiter,
    now: () => new Date(),
    deleteFile: defaultDeleteFile,
    audit: defaultAudit,
  };
}

function header(request: PrivateFileRequest, name: string): string | null {
  const value = request.get?.(name) ?? request.headers?.[name]
    ?? request.headers?.[name.toLowerCase()];
  return typeof value === 'string' ? value : null;
}

function hasJsonContentType(request: PrivateFileRequest): boolean {
  const contentType = header(request, 'content-type');
  return contentType?.split(';', 1)[0]?.trim().toLowerCase() === 'application/json';
}

function parsePath(body: unknown): string {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('invalid-input');
  }

  const entries = Object.entries(body);
  if (entries.length !== 1 || entries[0]?.[0] !== 'path' || typeof entries[0][1] !== 'string') {
    throw new Error('invalid-input');
  }

  return entries[0][1];
}

function parseDescriptor(body: unknown): PrivateFileDescriptor {
  const path = parsePath(body);
  try {
    return validatePrivateStoragePath(path);
  } catch {
    throw new Error('invalid-file-path');
  }
}

async function readPrivateFileMetadata(
  file: PrivateStorageFile,
  descriptor: PrivateFileDescriptor,
): Promise<boolean> {
  const [exists] = await file.exists();
  if (!exists) return false;

  const [{ metadata }] = await file.getMetadata();
  return metadata?.ownerUid === descriptor.ownerUid
    && metadata.category === descriptor.category
    && metadata.visibility === 'private';
}

function sendError(res: PrivateFileResponse, code: string): void {
  const publicError = PUBLIC_ERRORS[code] ?? INTERNAL_ERROR;
  res.status(publicError.status).json({
    error: { code: PUBLIC_ERRORS[code] ? code : 'internal', message: publicError.message },
  });
}

function normalizeError(error: unknown): string {
  if (error instanceof AppCheckError) return error.code;
  if (error instanceof AuthError) return error.code;
  if (error instanceof RateLimitError) return error.code;
  if (error instanceof Error && PUBLIC_ERRORS[error.message]) return error.message;
  return 'internal';
}

async function handlePrivateFileRequest(
  req: PrivateFileRequest,
  res: PrivateFileResponse,
  operation: PrivateFileOperation,
  providedDependencies?: Partial<PrivateFileDependencies>,
): Promise<void> {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: { code: 'method-not-allowed', message: 'Method not allowed' } });
    return;
  }

  if (!hasJsonContentType(req)) {
    sendError(res, 'invalid-input');
    return;
  }

  const dependencies = { ...defaultDependencies(), ...providedDependencies };
  const audit = dependencies.audit ?? (async () => {});
  const now = dependencies.now();
  const nowMs = now.getTime();

  try {
    await verifyConfiguredAppCheck(req, dependencies.verifyAppCheck, dependencies.appCheckMode);

    let context: AuthContext;
    try {
      context = await dependencies.authenticate(req);
    } catch (error) {
      // Los intentos sin sesion valida se miden por IP: acotan el sondeo de
      // tokens sin gastar el cupo por identidad de nadie.
      const requestIp = clientIp(req);
      if (requestIp !== 'desconocida') await dependencies.rateLimiter('request', requestIp, nowMs);
      if (error instanceof AuthError) throw error;
      throw new AuthError('unauthenticated', 401, 'Authentication required');
    }

    // Cupo por identidad ANTES de cualquier lectura de Storage: si no, un rol
    // autorizado podria sondear existencia de rutas ajenas sin gastar cuota.
    await dependencies.rateLimiter('archivos', context.uid, nowMs);

    const descriptor = parseDescriptor(req.body);
    const authorized = operation === 'read'
      ? canAccessPrivateFile(context, descriptor)
      : canDeletePrivateFile(context, descriptor);
    if (!authorized) {
      await audit({
        actorUid: context.uid,
        accion: AUDIT_ACCION[operation],
        entidadId: auditEntityId(descriptor.path),
        resultado: 'forbidden',
      });
      sendError(res, 'forbidden');
      return;
    }

    const file = dependencies.getFile(descriptor.path);
    if (!await readPrivateFileMetadata(file, descriptor)) {
      await audit({
        actorUid: context.uid,
        accion: AUDIT_ACCION[operation],
        entidadId: auditEntityId(descriptor.path),
        resultado: 'not-found',
      });
      sendError(res, 'file-not-found');
      return;
    }

    if (operation === 'delete') {
      await dependencies.deleteFile(file);
      await audit({
        actorUid: context.uid,
        accion: 'eliminar_archivo_privado',
        entidadId: auditEntityId(descriptor.path),
        resultado: 'ok',
      });
      res.status(200).json({ success: true });
      return;
    }

    const expiresAt = privateUrlExpiresAt(now);
    const url = await (dependencies.signReadUrl
      ? dependencies.signReadUrl(file, expiresAt)
      : file.getSignedUrl({ version: 'v4', action: 'read', expires: expiresAt })
        .then(([signedUrl]) => signedUrl));
    await audit({
      actorUid: context.uid,
      accion: 'firmar_url_privada',
      entidadId: auditEntityId(descriptor.path),
      resultado: 'ok',
    });
    res.status(200).json({ url, expiresAt: expiresAt.toISOString() });
  } catch (error) {
    if (error instanceof RateLimitError) {
      res.setHeader('Retry-After', String(error.retryAfter));
    }
    sendError(res, normalizeError(error));
  }
}

export function getPrivateFileUrlHandler(
  req: PrivateFileRequest,
  res: PrivateFileResponse,
  dependencies?: Partial<PrivateFileDependencies>,
): Promise<void> {
  return handlePrivateFileRequest(req, res, 'read', dependencies);
}

export function deletePrivateFileHandler(
  req: PrivateFileRequest,
  res: PrivateFileResponse,
  dependencies?: Partial<PrivateFileDependencies>,
): Promise<void> {
  return handlePrivateFileRequest(req, res, 'delete', dependencies);
}
