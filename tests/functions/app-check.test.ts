import { expect, it, vi } from 'vitest';
import {
  getAppCheckMode,
  verifyConfiguredAppCheck,
} from '../../functions/src/security/app-check.js';

it('disabled no exige token', async () => {
  expect(await verifyConfiguredAppCheck({ headers: {} }, async () => {
    throw new Error('must-not-run');
  }, 'disabled')).toEqual({ mode: 'disabled', verified: false });
});

it('log-only acepta ausencia y no expone errores', async () => {
  await expect(verifyConfiguredAppCheck({ headers: {} }, vi.fn(), 'log-only'))
    .resolves.toEqual({ mode: 'log-only', verified: false });
});

it('log-only marca como no verificado un token invalido sin propagar el error', async () => {
  await expect(verifyConfiguredAppCheck(
    { headers: { 'x-firebase-appcheck': 'bad' } },
    async () => { throw new Error('secret SDK detail'); },
    'log-only',
  )).resolves.toEqual({ mode: 'log-only', verified: false });
});

it('enforced exige X-Firebase-AppCheck y normaliza fallo', async () => {
  await expect(verifyConfiguredAppCheck({ headers: {} }, vi.fn(), 'enforced'))
    .rejects.toMatchObject({ code: 'app-check-required', status: 403 });
  await expect(verifyConfiguredAppCheck(
    { headers: { 'x-firebase-appcheck': 'bad' } },
    async () => { throw new Error('secret SDK detail'); },
    'enforced',
  )).rejects.toMatchObject({ code: 'app-check-required', status: 403 });
});

it('solo acepta los modos configurados', () => {
  expect(getAppCheckMode('disabled')).toBe('disabled');
  expect(getAppCheckMode('log-only')).toBe('log-only');
  expect(getAppCheckMode('enforced')).toBe('enforced');
});

it('falla cerrado ante un valor ausente o desconocido fuera del emulador', () => {
  expect(getAppCheckMode('unexpected', false)).toBe('enforced');
  expect(getAppCheckMode('', false)).toBe('enforced');
  expect(getAppCheckMode(null, false)).toBe('enforced');

  const previo = process.env.APP_CHECK_MODE;
  try {
    delete process.env.APP_CHECK_MODE;
    expect(getAppCheckMode(undefined, false)).toBe('enforced');
  } finally {
    if (previo === undefined) delete process.env.APP_CHECK_MODE;
    else process.env.APP_CHECK_MODE = previo;
  }
});

it('en Emulator Suite un valor ausente queda deshabilitado para poder probar', () => {
  expect(getAppCheckMode(undefined, true)).toBe('disabled');
  expect(getAppCheckMode('unexpected', true)).toBe('disabled');
  // Una configuracion explicita gana sobre el emulador.
  expect(getAppCheckMode('enforced', true)).toBe('enforced');
});

it('lee el token mediante el accessor de request', async () => {
  const verify = vi.fn(async () => undefined);
  const request = {
    get: vi.fn((name: string) => name === 'x-firebase-appcheck' ? 'valid' : undefined),
  };

  await expect(verifyConfiguredAppCheck(request, verify, 'enforced'))
    .resolves.toEqual({ mode: 'enforced', verified: true });
  expect(verify).toHaveBeenCalledWith('valid');
});
