import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { DEMO_STORAGE_BUCKET } from '../emulators/entorno.js';

// Guarda de regresion de una costura real: el cliente apuntaba a un bucket, las
// pruebas de emulador a otro y Functions resolvia un tercero con el bucket por
// defecto. Cliente y servidor deben nombrar el MISMO bucket en cada proyecto.
function leerEnv(ruta: string): Record<string, string> {
  return Object.fromEntries(
    readFileSync(ruta, 'utf8')
      .split('\n')
      .map((linea) => linea.trim())
      .filter((linea) => linea && !linea.startsWith('#'))
      .map((linea) => {
        const corte = linea.indexOf('=');
        return [linea.slice(0, corte).trim(), linea.slice(corte + 1).trim()];
      }),
  );
}

it('el proyecto de desarrollo usa el mismo bucket en cliente y en Functions', () => {
  const cliente = leerEnv('.env.example');
  const servidor = leerEnv('functions/.env.donaciones-venezuela-4fc29');

  expect(servidor.STORAGE_BUCKET).toBe(cliente.VITE_FIREBASE_STORAGE_BUCKET);
  expect(servidor.STORAGE_BUCKET).toBeTruthy();
});

it('el proyecto de pruebas declara el bucket que sirve el emulador', () => {
  const servidor = leerEnv('functions/.env.demo-donaciones-venezuela');

  expect(servidor.STORAGE_BUCKET).toBe(DEMO_STORAGE_BUCKET);
});

it('cada proyecto declara su modo de App Check', () => {
  expect(leerEnv('functions/.env.demo-donaciones-venezuela').APP_CHECK_MODE).toBe('disabled');
  expect(leerEnv('functions/.env.donaciones-venezuela-4fc29').APP_CHECK_MODE).toBe('log-only');
});
