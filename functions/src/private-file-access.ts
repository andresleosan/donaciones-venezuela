import type { AuthContext } from './auth/authorization.js';

export const PRIVATE_URL_TTL_MS = 15 * 60 * 1000;

// `centers` guarda la cedula de la persona responsable y la foto del sitio que
// exige `panel_crear`. Es la unica categoria que NO puede leer el rol 'panel':
// son documentos de identidad de terceros, y quien opera un panel no tiene por
// que ver los de otro centro. Solo el admin y quien la subio.
const CATEGORIES = new Set(['receipts', 'needs', 'reports', 'centers']);
const EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'pdf']);
const PATH_PATTERN = /^private\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9][a-zA-Z0-9_-]*)\.(jpg|jpeg|png|webp|pdf)$/;

export type PrivateFileDescriptor = {
  path: string;
  ownerUid: string;
  category: 'receipts' | 'needs' | 'reports' | 'centers';
  fileName: string;
  extension: 'jpg' | 'jpeg' | 'png' | 'webp' | 'pdf';
};

export function validatePrivateStoragePath(path: string): PrivateFileDescriptor {
  if (typeof path !== 'string') {
    throw new Error('invalid-private-storage-path');
  }

  const match = PATH_PATTERN.exec(path);
  if (!match) throw new Error('invalid-private-storage-path');

  const [, ownerUid, category, fileId, extension] = match;
  const fileName = fileId && extension ? `${fileId}.${extension}` : undefined;
  if (
    !ownerUid
    || !category
    || !fileName
    || !CATEGORIES.has(category)
    || !extension
    || !EXTENSIONS.has(extension)
  ) {
    throw new Error('invalid-private-storage-path');
  }

  return {
    path,
    ownerUid,
    category: category as PrivateFileDescriptor['category'],
    fileName,
    extension: extension as PrivateFileDescriptor['extension'],
  };
}

export function canAccessPrivateFile(
  context: AuthContext,
  descriptor: PrivateFileDescriptor,
): boolean {
  if (!context.uid.trim()) return false;
  if (context.role === 'admin') return true;
  if (context.uid === descriptor.ownerUid) return true;
  return context.role === 'panel' && (descriptor.category === 'receipts' || descriptor.category === 'needs');
}

export function canDeletePrivateFile(
  context: AuthContext,
  descriptor: PrivateFileDescriptor,
): boolean {
  return canAccessPrivateFile(context, descriptor);
}

export function privateUrlExpiresAt(now: Date): Date {
  return new Date(now.getTime() + PRIVATE_URL_TTL_MS);
}
