import { expect, it } from 'vitest';

// Sin mocks: el barrel debe resolver cada simbolo real. Un reexport roto
// (como el antiguo `uploadFile`) pasa desapercibido en Vitest y rompe el build.
it('el indice Firebase no reexporta simbolos inexistentes', async () => {
  const firebase = await import('../../src/firebase/index.js');
  const faltantes = Object.entries(firebase)
    .filter(([, value]) => value === undefined)
    .map(([name]) => name);

  expect(faltantes).toEqual([]);
  expect(typeof firebase.uploadPrivateFile).toBe('function');
  expect(typeof firebase.createPrivateFilePath).toBe('function');
  expect(typeof firebase.listPublicPlaces).toBe('function');
  expect(firebase).not.toHaveProperty('uploadFile');
  expect(firebase).not.toHaveProperty('deleteFile');
});
