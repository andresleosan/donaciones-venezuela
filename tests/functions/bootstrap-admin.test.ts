import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, it, vi } from 'vitest';
import { bootstrapAdmin } from '../../functions/src/auth/bootstrap-admin.js';

const execFileAsync = promisify(execFile);
const bootstrapScript = fileURLToPath(
  new URL('../../functions/scripts/bootstrap-admin.mjs', import.meta.url),
);

async function runBootstrapScript(overrides: Record<string, string>) {
  const environment = {
    PATH: process.env.PATH ?? '',
    SystemRoot: process.env.SystemRoot ?? '',
    ...overrides,
  };

  try {
    const result = await execFileAsync(process.execPath, [bootstrapScript], {
      env: environment,
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as {
      code?: number | string;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: failure.code ?? -1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

function expectGuardFailure(result: Awaited<ReturnType<typeof runBootstrapScript>>, message: string) {
  expect(result.code).not.toBe(0);
  expect(result.stderr).toContain(message);
  expect(result.stderr).not.toContain('firebase-admin');
  expect(result.stderr).not.toContain('initializeApp');
}

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

it('normaliza un fallo al escribir claims sin filtrar detalles del Admin SDK', async () => {
  const auth = {
    getUser: vi.fn(async () => ({ customClaims: { tenant: 'demo' } })),
    setCustomUserClaims: vi.fn(async () => { throw new Error('detalle interno del Admin SDK'); }),
  };

  const error = await bootstrapAdmin('admin-uid', auth).catch((failure: unknown) => failure);

  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe('No se pudo asignar el rol de administrador');
  expect((error as Error).message).not.toContain('detalle interno del Admin SDK');
});

it('rechaza un proyecto no permitido antes de importar Admin SDK', async () => {
  const result = await runBootstrapScript({
    FIREBASE_PROJECT_ID: 'proyecto-no-permitido',
    BOOTSTRAP_ADMIN_UID: 'admin-uid',
    BOOTSTRAP_ADMIN_APPROVED: 'YES',
  });

  expectGuardFailure(result, 'FIREBASE_PROJECT_ID no permitido para bootstrap');
});

it('rechaza la falta de aprobacion antes de importar Admin SDK', async () => {
  const result = await runBootstrapScript({
    FIREBASE_PROJECT_ID: 'demo-donaciones-venezuela',
    BOOTSTRAP_ADMIN_UID: 'admin-uid',
  });

  expectGuardFailure(result, 'Se requiere BOOTSTRAP_ADMIN_APPROVED=YES');
});

it('rechaza un UID vacio antes de importar Admin SDK', async () => {
  const result = await runBootstrapScript({
    FIREBASE_PROJECT_ID: 'demo-donaciones-venezuela',
    BOOTSTRAP_ADMIN_UID: '   ',
    BOOTSTRAP_ADMIN_APPROVED: 'YES',
  });

  expectGuardFailure(result, 'BOOTSTRAP_ADMIN_UID requerido');
});
