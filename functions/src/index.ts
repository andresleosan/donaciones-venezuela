import { initializeApp } from 'firebase-admin/app';
import { onRequest } from 'firebase-functions/v2/https';
import { authSessionHandler } from './auth/session.js';
import { healthHandler } from './health.js';
import { setVolunteerPublicConsentHandler } from './volunteers/public-consent-http.js';
import {
  deletePrivateFileHandler,
  getPrivateFileUrlHandler,
} from './private-file-access-http.js';
import { allowedOrigins } from './security/cors.js';
import { apiHandler } from './api/index.js';

initializeApp();

// Opciones comunes: CORS con allowlist explicita (nunca `true`), escalado acotado
// para que un pico no se convierta en costo abierto, y tiempo suficiente para
// firmar URLs o ejecutar una transaccion, pero no para colgar instancias.
const httpOptions = {
  cors: allowedOrigins(),
  region: 'us-east1',
  memory: '256MiB',
  timeoutSeconds: 30,
  maxInstances: 10,
  concurrency: 40,
} as const;

export const health = onRequest(httpOptions, healthHandler);

export const authSession = onRequest(httpOptions, authSessionHandler);

export const setVolunteerPublicConsent = onRequest(httpOptions, setVolunteerPublicConsentHandler);

export const getPrivateFileUrl = onRequest(httpOptions, getPrivateFileUrlHandler);

export const deletePrivateFile = onRequest(httpOptions, deletePrivateFileHandler);

// Despachador unico de las acciones de negocio: el cliente envia
// { accion, ...datos } y recibe { success, ...resultado }, el mismo contrato que
// exponia la edge function legada.
export const api = onRequest(
  { ...httpOptions, timeoutSeconds: 60, memory: '512MiB' },
  apiHandler,
);
