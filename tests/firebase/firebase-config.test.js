import { afterEach, expect, it } from 'vitest';

import {
  EMULADORES_POR_DEFECTO,
  configuracionEmuladores,
  firebaseConfig,
  validateFirebaseConfig,
} from '../../src/firebase/firebase-config.js';
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

// El Emulator Suite se activa desde `js/entorno.js`, que se sirve fuera del
// repositorio: sin `DV_ENTORNO.emuladores` la app habla con Firebase de verdad.
it('no conecta emuladores por defecto', () => {
  expect(configuracionEmuladores()).toBeNull();
});

it('usa los puertos de firebase.json cuando se activa con un booleano', () => {
  globalThis.DV_ENTORNO = { emuladores: true };

  expect(configuracionEmuladores()).toEqual(EMULADORES_POR_DEFECTO);
});

it('permite sobrescribir el puerto de un servicio', () => {
  globalThis.DV_ENTORNO = { emuladores: { firestore: { host: '127.0.0.1', port: 8085 } } };

  expect(configuracionEmuladores()).toMatchObject({
    firestore: { host: '127.0.0.1', port: 8085 },
    auth: EMULADORES_POR_DEFECTO.auth,
  });
});

// Un "emulador" remoto es un servidor ajeno hablando por Firebase: mejor romper
// que autenticar contra el.
it('rechaza un emulador fuera de la maquina local', () => {
  globalThis.DV_ENTORNO = { emuladores: { auth: { host: 'auth.ejemplo.com', port: 9099 } } };

  expect(() => configuracionEmuladores()).toThrow(/fuera de la maquina local/);
});

it('trata "0" y "false" como apagado', () => {
  globalThis.DV_ENTORNO = { emuladores: 'false' };
  expect(configuracionEmuladores()).toBeNull();

  globalThis.DV_ENTORNO = { emuladores: '0' };
  expect(configuracionEmuladores()).toBeNull();
});
