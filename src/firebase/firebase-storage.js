import { deleteObject, ref, uploadBytes } from 'firebase/storage';
import { getFirebaseApp } from './firebase-config.js';

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

function validateFile(file, { maxBytes = 5 * 1024 * 1024, contentTypes = [] } = {}) {
  if (!file || typeof file.size !== 'number' || typeof file.type !== 'string') {
    throw new TypeError('Se requiere un archivo valido');
  }
  if (file.size > maxBytes) throw new Error('El archivo excede el tamano permitido');
  if (contentTypes.length > 0 && !contentTypes.includes(file.type)) {
    throw new Error(`Tipo de archivo no permitido: ${file.type}`);
  }
}

export async function uploadFile(path, file, options = {}) {
  validateFile(file, options);
  const snapshot = await uploadBytes(ref(await getFirebaseStorage(), path), file, {
    ...options.metadata,
    // No permitir que metadata arbitraria vuelva publico un archivo privado.
    contentType: file.type,
    cacheControl: 'private, max-age=0, no-store',
  });
  return { path: snapshot.ref.fullPath };
}

export async function deleteFile(path) {
  await deleteObject(ref(await getFirebaseStorage(), path));
}
