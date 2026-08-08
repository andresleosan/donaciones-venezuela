import { expect, it, vi } from 'vitest';
import {
  authenticateRequest,
  requireRole,
} from '../../functions/src/auth/authorization.js';

it('extrae Bearer, verifica el token y usa user como rol por defecto', async () => {
  const verifyIdToken = vi.fn(async (token: string) => ({ uid: 'user-1', token }));

  await expect(authenticateRequest(
    { headers: { authorization: 'Bearer id-token' } },
    verifyIdToken,
  )).resolves.toEqual({ uid: 'user-1', role: 'user' });
  expect(verifyIdToken).toHaveBeenCalledWith('id-token');
});

it('rechaza header ausente o esquema distinto con 401 seguro', async () => {
  await expect(authenticateRequest({ headers: {} }, vi.fn()))
    .rejects.toMatchObject({ code: 'unauthenticated', status: 401 });
  await expect(authenticateRequest(
    { headers: { authorization: 'Basic abc' } },
    vi.fn(),
  )).rejects.toMatchObject({ code: 'unauthenticated', status: 401 });
});

it('no eleva un claim de rol desconocido', async () => {
  const context = await authenticateRequest(
    { headers: { authorization: 'Bearer id-token' } },
    async () => ({ uid: 'user-1', role: 'owner' }),
  );

  expect(context).toEqual({ uid: 'user-1', role: 'user' });
  expect(() => requireRole(context, ['admin']))
    .toThrowError(expect.objectContaining({ code: 'forbidden', status: 403 }));
});

it.each([
  ['user', ['user'], ['admin']],
  ['panel', ['panel', 'user'], ['admin']],
  ['admin', ['admin', 'panel'], ['user']],
] as const)('autoriza el rol %s solo en permisos declarados', (role, allowedRoles, deniedRoles) => {
  expect(() => requireRole({ uid: 'user-1', role }, allowedRoles)).not.toThrow();
  expect(() => requireRole({ uid: 'user-1', role }, deniedRoles)).toThrow();
});

it('no filtra el error real del verificador', async () => {
  await expect(authenticateRequest(
    { headers: { authorization: 'Bearer id-token' } },
    async () => { throw new Error('token secreto interno'); },
  )).rejects.toMatchObject({
    code: 'unauthenticated',
    status: 401,
    message: 'Authentication required',
  });
});
