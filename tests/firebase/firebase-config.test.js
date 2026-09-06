import { afterEach, expect, it } from 'vitest';

import { firebaseConfig, validateFirebaseConfig } from '../../src/firebase/firebase-config.js';
import { functionsBaseUrl } from '../../src/firebase/functions-base.js';

const COMPLETA = {
  apiKey: 'k', authDomain: 'd', projectId: 'demo-donaciones-venezuela',
  storageBucket: 'b', messagingSenderId: 'm', appId: 'a',
};

afterEach(() => {
  delete globalThis.DV_ENTORNO;
});

// El bundle de Vite se inyecta en el <head> y se evalúa antes que
// `js/entorno.js`: si la configuración se resolviera al importar el módulo, la
// sobrescritura de entorno nunca tendría efecto.
it('lee DV_ENTORNO en cada acceso, no al importar el módulo', () => {
  expect(firebaseConfig.projectId).toBe('');

  globalThis.DV_ENTORNO = { firebaseConfig: COMPLETA };

  expect(firebaseConfig.projectId).toBe('demo-donaciones-venezuela');
  expect(validateFirebaseConfig()).toBe(firebaseConfig);
});

it('deriva la URL de Functions del projectId que llega por DV_ENTORNO', () => {
  globalThis.DV_ENTORNO = { firebaseConfig: COMPLETA };

  expect(functionsBaseUrl()).toBe('https://us-east1-demo-donaciones-venezuela.cloudfunctions.net');
});

it('prefiere DV_ENTORNO.apiBase sobre el projectId', () => {
  globalThis.DV_ENTORNO = { firebaseConfig: COMPLETA, apiBase: 'http://127.0.0.1:5001/demo/us-east1/' };

  expect(functionsBaseUrl()).toBe('http://127.0.0.1:5001/demo/us-east1');
});

it('exige la configuración completa', () => {
  expect(() => validateFirebaseConfig()).toThrow(/Configuracion Firebase incompleta/);
});
