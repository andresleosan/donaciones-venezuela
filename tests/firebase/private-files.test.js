import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({ getIdToken: vi.fn() }));

vi.mock('../../src/firebase/firebase-auth.js', () => ({
  getIdToken: authMocks.getIdToken,
}));

const overrides = { apiBase: 'http://127.0.0.1:5001/demo/us-east1' };
const PATH = 'private/uid-1/receipts/r1.pdf';

let fetchMock;

beforeEach(() => {
  authMocks.getIdToken.mockResolvedValue('id-token-1');
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function respuesta(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

describe('getPrivateFileUrl', () => {
  it('envia el ID token y solo la ruta, y devuelve url y caducidad', async () => {
    const { getPrivateFileUrl } = await import('../../src/firebase/private-files.js');
    fetchMock.mockResolvedValue(respuesta({ url: 'https://firmada.example/x', expiresAt: '2026-09-06T12:15:00.000Z' }));

    const resultado = await getPrivateFileUrl(PATH, overrides);

    expect(resultado).toEqual({ url: 'https://firmada.example/x', expiresAt: '2026-09-06T12:15:00.000Z' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:5001/demo/us-east1/getPrivateFileUrl',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer id-token-1' },
        body: JSON.stringify({ path: PATH }),
      },
    );
  });

  it('exige sesion antes de llamar a la Function', async () => {
    const { getPrivateFileUrl } = await import('../../src/firebase/private-files.js');
    authMocks.getIdToken.mockResolvedValue(null);

    await expect(getPrivateFileUrl(PATH, overrides))
      .rejects.toThrow('Entra con tu cuenta para ver este archivo');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['ruta fuera del prefijo privado', 'public/uid-1/receipts/r1.pdf'],
    ['ruta vacia', ''],
    ['ruta que no es texto', 42],
  ])('rechaza localmente una %s', async (_caso, path) => {
    const { getPrivateFileUrl } = await import('../../src/firebase/private-files.js');

    await expect(getPrivateFileUrl(path, overrides)).rejects.toThrow('Ruta de archivo invalida');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['forbidden', 403, 'No tienes permiso para ver este archivo'],
    ['file-not-found', 404, 'El archivo ya no esta disponible'],
    ['rate-limit-exceeded', 429, 'Demasiadas solicitudes, intenta mas tarde'],
    ['app-check-required', 403, 'No pudimos verificar la aplicacion'],
  ])('traduce el codigo %s a un mensaje para la persona', async (code, status, mensaje) => {
    const { getPrivateFileUrl } = await import('../../src/firebase/private-files.js');
    fetchMock.mockResolvedValue(respuesta({ error: { code, message: 'Internal detail' } }, false, status));

    await expect(getPrivateFileUrl(PATH, overrides)).rejects.toThrow(mensaje);
  });

  it('no propaga detalles internos ante un error desconocido o de red', async () => {
    const { getPrivateFileUrl } = await import('../../src/firebase/private-files.js');

    fetchMock.mockResolvedValue(respuesta({ error: { code: 'internal', message: 'stack trace' } }, false, 500));
    await expect(getPrivateFileUrl(PATH, overrides)).rejects.toThrow('No se pudo abrir el archivo');

    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(getPrivateFileUrl(PATH, overrides)).rejects.toThrow('No se pudo abrir el archivo');
  });

  it('rechaza una respuesta sin url o sin caducidad', async () => {
    const { getPrivateFileUrl } = await import('../../src/firebase/private-files.js');
    fetchMock.mockResolvedValue(respuesta({ url: 'https://firmada.example/x' }));

    await expect(getPrivateFileUrl(PATH, overrides)).rejects.toThrow('No se pudo abrir el archivo');
  });
});

describe('requestPrivateFileDeletion', () => {
  it('llama al endpoint de borrado y confirma', async () => {
    const { requestPrivateFileDeletion } = await import('../../src/firebase/private-files.js');
    fetchMock.mockResolvedValue(respuesta({ success: true }));

    await expect(requestPrivateFileDeletion(PATH, overrides)).resolves.toEqual({ success: true });
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:5001/demo/us-east1/deletePrivateFile');
  });

  it('no da por borrado un archivo si la respuesta no lo confirma', async () => {
    const { requestPrivateFileDeletion } = await import('../../src/firebase/private-files.js');
    fetchMock.mockResolvedValue(respuesta({ success: false }));

    await expect(requestPrivateFileDeletion(PATH, overrides)).rejects.toThrow('No se pudo abrir el archivo');
  });
});

describe('URL base de Functions', () => {
  it('deriva el endpoint desplegado del projectId y la region', async () => {
    const { functionUrl, functionsBaseUrl } = await import('../../src/firebase/functions-base.js');

    expect(functionsBaseUrl({ projectId: 'donaciones-venezuela-4fc29' }))
      .toBe('https://us-east1-donaciones-venezuela-4fc29.cloudfunctions.net');
    expect(functionUrl('api', { projectId: 'demo' }))
      .toBe('https://us-east1-demo.cloudfunctions.net/api');
  });

  it('prefiere la base explicita y le quita la barra final', async () => {
    const { functionsBaseUrl } = await import('../../src/firebase/functions-base.js');

    expect(functionsBaseUrl({ apiBase: 'http://127.0.0.1:5001/demo/us-east1/' }))
      .toBe('http://127.0.0.1:5001/demo/us-east1');
  });

  it('rechaza un nombre de Function que no es un identificador', async () => {
    const { functionUrl } = await import('../../src/firebase/functions-base.js');

    for (const nombre of ['../secreto', 'api/x', '', 'con-guion']) {
      expect(() => functionUrl(nombre, { projectId: 'demo' })).toThrow('Nombre de Function invalido');
    }
  });
});
