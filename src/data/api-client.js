import { functionsBaseUrl } from '../firebase/functions-base.js';

// Cliente HTTP de la Function `api`.
//
// Mismo contrato de errores que el legado (`services/api.js:159-181, 331-342`):
// HTTP no-OK lanza `Error(data.error || data.message || 'HTTP <status>')` con
// `error.status`; cuerpo nulo o `success === false` lanza `Error(data.error)`.
// El éxito devuelve el JSON crudo, sin envelope, porque la UI lee campos
// directos de cada acción.
//
// La autenticación ya no viaja en el cuerpo (`accessToken`, `adminKey`,
// `token` + `pin` del legado): va como `Authorization: Bearer <idToken>` y la
// Function resuelve el rol por claims.

// 45 s: los registros con fotos (transportistas) suben ~1-2 MB en móvil.
export const TIMEOUT_MS = 45000;

// Sin `VITE_API_BASE` en desarrollo se asume el Emulator Suite del proyecto demo,
// que es donde corre la aplicación durante toda la reconstrucción.
export const API_BASE_DESARROLLO = 'http://127.0.0.1:5001/demo-donaciones-venezuela/us-east1';

const buildConfig = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {};

function traducir(clave, respaldo) {
  return typeof globalThis.t === 'function' ? globalThis.t(clave) : respaldo;
}

export function apiBaseUrl(overrides = {}) {
  const explicito = overrides.apiBase
    ?? buildConfig.VITE_API_BASE
    ?? (globalThis.DV_ENTORNO ?? {}).apiBase;
  if (typeof explicito === 'string' && explicito.trim()) {
    return explicito.trim().replace(/\/+$/, '');
  }
  if (buildConfig.DEV) return API_BASE_DESARROLLO;
  return functionsBaseUrl(overrides);
}

export function apiUrl(overrides = {}) {
  return `${apiBaseUrl(overrides)}/api`;
}

export async function post(payload, options = {}) {
  const { idToken, ...overrides } = options;
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), TIMEOUT_MS);
  let resp;
  let data;
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (idToken) headers.Authorization = `Bearer ${idToken}`;
    resp = await fetch(apiUrl(overrides), {
      method: 'POST',
      headers,
      body: JSON.stringify(payload || {}),
      signal: controller.signal
    });
    data = await resp.json().catch(() => null);
  } finally {
    globalThis.clearTimeout(timeout);
  }

  if (!resp.ok) {
    const error = new Error((data && (data.error || data.message)) || 'HTTP ' + resp.status);
    error.status = resp.status;
    throw error;
  }
  if (!data || data.success === false) {
    throw new Error((data && data.error) || traducir('messages.saveError', 'No se pudo guardar'));
  }
  return data;
}
