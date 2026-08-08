import { beforeEach, expect, it, vi } from 'vitest';

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

import { uploadFile } from '../../src/firebase/firebase-storage.js';

const filePng = { size: 128, type: 'image/png' };

beforeEach(() => {
  vi.clearAllMocks();
  storageMocks.uploadBytes.mockResolvedValue({
    ref: { fullPath: 'private/facturas/f1/a.png' },
  });
  storageMocks.getDownloadURL.mockResolvedValue('https://persistent.example/token');
});

it('sube y devuelve solo el path privado', async () => {
  const result = await uploadFile('private/facturas/f1/a.png', filePng);

  expect(result).toEqual({ path: 'private/facturas/f1/a.png' });
  expect(result).not.toHaveProperty('url');
});

it('no exporta un helper de URL persistente', async () => {
  const module = await import('../../src/firebase/firebase-storage.js');
  expect(module.downloadUrl).toBeUndefined();
});
