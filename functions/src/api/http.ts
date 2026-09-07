import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import {
  authenticateRequest,
  AuthError,
  type AuthContext,
} from '../auth/authorization.js';
import {
  AppCheckError,
  verifyConfiguredAppCheck,
  type AppCheckMode,
  type AppCheckVerifier,
} from '../security/app-check.js';
import {
  clientIp,
  consumeRateLimit,
  RateLimitError,
  RATE_LIMITS,
  type RateLimitBucket,
} from '../security/rate-limit.js';
import {
  ApiError,
  s,
  type ActionContext,
  type ActionDefinition,
  type ActionResult,
} from './contract.js';
import { getAction } from './registry.js';
import { allowedOrigins, isAllowedOrigin } from '../security/cors.js';

export type ApiRequest = {
  method: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
  get?: (name: string) => string | null | undefined;
};

export type ApiResponse = {
  setHeader(name: string, value: string): void;
  status(code: number): ApiResponse;
  json(body: unknown): void;
};

export type ApiDependencies = {
  authenticate: (request: ApiRequest) => Promise<AuthContext>;
  rateLimiter: (bucket: RateLimitBucket, keyValue: string, nowMs: number) => Promise<unknown>;
  now: () => Date;
  db: () => Firestore;
  lookupAction: (nombre: string) => ActionDefinition | undefined;
  appCheckMode?: AppCheckMode;
  verifyAppCheck?: AppCheckVerifier;
  origenesPermitidos?: readonly string[];
};

// Mensajes publicos en espanol, como los del backend legado: el cliente los
// muestra tal cual. Ningun detalle interno sale de aqui.
const MENSAJES = {
  soloPost: 'solo POST',
  formato: 'formato invalido',
  desconocida: 'accion desconocida',
  sesion: 'Entra con tu cuenta para continuar',
  permiso: 'No tienes permiso para esta accion',
  panelSinCentro: 'Tu cuenta no tiene un centro asignado',
  appCheck: 'Verificacion de la aplicacion requerida',
  demasiadas: 'Demasiadas solicitudes, intenta mas tarde',
  origen: 'origen no permitido',
  interno: 'Error interno',
} as const;

function defaultDependencies(): ApiDependencies {
  return {
    authenticate: authenticateRequest,
    rateLimiter: (bucket, keyValue, nowMs) => consumeRateLimit(bucket, keyValue, nowMs),
    now: () => new Date(),
    db: () => getFirestore(),
    lookupAction: getAction,
  };
}

function header(request: ApiRequest, name: string): string | null {
  const value = request.get?.(name) ?? request.headers?.[name]
    ?? request.headers?.[name.toLowerCase()];
  return typeof value === 'string' ? value : null;
}

function hasJsonContentType(request: ApiRequest): boolean {
  const contentType = header(request, 'content-type');
  return contentType?.split(';', 1)[0]?.trim().toLowerCase() === 'application/json';
}

function fallo(res: ApiResponse, status: number, error: string): void {
  res.status(status).json({ success: false, error });
}

// La identidad se resuelve segun lo que exige la accion, no segun lo que traiga
// el cliente: un token invalido en una accion publica se ignora, pero nunca
// degrada un permiso.
async function resolverIdentidad(
  req: ApiRequest,
  definicion: ActionDefinition,
  dependencies: ApiDependencies,
): Promise<AuthContext | null> {
  if (definicion.auth === 'anon') {
    const autorizacion = header(req, 'authorization');
    if (!autorizacion) return null;
    try {
      return await dependencies.authenticate(req);
    } catch {
      // Token vencido en un formulario publico: sigue siendo publico.
      return null;
    }
  }

  const context = await dependencies.authenticate(req);

  if (definicion.auth === 'admin' && context.role !== 'admin') {
    throw new ApiError(MENSAJES.permiso, 403);
  }

  if (definicion.auth === 'panel') {
    if (context.role !== 'panel' && context.role !== 'admin') {
      throw new ApiError(MENSAJES.permiso, 403);
    }
    if (context.role === 'panel' && !context.panelLugarId) {
      throw new ApiError(MENSAJES.panelSinCentro, 403);
    }
  }

  return context;
}

function claveDeCupo(
  bucket: RateLimitBucket,
  context: AuthContext | null,
  ip: string,
): string | null {
  if (RATE_LIMITS[bucket].key === 'ip') return ip === 'desconocida' ? null : ip;
  return context?.uid ?? null;
}

export async function apiHandler(
  req: ApiRequest,
  res: ApiResponse,
  providedDependencies?: Partial<ApiDependencies>,
): Promise<void> {
  const dependenciasPrevias = providedDependencies ?? {};
  const origenes = dependenciasPrevias.origenesPermitidos ?? allowedOrigins();

  // Defensa en profundidad: el CORS de la plataforma es un control del navegador
  // y el emulador lo relaja. La allowlist se comprueba tambien aqui, para que el
  // comportamiento sea el mismo en local, en el emulador y en produccion.
  const origen = header(req, 'origin');
  if (origen !== null && !isAllowedOrigin(origen, origenes)) {
    fallo(res, 403, MENSAJES.origen);
    return;
  }

  // Con `cors` configurado, firebase-functions ya responde el preflight; esta
  // rama cubre el caso de invocar el handler directamente.
  if (req.method === 'OPTIONS') {
    res.status(204).json(null);
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    fallo(res, 405, MENSAJES.soloPost);
    return;
  }

  if (!hasJsonContentType(req)) {
    fallo(res, 400, MENSAJES.formato);
    return;
  }

  const dependencies = { ...defaultDependencies(), ...providedDependencies };
  const now = dependencies.now();
  const nowMs = now.getTime();
  const ip = clientIp(req);

  try {
    await verifyConfiguredAppCheck(req, dependencies.verifyAppCheck, dependencies.appCheckMode);

    const cuerpo = req.body;
    if (cuerpo === null || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) {
      fallo(res, 400, MENSAJES.formato);
      return;
    }

    const payload = cuerpo as Record<string, unknown>;

    // Anti-rafaga por IP antes de resolver la accion: si se cobrara despues, un
    // atacante podria martillear con acciones inexistentes sin gastar cupo.
    if (ip !== 'desconocida') await dependencies.rateLimiter('rafaga', ip, nowMs);

    const nombre = s(payload.accion, 40);
    const definicion = dependencies.lookupAction(nombre);
    if (!definicion) {
      fallo(res, 400, MENSAJES.desconocida);
      return;
    }

    const context = await resolverIdentidad(req, definicion, dependencies);

    const clave = claveDeCupo(definicion.cubo, context, ip);
    if (clave) await dependencies.rateLimiter(definicion.cubo, clave, nowMs);

    const { accion: _accion, ...datos } = payload;
    const ctx: ActionContext = {
      uid: context?.uid ?? null,
      role: context?.role ?? 'anon',
      panelLugarId: context?.panelLugarId ?? null,
      ip,
      now,
      db: dependencies.db(),
    };

    const resultado: ActionResult = await definicion.handler(ctx, datos);
    res.status(200).json({ success: true, ...resultado });
  } catch (error) {
    if (error instanceof RateLimitError) {
      res.setHeader('Retry-After', String(error.retryAfter));
      fallo(res, 429, MENSAJES.demasiadas);
      return;
    }
    if (error instanceof AppCheckError) {
      fallo(res, 403, MENSAJES.appCheck);
      return;
    }
    if (error instanceof ApiError) {
      fallo(res, error.status, error.message);
      return;
    }
    if (error instanceof AuthError) {
      fallo(res, error.status, error.status === 403 ? MENSAJES.permiso : MENSAJES.sesion);
      return;
    }
    // Cualquier otro fallo es interno: no se filtra su mensaje.
    console.error('api', (error as Error)?.name ?? 'error');
    fallo(res, 500, MENSAJES.interno);
  }
}

export const API_MESSAGES = MENSAJES;
