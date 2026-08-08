import { expect, it, vi } from 'vitest';
import { bootstrapAdmin } from '../../functions/src/auth/bootstrap-admin.js';

it('conserva claims existentes y agrega role admin', async () => {
  const auth = {
    getUser: vi.fn(async () => ({ customClaims: { tenant: 'demo' } })),
    setCustomUserClaims: vi.fn(async () => undefined),
  };

  await expect(bootstrapAdmin('admin-uid', auth)).resolves.toEqual({
    uid: 'admin-uid',
    role: 'admin',
  });
  expect(auth.setCustomUserClaims).toHaveBeenCalledWith('admin-uid', {
    tenant: 'demo',
    role: 'admin',
  });
});

it('rechaza UID vacio sin escribir claims', async () => {
  const auth = {
    getUser: vi.fn(),
    setCustomUserClaims: vi.fn(),
  };

  await expect(bootstrapAdmin('   ', auth)).rejects.toThrow('UID de administrador requerido');
  expect(auth.getUser).not.toHaveBeenCalled();
  expect(auth.setCustomUserClaims).not.toHaveBeenCalled();
});

it('propaga un error seguro si el UID no existe y no escribe claims', async () => {
  const auth = {
    getUser: vi.fn(async () => { throw new Error('credencial interna'); }),
    setCustomUserClaims: vi.fn(),
  };

  await expect(bootstrapAdmin('missing-uid', auth))
    .rejects.toThrow('No se pudo verificar el usuario administrador');
  expect(auth.setCustomUserClaims).not.toHaveBeenCalled();
});
