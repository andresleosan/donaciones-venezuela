import { deleteObject, ref, uploadBytes } from 'firebase/storage';
import { getFirebaseApp } from './firebase-config.js';

export const PRIVATE_FILE_CATEGORIES = ['receipts', 'needs', 'reports'];

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

let storagePromise;

async function getFirebaseStorage() {
  if (!storagePromise) {
    storagePromise = getFirebaseApp().then(async (app) => {
      const { getStorage } = await import('firebase/storage');
      return getStorage(app);
    });
  }
  return storagePromise;
}

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
  if (options.fileId !== undefined && (typeof options.fileId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(options.fileId))) {
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
  if (typeof fileId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(fileId)) {
    throw new Error('fileId invalido');
  }
  validateExtension(extension);

  return `private/${uid}/${category}/${fileId}.${extension}`;
}

export async function uploadPrivateFile(uid, category, file, options = {}) {
  validatePrivateIdentity(uid, category, file, options);
  const extension = MIME_EXTENSIONS[file.type];
  const fileId = options.fileId ?? crypto.randomUUID();
  const path = createPrivateFilePath(uid, category, fileId, extension);
  const snapshot = await uploadBytes(ref(await getFirebaseStorage(), path), file, {
    contentType: file.type,
    cacheControl: 'private, max-age=0, no-store',
    customMetadata: { ownerUid: uid, category, visibility: 'private' },
  });
  return { path: snapshot.ref.fullPath };
}

export async function deleteFile(path) {
  await deleteObject(ref(await getFirebaseStorage(), path));
}
