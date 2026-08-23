import { expect, it } from 'vitest';
import {
  PRIVATE_URL_TTL_MS,
  privateUrlExpiresAt,
  validatePrivateStoragePath,
} from '../../functions/src/private-file-access.js';

it('limita la expiración a 15 minutos', () => {
  const now = new Date('2026-08-06T12:00:00.000Z');
  expect(PRIVATE_URL_TTL_MS).toBe(900000);
  expect(privateUrlExpiresAt(now).toISOString()).toBe('2026-08-06T12:15:00.000Z');
});

it('acepta solo el path privado canónico', () => {
  expect(validatePrivateStoragePath('private/owner-1/receipts/f1.png'))
    .toMatchObject({
      path: 'private/owner-1/receipts/f1.png',
      ownerUid: 'owner-1',
      category: 'receipts',
      fileName: 'f1.png',
      extension: 'png',
    });

  for (const invalid of [
    'public/owner-1/receipts/f1.png',
    'private/../f1/a.png',
    'private//f1/a.png',
    'private/facturas/f1/..',
    'private\\facturas\\f1\\a.png',
  ]) {
    expect(() => validatePrivateStoragePath(invalid))
      .toThrow('invalid-private-storage-path');
  }
});
