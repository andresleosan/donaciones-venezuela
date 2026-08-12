import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const storageMocks = vi.hoisted(() => ({
  deleteObject: vi.fn(),
  getDownloadURL: vi.fn(),
  getStorage: vi.fn(() => ({ name: 'storage' })),
  ref: vi.fn((_storage, path) => ({ fullPath: path })),
  uploadBytes: vi.fn(),
}));

vi.mock('firebase/storage', () => storageMocks);
vi.mock('../../src/firebase/firebase-config.js', () => ({
  getFirebaseApp: vi.fn(async () => ({ name: 'app' })),
}));

import { uploadPrivateFile } from '../../src/firebase/firebase-storage.js';

const validPdf = { size: 10 * 1024 * 1024, type: 'application/pdf' };

beforeEach(() => {
  vi.clearAllMocks();
  storageMocks.uploadBytes.mockResolvedValue({
    ref: { fullPath: 'private/uid-1/receipts/file-1.pdf' },
  });
  storageMocks.getDownloadURL.mockResolvedValue('https://persistent.example/token');
});

afterEach(() => {
  vi.restoreAllMocks();
});

it('construye un path privado canonico', async () => {
  const { createPrivateFilePath } = await import('../../src/firebase/firebase-storage.js');
  expect(createPrivateFilePath('uid-1', 'receipts', 'file-1', 'pdf'))
    .toBe('private/uid-1/receipts/file-1.pdf');
});

it('genera un fileId UUID cuando no se proporciona', async () => {
  const { uploadPrivateFile } = await import('../../src/firebase/firebase-storage.js');
  const uuid = '00000000-0000-4000-8000-000000000001';
  vi.spyOn(crypto, 'randomUUID').mockReturnValue(uuid);

  await uploadPrivateFile('uid-1', 'needs', { size: 128, type: 'image/png' });

  expect(storageMocks.ref).toHaveBeenCalledWith(
    expect.anything(),
    `private/uid-1/needs/${uuid}.png`,
  );
});

it.each([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['application/pdf', 'pdf'],
])('mapea %s a la extension %s', async (type, extension) => {
  const { uploadPrivateFile } = await import('../../src/firebase/firebase-storage.js');

  await uploadPrivateFile('uid-1', 'needs', { size: 128, type }, { fileId: 'file-1' });

  expect(storageMocks.ref).toHaveBeenCalledWith(
    expect.anything(),
    `private/uid-1/needs/file-1.${extension}`,
  );
});

it.each([
  ['text/plain', 128, 'Tipo de archivo no permitido'],
  ['image/png', 5 * 1024 * 1024 + 1, 'El archivo excede el tamano permitido'],
  ['application/pdf', 10 * 1024 * 1024 + 1, 'El archivo excede el tamano permitido'],
])('rechaza archivo invalido %s', async (type, size, message) => {
  await expect(uploadPrivateFile('uid-1', 'needs', { type, size }))
    .rejects.toThrow(message);
});

it.each([
  ['', 'receipts', validPdf, undefined, 'UID invalido'],
  ['uid-1', 'invalid', validPdf, undefined, 'Categoria no permitida'],
  ['uid-1', 'receipts', validPdf, { fileId: 'file/id' }, 'fileId invalido'],
  ['uid-1', 'receipts', validPdf, { fileId: '..' }, 'fileId invalido'],
  ['uid-1', 'receipts', validPdf, { fileId: 'file\u0000id' }, 'fileId invalido'],
])('rechaza identidad o ruta privada invalida', async (uid, category, file, options, message) => {
  await expect(uploadPrivateFile(uid, category, file, options)).rejects.toThrow(message);
});

it('rechaza extensiones que no pertenecen al allowlist', async () => {
  const { createPrivateFilePath } = await import('../../src/firebase/firebase-storage.js');
  expect(() => createPrivateFilePath('uid-1', 'receipts', 'file-1', 'png.exe'))
    .toThrow('Extension invalida');
});

it('rechaza una extension valida que no corresponde al MIME', async () => {
  await expect(uploadPrivateFile(
    'uid-1',
    'receipts',
    { size: 128, type: 'image/png' },
    { fileId: 'file-1', extension: 'jpg' },
  )).rejects.toThrow('Extension no coincide con MIME');
});

it('sube con metadata custom privada y devuelve solo el path', async () => {
  const result = await uploadPrivateFile('uid-1', 'receipts', validPdf, { fileId: 'file-1' });

  expect(result).toEqual({ path: 'private/uid-1/receipts/file-1.pdf' });
  expect(storageMocks.uploadBytes).toHaveBeenCalledWith(
    expect.objectContaining({ fullPath: 'private/uid-1/receipts/file-1.pdf' }),
    validPdf,
    expect.objectContaining({
      contentType: 'application/pdf',
      cacheControl: 'private, max-age=0, no-store',
      customMetadata: {
        ownerUid: 'uid-1',
        category: 'receipts',
        visibility: 'private',
      },
    }),
  );
  expect(result).not.toHaveProperty('url');
});

it('no exporta un helper de URL persistente', async () => {
  const module = await import('../../src/firebase/firebase-storage.js');
  expect(module.downloadUrl).toBeUndefined();
});
