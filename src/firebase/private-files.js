import { getIdToken } from './firebase-auth.js';
import { functionUrl } from './functions-base.js';

// Acceso a archivos privados.
//
// Storage Rules prohiben leer y borrar directamente (`allow read, delete: if false`):
// ambas operaciones pasan por Cloud Functions, que comprueban rol y propiedad y
// firman una URL temporal de 15 minutos como maximo. Este modulo es el unico
// camino del cliente hacia esos endpoints.

const MENSAJES = {
  'invalid-file-path': 'Ruta de archivo invalida',
  unauthenticated: 'Entra con tu cuenta para ver este archivo',
  forbidden: 'No tienes permiso para ver este archivo',
  'file-not-found': 'El archivo ya no esta disponible',
  'rate-limit-exceeded': 'Demasiadas solicitudes, intenta mas tarde',
  'app-check-required': 'No pudimos verificar la aplicacion',
};

const ERROR_GENERICO = 'No se pudo abrir el archivo';

function mensajeDe(codigo) {
  return MENSAJES[codigo] ?? ERROR_GENERICO;
}

async function llamar(nombreFuncion, path, overrides = {}) {
  if (typeof path !== 'string' || !path.startsWith('private/')) {
    throw new Error(MENSAJES['invalid-file-path']);
  }

  const token = await getIdToken();
  if (!token) throw new Error(MENSAJES.unauthenticated);

  let response;
  try {
    response = await fetch(functionUrl(nombreFuncion, overrides), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ path }),
    });
  } catch {
    // Fallo de red: no se distingue de un servidor caido y no aporta detalle util.
    throw new Error(ERROR_GENERICO);
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(mensajeDe(data?.error?.code));
    error.code = data?.error?.code ?? 'unknown';
    throw error;
  }
  return data;
}

// Devuelve { url, expiresAt } con una URL firmada de vida corta. No guardar esa
// URL: caduca, y persistirla convertiria un archivo privado en uno publico.
export async function getPrivateFileUrl(path, overrides = {}) {
  const data = await llamar('getPrivateFileUrl', path, overrides);
  if (!data || typeof data.url !== 'string' || typeof data.expiresAt !== 'string') {
    throw new Error(ERROR_GENERICO);
  }
  return { url: data.url, expiresAt: data.expiresAt };
}

// Borrado autorizado. El cliente nunca llama a deleteObject(): las Rules lo
// deniegan siempre, y ademas el borrado directo no dejaria rastro en la auditoria.
export async function requestPrivateFileDeletion(path, overrides = {}) {
  const data = await llamar('deletePrivateFile', path, overrides);
  if (!data || data.success !== true) throw new Error(ERROR_GENERICO);
  return { success: true };
}
