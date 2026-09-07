import { ref, uploadBytes } from 'firebase/storage';
import { getStorageInstance } from './firebase-config.js';

// `centers`: cedula del responsable y foto del sitio que pide `panel_crear`.
// `offers`: fotos del insumo ofrecido, de quien lo ofrece y de la recogida.
// A diferencia de `receipts` y `needs`, el rol 'panel' NO puede leer ninguna.
export const PRIVATE_FILE_CATEGORIES = ['receipts', 'needs', 'reports', 'centers', 'volunteers', 'drivers', 'offers', 'deliveries'];

export const MIME_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export const PRIVATE_FILE_LIMITS = {
  'image/jpeg': 5 * 1024 * 1024,
  'image/png': 5 * 1024 * 1024,
  'image/webp': 5 * 1024 * 1024,
  'application/pdf': 10 * 1024 * 1024,
};


function validateFile(file) {
  if (
    !file
    || typeof file.size !== 'number'
    || !Number.isFinite(file.size)
    || file.size < 0
    || typeof file.type !== 'string'
  ) {
    throw new TypeError('Se requiere un archivo valido');
  }

  const maxBytes = PRIVATE_FILE_LIMITS[file.type];
  if (!maxBytes) {
    throw new Error(`Tipo de archivo no permitido: ${file.type}`);
  }
  if (file.size > maxBytes) throw new Error('El archivo excede el tamano permitido');
}

function validatePrivateIdentity(uid, category, file, options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Opciones invalidas');
  }
  if (typeof uid !== 'string' || !/^[A-Za-z0-9_-]+$/.test(uid)) {
    throw new Error('UID invalido');
  }
  if (!PRIVATE_FILE_CATEGORIES.includes(category)) {
    throw new Error('Categoria no permitida');
  }
  validateFile(file);
  if (options.extension !== undefined) {
    const expectedExtension = MIME_EXTENSIONS[file.type];
    if (options.extension !== expectedExtension) {
      throw new Error('Extension no coincide con MIME');
    }
  }
  if (options.fileId !== undefined && (typeof options.fileId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(options.fileId))) {
    throw new Error('fileId invalido');
  }
}

function validateExtension(extension) {
  if (!Object.values(MIME_EXTENSIONS).includes(extension)) {
    throw new Error('Extension invalida');
  }
}

export function createPrivateFilePath(uid, category, fileId, extension) {
  if (typeof uid !== 'string' || !/^[A-Za-z0-9_-]+$/.test(uid)) {
    throw new Error('UID invalido');
  }
  if (!PRIVATE_FILE_CATEGORIES.includes(category)) {
    throw new Error('Categoria no permitida');
  }
  if (typeof fileId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(fileId)) {
    throw new Error('fileId invalido');
  }
  validateExtension(extension);

  return `private/${uid}/${category}/${fileId}.${extension}`;
}

// La camara de los formularios entrega `data:<mime>;base64,<datos>`. Storage
// necesita un Blob con `type` y `size`, que es lo que valida `validateFile`.
export function archivoDesdeDataUrl(dataUrl) {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(String(dataUrl ?? ''));
  if (!match) throw new Error('Formato de imagen no reconocido');
  const binario = atob(match[2]);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
  return new Blob([bytes], { type: match[1] });
}

export async function uploadPrivateFile(uid, category, file, options = {}) {
  validatePrivateIdentity(uid, category, file, options);
  const extension = MIME_EXTENSIONS[file.type];
  const fileId = options.fileId ?? crypto.randomUUID();
  const path = createPrivateFilePath(uid, category, fileId, extension);
  const snapshot = await uploadBytes(ref(await getStorageInstance(), path), file, {
    contentType: file.type,
    cacheControl: 'private, max-age=0, no-store',
    customMetadata: { ownerUid: uid, category, visibility: 'private' },
  });
  return { path: snapshot.ref.fullPath };
}
