import { firebaseConfig } from './firebase-config.js';

export const FUNCTIONS_REGION = 'us-east1';

const runtimeConfig = globalThis.DV_ENTORNO ?? {};
const buildConfig = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {};

// URL base de las Cloud Functions.
//
// En desarrollo se apunta al emulador con VITE_API_BASE (o
// window.DV_ENTORNO.apiBase); sin esa variable se deriva de la region y el
// projectId, que es la forma canonica del endpoint desplegado.
export function functionsBaseUrl(overrides = {}) {
  const explicito = overrides.apiBase
    ?? buildConfig.VITE_API_BASE
    ?? runtimeConfig.apiBase;
  if (typeof explicito === 'string' && explicito.trim()) {
    return explicito.trim().replace(/\/+$/, '');
  }

  const projectId = overrides.projectId ?? firebaseConfig.projectId;
  if (!projectId) throw new Error('Configuracion Firebase incompleta: projectId');
  return `https://${FUNCTIONS_REGION}-${projectId}.cloudfunctions.net`;
}

export function functionUrl(nombre, overrides = {}) {
  if (typeof nombre !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(nombre)) {
    throw new Error('Nombre de Function invalido');
  }
  return `${functionsBaseUrl(overrides)}/${nombre}`;
}
